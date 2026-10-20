import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { bareHost, isLoopbackHost } from "./hosts.ts";

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
}

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
  const config: WatchConfig = {
    port: Number(process.env.T3_WATCH_PORT ?? stored.port ?? 8460),
    host: bareHost(process.env.T3_WATCH_HOST ?? stored.host ?? "127.0.0.1"),
    token: stored.token ?? randomBytes(24).toString("base64url"),
    roots: stored.roots ?? defaultRoots(),
    publicUrl: stored.publicUrl ?? null,
    // Kept only when someone set it, so existing config files do not change.
    ...(stored.probeUrls === undefined ? {} : { probeUrls: stored.probeUrls }),
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

