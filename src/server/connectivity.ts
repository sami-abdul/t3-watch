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
/** A check's failures are held at most this long in a row, so a wrong probe list cannot hide them for good. */
export const MAX_HOLD_MS = 60 * 60_000;

export interface Link {
  /** When Watch found it could not reach the internet, or null while it can. */
  readonly offlineSince: string | null;
}

const httpHost = (check: Pick<Check, "config">) => URL.parse(String(check.config.url ?? ""))?.hostname ?? null;

/**
 * Whether Watch holds this check's failures while it is offline. Heartbeats, which need no network,
 * and checks on this machine are never held; the local network and the tailnet are, since Watch's
 * alerts could not leave the machine either.
 */
export const heldWhenOffline = (check: Pick<Check, "kind" | "config">) => {
  if (check.kind === "heartbeat") return false;
  if (check.kind !== "http") return true;
  const host = httpHost(check);
  return host === null || hostClass(host) !== "loopback";
};

/** Whether this check passing proves Watch reaches the internet, not just its own network or tailnet. */
export const provesInternet = (check: Pick<Check, "kind" | "config">) => {
  if (check.kind === "heartbeat") return false;
  if (check.kind !== "http") return true;
  const host = httpHost(check);
  return host !== null && hostClass(host) === "internet";
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

  /** When the current offline spell began, while a failed probe in the last 30 minutes vouches for it. */
  const since = () => (offlineSince !== null && now() - lastFailedProbeAt <= OFFLINE_LAPSE_MS ? offlineSince : null);

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

  return {
    link: (): Link => {
      const from = since();
      return { offlineSince: from === null ? null : new Date(from).toISOString() };
    },
    /** A check that needs the internet passed, which proves the link works. */
    sawInternet: () => {
      lastPassAt = now();
      offlineSince = null;
    },
    /** Whether a failure from a check that needs the internet should be held now. */
    hold: async () => !(await probeNow()) && since() !== null,
  };
};
export type Connectivity = ReturnType<typeof makeConnectivity>;
