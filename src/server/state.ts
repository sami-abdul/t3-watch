import type { Watch } from "./app.ts";
import type { Scan } from "./scan.ts";
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
    setup: { scan: watch.store.getKv<Scan | null>("scan", null), status: watch.scanner.status() },
    vendors: [...watch.vendors().values()].map((v) => ({
      id: v.id,
      label: v.label,
      keyUrl: v.key?.keyUrl ?? null,
      signIn: v.signIn ?? null,
    })),
  };
};
export type WatchState = ReturnType<typeof readState>;
