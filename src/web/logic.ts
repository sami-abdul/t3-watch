import { NO_RUNS_NOTE } from "../server/notices.ts";
import type { AccessRow, FoundService, Scan } from "../server/scan.ts";
import type { CheckView, WatchState } from "../server/state.ts";
import type { CheckKind } from "../server/store.ts";
import type { CheckEditInput } from "./client.ts";

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
  // As the checks stand now: a check turned on or paused since the scan keeps that choice; only one
  // still undecided takes the scan's suggestion.
  checks: new Set(scan.suggestions.filter((s) => s.state === "on" || (s.state === "proposed" && s.suggested)).map((s) => s.checkId)),
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

/** Parts of a detail line, joined with a middle dot, leaving out the missing and the empty. */
export const joinParts = (...parts: ReadonlyArray<string | null | undefined>) =>
  parts.filter((part): part is string => part !== null && part !== undefined && part !== "").join(" · ");

/** A suggestion's detail line: what it contacts and how often, then anything after. */
export const suggestionDetail = (s: Scan["suggestions"][number], ...more: ReadonlyArray<string>) => joinParts(s.target, s.cadence, ...more);

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
  // Quiet is what the scan found, no Actions runs yet; a repository whose check the person deleted is not.
  const quiet = (s: FoundService) => s.reachable && s.vendor === "github" && s.note === NO_RUNS_NOTE;
  return {
    ready: scan.services.filter((s) => s.reachable && !quiet(s)),
    unreachable: scan.services.filter((s) => !s.reachable),
    quiet: scan.services.filter(quiet),
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

const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

const kindAndName = (serviceId: string) => {
  const colon = serviceId.indexOf(":");
  return colon === -1 ? { kind: "", name: serviceId } : { kind: serviceId.slice(0, colon), name: serviceId.slice(colon + 1) };
};

/** A repository's name without its owner, once case and punctuation go. */
const repoName = (fullName: string) => plain(fullName.slice(fullName.lastIndexOf("/") + 1));

const add = (map: Map<string, Set<string>>, name: string, value: string) => map.set(name, (map.get(name) ?? new Set<string>()).add(value));

/** The one value held under a name, or null when none or several are. */
const one = (values: ReadonlySet<string> | undefined) => (values?.size === 1 ? [...values][0]! : null);

/**
 * Each check's product. A site or job service is a product, and a repository joins it when their
 * names match once case and punctuation go and no other site or repository has that name. A site
 * whose id is its name cut short also matches by its full name. Anything else is a product of its
 * own: a repository with its owner, so two repositories of one name never merge, a vendor, an AWS
 * account.
 */
export const productsOf = (checks: ReadonlyArray<Pick<CheckView, "serviceId" | "serviceLabel">>) => {
  const sites = new Map<string, Set<string>>();
  const labels = new Map<string, string>();
  const repos = new Map<string, Set<string>>();
  for (const { serviceId, serviceLabel } of checks) {
    const { kind, name } = kindAndName(serviceId);
    if (kind === "github") add(repos, repoName(name), name);
    const id = plain(name);
    if (kind !== "custom" || id === "") continue;
    labels.set(serviceId, serviceLabel);
    add(sites, id, serviceId);
    // Only a name the id was cut from: a label such as "Website" must not claim a website repository.
    const full = plain(serviceLabel);
    if (full.length > id.length && full.startsWith(id)) add(sites, full, serviceId);
  }
  return (check: Pick<CheckView, "serviceId" | "serviceLabel">) => {
    const { kind, name } = kindAndName(check.serviceId);
    if (kind === "github") {
      const repo = repoName(name);
      const site = one(sites.get(repo));
      if (site !== null && one(repos.get(repo)) !== null) return { key: site, label: labels.get(site)! };
    }
    return { key: check.serviceId, label: check.serviceLabel };
  };
};

export interface ProductGroup {
  readonly key: string;
  readonly label: string;
  readonly checks: ReadonlyArray<CheckView>;
  /** Checks by their latest outcome; waiting have not run yet. */
  readonly counts: { readonly passing: number; readonly failing: number; readonly couldNotRun: number; readonly waiting: number };
  /** The worst latest outcome among its checks: fail, then unknown, then not run yet, then pass. */
  readonly worst: CheckView["lastOutcome"];
  /** Whether its checks come from more than one service, so each row names its own. */
  readonly mixed: boolean;
}

const severity = (outcome: CheckView["lastOutcome"]) => (outcome === "fail" ? 3 : outcome === "unknown" ? 2 : outcome === null ? 1 : 0);

/** Checks by their latest outcome, counted in one pass. */
const tally = (checks: ReadonlyArray<CheckView>) => {
  const counts = { passing: 0, failing: 0, couldNotRun: 0, waiting: 0 };
  for (const { lastOutcome } of checks)
    counts[lastOutcome === "pass" ? "passing" : lastOutcome === "fail" ? "failing" : lastOutcome === "unknown" ? "couldNotRun" : "waiting"] += 1;
  return counts;
};

/** The checks that are on, by product: products with a problem first, then by name. */
export const productGroups = (state: WatchState): ReadonlyArray<ProductGroup> => {
  const on = state.checks.filter((c) => c.state === "on");
  // Only watched services name products: a declined site or a draft does not rename a repository.
  const productOf = productsOf(on);
  const groups = new Map<string, { key: string; label: string; checks: Array<CheckView> }>();
  for (const check of on) {
    const product = productOf(check);
    const group = groups.get(product.key) ?? { ...product, checks: [] };
    group.checks.push(check);
    groups.set(product.key, group);
  }
  return [...groups.values()]
    .map((group): ProductGroup => {
      const counts = tally(group.checks);
      return {
        key: group.key,
        label: group.label,
        checks: group.checks.toSorted((a, b) => a.intent.localeCompare(b.intent)),
        counts,
        worst: counts.failing > 0 ? "fail" : counts.couldNotRun > 0 ? "unknown" : counts.waiting > 0 ? null : "pass",
        mixed: new Set(group.checks.map((c) => c.serviceId)).size > 1,
      };
    })
    .toSorted((a, b) => severity(b.worst) - severity(a.worst) || a.label.localeCompare(b.label));
};

/** A product's line: "All 3 passing", or what is not, such as "1 failing, 1 passing". */
export const productSummary = (group: ProductGroup) => {
  const { passing, failing, couldNotRun, waiting } = group.counts;
  const n = group.checks.length;
  if (passing === n) return n === 1 ? "Passing" : `All ${n} passing`;
  return [
    failing > 0 ? `${failing} failing` : null,
    couldNotRun > 0 ? `${couldNotRun} could not run` : null,
    waiting > 0 ? `${waiting} waiting for a first run` : null,
    passing > 0 ? `${passing} passing` : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
};

/**
 * Whether a check in the scan is new to review: nobody has decided on it, and the scan was applied
 * before. Before the first apply the review shows by itself, so nothing in it is new yet.
 */
export const isNewCheck = (scan: Scan, suggestion: Scan["suggestions"][number]) => scan.appliedAt !== null && suggestion.state === "proposed";

/** How many checks in the latest scan are new to review, as the review marks them. */
export const newChecksToReview = (state: WatchState) => {
  const scan = state.setup.scan;
  return scan === null ? 0 : scan.suggestions.filter((s) => isNewCheck(scan, s)).length;
};

/** Checks that are on or paused can be edited; the others are decided in the review or on Home first. */
export const canEdit = (check: Pick<CheckView, "state">) => check.state === "on" || check.state === "paused";

/** Any check but a draft, which Home discards, and one already deleted. */
export const canDelete = (check: Pick<CheckView, "state">) => check.state !== "draft" && check.state !== "deleted";

/** The Edit form: the check's name, how often it runs in minutes, and its settings as JSON. */
export interface EditForm {
  readonly intent: string;
  readonly minutes: string;
  /** Null where Edit does not change settings: a vendor check, or a kind this build does not know. */
  readonly settings: string | null;
  /** The check as it was when the form opened, so a change made since is not overwritten. */
  readonly updatedAt: string;
}

/**
 * Kinds whose settings Edit changes. A vendor check's come from its vendor's description, and a
 * kind from another build of Watch has nothing here to check them against.
 */
const SETTINGS_KINDS: ReadonlyArray<CheckKind> = ["http", "github", "aws_metric", "heartbeat"];

/** The form as a check stands, with a heartbeat's ping token left out: it never changes here. */
export const editFormOf = (check: Pick<CheckView, "intent" | "cadenceSeconds" | "kind" | "config" | "updatedAt">): EditForm => {
  const { token: _, ...rest } = check.config as Record<string, unknown>;
  return {
    intent: check.intent,
    minutes: String(check.cadenceSeconds / 60),
    settings: SETTINGS_KINDS.includes(check.kind) ? JSON.stringify(check.kind === "heartbeat" ? rest : check.config, null, 2) : null,
    updatedAt: check.updatedAt,
  };
};

/** The edit to send, or why the settings are not JSON. Watch checks everything else and says what is wrong. */
export const editOf = (form: EditForm): { readonly edit: CheckEditInput } | { readonly error: string } => {
  let config: unknown;
  if (form.settings !== null)
    try {
      config = JSON.parse(form.settings);
    } catch (error) {
      return { error: `The settings are not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
    }
  const minutes = form.minutes.trim();
  // An empty or non-numeric answer goes as it is, for Watch to refuse with its reason.
  return {
    edit: {
      intent: form.intent,
      cadenceMinutes: minutes === "" ? Number.NaN : Number(minutes),
      ...(form.settings === null ? {} : { config }),
      updatedAt: form.updatedAt,
    },
  };
};
