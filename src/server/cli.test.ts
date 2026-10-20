import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { shellQuote, systemdQuote } from "./cli.ts";
import { isSession, startSession, useSignInCode } from "./signin.ts";
import { openStore } from "./store.ts";

describe("t3-watch url", () => {
  it("prints a one-time link that never carries the access token", () => {
    const home = mkdtempSync(join(tmpdir(), "t3w-url-"));
    try {
      const cli = join(import.meta.dirname, "cli.ts");
      const env = { ...process.env, T3_WATCH_HOME: home };
      const link = execFileSync(process.execPath, [cli, "url"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      const token = (JSON.parse(readFileSync(join(home, "config.json"), "utf8")) as { token: string }).token;
      expect(link).toMatch(/^http:\/\/127\.0\.0\.1:8460\/signin\?code=[A-Za-z0-9_-]{32}$/);
      expect(link).not.toContain(token);
      const store = openStore(join(home, "watch.sqlite"));
      const code = new URL(link).searchParams.get("code")!;
      expect(useSignInCode(store, code, new Date())).toBe(true);
      expect(useSignInCode(store, code, new Date())).toBe(false);
      store.close();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("t3-watch signout", () => {
  it("ends every browser session", () => {
    const home = mkdtempSync(join(tmpdir(), "t3w-signout-"));
    try {
      const store = openStore(join(home, "watch.sqlite"));
      const sessions = [startSession(store, new Date()), startSession(store, new Date())];
      store.close();
      const cli = join(import.meta.dirname, "cli.ts");
      const said = execFileSync(process.execPath, [cli, "signout"], { env: { ...process.env, T3_WATCH_HOME: home }, encoding: "utf8" });
      expect(said).toContain("Signed out 2 browsers");
      const after = openStore(join(home, "watch.sqlite"));
      expect(sessions.some((id) => isSession(after, id))).toBe(false);
      after.close();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("cli quoting", () => {
  it("prints commands a shell reads back unchanged", () => {
    expect(shellQuote("/usr/bin/node")).toBe("/usr/bin/node");
    for (const word of ["/home/u/My Projects/bin/t3-watch.js", "/Users/o'brien/t3-watch", "/tmp/$HOME/`x`"])
      expect(execFileSync("sh", ["-c", `printf %s ${shellQuote(word)}`], { encoding: "utf8" })).toBe(word);
  });

  it("writes systemd values that survive specifier and variable expansion", () => {
    expect(systemdQuote("/home/u/My Projects/bin/t3-watch.js", true)).toBe('"/home/u/My Projects/bin/t3-watch.js"');
    expect(systemdQuote('/opt/100%/$x/"q"', true)).toBe('"/opt/100%%/$$x/\\"q\\""');
    // Environment= expands specifiers but not variables.
    expect(systemdQuote("PATH=/a:/b%:$c", false)).toBe('"PATH=/a:/b%%:$c"');
  });
});
