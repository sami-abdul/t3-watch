import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { bareHost, isLoopbackHost } from "./hosts.ts";

/** What setup may read besides the folders. */
export interface Reads {
  /** The GitHub CLI's login, for each repository's CI. */
  readonly github: boolean;
  /** AWS CLI profiles, for each account's identity and metrics. */
  readonly aws: boolean;
  /** Vendor keys in .env files in the folders. */
  readonly envFiles: boolean;
}

/** The logins setup can read, in the order the page lists them. */
export const READS = ["github", "aws", "envFiles"] as const;

/** Everything allowed: what an install reads before the person has chosen. */
export const ALL_READS: Reads = { github: true, aws: true, envFiles: true };

export interface WatchConfig {
  readonly port: number;
  readonly host: string;
  /** Bearer token for the API, the page and MCP. */
  readonly token: string;
  /** Folders whose git repositories setup scans. */
  readonly roots: ReadonlyArray<string>;
  /** Public base URL of the page when it is reached through a proxy such as Tailscale. */
  readonly publicUrl: string | null;
  /**
   * Addresses Watch probes to tell its own lost link from a site going down; [] turns that off.
   * Kept as written in config.json and checked where it is used.
   */
  readonly probeUrls?: unknown;
  /**
   * The address install served the page at with tailscale serve, the publicUrl it set. Set only
   * by install, so a route or publicUrl the person made is never taken down.
   */
  readonly tailnetUrl?: string;
  /** Whether install made the route at tailnetUrl, so it may take it down, or found it there. */
  readonly tailnetRoute?: "made" | "found";
  /** What setup may read, as the person chose it on the page; a login it does not name is allowed. */
  readonly reads?: Partial<Reads>;
  /** Folders the person unticked, kept so the page still lists them. */
  readonly skippedRoots?: ReadonlyArray<string>;
}

/** The saved choice in full: anything the person has not ruled out is allowed, as before the choice existed. */
export const readsOf = (config: WatchConfig): Reads => ({ ...ALL_READS, ...config.reads });

/** The booleans of a stored `reads`, and nothing else. */
const readsFrom = (value: unknown): Partial<Reads> | null => {
  if (typeof value !== "object" || value === null) return null;
  const kept = Object.fromEntries(READS.filter((key) => typeof (value as Record<string, unknown>)[key] === "boolean").map((key) => [key, (value as Record<string, boolean>)[key]]));
  return Object.keys(kept).length === 0 ? null : (kept as Partial<Reads>);
};

export const watchHome = () => process.env.T3_WATCH_HOME ?? join(homedir(), ".t3-watch");

const defaultRoots = () =>
  ["Projects", "projects", "code", "src", "dev", "repos"]
    .map((name) => join(homedir(), name))
    .filter((dir) => existsSync(dir));

/** Reads config.json, creating it with a fresh token on first use. */
export const loadConfig = (home = watchHome()): WatchConfig => {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = join(home, "config.json");
  const stored = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Partial<WatchConfig>)
    : {};
  const reads = readsFrom(stored.reads);
  const config: WatchConfig = {
    port: Number(process.env.T3_WATCH_PORT ?? stored.port ?? 8460),
    host: bareHost(process.env.T3_WATCH_HOST ?? stored.host ?? "127.0.0.1"),
    token: stored.token ?? randomBytes(24).toString("base64url"),
    roots: stored.roots ?? defaultRoots(),
    publicUrl: stored.publicUrl ?? null,
    // Kept only when someone set it, so existing config files do not change.
    ...(stored.probeUrls === undefined ? {} : { probeUrls: stored.probeUrls }),
    ...(reads === null ? {} : { reads }),
    ...(Array.isArray(stored.skippedRoots) && stored.skippedRoots.every((r) => typeof r === "string") ? { skippedRoots: stored.skippedRoots } : {}),
    ...(typeof stored.tailnetUrl === "string" && (stored.tailnetRoute === "made" || stored.tailnetRoute === "found")
      ? { tailnetUrl: stored.tailnetUrl, tailnetRoute: stored.tailnetRoute }
      : {}),
  };
  if (JSON.stringify(stored) !== JSON.stringify(config)) saveConfig(config, home);
  return config;
};

export const saveConfig = (config: WatchConfig, home = watchHome()) => {
  writeFileSync(join(home, "config.json"), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
};

/** Where tools on this machine reach the service: its own address, or loopback when it listens everywhere. */
export const localUrl = (config: WatchConfig) => {
  const bare = bareHost(config.host);
  const host = bare === "0.0.0.0" || bare === "::" ? "127.0.0.1" : bare;
  return `http://${host.includes(":") ? `[${host}]` : host}:${config.port}`;
};

export const pageUrl = (config: WatchConfig) => config.publicUrl ?? localUrl(config);

/**
 * The addresses the service listens on: its host, plus 127.0.0.1 when the host is one address
 * that is not loopback, so a local proxy such as tailscale serve can reach the page too.
 */
export const listenHosts = (config: WatchConfig) => {
  const host = bareHost(config.host);
  // Loopback and the unspecified addresses, which listen everywhere, need no second listener.
  return isLoopbackHost(host) ? [host] : [host, "127.0.0.1"];
};

