import type { AccessRow, FoundService, Scan } from "../server/scan.ts";
import type { CheckView, WatchState } from "../server/state.ts";

export type PageView = "scanning" | "empty" | "review" | "home";

/** Which screen the page opens on. */
export const pageView = (state: WatchState, wantsReview: boolean): PageView => {
  if (state.setup.status.running) return "scanning";
  const scan = state.setup.scan;
  if (scan === null) return state.checks.some((c) => c.state === "on") ? "home" : "empty";
  if (scan.appliedAt === null || wantsReview) return "review";
  return "home";
};

export interface Ticks {
  readonly checks: ReadonlySet<string>;
  readonly access: ReadonlySet<string>;
}

/** Suggested checks and every stored key start ticked. */
export const defaultTicks = (scan: Scan): Ticks => ({
  checks: new Set(scan.suggestions.filter((s) => s.suggested).map((s) => s.checkId)),
  access: new Set(scan.services.flatMap((s) => s.access).filter((a) => a.removable).map((a) => a.accessKey)),
});

export const toggle = <T>(set: ReadonlySet<T>, value: T) => {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
};

/** A check is available while the key it needs stays ticked. */
export const checkAvailable = (scan: Scan, ticks: Ticks, checkId: string) => {
  const suggestion = scan.suggestions.find((s) => s.checkId === checkId);
  if (suggestion === undefined) return false;
  const service = scan.services.find((s) => s.serviceId === suggestion.serviceId);
  const keyed = service?.access.filter((a) => a.removable) ?? [];
  return keyed.length === 0 || keyed.some((a) => ticks.access.has(a.accessKey));
};

export const applyPayload = (scan: Scan, ticks: Ticks) => ({
  turnOn: scan.suggestions
    .filter((s) => ticks.checks.has(s.checkId) && checkAvailable(scan, ticks, s.checkId))
    .map((s) => s.checkId),
  removeKeys: scan.services
    .flatMap((s) => s.access)
    .filter((a) => a.removable && !ticks.access.has(a.accessKey))
    .map((a) => a.accessKey),
});

export const watchLabel = (count: number) =>
  count === 0 ? "Save without checks" : `Watch ${count === 1 ? "this check" : `these ${count}`}`;

export interface ReviewGroups {
  /** Services with something to decide: working access or checks. */
  readonly ready: ReadonlyArray<FoundService>;
  /** Found in code but not reachable. */
  readonly unreachable: ReadonlyArray<FoundService>;
  /** Reachable repositories with nothing to watch yet, shown as one line. */
  readonly quiet: ReadonlyArray<FoundService>;
}
export const reviewGroups = (scan: Scan): ReviewGroups => {
  const withChecks = new Set(scan.suggestions.map((s) => s.serviceId));
  return {
    ready: scan.services.filter((s) => s.reachable && (withChecks.has(s.serviceId) || s.vendor !== "github")),
    unreachable: scan.services.filter((s) => !s.reachable),
    quiet: scan.services.filter((s) => s.reachable && s.vendor === "github" && !withChecks.has(s.serviceId)),
  };
};

/** Access rows worth a line: one row per login, even when many services share it. */
export const accessRows = (services: ReadonlyArray<FoundService>): ReadonlyArray<AccessRow & { readonly service: string }> => {
  const seen = new Set<string>();
  const rows: Array<AccessRow & { service: string }> = [];
  for (const service of services)
    for (const row of service.access) {
      if (seen.has(row.accessKey)) continue;
      seen.add(row.accessKey);
      rows.push({ ...row, service: row.accessKey === "machine:gh" ? "GitHub" : service.label });
    }
  return rows;
};

export const warningText: Record<AccessRow["warnings"][number], string> = {
  personal_token: "Belongs to one person",
  can_write: "Can make changes; Watch only reads, but a read-only key is safer",
  login_expires: "Login expires",
};

export interface HomeModel {
  readonly headline: string;
  readonly failing: ReadonlyArray<CheckView>;
  readonly couldNotRun: ReadonlyArray<CheckView>;
  readonly drafts: ReadonlyArray<CheckView>;
  readonly passing: ReadonlyArray<CheckView>;
  readonly waiting: ReadonlyArray<CheckView>;
  readonly paused: ReadonlyArray<CheckView>;
  readonly onCount: number;
}
export const homeModel = (state: WatchState): HomeModel => {
  const on = state.checks.filter((c) => c.state === "on");
  const failing = on.filter((c) => c.lastOutcome === "fail");
  return {
    headline:
      failing.length === 0
        ? on.length === 0
          ? "Nothing is watched yet"
          : "All clear"
        : `${failing.length} thing${failing.length === 1 ? " is" : "s are"} broken`,
    failing,
    couldNotRun: on.filter((c) => c.lastOutcome === "unknown"),
    drafts: state.checks.filter((c) => c.state === "draft"),
    passing: on.filter((c) => c.lastOutcome === "pass"),
    waiting: on.filter((c) => c.lastOutcome === null),
    paused: state.checks.filter((c) => c.state === "paused"),
    onCount: on.length,
  };
};

export const ago = (iso: string | null, now: Date) => {
  if (iso === null) return "never";
  const seconds = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
};

export const askAbout = (check: CheckView) =>
  `Watch: "${check.intent}" (${check.serviceLabel}) is ${check.lastOutcome === "fail" ? "failing" : "not running"}: ${check.lastSummary ?? ""}. Look into it with watch_check ${check.id}, tell me why, and what to do.`;
