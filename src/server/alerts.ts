/**
 * Change events go to one URL, normally a T3 webhook task that wakes the Watch thread. Only
 * changes are sent, so hours where everything passes cost nothing.
 */
import { createHmac, randomBytes } from "node:crypto";

import { type WatchCore, WatchError } from "./app.ts";
import type { ChangeEvent } from "./store.ts";

export interface AlertSettings {
  readonly url: string | null;
  /** HMAC-SHA256 key for the X-Watch-Signature header. */
  readonly secret: string | null;
}

/** How the webhook answered a test or a real alert: when, whether it accepted, what to tell people. */
export interface AlertResult {
  readonly at: string;
  readonly ok: boolean;
  /** The webhook's HTTP status, or null when it did not answer. */
  readonly status: number | null;
  readonly message: string;
}

const MAX_ATTEMPTS = 20;
/** Tests closer together than this are refused, so a double press wakes the thread once. */
export const TEST_GAP_SECONDS = 10;

export const alertSettings = (watch: WatchCore) =>
  watch.store.getKv<AlertSettings>("alerts", { url: null, secret: null });

export const lastAlertTest = (watch: WatchCore) => watch.store.getKv<AlertResult | null>("alertTest", null);

/** How the last real change event fared, so a webhook that stops accepting shows without a test. */
export const lastAlertDelivery = (watch: WatchCore) => watch.store.getKv<AlertResult | null>("alertDelivery", null);

/** Results about an earlier address or secret say nothing about the new ones. */
const forgetResults = (watch: WatchCore) => {
  watch.store.setKv("alertTest", null);
  watch.store.setKv("alertDelivery", null);
};

/** The webhook's host. People and chats see this, not the address, which belongs to the task. */
export const alertHost = (url: string | null) => (url === null ? null : (URL.parse(url)?.host ?? null));

export const setAlerts = (watch: WatchCore, input: { url: string | null; secret?: string | null }) => {
  if (input.url !== null) {
    const url = URL.parse(input.url);
    if (url === null || !/^https?:$/.test(url.protocol)) throw new WatchError("The alert URL must be http or https");
  }
  const previous = alertSettings(watch);
  // A new destination starts fresh rather than receiving a backlog.
  if (input.url !== previous.url) watch.store.dropPendingEvents(watch.now());
  const next: AlertSettings = { url: input.url, secret: input.secret === undefined ? previous.secret : input.secret };
  watch.store.setKv("alerts", next);
  if (next.url !== previous.url || next.secret !== previous.secret) forgetResults(watch);
  return { url: next.url, host: alertHost(next.url), signed: next.secret !== null };
};

/**
 * Makes a new signing secret, replacing any earlier one. Only the page shows it, once: a secret
 * that passes through a chat stays in that chat's transcript.
 */
export const makeAlertSecret = (watch: WatchCore) => {
  const secret = randomBytes(32).toString("hex");
  watch.store.setKv("alerts", { ...alertSettings(watch), secret } satisfies AlertSettings);
  forgetResults(watch);
  return secret;
};

/** One alert body's headers, signed when there is a secret. */
const alertHeaders = (secret: string | null, body: string) => {
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "t3-watch" };
  if (secret !== null) headers["x-watch-signature"] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return headers;
};

/** The webhook's answer, or why there was none. */
type Answer = { readonly ok: boolean; readonly status: number } | { readonly failure: string };

const failureReason = (error: unknown) => {
  if (error instanceof Error && error.name === "TimeoutError") return "no answer within 10 seconds";
  // Node's fetch says only "fetch failed" and keeps the reason, such as ENOTFOUND, in its cause.
  const cause = error instanceof Error ? error.cause : undefined;
  const reason = cause instanceof Error && cause.message !== "" ? cause.message : error instanceof Error ? error.message : String(error);
  return reason === "" ? "no reason given" : reason;
};

/**
 * POSTs one alert and reads only its status. 307 and 308 keep the method and body, so they are
 * followed, never from https down to http. Any other redirect would turn the POST into a GET, often
 * of a login page, and count its 200 as delivered, so it counts as not accepted.
 */
const postAlert = async (watch: WatchCore, url: string, secret: string | null, body: string): Promise<Answer> => {
  // One deadline for the whole chain, redirects included.
  const signal = AbortSignal.timeout(10_000);
  let target = url;
  try {
    for (let hop = 0; ; hop += 1) {
      const response = await watch.deps.fetch(target, {
        method: "POST",
        headers: alertHeaders(secret, body),
        body,
        redirect: "manual",
        signal,
      });
      // An unread body holds the connection open.
      void response.body?.cancel().catch(() => {});
      const location = response.headers.get("location");
      const next = (response.status === 307 || response.status === 308) && location !== null ? URL.parse(location, target) : null;
      const downgrade = next !== null && next.protocol !== "https:" && URL.parse(target)?.protocol === "https:";
      if (next !== null && /^https?:$/.test(next.protocol) && !downgrade && hop < 3) {
        target = next.href;
        continue;
      }
      return { ok: response.ok, status: response.status };
    }
  } catch (error) {
    return { failure: failureReason(error) };
  }
};

