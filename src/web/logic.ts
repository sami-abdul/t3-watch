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

/** A suggestion's detail line: what it contacts and how often, then anything after. */
export const suggestionDetail = (s: Scan["suggestions"][number], ...more: ReadonlyArray<string>) =>
  [s.target ?? null, s.cadence ?? null, ...more].filter((part) => part !== null).join(" · ");

export interface Change {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * What applying the review changes, as the checks stand now: checks it turns on, each with what
 * it contacts and how often; running checks it pauses because they are unticked; keys it removes.
 * Checks already on and suggestions never turned on are left out, since nothing about them runs
 * differently afterwards.
 */
export const applyChanges = (scan: Scan, payload: { readonly turnOn: ReadonlyArray<string>; readonly removeKeys: ReadonlyArray<string> }) => {
  const row = (s: Scan["suggestions"][number]): Change => ({ key: s.checkId, title: `${s.title}: ${s.intent}`, detail: suggestionDetail(s) });
  const turnOn = new Set(payload.turnOn);
  const rows = scan.services.flatMap((s) => s.access);
  // As the service applies it: a check whose key is removed neither turns on nor keeps running.
  const removedKeys = new Set(rows.filter((r) => payload.removeKeys.includes(r.accessKey) && r.keyId !== null).map((r) => r.keyId));
  const losesKey = (s: Scan["suggestions"][number]) => s.keyId !== undefined && s.keyId !== null && removedKeys.has(s.keyId);
  return {
    turnOn: scan.suggestions.filter((s) => turnOn.has(s.checkId) && s.state !== "on" && !losesKey(s)).map(row),
    pause: scan.suggestions.filter((s) => s.state === "on" && (!turnOn.has(s.checkId) || losesKey(s))).map(row),
    removeKeys: payload.removeKeys.map((key): Change => ({ key, title: rows.find((r) => r.accessKey === key)?.source ?? key, detail: "Watch deletes its copy of this key" })),
  };
};

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

export type StepState = "done" | "current" | "waiting";

type Alerts = WatchState["alerts"];

/** The newer of the last test and the last real alert: what is known about the webhook now. */
export const latestAlertResult = (alerts: Alerts) =>
  [alerts.lastTest, alerts.lastDelivery]
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;

/**
 * The Connect alerts panel's three steps: a signing secret, a webhook address from the Watch
 * thread, and a signed alert the webhook accepted. A step waits until the one before it is done.
 */
export const alertSteps = (alerts: Alerts) => {
  const secret: StepState = alerts.signed ? "done" : "current";
  const connected: StepState = alerts.on ? "done" : alerts.signed ? "current" : "waiting";
  // An unsigned alert that got through proves the address, not the signature.
  const tested: StepState = alerts.on && alerts.signed && latestAlertResult(alerts)?.ok === true ? "done" : alerts.on ? "current" : "waiting";
  return { secret, connected, tested };
};

/**
 * What Home says about alerts, and its button: off while checks are on, unsigned, never tested
 * since they were set or the secret changed, or the latest test or real alert not accepted.
 */
export const alertsNotice = (state: WatchState): { readonly text: string; readonly button: string } | null => {
  const alerts = state.alerts;
  if (!alerts.on)
    return state.checks.some((c) => c.state === "on")
      ? { text: "Alerts are off, so nothing wakes your Watch thread when a check fails.", button: "Connect alerts" }
      : null;
  if (!alerts.signed) return { text: "Alerts are not signed, so their T3 task cannot tell Watch's alerts from anyone else's.", button: "Fix alerts" };
  const latest = latestAlertResult(alerts);
  if (latest === null)
    return {
      text: "Alerts have not been tested since they were set up or their secret changed. A test alert shows whether they reach your Watch thread.",
      button: "Test alerts",
    };
  if (latest.ok) return null;
  return {
    text: latest === alerts.lastTest ? `The last test alert was not accepted. ${latest.message}` : `The last alert did not get through. ${latest.message}`,
    button: "Fix alerts",
  };
};

/** A secret made on this page while alerts are on: the T3 task needs it until an alert gets through. */
export const needsHandover = (alerts: Alerts, madeSecret: boolean) => madeSecret && alerts.on && latestAlertResult(alerts)?.ok !== true;
