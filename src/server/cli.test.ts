import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { probe, shellQuote, systemdQuote } from "./cli.ts";
import type { WatchConfig } from "./config.ts";
import { isSession, startSession, useSignInCode } from "./signin.ts";
import { openStore } from "./store.ts";

describe("t3-watch url", () => {
  it("prints a one-time link that never carries the access token", () => {
    const home = mkdtempSync(join(tmpdir(), "t3w-url-"));
    try {
      const cli = join(import.meta.dirname, "cli.ts");
      // Overrides in the developer's shell would change the address the link names.
      const { T3_WATCH_PORT: _port, T3_WATCH_HOST: _host, ...rest } = process.env;
      writeFileSync(join(home, "config.json"), JSON.stringify({ token: "t3w-url-test-token-0123456789" }));
      const run = spawnSync(process.execPath, [cli, "url"], { env: { ...rest, T3_WATCH_HOME: home }, encoding: "utf8" });
      const link = run.stdout.trim();
      // No Watch runs with this scratch folder, so the CLI says the link cannot work yet.
      expect(run.stderr).toContain("No Watch answers for");
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

  it("says when the folder holds no Watch, and creates nothing there", () => {
    const home = mkdtempSync(join(tmpdir(), "t3w-none-"));
    try {
      const cli = join(import.meta.dirname, "cli.ts");
      for (const command of ["url", "status"]) {
        const run = spawnSync(process.execPath, [cli, command], { env: { ...process.env, T3_WATCH_HOME: home }, encoding: "utf8" });
        expect(run.status).toBe(1);
        expect(run.stdout + run.stderr).toContain("No Watch in");
        expect(run.stdout).not.toContain("/signin");
      }
      expect(readdirSync(home)).toEqual([]);
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
      expect(sessions.some((id) => isSession(after, id, new Date()))).toBe(false);
      after.close();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("says when the folder holds no Watch, and makes no database there", () => {
    const home = mkdtempSync(join(tmpdir(), "t3w-signout-none-"));
    try {
      const cli = join(import.meta.dirname, "cli.ts");
      const run = spawnSync(process.execPath, [cli, "signout"], { env: { ...process.env, T3_WATCH_HOME: home }, encoding: "utf8" });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("No Watch in");
      expect(existsSync(join(home, "watch.sqlite"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("probe", () => {
  const at = (port: number): WatchConfig => ({ port, host: "127.0.0.1", token: "t", roots: [], publicUrl: null });
  const listen = async (handler: (request: IncomingMessage, response: ServerResponse) => void) => {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, port: (server.address() as AddressInfo).port };
  };

  it("tells a running Watch from a refusal, another answer, a slow one and nothing listening", async () => {
    const checks = [{ state: "on", lastOutcome: "fail" }];
    const respond = (status: number, body: string) =>
      listen((_request, response) => {
        response.writeHead(status);
        response.end(body);
      });
    const running = await respond(200, JSON.stringify({ checks }));
    const refusing = await respond(401, "{}");
    const failing = await respond(500, "{}");
    const page = await respond(200, "<!doctype html><p>Another app</p>");
    const odd = await respond(200, JSON.stringify({ checks: [null] }));
    const stuck = await listen(() => {});
    try {
      expect(await probe(at(running.port))).toEqual({ kind: "running", checks });
      expect((await probe(at(refusing.port))).kind).toBe("refused");
      // An error from Watch itself, or another program on the port, is not a refused token.
      expect(await probe(at(failing.port))).toEqual({ kind: "unexpected", answer: "HTTP 500" });
      expect((await probe(at(page.port))).kind).toBe("unexpected");
      expect((await probe(at(odd.port))).kind).toBe("unexpected");
      expect((await probe(at(stuck.port), 200)).kind).toBe("slow");
    } finally {
      await Promise.all(
        [running, refusing, failing, page, odd, stuck].map(({ server }) => {
          server.closeAllConnections();
          return new Promise<void>((resolve) => server.close(() => resolve()));
        }),
      );
    }
    // The refusing server's port, closed and released above, has nothing listening.
    expect((await probe(at(refusing.port))).kind).toBe("absent");
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
