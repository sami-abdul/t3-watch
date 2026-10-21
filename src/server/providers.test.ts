import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { registerMcp } from "./cli.ts";
import { type ProcResult, runProc } from "./proc.ts";
import { homeEnv, providerHomes, readT3Settings, t3SettingsFile } from "./providers.ts";

// Shaped like T3 Code's own settings: several accounts per provider, one turned off.
const settings = {
  providerInstances: {
    claudeAgent_social: { driver: "claudeAgent", displayName: "Social", enabled: true, config: { homePath: "~/.claude-night" } },
    claudeAgent: { driver: "claudeAgent", displayName: "Shop", enabled: true, config: { homePath: "", binaryPath: "/opt/claude/bin/claude" } },
    codex: { driver: "codex", displayName: "Tools", enabled: false, config: { homePath: "" } },
    opencode: { driver: "opencode", displayName: "Server", enabled: true, config: { serverUrl: "http://127.0.0.1:4096" } },
    claudeAgent_third: { driver: "claudeAgent", displayName: "", enabled: true, config: { homePath: "~/.claude-third", binaryPath: "~/bin/claude" } },
    codex_work: { driver: "codex", displayName: "Work", enabled: true, config: { homePath: "/srv/codex-work" } },
    claudeAgent_same: { driver: "claudeAgent", displayName: "Again", enabled: true, config: { homePath: "~/.claude-night/" } },
    claudeAgent_relative: { driver: "claudeAgent", displayName: "Relative", enabled: true, config: { homePath: "accounts/claude" } },
    codex_default: { driver: "codex", displayName: "Plain", enabled: true, config: { homePath: "~/.codex/" } },
  },
};

