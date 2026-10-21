/**
 * Whether Watch itself can reach the internet, and whether its link is slow. When its own link
 * drops, every check that needs the internet fails at once; when it is slow, connections time out
 * or reset though the sites are fine. Watch holds those results instead of alerting on each.
 */
import { isIP } from "node:net";

import { bareHost, hostClass } from "./hosts.ts";
import { type Deps, steadyClock } from "./proc.ts";
import type { Check } from "./store.ts";

/** Two addresses run by different providers, so one provider's outage does not look like Watch's. */
export const DEFAULT_PROBE_URLS: ReadonlyArray<string> = [
  "https://www.gstatic.com/generate_204",
  "https://one.one.one.one/cdn-cgi/trace",
];
/** Checks that fail together share a probe, whose answer is reused this long. */
const PROBE_REUSE_MS = 15_000;
const PROBE_TIMEOUT_MS = 5000;
/** Without a newer failed probe, Watch stops counting itself offline after this long. */
const OFFLINE_LAPSE_MS = 30 * 60_000;
/**
 * A check's failures are held for at most this much of its own cadence in a row, so a wrong probe
 * list cannot hide them for good. Counted in runs, so time Watch spends stopped does not count.
 */
export const MAX_HOLD_MS = 60 * 60_000;
/** Two disagreements within this long mean the probe list is wrong for this network. */
const DISAGREE_SPAN_MS = 60 * 60_000;
/** While the list is in doubt, a passing check rechecks it this often, so a fixed list clears it. */
const RECHECK_MS = 5 * 60_000;
/**
 * A probe slower than this means Watch's own link is slow. A healthy link answers in tens to a few
 * hundred milliseconds, while a fresh HTTPS request over an 850 ms round trip takes about 3 seconds.
 */
const SLOW_PROBE_MS = 1000;
/** Slower than this counts as slow too while checks on two or more hosts fail to connect together. */
const SLOWISH_PROBE_MS = 400;
/** Failures on different hosts this close together came at once. */
const TOGETHER_MS = 2 * 60_000;

export interface Link {
  /** When Watch found it could not reach the internet, or null while it can. */
  readonly offlineSince: string | null;
  /** Whether the probe addresses keep failing while checks that need the internet pass. */
  readonly probesDisagree: boolean;
  /** When Watch found its own link slow, or null while it is quick or Watch is offline. */
  readonly slowSince: string | null;
}

/** Why Watch holds a failure: it cannot reach the internet, or its link is slow. */
export type HoldReason = "offline" | "slow";

interface ProbeAnswer {
  readonly online: boolean;
  /** How long the first address took to answer, or null when that says nothing about speed. */
  readonly ms: number | null;
  /** When the probe began, on the steady clock, so newer evidence can outrank it. */
  readonly startedClock: number;
}

/**
 * The site a host belongs to, so two names on one server count once: its last two labels, or three
 * under a country's second level such as co.uk. An address stands for itself.
 */
export const siteOf = (host: string) => {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (/^[\d.]+$/.test(name) || name.includes(":")) return name;
  const labels = name.split(".");
  const take = labels.length >= 3 && labels.at(-1)!.length === 2 && /^(ac|co|com|edu|gov|ne|net|or|org)$/.test(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-take).join(".");
};

type Vendors = ReadonlyMap<string, { readonly api?: { readonly origin: string } }>;

/**
 * The host a check reaches: an HTTP check's URL or a vendor's API origin. Null for GitHub and AWS,
 * which are on the internet; undefined when the address is missing or does not parse.
 */
export const targetHost = (check: Pick<Check, "kind" | "config">, vendors: Vendors): string | null | undefined => {
  if (check.kind === "http") return URL.parse(String(check.config.url ?? ""))?.hostname;
  if (check.kind === "vendor") {
    const origin = vendors.get(String(check.config.vendor ?? ""))?.api?.origin;
    return origin === undefined ? undefined : URL.parse(origin)?.hostname;
  }
  return null;
};

/**
 * Whether Watch holds this check's failures while it is offline. Heartbeats, which need no network,
 * checks on this machine and checks whose address does not parse, which fail on their settings,
 * are never held; the local network and the tailnet are, since Watch's alerts could not leave the
 * machine either. A slow link holds only a subset: web and vendor checks on internet hosts.
 */
