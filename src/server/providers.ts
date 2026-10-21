/**
 * Where agents look for MCP servers: Claude Code's and Codex's default homes, and, with --all,
 * the home of every provider instance T3 Code runs. Registering Watch in each lets a Watch
 * thread on any of T3's accounts use its tools.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type AgentCli = "claude" | "codex";

export interface ProviderHome {
  readonly cli: AgentCli;
  /** The program to run: the CLI's name, or the instance's own binary when T3 names one. */
  readonly command: string;
  /** Another binary T3 names for the same home, tried when `command` is not installed. */
  readonly fallback?: string;
  /** The folder for CLAUDE_CONFIG_DIR or CODEX_HOME, or null for the CLI's default home. */
  readonly home: string | null;
  /** Whose home it is, for the printout. */
  readonly label: string;
}

export interface SkippedProvider {
  readonly label: string;
  readonly reason: string;
}

const DRIVERS: Readonly<Record<string, AgentCli>> = { claudeAgent: "claude", codex: "codex" };
const HOME_VARIABLE: Readonly<Record<AgentCli, string>> = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME" };
const NAMES: Readonly<Record<AgentCli, string>> = { claude: "Claude Code", codex: "Codex" };

/**
 * The variable that points a CLI at a home, so each run writes where the label says: set for a
 * named home, unset for the CLI's own default.
 */
export const homeEnv = (provider: ProviderHome): Record<string, string | undefined> => ({
  [HOME_VARIABLE[provider.cli]]: provider.home ?? undefined,
});

/** T3 Code's data folder: T3CODE_HOME when set, as T3 itself reads it. */
export const t3Home = (env: NodeJS.ProcessEnv = process.env, home = homedir()) => env.T3CODE_HOME?.trim() || join(home, ".t3");

/** T3's settings file, in its data folder. */
export const t3SettingsFile = (env: NodeJS.ProcessEnv = process.env, home = homedir()) => join(t3Home(env, home), "userdata", "settings.json");

/** T3's settings, or null with the reason: T3 is not installed, or its file cannot be read. */
export const readT3Settings = (file = t3SettingsFile()): { readonly settings: unknown; readonly problem: string | null } => {
  if (!existsSync(file)) return { settings: null, problem: `no settings at ${file}` };
  try {
    return { settings: JSON.parse(readFileSync(file, "utf8")) as unknown, problem: null };
  } catch (error) {
    return { settings: null, problem: `could not read ${file}: ${error instanceof Error ? error.message : String(error)}` };
  }
};

const expand = (path: string, home: string) => (path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path);

/** A home folder as one absolute path, ~ expanded and no trailing slash. */
const homeFolder = (path: string, home: string) => resolve(expand(path, home));

/**
 * CODEX_HOME set to ~/.codex is Codex's own default, so it is the default home. Claude Code has
 * no such twin: CLAUDE_CONFIG_DIR=~/.claude keeps its file in ~/.claude, not ~/.claude.json.
 */
const sameAsDefault = (cli: AgentCli, home: string, userHome: string) => cli === "codex" && home === join(userHome, ".codex");

/** A path Watch can place as T3 would: absolute, or under the user's home with ~ or ~/. */
const placeable = (path: string) => path.startsWith("/") || path === "~" || path.startsWith("~/");

/** A binary to run: a bare name found on PATH, or a path Watch can place. */
const runnable = (binary: string) => binary !== "" && (!binary.includes("/") || placeable(binary));

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * The homes the CLIs use by default, then the home of each enabled Claude Code and Codex instance
 * in T3's settings, once each. A default home follows CLAUDE_CONFIG_DIR or CODEX_HOME when the
 * environment sets one, as the CLI would; T3 sets them only for an instance that names a home, so
 * an instance with none uses the CLI's own default. A Codex shadow home shares CODEX_HOME's state
 * apart from auth.json, so the server registered in the home reaches it too. Removing covers
 * instances that are turned off as well, since one may have been on when Watch was installed.
 */
export const providerHomes = (
  settings: unknown,
  options: { readonly userHome?: string; readonly includeDisabled?: boolean; readonly env?: NodeJS.ProcessEnv } = {},
) => {
  const userHome = options.userHome ?? homedir();
  const env = options.env ?? process.env;
  const defaults = (["codex", "claude"] as const).map((cli): ProviderHome => {
    const named = env[HOME_VARIABLE[cli]]?.trim() ?? "";
    const folder = named === "" ? null : resolve(expand(named, userHome));
    const home = folder !== null && sameAsDefault(cli, folder, userHome) ? null : folder;
    return { cli, command: cli, home, label: home === null ? NAMES[cli] : `${NAMES[cli]} in ${named}` };
  });
  const homes: Array<ProviderHome> = [...defaults];
  const skipped: Array<SkippedProvider> = [];
  const instances = (settings as { providerInstances?: unknown } | null)?.providerInstances;
  if (typeof instances !== "object" || instances === null) return { defaults, extra: [], skipped };
  for (const [id, raw] of Object.entries(instances)) {
    const instance = (typeof raw === "object" && raw !== null ? raw : {}) as {
      driver?: unknown;
      displayName?: unknown;
      enabled?: unknown;
      config?: { homePath?: unknown; binaryPath?: unknown };
    };
    const name = `T3's ${text(instance.displayName) || id}`;
    const cli = DRIVERS[text(instance.driver)];
    if (cli === undefined) {
      skipped.push({ label: name, reason: `Watch does not register with ${text(instance.driver) || "unknown"} instances yet` });
      continue;
    }
    if (instance.enabled === false && options.includeDisabled !== true) {
      skipped.push({ label: name, reason: "turned off in T3" });
      continue;
    }
    const homePath = text(instance.config?.homePath);
    if (homePath !== "" && !placeable(homePath)) {
      skipped.push({ label: name, reason: `its home, ${homePath}, is not a path Watch can place the way T3 does` });
      continue;
    }
    const folder = homePath === "" ? null : homeFolder(homePath, userHome);
    const home = folder !== null && sameAsDefault(cli, folder, userHome) ? null : folder;
    const binary = runnable(text(instance.config?.binaryPath)) ? expand(text(instance.config?.binaryPath), userHome) : "";
    const same = homes.findIndex((h) => h.cli === cli && h.home === home);
    if (same !== -1) {
      // One entry per home. A binary T3 names for it is kept to try if the first is not installed.
      const known = homes[same]!;
      if (binary !== "" && known.fallback === undefined && binary !== known.command) homes[same] = { ...known, fallback: binary };
      continue;
    }
    homes.push({
      cli,
      command: binary === "" ? cli : binary,
      home,
      label: `${NAMES[cli]} for ${name}${homePath === "" ? "" : ` in ${homePath}`}`,
    });
  }
  return { defaults: homes.slice(0, defaults.length), extra: homes.slice(defaults.length), skipped };
};
