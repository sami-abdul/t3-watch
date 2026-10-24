import { type WatchCore, WatchError } from "./app.ts";
import { type AlertResult, eventPayload, TEST_GAP_SECONDS } from "./alerts.ts";

interface Settings {
  readonly ciphertext: string;
  readonly afterId: number;
}

const settings = (watch: WatchCore) => watch.store.getKv<Settings | null>("slack", null);
export const slackState = (watch: WatchCore) => ({
  on: settings(watch) !== null,
  lastTest: watch.store.getKv<AlertResult | null>("slackTest", null),
  lastDelivery: watch.store.getKv<AlertResult | null>("slackDelivery", null),
});

/** Only the page accepts this secret. Stored values never enter the public state or key list. */
export const setSlack = (watch: WatchCore, value: unknown) => {
  if (watch.sample) throw new WatchError("The demo takes no Slack webhook and sends no real Slack alerts. Use your own Watch.", 403);
  if (value !== null) {
    const url = typeof value === "string" ? URL.parse(value.trim()) : null;
    if (url === null || url.protocol !== "https:" || !["hooks.slack.com", "hooks.slack-gov.com"].includes(url.hostname) ||
      url.port !== "" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" ||
      !/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname))
      throw new WatchError("Paste a Slack incoming-webhook URL from your Slack app's Incoming Webhooks page.");
    watch.store.setKv("slack", { ciphertext: watch.keyring.encrypt(url.href), afterId: watch.store.events(1)[0]?.id ?? 0 } satisfies Settings);
  } else watch.store.setKv("slack", null);
  watch.store.setKv("slackTest", null);
  watch.store.setKv("slackDelivery", null);
  watch.store.setKv("slackNextSend", null);
  return slackState(watch);
};

/** Slack plain text must not turn a check's name into a channel mention or link. */
const escapeText = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const post = async (watch: WatchCore, config: Settings, text: string) => {
  const at = watch.now();
  try {
    const response = await watch.deps.fetch(watch.keyring.decrypt(config.ciphertext), {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: escapeText(text).slice(0, 3500), mrkdwn: false, unfurl_links: false, unfurl_media: false }),
    });
    const ok = response.status === 200 && (await response.text()).trim() === "ok";
    const retry = Number(response.headers.get("retry-after"));
    return {
      result: { at, ok, status: response.status, message: ok ? "Slack accepted the message." : `Slack did not accept the message, HTTP ${response.status}. Check the webhook and channel in your Slack app.` } satisfies AlertResult,
      delay: response.status === 429 && Number.isFinite(retry) && retry > 0 ? Math.min(retry, 86_400) * 1000 : 1000,
    };
  } catch {
    // Fetch errors can contain the destination URL. Never keep or log their text.
    return { result: { at, ok: false, status: null, message: "Watch could not reach Slack within 10 seconds. Check the connection and try again." } satisfies AlertResult, delay: 1000 };
  }
};

const current = (watch: WatchCore, config: Settings) => settings(watch)?.ciphertext === config.ciphertext;
const sending = new WeakSet<WatchCore>();

/** One message per pass and at least a second apart, with retries on the service's minute timer. */
export const deliverSlack = async (watch: WatchCore, pageUrl: string) => {
  const config = settings(watch);
  const next = watch.store.getKv<number | null>("slackNextSend", null);
  if (config === null || watch.sample || sending.has(watch) || (next !== null && Date.parse(watch.now()) < next)) return 0;
  const event = watch.store.pendingSlackEvents(config.afterId)[0];
  if (event === undefined) return 0;
  sending.add(watch);
  try {
    const { result, delay } = await post(watch, config, `${eventPayload(watch, event, pageUrl).text}\n${pageUrl}`);
    if (!current(watch, config)) return 0;
    watch.store.markSlackEvent(event.id, result.ok || event.attempts + 1 >= 20 ? watch.now() : null);
    watch.store.setKv("slackDelivery", result);
    watch.store.setKv("slackNextSend", Date.parse(watch.now()) + delay);
    return result.ok ? 1 : 0;
  } finally { sending.delete(watch); }
};

const testing = new WeakSet<WatchCore>();
const lastTest = new WeakMap<WatchCore, number>();
export const testSlack = async (watch: WatchCore) => {
  if (watch.sample) throw new WatchError("The demo sends no real Slack alerts. Test Slack in your own Watch.", 403);
  const config = settings(watch);
  if (config === null) throw new WatchError("Connect Slack before sending a test.", 409);
  const at = Date.parse(watch.now());
  const previous = lastTest.get(watch);
  const next = watch.store.getKv<number | null>("slackNextSend", null);
  if (sending.has(watch) || testing.has(watch) || (next !== null && at < next) || (previous !== undefined && at >= previous && at - previous < TEST_GAP_SECONDS * 1000))
    throw new WatchError("A Slack message went out moments ago. Wait before sending another test.", 429);
  testing.add(watch);
  sending.add(watch);
  try {
    const { result, delay } = await post(watch, config, "Watch test alert. Slack alerts are connected. This is only a test; no check needs attention.");
    if (!current(watch, config)) return { ...result, message: "Slack settings changed during the test. Test the current settings again." };
    watch.store.setKv("slackTest", result);
    watch.store.setKv("slackNextSend", Date.parse(watch.now()) + delay);
    return result;
  } finally {
    testing.delete(watch); sending.delete(watch); lastTest.set(watch, Date.parse(watch.now()));
  }
};
