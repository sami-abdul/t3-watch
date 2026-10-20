import { type CheckContext, runCheck } from "./checks/index.ts";
import { type Connectivity, heldWhenOffline, MAX_HOLD_MS, provesInternet } from "./connectivity.ts";
import { type ChangeEvent, type Check, changesState } from "./store.ts";

const CONCURRENCY = 4;

/** Runs due checks on a clock. Each check runs at most once at a time. */
export const makeRunner = (context: CheckContext, onEvent: (event: ChangeEvent) => void, link: Connectivity) => {
  const running = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  const runAndRecord = async (check: Check) => {
    if (running.has(check.id)) return null;
    running.add(check.id);
    try {
      const started = context.deps.now();
      const result = await runCheck(check, context);
      const finished = context.deps.now();
      const fresh = context.store.check(check.id);
      if (fresh === null) return null;
      const nextRunAt = new Date(finished.getTime() + fresh.cadenceSeconds * 1000).toISOString();
      // A failure may only mean Watch's own link is down. One that would change the check's state
      // probes; one that changes nothing probes only while Watch already counts itself offline,
      // which keeps the notice true and the check's real failure reason in place. Held runs keep
      // the check as it was, with no event, for at most an hour of the check's runs in a row.
      let recorded = result;
      if (result.outcome === "pass") {
        if (provesInternet(fresh, context.vendors())) link.sawInternet();
      } else if (heldWhenOffline(fresh, context.vendors()) && (changesState(fresh.lastOutcome, result.outcome) || link.offline())) {
        const offline = await link.hold();
        const capped = context.store.heldStreak(fresh.id) >= Math.ceil(MAX_HOLD_MS / 1000 / fresh.cadenceSeconds);
        if (offline && !capped) {
          context.store.recordHeld(fresh, result, finished.toISOString(), finished.getTime() - started.getTime(), nextRunAt);
          return result;
        }
        // Past the cap the run is recorded, marked so the streak goes on while Watch stays offline.
        if (offline) recorded = { ...result, evidence: { ...result.evidence, heldTooLong: true } };
      }
      const event = context.store.recordRun(
        fresh,
        recorded,
        finished.toISOString(),
        finished.getTime() - started.getTime(),
        nextRunAt,
      );
      if (event !== null) onEvent(event);
      return result;
    } finally {
      running.delete(check.id);
    }
  };

  const tick = async () => {
    const due = context.store
      .dueChecks(context.deps.now().toISOString())
      .filter((c) => !running.has(c.id));
    for (let i = 0; i < due.length; i += CONCURRENCY)
      await Promise.all(due.slice(i, i + CONCURRENCY).map(runAndRecord));
  };

  return {
    tick,
    /** Runs one check now and records the result, whatever its state. */
    runNow: runAndRecord,
    /** Runs a check without recording anything, for setup and drafts. */
    trial: (check: Check) => runCheck(check, context),
    start: (intervalMs = 15_000) => {
      if (timer !== null) return;
      const loop = () => {
        void tick().finally(() => {
          timer = setTimeout(loop, intervalMs);
        });
      };
      loop();
    },
    stop: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
};
export type Runner = ReturnType<typeof makeRunner>;
