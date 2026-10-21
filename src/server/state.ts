import { alertSettings } from "./alerts.ts";
import type { Watch } from "./app.ts";
import type { Scan } from "./scan.ts";
import { HELD_NOTICE, PROBES_DISAGREE_NOTICE } from "./notices.ts";
import { pendingText } from "./pending.ts";
import type { Check } from "./store.ts";

export interface CheckView extends Check {
  readonly serviceLabel: string;
  readonly note: string | null;
  /** Ping URL path for heartbeat checks. */
  readonly pingPath: string | null;
}

/** Everything the page and the inline view show, in one read. Never contains a key value. */
export const readState = (watch: Watch) => {
  const services = watch.store.services();
  const labels = new Map(services.map((s) => [s.id, s.label]));
  const notes = watch.store.notes(200);
  const latestNote = new Map<string, string>();
  for (const note of notes)
    if (note.checkId !== null && !latestNote.has(note.checkId)) latestNote.set(note.checkId, note.text);
  const checks: Array<CheckView> = watch.store.checks().map((check) => ({
    ...check,
    serviceLabel: labels.get(check.serviceId) ?? check.serviceId,
    note: latestNote.get(check.id) ?? null,
    pingPath:
      check.kind === "heartbeat" && typeof check.config.token === "string"
        ? `/hb/${check.config.token}`
        : null,
  }));
  return {
    generatedAt: watch.now(),
    services,
    checks,
    keys: watch.keys(),
    events: watch.store.events(20),
    notes: notes.filter((n) => n.checkId === null).slice(0, 10),
    vendorDrafts: watch.store.vendorDrafts().filter((d) => d.state === "draft"),
    alerts: (() => {
      const a = alertSettings(watch);
      return { url: a.url, signed: a.secret !== null };
    })(),
    setup: { scan: watch.store.getKv<Scan | null>("scan", null), status: watch.scanner.status() },
    link: watch.link(),
    vendors: [...watch.vendors().values()].map((v) => ({
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
        ? "Watch is not set up yet. Call watch_scan."
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
