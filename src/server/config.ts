import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface WatchConfig {
  readonly port: number;
  readonly host: string;
  /** Bearer token for the API, the page and MCP. */
  readonly token: string;
  /** Folders whose git repositories setup scans. */
  readonly roots: ReadonlyArray<string>;
  /** Public base URL of the page when it is reached through a proxy such as Tailscale. */
  readonly publicUrl: string | null;
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
    host: process.env.T3_WATCH_HOST ?? stored.host ?? "127.0.0.1",
    token: stored.token ?? randomBytes(24).toString("base64url"),
    roots: stored.roots ?? defaultRoots(),
    publicUrl: stored.publicUrl ?? null,
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
  const bare = config.host.replace(/^\[(.*)\]$/, "$1");
  const host = bare === "0.0.0.0" || bare === "::" ? "127.0.0.1" : bare;
  return `http://${host.includes(":") ? `[${host}]` : host}:${config.port}`;
};

export const pageUrl = (config: WatchConfig) => config.publicUrl ?? localUrl(config);

export const signInUrl = (config: WatchConfig) =>
  `${pageUrl(config)}/signin?token=${encodeURIComponent(config.token)}`;

/**
 * The sign-in line for start and install. The link carries the access token, so it goes only to
 * a terminal, never to a service log or an agent's transcript.
 */
export const signInLine = (config: WatchConfig, terminal: boolean) =>
  terminal
    ? `Open this link once to sign in: ${signInUrl(config)}`
    : "For the sign-in link, run t3-watch url in a terminal. It carries the access token, so keep it out of logs and chats.";
