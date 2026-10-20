/**
 * Change events go to one URL, normally a T3 webhook task that wakes the Watch thread. Only
 * changes are sent, so hours where everything passes cost nothing.
 */
import { createHmac } from "node:crypto";

import { type WatchCore, WatchError } from "./app.ts";
import type { ChangeEvent } from "./store.ts";

export interface AlertSettings {
  readonly url: string | null;
  /** HMAC-SHA256 key for the X-Watch-Signature header. */
  readonly secret: string | null;
}
const MAX_ATTEMPTS = 20;

export const alertSettings = (watch: WatchCore) =>
  watch.store.getKv<AlertSettings>("alerts", { url: null, secret: null });

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
  return { url: next.url, signed: next.secret !== null };
};

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

/** Sends pending events. Failed sends stay pending for the next call. */
export const deliverAlerts = async (watch: WatchCore, pageUrl: string) => {
  const settings = alertSettings(watch);
  if (settings.url === null) return 0;
  let sent = 0;
  for (const event of watch.store.pendingEvents()) {
    const body = JSON.stringify(eventPayload(watch, event, pageUrl));
    const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "t3-watch" };
    if (settings.secret !== null)
      headers["x-watch-signature"] = `sha256=${createHmac("sha256", settings.secret).update(body).digest("hex")}`;
    let ok = false;
    try {
      const response = await watch.deps.fetch(settings.url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
      ok = response.ok;
    } catch {
      ok = false;
    }
    // After many failures an event is dropped, so one bad URL cannot pile up forever.
    watch.store.markEvent(event.id, ok || event.attempts + 1 >= MAX_ATTEMPTS ? watch.now() : null);
    if (ok) sent += 1;
    else break;
  }
  return sent;
};
