/**
 * What a check contacts, in one plain sentence for the person deciding whether it may run on a
 * schedule. Never a secret: a heartbeat's ping token stays out, and a key shows only its last four.
 */
import type { WatchCore } from "./app.ts";
import type { Check } from "./store.ts";
import type { Vendor } from "./vendors.ts";

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** A duration in the largest unit that states it exactly: 90 s, 15 min, 2 h, 3 d. */
export const span = (seconds: number) =>
  seconds % 86400 === 0
    ? `${seconds / 86400} d`
    : seconds % 3600 === 0
      ? `${seconds / 3600} h`
      : seconds % 60 === 0
        ? `${seconds / 60} min`
        : `${seconds} s`;

/** How often a check runs, in the same units as its target: every 15 min, every 1 d. */
export const cadenceOf = (seconds: number) => `every ${span(seconds)}`;

/**
 * Path parts an address may show: common words for what a check asks for, or a version. Any other
 * part may be the token a capability address carries, short or long, mixed case or not, so it
 * shows as "…"; the page shows the stored address when the person edits it.
 */
const SAFE_PARTS = new Set([
  "",
  ".well-known",
  "admin",
  "api",
  "app",
  "apps",
  "auth",
  "blog",
  "cart",
  "check",
  "checks",
  "docs",
  "favicon.ico",
  "graphql",
  "health",
  "healthcheck",
  "healthz",
  "health.json",
  "heartbeat",
  "home",
  "index.html",
  "info",
  "live",
  "livez",
  "login",
  "metrics",
  "ping",
  "products",
  "public",
  "ready",
  "readyz",
  "rest",
  "robots.txt",
  "rss",
  "search",
  "security.txt",
  "shop",
  "signin",
  "sitemap.xml",
  "status",
  "status.json",
  "store",
  "up",
  "uptime",
  "version",
  "www",
]);
const safePart = (part: string) => SAFE_PARTS.has(part.toLowerCase()) || /^v\d{1,3}(\.\d{1,3}){0,2}$/i.test(part);

/** A path part as written, decoded when it decodes; a malformed escape is kept, never thrown. */
const decoded = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/**
 * An address to show: its origin and the path parts known to be safe, never a password in it, its
 * query string, or any other path part, which may be a token, as capability URLs carry.
 */
const shownUrl = (value: string | null) => {
  const url = value === null ? null : URL.parse(value);
  if (url === null) return value === null ? "an address" : "an address that does not parse";
  const path = url.pathname
    .split("/")
    .map((part) => (safePart(decoded(part)) ? part : "…"))
    .join("/");
  return `${url.origin}${path}${url.search === "" ? "" : "?…"}`;
};

const short = (value: string, max = 40) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

/** The settings each kind may show. Any other field, and every setting of a kind this build does not know, stays out. */
const PUBLIC_FIELDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  http: ["url", "expectStatus", "contains"],
  github: ["repo", "branch", "workflow", "maxAgeSeconds"],
  aws_metric: ["profile", "region", "namespace", "metric", "dimensions", "statistic", "periodSeconds", "windowSeconds", "comparison", "threshold", "missingIsOk"],
  heartbeat: ["periodSeconds", "graceSeconds"],
  vendor: ["vendor", "check"],
};

/**
 * A check's settings with no secret in them, for the state the page and the inline view read and
 * for every answer agents get: only the settings its kind may show, so a heartbeat's ping token, a
 * field no kind has and a kind this build does not know stay out, and an HTTP address shown as the
 * target sentence shows it. The page fetches the settings as stored when the person edits a check.
 */
export const publicConfig = (check: Pick<Check, "kind" | "config">): Readonly<Record<string, unknown>> => {
  const fields = Object.hasOwn(PUBLIC_FIELDS, check.kind) ? PUBLIC_FIELDS[check.kind]! : [];
  const shown: Record<string, unknown> = Object.fromEntries(fields.filter((field) => Object.hasOwn(check.config, field)).map((field) => [field, check.config[field]]));
  if (typeof shown.url === "string") shown.url = shownUrl(shown.url);
  return shown;
};

