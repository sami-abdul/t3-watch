/**
 * Whether Watch itself can reach the internet. When its own link drops, every check that needs the
 * internet fails at once; Watch holds those results instead of alerting on each of them.
 */
import type { Deps } from "./proc.ts";
import type { Check, Store } from "./store.ts";

/** Two addresses run by different providers, so one provider's outage does not look like Watch's. */
export const DEFAULT_PROBE_URLS: ReadonlyArray<string> = [
  "https://www.gstatic.com/generate_204",
  "https://one.one.one.one/cdn-cgi/trace",
];
/** A pass from a check that needs the internet proves the link for this long. */
const RECENT_PASS_MS = 2 * 60_000;
/** A probe's answer is reused for this long. */
const PROBE_REUSE_MS = 60_000;
const PROBE_TIMEOUT_MS = 5000;

export interface Link {
  /** When Watch found it could not reach the internet, or null while it can. */
  readonly offlineSince: string | null;
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

/** Whether a check needs the internet to run. Heartbeats and loopback HTTP checks do not. */
export const needsInternet = (check: Pick<Check, "kind" | "config">) => {
  if (check.kind === "heartbeat") return false;
  if (check.kind !== "http") return true;
  const host = URL.parse(String(check.config.url ?? ""))?.hostname ?? "";
  return !LOOPBACK.test(host) && !host.endsWith(".localhost");
};

/** The probeUrls setting as a list, or the defaults when it is missing or malformed. */
export const probeUrls = (setting: unknown): ReadonlyArray<string> =>
  Array.isArray(setting) && setting.every((url) => typeof url === "string" && /^https?:\/\//.test(url))
    ? setting
    : DEFAULT_PROBE_URLS;

/** `setting` is read on each probe, so a reloaded config applies without a restart. */
export const makeConnectivity = (deps: Deps, store: Store, setting: () => unknown = () => undefined) => {
  let lastPassAt = Number.NEGATIVE_INFINITY;
  let probe: { readonly at: number; readonly answer: Promise<boolean> } | null = null;

  const link = () => store.getKv<Link>("link", { offlineSince: null });
  const mark = (online: boolean) => {
    const offline = link().offlineSince !== null;
    if (online && offline) store.setKv("link", { offlineSince: null });
    if (!online && !offline) store.setKv("link", { offlineSince: deps.now().toISOString() });
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

  return {
    link,
    /** A check that needs the internet passed, which proves the link works. */
    sawInternet: () => {
      lastPassAt = deps.now().getTime();
      mark(true);
    },
    /** Whether Watch can reach the internet now. Checks that fail together share one probe. */
    online: (): Promise<boolean> => {
      const now = deps.now().getTime();
      if (now - lastPassAt <= RECENT_PASS_MS) return Promise.resolve(true);
      if (probe === null || now - probe.at > PROBE_REUSE_MS) {
        const answer = reach(probeUrls(setting())).then((online) => {
          mark(online);
          return online;
        });
        probe = { at: now, answer };
      }
      return probe.answer;
    },
  };
};
export type Connectivity = ReturnType<typeof makeConnectivity>;