export const heldWhenOffline = (check: Pick<Check, "kind" | "config">, vendors: Vendors = new Map()) => {
  if (check.kind === "heartbeat") return false;
  const host = targetHost(check, vendors);
  return host === null || (host !== undefined && hostClass(host) !== "loopback");
};

/** Names a home network or an office gives itself, which the public internet does not reach. */
const PRIVATE_NAME = /(^|\.)(home|box|corp|lan|local|internal|intranet|private|localdomain|home\.arpa)$/;

/**
 * Whether a check's speed says something about Watch's own link to the internet: a web or vendor
 * check on a public host. A device on the local network, by its address or by a name such as nas
 * or fritz.box, is not on the probes' path.
 */
export const onTheInternet = (check: Pick<Check, "kind" | "config">, vendors: Vendors = new Map()) => {
  if (check.kind !== "http" && check.kind !== "vendor") return false;
  const host = targetHost(check, vendors);
  if (typeof host !== "string" || hostClass(host) !== "internet") return false;
  const name = bareHost(host).toLowerCase().replace(/\.$/, "");
  return isIP(name) !== 0 || (name.includes(".") && !PRIVATE_NAME.test(name));
};

/** Whether this check passing proves Watch reaches the internet, not just its own network or tailnet. */
export const provesInternet = (check: Pick<Check, "kind" | "config">, vendors: Vendors = new Map()) => {
  if (check.kind === "heartbeat") return false;
  const host = targetHost(check, vendors);
  return host === null || (host !== undefined && hostClass(host) === "internet");
};