/** A check as the agents' token may see it, in every answer that carries one: its settings without secrets. */
export const publicCheck = <T extends Pick<Check, "kind" | "config">>(check: T): T => ({ ...check, config: publicConfig(check) });

/** A heartbeat check's ping address on Watch's own origin, the one place it is built. */
export const pingPath = (token: string) => `/hb/${token}`;

/**
 * One read of a stored check for the person on the page: its name, cadence, kind and version, and
 * its settings as stored with a heartbeat's ping token taken out into its ping address, since the
 * token never changes in Edit. Edit saves against the version its settings came from.
 */
export const storedSettings = (check: Pick<Check, "intent" | "cadenceSeconds" | "kind" | "updatedAt" | "config">) => {
  const { token, ...rest } = check.config;
  const heartbeat = check.kind === "heartbeat";
  return {
    intent: check.intent,
    cadenceSeconds: check.cadenceSeconds,
    kind: check.kind,
    updatedAt: check.updatedAt,
    config: heartbeat ? rest : check.config,
    pingPath: heartbeat && typeof token === "string" ? pingPath(token) : null,
  };
};

export const checkTarget = (
  check: Pick<Check, "kind" | "config">,
  context: { readonly vendor: (id: string) => Vendor | undefined; readonly keyLast4: string | null },
): string => {
  const c = check.config;
  switch (check.kind) {
    case "http": {
      const contains = text(c.contains);
      return `GET ${shownUrl(text(c.url))}${contains === null ? "" : `, expecting "${short(contains)}"`}`;
    }
    case "github": {
      const workflow = text(c.workflow);
      const branch = text(c.branch);
      return `GitHub Actions${workflow === null ? "" : ` workflow ${workflow}`} in ${text(c.repo) ?? "a repository"}${branch === null ? "" : ` on ${branch}`}, read with the gh login`;
    }
    case "aws_metric": {
      const profile = text(c.profile);
      const metric = [text(c.namespace), text(c.metric)].filter((part) => part !== null).join(" ") || "a metric";
      // Two checks on one metric differ by their dimensions, such as the function each watches.
      const dimensions = (Array.isArray(c.dimensions) ? c.dimensions : [])
        .map((d) => (typeof d === "object" && d !== null ? `${text((d as { name?: unknown }).name) ?? "?"} ${text((d as { value?: unknown }).value) ?? "?"}` : null))
        .filter((d) => d !== null);
      return `CloudWatch ${metric}${dimensions.length === 0 ? "" : ` for ${dimensions.join(", ")}`} in ${text(c.region) ?? "a region"}${profile === null ? "" : `, with AWS profile ${profile}`}`;
    }
    case "heartbeat": {
      const period = typeof c.periodSeconds === "number" && c.periodSeconds > 0 ? c.periodSeconds : null;
      return `Nothing outside: your job pings Watch${period === null ? "" : ` at least every ${span(period)}`}`;
    }
    case "vendor": {
      const id = text(c.vendor);
      const vendor = id === null ? undefined : context.vendor(id);
      const origin = vendor?.api?.origin;
      return `${vendor?.label ?? id ?? "A vendor"}'s API${origin === undefined ? "" : ` at ${origin}`}${context.keyLast4 === null ? "" : `, with the key ending ${context.keyLast4}`}`;
    }
    default:
      // A kind from another build of Watch still gets a sentence.
      return `A ${String(check.kind)} check`;
  }
};

/**
 * Targets for many checks at once: the vendor descriptions and stored keys are read once, not
 * once per check, since the state is read on every page refresh.
 */
export const targetsOf = (
  watch: WatchCore,
  keys: ReadonlyArray<{ readonly id: string; readonly last4: string }> = watch.keys(),
  vendors: ReadonlyMap<string, Vendor> = watch.vendors(),
) => {
  const last4 = new Map(keys.map((k) => [k.id, k.last4]));
  return (check: Pick<Check, "kind" | "config" | "keyId">) =>
    checkTarget(check, { vendor: (id) => vendors.get(id), keyLast4: check.keyId === null ? null : (last4.get(check.keyId) ?? null) });
};
