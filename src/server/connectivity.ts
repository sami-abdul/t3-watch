/**
 * Whether Watch itself can reach the internet. When its own link drops, every check that needs the
 * internet fails at once; Watch holds those results instead of alerting on each of them.
 */
import { hostClass } from "./hosts.ts";
import type { Deps } from "./proc.ts";
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

export interface Link {
  /** When Watch found it could not reach the internet, or null while it can. */
  readonly offlineSince: string | null;
  /** Whether the probe addresses keep failing while checks that need the internet pass. */
  readonly probesDisagree: boolean;
}

type Vendors = ReadonlyMap<string, { readonly api?: { readonly origin: string } }>;

/**
 * The host a check reaches: an HTTP check's URL or a vendor's API origin. Null for GitHub and AWS,
 * which are on the internet; undefined when the address is missing or does not parse.
 */
const targetHost = (check: Pick<Check, "kind" | "config">, vendors: Vendors): string | null | undefined => {
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
 * machine either.
 */
export const heldWhenOffline = (check: Pick<Check, "kind" | "config">, vendors: Vendors = new Map()) => {
  if (check.kind === "heartbeat") return false;
  const host = targetHost(check, vendors);
  return host === null || (host !== undefined && hostClass(host) !== "loopback");
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
  // In memory, so a restart starts online and the next failure probes afresh.
  let offlineSince: number | null = null;
  let lastFailedProbeAt = Number.NEGATIVE_INFINITY;
  let lastPassAt = Number.NEGATIVE_INFINITY;
  let probe: { readonly at: number; readonly answer: Promise<boolean> } | null = null;
  // When fresh probes failed right after a check reached the internet, in the last hour.
  let disagreements: ReadonlyArray<number> = [];
  // Set by the second disagreement in an hour; only a probe that answers, or a restart, clears it.
  let doubted = false;
  let lastAnswerAt = Number.NEGATIVE_INFINITY;
  let lastDisagreeAt = Number.NEGATIVE_INFINITY;
  let lastVerifyAt = Number.NEGATIVE_INFINITY;
  let verifying: Promise<void> | null = null;

  /** When the current offline spell began, while a failed probe in the last 30 minutes vouches for it. */
  const since = () => (offlineSince !== null && now() - lastFailedProbeAt <= OFFLINE_LAPSE_MS ? offlineSince : null);

  /** A probe that began at `startedAt` answered. A disagreement newer than its start outranks it. */
  const answered = (startedAt: number) => {
    lastAnswerAt = now();
    if (startedAt < lastDisagreeAt) return;
    disagreements = [];
    doubted = false;
  };
  const disagree = (at: number) => {
    lastDisagreeAt = at;
    disagreements = [...disagreements.filter((t) => at - t <= DISAGREE_SPAN_MS), at];
    if (disagreements.length >= 2) doubted = true;
  };

  /** True when any address answers at all; an empty list never counts as offline. */
  const reach = async (urls: ReadonlyArray<string>) => {
    if (urls.length === 0) return true;
    try {
      return await Promise.any(
        urls.map(async (url) => {
          const response = await deps.fetch(url, { redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
          void response.body?.cancel().catch(() => {});
          return true;
        }),
      );
    } catch {
      return false;
    }
  };

  const probeNow = (): Promise<boolean> => {
    const startedAt = now();
    if (probe !== null && startedAt - probe.at <= PROBE_REUSE_MS) return probe.answer;
    const answer = reach(probeUrls(setting())).then((online) => {
      if (online) answered(startedAt);
      // A check that passed while the probe ran is newer evidence than the probe.
      if (online || lastPassAt >= startedAt) {
        offlineSince = null;
        return true;
      }
      if (since() === null) offlineSince = startedAt;
      lastFailedProbeAt = now();
      return false;
    });
    probe = { at: startedAt, answer };
    return answer;
  };

  /**
   * Watch counted itself offline, yet a check just reached the internet. A fresh probe that still
   * gets no answer disagrees with that check: this network may block the probe addresses.
   */
  const verify = () => {
    if (verifying !== null) return verifying;
    const startedAt = now();
    lastVerifyAt = startedAt;
    verifying = reach(probeUrls(setting()))
      .then((online) => {
        if (online) answered(startedAt);
        // A probe that answered after this one began is newer evidence, so this one counts nothing.
        else if (lastAnswerAt < startedAt) disagree(now());
      })
      .finally(() => {
        verifying = null;
      });
    return verifying;
  };

  /** When the current offline spell began, unless the probe list is in doubt. */
  const offlineFrom = () => (doubted ? null : since());

  return {
    link: (): Link => {
      const from = offlineFrom();
      return { offlineSince: from === null ? null : new Date(from).toISOString(), probesDisagree: doubted };
    },
    /**
     * A check that needs the internet passed, which proves the link works. When Watch counted
     * itself offline it also probes again, and while the probe list is in doubt it rechecks the
     * list every 5 minutes; the returned promise settles when that probe is done.
     */
    sawInternet: (): Promise<void> => {
      const wasOffline = offlineFrom() !== null;
      lastPassAt = now();
      offlineSince = null;
      return wasOffline || (doubted && now() - lastVerifyAt >= RECHECK_MS) ? verify() : Promise.resolve();
    },
    /** Settles when a recheck of the probe list in flight is done, for callers that need its result. */
    settled: (): Promise<void> => verifying ?? Promise.resolve(),
    /** Whether Watch counts itself offline, without probing. */
    offline: () => offlineFrom() !== null,
    /**
     * Probes, or reuses a recent probe, and says whether Watch is offline now. While the probe list
     * is in doubt it still probes, so an answer can clear the doubt, but never holds.
     */
    hold: async () => !(await probeNow()) && offlineFrom() !== null,
  };
};
export type Connectivity = ReturnType<typeof makeConnectivity>;