const isProbeUrl = (url: unknown) => {
  const parsed = typeof url === "string" ? URL.parse(url) : null;
  return parsed !== null && (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname !== "";
};

/** The probeUrls setting as a list, or the defaults when it is missing or any address does not parse. */
export const probeUrls = (setting: unknown): ReadonlyArray<string> =>
  Array.isArray(setting) && setting.every(isProbeUrl) ? (setting as ReadonlyArray<string>) : DEFAULT_PROBE_URLS;

/** `setting` is read on each probe, so a reloaded config applies without a restart. */
export const makeConnectivity = (deps: Deps, setting: () => unknown = () => undefined) => {
  const now = () => deps.now().getTime();
  // Durations, and which of two pieces of evidence came first, run on the steady clock, which a step
  // of the wall clock does not move. Spans that must count time asleep, such as how long a spell
  // lasts, run on the wall clock, and a time that a step back put in the future counts as stale.
  const elapsed = steadyClock(deps);
  const within = (age: number, limit: number) => age >= 0 && age <= limit;
  // In memory, so a restart starts online and the next failure probes afresh.
  let offlineSince: number | null = null;
  let lastFailedProbeAt = Number.NEGATIVE_INFINITY;
  // When the latest check that reached the internet finished passing, and how long its web
  // request took, or null when it made none.
  let lastPassClock = Number.NEGATIVE_INFINITY;
  let lastPassRequestMs: number | null = null;
  let probe: { readonly at: number; readonly clock: number; readonly answer: Promise<ProbeAnswer> } | null = null;
  // When the current slow spell began and when an answer last showed the link slow, by the wall
  // clock; when the latest quick answer, from a probe or a web request, began, by the steady one;
  // and when each site last newly failed in a way a slow link explains.
  let slowSince: number | null = null;
  let lastSlowAt = Number.NEGATIVE_INFINITY;
  let lastQuickClock = Number.NEGATIVE_INFINITY;
  const failedSites = new Map<string, number>();
  // When rechecks began whose probes failed right after a check reached the internet, last hour.
  let disagreements: ReadonlyArray<number> = [];
  // Set by the second disagreement in an hour. Cleared by a probe that answers and began after the
  // latest disagreement's recheck, or by a restart.
  let doubted = false;
  // Between an answer and a disagreement, the one whose probe began later wins, whichever finishes
  // first. Each marker is the start of the latest probe of its kind that counted.
  let lastAnswerStart = Number.NEGATIVE_INFINITY;
  let lastDisagreeStart = Number.NEGATIVE_INFINITY;
  let lastVerifyAt = Number.NEGATIVE_INFINITY;
  let verifying: Promise<void> | null = null;

  /** When the current offline spell began, while a failed probe in the last 30 minutes vouches for it. */
  const since = () => (offlineSince !== null && now() - lastFailedProbeAt <= OFFLINE_LAPSE_MS ? offlineSince : null);

  /** A probe that began at `startedAt` answered; it clears the doubt unless a later recheck disagreed. */
  const answered = (startedAt: number) => {
    if (startedAt < lastDisagreeStart) return;
    lastAnswerStart = Math.max(lastAnswerStart, startedAt);
    disagreements = [];
    doubted = false;
  };
  /** A recheck that began at `startedAt` failed; it counts unless a later probe answered. */
  const disagree = (startedAt: number) => {
    if (startedAt < lastAnswerStart) return;
    lastDisagreeStart = Math.max(lastDisagreeStart, startedAt);
    disagreements = [...disagreements.filter((t) => startedAt - t <= DISAGREE_SPAN_MS), startedAt];
    if (disagreements.length >= 2) doubted = true;
  };

  /**
   * Whether any address answered, and how long the first took or how long until all gave up, and
   * whether they all ran out of time. An empty list answers at once, so it never counts as offline
   * or slow.
   */
  const reach = async (urls: ReadonlyArray<string>) => {
    if (urls.length === 0) return { answered: true, ms: 0, timedOut: false };
    const started = elapsed();
    try {
      await Promise.any(
        urls.map(async (url) => {
          const response = await deps.fetch(url, { redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
          void response.body?.cancel().catch(() => {});
        }),
      );
      return { answered: true, ms: Math.max(0, elapsed() - started), timedOut: false };
    } catch (error) {
      const errors = error instanceof AggregateError ? error.errors : [error];
      return {
        answered: false,
        ms: Math.max(0, elapsed() - started),
        timedOut: errors.every((e: unknown) => e instanceof Error && e.name === "TimeoutError"),
      };
    }
  };

  const probeNow = (): Promise<ProbeAnswer> => {
    const startedAt = now();
    const startedClock = elapsed();
    // Reused only while both clocks agree it is recent: time asleep or a step of the clock is not.
    if (probe !== null && within(startedAt - probe.at, PROBE_REUSE_MS) && within(startedClock - probe.clock, PROBE_REUSE_MS)) return probe.answer;
    const answer = reach(probeUrls(setting())).then((reached): ProbeAnswer => {
      if (reached.answered) answered(startedAt);
      // A check that finished passing after the probe began is newer evidence than the probe.
      const passedSince = lastPassClock > startedClock;
      if (reached.answered || passedSince) {
        offlineSince = null;
        // Probes that all ran out of time while a web request finished passing, slower than they
        // waited, show a link that works slowly. After a quicker pass they say nothing about speed.
        const slowPass = passedSince && lastPassRequestMs !== null && lastPassRequestMs >= PROBE_TIMEOUT_MS;
        const ms = reached.answered ? reached.ms : reached.timedOut && !doubted && slowPass ? Math.max(reached.ms, PROBE_TIMEOUT_MS) : null;
        return { online: true, ms, startedClock };
      }
      if (since() === null) offlineSince = startedAt;
      lastFailedProbeAt = now();
      // Offline outranks slow; once back, the link is measured afresh.
      slowSince = null;
      return { online: false, ms: null, startedClock };
    });
    probe = { at: startedAt, clock: startedClock, answer };
    return answer;
  };

  /**
   * Watch counted itself offline, yet a check just reached the internet. A fresh probe that still
   * gets no answer disagrees with that check: this network may block the probe addresses. Not when
   * every probe ran out of time just after a web request passed slower than they waited: the link
   * is slow, not the list blocked. `passMs` is how long that request took, when the check that
   * passed made one; a quicker request leaves timeouts a disagreement, so a list a firewall drops
   * is still found out.
   */
  const verify = (passMs?: number) => {
    if (verifying !== null) return verifying;
    const startedAt = now();
    const startedClock = elapsed();
    lastVerifyAt = startedAt;
    verifying = reach(probeUrls(setting()))
      .then((reached) => {
        if (reached.answered) {
          answered(startedAt);
          observe(reached.ms, startedClock);
        } else if (reached.timedOut && passMs !== undefined && passMs >= PROBE_TIMEOUT_MS) observe(Math.max(reached.ms, PROBE_TIMEOUT_MS), startedClock);
        else disagree(startedAt);
      })
      // Nothing above should throw, and a runner that does not wait on this must never see it.
      .catch(() => {})
      .finally(() => {
        verifying = null;
      });
    return verifying;
  };

  /** When the current offline spell began, unless the probe list is in doubt. */
  const offlineFrom = () => (doubted ? null : since());

  /** When the current slow spell began, while a slow answer in the last 30 minutes vouches for it and Watch is online. */
  const slowFrom = () => (slowSince !== null && within(now() - lastSlowAt, OFFLINE_LAPSE_MS) && offlineFrom() === null ? slowSince : null);

  /**
   * Updates the slow spell from an answer that took `ms`, from a probe begun at `startedClock`, and
   * says whether it shows the link slow: a second or more, or 400 ms or more while checks on two or
   * more internet sites newly failed to connect within two minutes. A slow answer begins or extends
   * the spell; one that is not slow ends it. A quick answer, from a probe or a passing request, that
   * began after this probe outranks it.
   */
  const observe = (ms: number | null, startedClock: number) => {
    if (ms === null || startedClock < lastQuickClock) return false;
    if (ms < SLOWISH_PROBE_MS) {
      lastQuickClock = Math.max(lastQuickClock, startedClock);
      slowSince = null;
      return false;
    }
    const at = now();
    const together = [...failedSites.values()].filter((when) => within(at - when, TOGETHER_MS)).length;
    if (ms < SLOW_PROBE_MS && together < 2) {
      slowSince = null;
      return false;
    }
    if (slowFrom() === null) slowSince = at;
    lastSlowAt = at;
    return true;
  };

  return {
    link: (): Link => {
      const from = offlineFrom();
      const slow = slowFrom();
      return {
        offlineSince: from === null ? null : new Date(from).toISOString(),
        probesDisagree: doubted,
        slowSince: slow === null ? null : new Date(slow).toISOString(),
      };
    },
    /**
     * A check that needs the internet finished passing at `finishedClock` on the steady clock, which
     * proves the link works. `requestMs` is how long its web request took, when it made one on the
     * public internet; under 400 ms it shows the link is quick. When Watch counted itself offline it
     * also probes again, and while the probe list is in doubt it rechecks the list every 5 minutes;
     * the returned promise settles when that probe is done.
     */
    sawInternet: ({ finishedClock = elapsed(), requestMs }: { readonly finishedClock?: number; readonly requestMs?: number } = {}): Promise<void> => {
      const wasOffline = offlineFrom() !== null;
      if (finishedClock >= lastPassClock) {
        lastPassClock = finishedClock;
        lastPassRequestMs = requestMs ?? null;
      }
      offlineSince = null;
      if (requestMs !== undefined && requestMs < SLOWISH_PROBE_MS) {
        lastQuickClock = Math.max(lastQuickClock, finishedClock - requestMs);
        slowSince = null;
      }
      return wasOffline || (doubted && now() - lastVerifyAt >= RECHECK_MS) ? verify(requestMs) : Promise.resolve();
    },
    /**
     * A check on an internet host newly failed in a way a slow link explains. Noted before any
     * failure in its batch is decided, so failures on several sites at once count together.
     */
    failed: (host: string) => {
      const at = now();
      for (const [known, when] of failedSites) if (!within(at - when, TOGETHER_MS)) failedSites.delete(known);
      failedSites.set(siteOf(host), at);
    },
    /** Whether Watch counts itself offline, without probing. */
    offline: () => offlineFrom() !== null,
    /** Whether Watch counts its link slow, without probing. */
    slow: () => slowFrom() !== null,
    /**
     * Probes, or reuses a recent probe, and says why to hold a failure now: offline while no probe
     * address answers, or slow while the link is slow and `slowLinkExplains` the failure. Null means
     * record it. Every answer also updates the slow spell. While the probe list is in doubt it still
     * probes, so an answer can clear the doubt, but never holds for being offline.
     */
    hold: async (slowLinkExplains = false): Promise<HoldReason | null> => {
      const answer = await probeNow();
      if (!answer.online) return offlineFrom() !== null ? "offline" : null;
      return observe(answer.ms, answer.startedClock) && slowLinkExplains ? "slow" : null;
    },
  };
};
export type Connectivity = ReturnType<typeof makeConnectivity>;