const answerMessage = (noun: "test alert" | "alert", answer: Answer, signed: boolean) => {
  if ("failure" in answer) return `Watch could not reach the webhook: ${answer.failure}.`;
  const { ok, status } = answer;
  if (ok) {
    if (!signed) return `The webhook accepted an unsigned ${noun}. Make a signing secret, so its task can tell Watch's alerts from anyone else's.`;
    return noun === "test alert" ? "The webhook accepted a signed test alert, so alerts reach the thread it wakes." : "The webhook accepted the last alert.";
  }
  if (status === 401 || status === 403)
    return signed
      ? `The webhook refused ${noun === "test alert" ? "the test alert" : "an alert"} with HTTP ${status}, so its task does not have Watch's current signing secret. Make a new secret on the page and give it to the task through the Watch thread.`
      : `The webhook refused an unsigned ${noun} with HTTP ${status}, so it expects a signature. Make a signing secret on the page and give it to the task through the Watch thread.`;
  if (status >= 300 && status < 400)
    return `The webhook answered HTTP ${status}, a redirect, so alerts would not arrive. Ask the Watch thread to set up alerts again with the task's own address.`;
  if (status === 404 || status === 410)
    return `The webhook answered HTTP ${status}, so its task may be gone. Ask the Watch thread to set up alerts again.`;
  return `The webhook answered HTTP ${status}, so alerts may not arrive.`;
};

const resultOf = (noun: "test alert" | "alert", at: string, answer: Answer, signed: boolean): AlertResult => ({
  at,
  ok: "ok" in answer && answer.ok,
  status: "status" in answer ? answer.status : null,
  message: answerMessage(noun, answer, signed),
});

export const eventPayload = (watch: WatchCore, event: ChangeEvent, pageUrl: string) => {
  const check = watch.store.check(event.checkId);
  const service = check === null ? null : watch.store.service(check.serviceId);
  const label = [service?.label, check?.intent ?? event.checkId].filter(Boolean).join(": ");
  // Intents name the healthy state ("CI on main is passing"), so the change leads the sentence.
  const what =
    event.to === "fail" ? "Watch check failed" : event.to === "pass" ? "Watch check passing again" : "Watch check could not run";
  return {
    kind: "watch.change",
    checkId: event.checkId,
    service: service?.label ?? null,
    intent: check?.intent ?? null,
    from: event.from,
    to: event.to,
    summary: event.summary,
    at: event.at,
    page: pageUrl,
    text: `${what}: ${label}. ${event.summary}`,
  };
};

const sameSettings = (a: AlertSettings, b: AlertSettings) => a.url === b.url && a.secret === b.secret;

/** Sends pending events. Failed sends stay pending for the next call. */
export const deliverAlerts = async (watch: WatchCore, pageUrl: string) => {
  const settings = alertSettings(watch);
  if (settings.url === null) return 0;
  let sent = 0;
  let last: AlertResult | null = null;
  for (const event of watch.store.pendingEvents()) {
    const answer = await postAlert(watch, settings.url, settings.secret, JSON.stringify(eventPayload(watch, event, pageUrl)));
    const ok = "ok" in answer && answer.ok;
    // Settings replaced while this was out: the rest of the queue, and any result, belong to them.
    if (!sameSettings(settings, alertSettings(watch))) {
      if (ok) watch.store.markEvent(event.id, watch.now());
      return sent + (ok ? 1 : 0);
    }
    last = resultOf("alert", watch.now(), answer, settings.secret !== null);
    // After many failures an event is dropped, so one bad URL cannot pile up forever.
    watch.store.markEvent(event.id, ok || event.attempts + 1 >= MAX_ATTEMPTS ? watch.now() : null);
    if (ok) sent += 1;
    else break;
  }
  // The page and the CLI say whether real alerts get through, not only tests; one write a pass.
  if (last !== null) watch.store.setKv("alertDelivery", last);
  return sent;
};

export const testPayload = (at: string, pageUrl: string) => ({
  kind: "watch.test",
  checkId: null,
  service: null,
  intent: null,
  from: null,
  to: null,
  summary: "Test alert",
  at,
  page: pageUrl,
  // The task's prompt may say to look into a check; this text tells the woken agent there is none.
  text: "Watch test alert: alerts from Watch reach this thread. This is only a test, so there is no check to look into and nothing to do.",
});

const inFlight = new WeakSet<WatchCore>();
/** When each Watch's last test finished, by its clock, so tests stay apart when settings change. */
const lastFinished = new WeakMap<WatchCore, number>();

/**
 * Sends one signed test alert and keeps the result, so the page and the CLI can say whether alerts
 * work. A 2xx answer means the webhook accepted it; T3 checks the signature before it answers.
 */
export const sendTestAlert = async (watch: WatchCore, pageUrl: string): Promise<AlertResult> => {
  const settings = alertSettings(watch);
  if (settings.url === null) throw new WatchError("Alerts are off, so there is nowhere to send a test. Connect them first.", 409);
  const at = watch.now();
  const finished = lastFinished.get(watch);
  const since = finished === undefined ? null : Date.parse(at) - finished;
  // A clock set back makes the gap negative; that should not block tests until it catches up.
  if (inFlight.has(watch) || (since !== null && since >= 0 && since < TEST_GAP_SECONDS * 1000))
    throw new WatchError(`A test alert went out moments ago. Wait ${TEST_GAP_SECONDS} seconds before sending another.`, 429);
  inFlight.add(watch);
  try {
    const answer = await postAlert(watch, settings.url, settings.secret, JSON.stringify(testPayload(at, pageUrl)));
    const result = resultOf("test alert", at, answer, settings.secret !== null);
    // A result about an address or secret replaced while the test was out would describe the old one.
    if (!sameSettings(settings, alertSettings(watch)))
      return { ...result, message: `${result.message} The alert settings changed while it was out, so send another to test the new ones.` };
    watch.store.setKv("alertTest", result);
    return result;
  } finally {
    inFlight.delete(watch);
    lastFinished.set(watch, Date.parse(watch.now()));
  }
};
