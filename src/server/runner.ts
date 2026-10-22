import { type CheckContext, type CheckResult, runCheck } from "./checks/index.ts";
import { linkExplains } from "./checks/network.ts";
import { passesOnItsOwn } from "./checks/types.ts";
import { type Connectivity, heldWhenOffline, MAX_HOLD_MS, onTheInternet, provesInternet, targetHost } from "./connectivity.ts";
import { steadyClock } from "./proc.ts";
import { type ChangeEvent, type Check, changesState } from "./store.ts";

const CONCURRENCY = 4;
/** A failure after a pass is confirmed by a second run this soon, or at the check's cadence if shorter. */
const CONFIRM_SECONDS = 60;

/** Runs due checks on a clock. Each check runs at most once at a time. */
export const makeRunner = (context: CheckContext, onEvent: (event: ChangeEvent) => void, link: Connectivity) => {
  const running = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  // How long a run took and when it ended, by a clock a step of the wall clock does not move.
  const elapsed = steadyClock(context.deps);

  interface Ran {
    readonly check: Check;
    readonly result: CheckResult;
    readonly started: Date;
    readonly finished: Date;
    readonly tookMs: number;
    readonly finishedClock: number;
  }

  /** Runs a check once, or nothing when it is already running; it stays running until recorded. */
  const run = async (check: Check): Promise<Ran | null> => {
    if (running.has(check.id)) return null;
    running.add(check.id);
    try {
      const started = context.deps.now();
      const clock = elapsed();
      // A check whose last run was held waits longer for an answer: its link may still be slow.
      const result = await runCheck(check, { ...context, patient: context.store.lastRunHeld(check.id) });
      const finishedClock = elapsed();
      return { check, result, started, finished: context.deps.now(), tookMs: finishedClock - clock, finishedClock };
    } catch (error) {
      running.delete(check.id);
      throw error;
    }
  };

  /**
   * Notes a new failure that a slow link of Watch's own could explain, of a check on the public
   * internet, before any failure in its batch is decided, so failures on several sites at once
   * count together. A check that was failing already says nothing new about the link.
   */
  const note = ({ check, result }: Ran) => {
    if (!linkExplains(result) || (check.lastOutcome ?? "pass") !== "pass" || !onTheInternet(check, context.vendors())) return;
    const host = targetHost(check, context.vendors());
    if (typeof host === "string") link.failed(host);
  };

  /**
   * `manual` is a run someone asked for, which records its result without a second run to confirm
   * it. It is held as any run is.
   */
  const record = async ({ check, result, started, finished, tookMs, finishedClock }: Ran, manual: boolean) => {
    try {
      const fresh = context.store.check(check.id);
      // A pause, snooze or new definition made while this run was in flight wins over it.
      if (fresh === null || fresh.updatedAt !== check.updatedAt) return null;
      const nextRunAt = new Date(finished.getTime() + fresh.cadenceSeconds * 1000).toISOString();
      // A failure may only mean Watch's own link is down, or slow. One that would change the
      // check's state probes; one that changes nothing probes only while Watch already counts its
      // link down or slow, which keeps the notice true and the check's real failure reason in
      // place. Held runs keep the check as it was, with no event, for at most an hour of the
      // check's runs in a row.
      let recorded = result;
      if (result.outcome === "pass") {
        if (provesInternet(fresh, context.vendors())) {
          // A run someone asked for waits for any recheck, so what they see next is current; a
          // scheduled run does not hold up its batch for it.
          // Only a web request's time on the public internet says how fast the link is; a command's
          // includes its start-up, and a device at home answers whatever the internet does.
          const rechecking = link.sawInternet({ finishedClock, ...(onTheInternet(fresh, context.vendors()) ? { requestMs: tookMs } : {}) });
          if (manual) {
            await rechecking;
            if (context.store.check(fresh.id)?.updatedAt !== check.updatedAt) return null;
          }
        }
      } else if (
        passesOnItsOwn(result) ||
        (heldWhenOffline(fresh, context.vendors()) && (changesState(fresh.lastOutcome, result.outcome) || link.offline() || link.slow()))
      ) {
        // A slow link explains a timeout or a dropped connection to a public host; the local network
        // and the tailnet are not on the probes' path. Trouble at the source that passes on its own
        // came with an answer, so the link is fine: it is held without a probe, and whatever the
        // check said before stays in place.
        const why = passesOnItsOwn(result) ? "transient" : await link.hold(linkExplains(result) && onTheInternet(fresh, context.vendors()));
        // And one made while the probe ran.
        if (context.store.check(fresh.id)?.updatedAt !== check.updatedAt) return null;
        const capped = context.store.heldStreak(fresh.id) >= Math.ceil(MAX_HOLD_MS / 1000 / fresh.cadenceSeconds);
        if (why !== null && !capped) {
          // Due a cadence after the run began, so a long run does not stretch the hour of holding.
          const heldNext = new Date(Math.max(finished.getTime(), started.getTime() + fresh.cadenceSeconds * 1000)).toISOString();
          context.store.recordHeld(fresh.id, result, finished.toISOString(), finished.getTime() - started.getTime(), heldNext, why);
          return result;
        }
        // Past the cap the run is recorded, marked so the streak goes on while the link stays bad.
        if (why !== null) recorded = { ...result, evidence: { ...result.evidence, heldTooLong: true } };
      }
      // One non-passing run from a check that was passing, or is new, is pending: kept in the
      // history with no new state, and run again within a minute. The next run that is not held,
      // whenever it comes, confirms or clears it, so only two non-passing runs in a row fail the
      // check and alert, and one dropped request on a lossy link does not.
      if (!manual && recorded.outcome !== "pass" && (fresh.lastOutcome ?? "pass") === "pass" && fresh.pending === null) {
        const again = new Date(finished.getTime() + Math.min(fresh.cadenceSeconds, CONFIRM_SECONDS) * 1000).toISOString();
        context.store.recordPending(fresh.id, recorded, finished.toISOString(), finished.getTime() - started.getTime(), again);
        return result;
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

  const runAndRecord = async (check: Check, manual: boolean) => {
    const ran = await run(check);
    if (ran === null) return null;
    note(ran);
    return record(ran, manual);
  };

  const tick = async () => {
    const due = context.store
      .dueChecks(context.deps.now().toISOString())
      .filter((c) => !running.has(c.id));
    for (let i = 0; i < due.length; i += CONCURRENCY) {
      // Settled one by one, so a run that throws cannot keep the others from being recorded.
      const ran: Array<Ran> = [];
      for (const settled of await Promise.allSettled(due.slice(i, i + CONCURRENCY).map((check) => run(check))))
        if (settled.status === "rejected") console.error("t3-watch could not run a check", settled.reason);
        else if (settled.value !== null) ran.push(settled.value);
      // Every failure in the batch counts before any is decided, so failures on several hosts at
      // once count together. Passes go first, since they came before any probe a failure sets off.
      for (const done of ran) note(done);
      await Promise.all([...ran.filter((r) => r.result.outcome === "pass"), ...ran.filter((r) => r.result.outcome !== "pass")].map((r) => record(r, false)));
    }
  };

  return {
    tick,
    /**
     * Runs one check now, whatever the check's state, and records the result without a second run to
     * confirm it, unless Watch holds it as it holds any run.
     */
    runNow: (check: Check) => runAndRecord(check, true),
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