describe("provider homes", () => {
  it("adds each enabled Claude Code and Codex home from T3 once, and says why others are left out", () => {
    const { defaults, extra, skipped } = providerHomes(settings, { userHome: "/home/u", env: {} });
    const homes = [...defaults, ...extra];
    expect(homes).toEqual([
      { cli: "codex", command: "codex", home: null, label: "Codex" },
      // Shop shares the default home, so the binary it names is kept to try if claude is missing.
      { cli: "claude", command: "claude", home: null, label: "Claude Code", fallback: "/opt/claude/bin/claude" },
      { cli: "claude", command: "claude", home: "/home/u/.claude-night", label: "Claude Code for T3's Social in ~/.claude-night" },
      { cli: "claude", command: "/home/u/bin/claude", home: "/home/u/.claude-third", label: "Claude Code for T3's claudeAgent_third in ~/.claude-third" },
      // A trailing slash names the same home as without; CODEX_HOME=~/.codex is Codex's default.
      { cli: "codex", command: "codex", home: "/srv/codex-work", label: "Codex for T3's Work in /srv/codex-work" },
    ]);
    expect(skipped).toEqual([
      { label: "T3's Tools", reason: "turned off in T3" },
      { label: "T3's Server", reason: "Watch does not register with opencode instances yet" },
      { label: "T3's Relative", reason: "its home, accounts/claude, is not a path Watch can place the way T3 does" },
    ]);
    expect(homeEnv(homes[2]!)).toEqual({ CLAUDE_CONFIG_DIR: "/home/u/.claude-night" });
    expect(homeEnv(homes[4]!)).toEqual({ CODEX_HOME: "/srv/codex-work" });
    // The default homes unset the variable: an install run from a T3 thread inherits that thread's
    // account, and CLAUDE_CONFIG_DIR=~/.claude would move Claude's own file.
    expect(homeEnv(homes[1]!)).toStrictEqual({ CLAUDE_CONFIG_DIR: undefined });
    expect(homeEnv(homes[0]!)).toStrictEqual({ CODEX_HOME: undefined });
    // Removing also covers an instance turned off since it was installed; Tools shares the default home.
    expect(providerHomes(settings, { userHome: "/home/u", includeDisabled: true, env: {} }).skipped.map((s) => s.label)).toEqual(["T3's Server", "T3's Relative"]);
  });

  it("follows a home the environment names for the default entries, and labels it", () => {
    const env = { CLAUDE_CONFIG_DIR: "~/.claude-night", CODEX_HOME: "~/.codex" };
    const shop = { driver: "claudeAgent", displayName: "Shop", enabled: true, config: { homePath: "" } };
    const social = { driver: "claudeAgent", displayName: "Social", enabled: true, config: { homePath: "~/.claude-night" } };
    const odd = { driver: "claudeAgent", displayName: "Odd", enabled: true, config: { homePath: "~alice/.claude", binaryPath: "bin/claude" } };
    const loose = { driver: "claudeAgent", displayName: "Loose", enabled: true, config: { homePath: "/srv/claude", binaryPath: "bin/claude" } };
    const { defaults, extra, skipped } = providerHomes({ providerInstances: { shop, social, odd, loose } }, { userHome: "/home/u", env });
    // CODEX_HOME=~/.codex is Codex's own default; CLAUDE_CONFIG_DIR names another home, which Social shares.
    expect(defaults).toEqual([
      { cli: "codex", command: "codex", home: null, label: "Codex" },
      { cli: "claude", command: "claude", home: "/home/u/.claude-night", label: "Claude Code in ~/.claude-night" },
    ]);
    // Shop runs with no variable, so it is the real default home, its own entry here.
    expect(extra.map((h) => [h.label, h.home, h.command])).toEqual([
      ["Claude Code for T3's Shop", null, "claude"],
      // A relative binary path cannot be placed, so the bare CLI runs.
      ["Claude Code for T3's Loose in /srv/claude", "/srv/claude", "claude"],
    ]);
    expect(skipped).toEqual([{ label: "T3's Odd", reason: "its home, ~alice/.claude, is not a path Watch can place the way T3 does" }]);
  });

  it("keeps to the default homes when T3's settings are missing or odd", () => {
    for (const odd of [null, {}, { providerInstances: "none" }, { providerInstances: { x: null } }]) {
      const { defaults, extra } = providerHomes(odd, { userHome: "/home/u", env: {} });
      expect(defaults.map((h) => h.label)).toEqual(["Codex", "Claude Code"]);
      expect(extra).toEqual([]);
    }
    expect(providerHomes({ providerInstances: { x: null } }, { userHome: "/home/u", env: {} }).skipped).toEqual([
      { label: "T3's x", reason: "Watch does not register with unknown instances yet" },
    ]);
  });

  it("finds T3's settings where T3 does, and reads none from a missing or broken file", () => {
    expect(t3SettingsFile({}, "/home/u")).toBe("/home/u/.t3/userdata/settings.json");
    expect(t3SettingsFile({ T3CODE_HOME: "/srv/t3" }, "/home/u")).toBe("/srv/t3/userdata/settings.json");
    expect(t3SettingsFile({ T3CODE_HOME: " " }, "/home/u")).toBe("/home/u/.t3/userdata/settings.json");
    const dir = mkdtempSync(join(tmpdir(), "t3w-t3-"));
    try {
      const file = join(dir, "settings.json");
      expect(readT3Settings(file)).toEqual({ settings: null, problem: `no settings at ${file}` });
      writeFileSync(file, "{ not json");
      // A broken file is named as broken, not as missing.
      expect(readT3Settings(file).problem).toMatch(new RegExp(`^could not read ${file}: `));
      writeFileSync(file, JSON.stringify(settings));
      expect(readT3Settings(file)).toEqual({ settings, problem: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runProc", () => {
  it("unsets a variable the command would inherit, and sets one it names", async () => {
    process.env.T3W_TEST_HOME = "/inherited";
    try {
      const echo = (env: Record<string, string | undefined>) => runProc("sh", ["-c", 'echo "${T3W_TEST_HOME:-unset}"'], { env });
      expect((await echo({ T3W_TEST_HOME: undefined })).stdout.trim()).toBe("unset");
      expect((await echo({ T3W_TEST_HOME: "/named" })).stdout.trim()).toBe("/named");
      expect((await echo({})).stdout.trim()).toBe("/inherited");
    } finally {
      delete process.env.T3W_TEST_HOME;
    }
  });
});

describe("install --all", () => {
  const recorder = (answer: (command: string) => Partial<ProcResult> = () => ({})) => {
    const calls: Array<{ command: string; args: ReadonlyArray<string>; env: Readonly<Record<string, string | undefined>> | undefined }> = [];
    const run = async (command: string, args: ReadonlyArray<string>, options?: { readonly env?: Readonly<Record<string, string | undefined>> }) => {
      calls.push({ command, args, env: options?.env });
      return { code: 0, stdout: "", stderr: "", missing: false, timedOut: false, ...answer(command) } as ProcResult;
    };
    return { calls, run };
  };

  it("registers in every home with its variable, and lists what it skipped", async () => {
    const { calls, run } = recorder((command) => (command === "/home/u/bin/claude" ? { missing: true } : {}));
    const lines = await registerMcp({ all: true, settings: providerHomesSettings(), run, env: {}, exists: () => true });
    const adds = calls.filter((c) => c.args[1] === "add");
    expect(adds.map((c) => [c.command, c.env, c.args.slice(0, c.args.indexOf("--")).join(" ")])).toEqual([
      ["codex", {}, "mcp add t3-watch"],
      ["claude", {}, "mcp add -s user t3-watch"],
      ["claude", { CLAUDE_CONFIG_DIR: `${homedir()}/.claude-night` }, "mcp add -s user t3-watch"],
      ["/home/u/bin/claude", { CLAUDE_CONFIG_DIR: `${homedir()}/.claude-third` }, "mcp add -s user t3-watch"],
    ]);
    // The default homes run with the variable unset, whatever the shell running install had.
    expect(adds[1]!.env).toStrictEqual({ CLAUDE_CONFIG_DIR: undefined });
    // Each add follows a remove in the same home, so a second install replaces the first.
    expect(calls.filter((c) => c.args[1] === "remove")).toHaveLength(4);
    expect(lines).toContain("Claude Code for T3's Social in ~/.claude-night: added the t3-watch MCP server");
    const later = lines.find((line) => line.startsWith("Claude Code for T3's Third"))!;
    expect(later).toContain(`not installed. Later run: CLAUDE_CONFIG_DIR=${homedir()}/.claude-third /home/u/bin/claude mcp add -s user t3-watch -- `);
    expect(lines).toContain("T3's Off: skipped, turned off in T3");
  });

  it("skips a home that does not exist yet, on install", async () => {
    const { calls, run } = recorder();
    const lines = await registerMcp({ all: true, settings: providerHomesSettings(), run, env: {}, exists: (path) => !path.endsWith(".claude-third") });
    expect(lines).toContain("Claude Code for T3's Third in ~/.claude-third: skipped, its home does not exist yet");
    expect(calls.some((c) => c.command === "/home/u/bin/claude")).toBe(false);
  });

  it("covers the default homes alone without --all, and says what --all would add", async () => {
    const { calls, run } = recorder();
    const lines = await registerMcp({ all: false, settings: providerHomesSettings(), run, env: {}, exists: () => true });
    expect(new Set(calls.map((c) => c.command))).toEqual(new Set(["codex", "claude"]));
    expect(calls.every((c) => Object.values(c.env ?? {}).every((value) => value === undefined))).toBe(true);
    expect(lines.at(-1)).toBe("T3 Code lists 2 more provider homes. To cover them too: t3-watch install --all");
    const none = await registerMcp({ all: true, settings: null, run: recorder().run, env: {}, exists: () => true });
    expect(none.at(-1)).toContain("no settings at");
  });

  it("removes from the same homes on uninstall --all, turned-off ones too, and says what happened", async () => {
    const { calls, run } = recorder((command) =>
      // The real codex exits 0 when there was nothing to remove.
      command === "codex"
        ? { code: 0, stdout: "No MCP server named 't3-watch' found." }
        : command === "/home/u/bin/claude"
          ? { code: null, timedOut: true }
          : command === "claude" && calls.length > 2
            ? { code: 1, stderr: "Error: failed to write config\n\nCaused by:\n    disk full" }
            : {},
    );
    const lines = await registerMcp({ all: true, remove: true, settings: providerHomesSettings(), run, env: {}, exists: (path) => !path.endsWith(".codex-off") });
    expect(calls.every((c) => c.args[1] === "remove")).toBe(true);
    // The home of Off was never made, so no CLI runs there.
    expect(calls).toHaveLength(4);
    expect(lines).toEqual([
      "Codex: had no t3-watch MCP server",
      "Claude Code: removed the t3-watch MCP server",
      // A CLI's error is cut to its first line.
      "Claude Code for T3's Social in ~/.claude-night: could not remove the MCP server: Error: failed to write config",
      "Claude Code for T3's Third in ~/.claude-third: did not answer in time, so the MCP server may still be there",
      "Codex for T3's Off in ~/.codex-off: had no t3-watch MCP server",
    ]);
  });
});

describe("install's fallback and timeouts", () => {
  it("tries the binary T3 names for a home when the bare CLI is missing, and says when a CLI hangs", async () => {
    const calls: Array<string> = [];
    const run = async (command: string) => {
      calls.push(command);
      const missing = command === "claude";
      const timedOut = command === "codex";
      return { code: missing || timedOut ? null : 0, stdout: "", stderr: "", missing, timedOut } as ProcResult;
    };
    const shop = { providerInstances: { shop: { driver: "claudeAgent", displayName: "Shop", enabled: true, config: { homePath: "", binaryPath: "/opt/claude/bin/claude" } } } };
    const lines = await registerMcp({ all: false, settings: shop, run, env: {}, exists: () => true });
    expect(lines).toEqual([
      "Codex: did not answer in time, so the MCP server may be half added; run install again",
      "Claude Code: added the t3-watch MCP server",
    ]);
    expect(calls).toEqual(["codex", "codex", "claude", "/opt/claude/bin/claude", "claude", "/opt/claude/bin/claude"]);
  });
});

/** Settings whose homes live under the real home folder, since registerMcp expands ~ there. */
function providerHomesSettings() {
  return {
    providerInstances: {
      social: { driver: "claudeAgent", displayName: "Social", enabled: true, config: { homePath: "~/.claude-night" } },
      third: { driver: "claudeAgent", displayName: "Third", enabled: true, config: { homePath: "~/.claude-third", binaryPath: "/home/u/bin/claude" } },
      off: { driver: "codex", displayName: "Off", enabled: false, config: { homePath: "~/.codex-off" } },
    },
  };
}
