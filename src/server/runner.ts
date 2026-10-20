import { type CheckContext, runCheck } from "./checks/index.ts";
import { type Connectivity, needsInternet } from "./connectivity.ts";
import type { ChangeEvent, Check } from "./store.ts";

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
      // When a check that needs the internet does not pass, Watch's own link may be what is down.
      // Then the result is held: kept in the history, with no new state and no event.
      if (needsInternet(fresh)) {
        if (result.outcome === "pass") link.sawInternet();
        else if (await link.hold()) {
          context.store.recordHeld(fresh, result, finished.toISOString(), finished.getTime() - started.getTime(), nextRunAt);
          return result;
        }
      }
      const event = context.store.recordRun(
        fresh,
        result,
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
