import { alertHost, alertSettings, lastAlertDelivery, lastAlertTest } from "./alerts.ts";
import type { Watch } from "./app.ts";
import type { Scan } from "./scan.ts";
import { HELD_NOTICE, PROBES_DISAGREE_NOTICE, SLOW_NOTICE } from "./notices.ts";
import { pendingText } from "./pending.ts";
import type { Check } from "./store.ts";
import { cadenceOf, publicConfig, targetsOf } from "./targets.ts";

export interface CheckView extends Check {
  readonly serviceLabel: string;
  readonly note: string | null;
  /** What the check contacts, in a sentence with no secret in it. */
  readonly target: string;
  /** How often it runs, in words. */
  readonly cadence: string;
}

/**
 * A scan's suggestions as the checks stand now: its name, what it contacts, how often, and its
 * current state, which the review needs to say what applying would change. A check deleted since
 * the scan leaves the list; Details keeps its history.
 */
export const withTargets = (
  watch: Watch,
  scan: Scan,
  checks: ReadonlyMap<string, Check> = new Map(watch.store.checks().map((c) => [c.id, c])),
  target: (check: Check) => string = targetsOf(watch),
): Scan => ({
  ...scan,
  suggestions: scan.suggestions.flatMap((s) => {
    const check = checks.get(s.checkId);
    if (check === undefined) return [s];
    if (check.state === "deleted") return [];
    return [{ ...s, intent: check.intent, state: check.state, target: target(check), cadence: cadenceOf(check.cadenceSeconds), keyId: check.keyId }];
  }),
});

/**
 * Everything the page and the inline view show, in one read. Never contains a key value, nor a
 * secret in a check's settings: those, and a heartbeat's ping address, the page fetches on its own.
 */
export const readState = (watch: Watch) => {
  const services = watch.store.services();
  const labels = new Map(services.map((s) => [s.id, s.label]));
  const notes = watch.store.notes(200);
  const latestNote = new Map<string, string>();
  for (const note of notes)
    if (note.checkId !== null && !latestNote.has(note.checkId)) latestNote.set(note.checkId, note.text);
  const stored = watch.store.checks();
  // Keys and vendors are read once here, for the targets and for the state's own lists.
  const keys = watch.keys();
  const vendors = watch.vendors();
  const target = targetsOf(watch, keys, vendors);
  const checks: Array<CheckView> = stored.map((check) => ({
    ...check,
    config: publicConfig(check),
    serviceLabel: labels.get(check.serviceId) ?? check.serviceId,
    note: latestNote.get(check.id) ?? null,
    target: target(check),
    cadence: cadenceOf(check.cadenceSeconds),
  }));
  return {
    generatedAt: watch.now(),
    services,
    checks,
    keys,
    events: watch.store.events(20),
    notes: notes.filter((n) => n.checkId === null).slice(0, 10),
    vendorDrafts: watch.store.vendorDrafts().filter((d) => d.state === "draft"),
    // The host only: the address belongs to the T3 task, and this state can render inside a chat.
    alerts: (() => {
      const a = alertSettings(watch);
      return {
        on: a.url !== null,
        host: alertHost(a.url),
        signed: a.secret !== null,
        lastTest: lastAlertTest(watch),
        lastDelivery: lastAlertDelivery(watch),
      };
    })(),
    setup: {
      scan: (() => {
        const scan = watch.store.getKv<Scan | null>("scan", null);
        return scan === null ? null : withTargets(watch, scan, new Map(stored.map((c) => [c.id, c])), target);
      })(),
      status: watch.scanner.status(),
    },
    link: watch.link(),
    vendors: [...vendors.values()].map((v) => ({
      id: v.id,
      label: v.label,
      keyUrl: v.key?.keyUrl ?? null,
      signIn: v.signIn ?? null,
    })),
  };
};
export type WatchState = ReturnType<typeof readState>;

/** Home as text, for hosts that cannot render the view and for agents. */
export const homeText = (state: WatchState) => {
  const on = state.checks.filter((c) => c.state === "on");
  const failing = on.filter((c) => c.lastOutcome === "fail");
  const unknown = on.filter((c) => c.lastOutcome === "unknown");
  const drafts = state.checks.filter((c) => c.state === "draft");
  const passing = on.filter((c) => c.lastOutcome === "pass").length;
  const line = (c: CheckView) => `- ${c.serviceLabel}: ${c.intent} (${c.id}): ${c.lastSummary ?? "no result yet"}`;
  const lines = [
    on.length === 0
      ? state.setup.scan === null
        ? "Watch is not set up yet. Ask the person to open the page, choose what Watch may read and press Scan these."
        : "Nothing is watched yet. Review the scan with the person, then call watch_apply."
      : failing.length === 0
        ? `All clear: ${passing} of ${on.length} checks passing.`
        : `${failing.length} broken, ${passing} passing, ${on.length} on.`,
  ];
  if (state.link.probesDisagree) lines.unshift(PROBES_DISAGREE_NOTICE);
  if (state.link.offlineSince !== null)
    lines.unshift(
      `Watch cannot reach the internet since ${state.link.offlineSince.slice(0, 16).replace("T", " ")} UTC. ${HELD_NOTICE}`,
    );
  if (state.link.slowSince !== null)
    lines.unshift(`Watch's connection has been slow since ${state.link.slowSince.slice(0, 16).replace("T", " ")} UTC. ${SLOW_NOTICE}`);
  if (failing.length > 0) lines.push("", "Broken:", ...failing.map(line));
  if (unknown.length > 0) lines.push("", "Could not run:", ...unknown.map(line));
  const checkingAgain = on.filter((c) => c.pending !== null);
  if (checkingAgain.length > 0)
    lines.push(
      "",
      "Checking again after one bad run:",
      ...checkingAgain.map((c) => `- ${c.serviceLabel}: ${c.intent} (${c.id}): ${pendingText(c.pending!.outcome)}: ${c.pending!.summary}`),
    );
  if (drafts.length > 0) lines.push("", "Drafts waiting for the person:", ...drafts.map(line));
  if (state.vendorDrafts.length > 0)
    lines.push("", `Vendor drafts waiting: ${state.vendorDrafts.map((d) => String(d.description.label ?? d.id)).join(", ")}`);
  return lines.join("\n");
};
