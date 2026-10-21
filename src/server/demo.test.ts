import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { homeModel, newChecksToReview, productGroups } from "../web/logic.ts";
import { makeAlertSecret } from "./alerts.ts";
import { makeWatch, SAMPLE_ONLY } from "./app.ts";
import { DEMO_PORT, demoPort } from "./cli.ts";
import { DEMO_ACCOUNT, DEMO_READS, demoDeps, demoFetch, demoRun, seedDemo } from "./demo.ts";
import { readState } from "./state.ts";

const PAGE = "http://127.0.0.1:8470";
const dirs: Array<string> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const demoWatch = (now: () => Date) =>
  makeWatch({ home: null, dbFile: ":memory:", deps: demoDeps(now), roots: () => [], reads: () => DEMO_READS, chosen: () => true, sample: true });

describe("the demo", () => {
  it("fills a Watch with sample products, one broken with an agent's note, a draft and a new check to review", async () => {
    const watch = demoWatch(() => new Date("2026-10-21T12:00:00Z"));
    await seedDemo(watch, PAGE);
    const state = readState(watch);
    expect(productGroups(state).map((g) => [g.label, g.checks.length, g.worst])).toEqual([
      ["Billing API", 2, "fail"],
      [`AWS account ${DEMO_ACCOUNT}`, 1, "pass"],
      ["Docs", 1, "pass"],
      ["Nightly backup", 1, "pass"],
      ["Storefront", 2, "pass"],
      ["Stripe", 2, "pass"],
    ]);
    const home = homeModel(state);
    expect(home.failing.map((c) => [c.intent, c.lastSummary])).toEqual([["Health endpoint answers", "Answered 503"]]);
    expect(home.failing[0]!.note).toContain("database pool is exhausted");
    expect(home.drafts.map((c) => [c.intent, c.lastOutcome])).toEqual([["Search answers", "pass"]]);
    expect(newChecksToReview(state)).toBe(1);
    expect(state.alerts).toMatchObject({ on: true, host: "hooks.example", signed: true, lastTest: { ok: true } });
    // History to look at: every check that is on has runs, and changes were recorded.
    for (const check of state.checks.filter((c) => c.state === "on")) expect(watch.store.runs(check.id).length).toBeGreaterThan(0);
    // Newest first, in time as well as in the order they were recorded.
    expect(state.events.map((e) => [e.checkId, e.to])).toEqual([
      ["custom:billing-api:health", "fail"],
      ["custom:docs:answers", "pass"],
      ["custom:docs:answers", "fail"],
    ]);
    expect(state.events.map((e) => e.at)).toEqual(state.events.map((e) => e.at).toSorted().reverse());
    // The key is made up each time, and only its last four show; the review offers no Remove the demo would refuse.
    expect(state.keys.map((k) => [k.vendor, k.account])).toEqual([["stripe", "acct_demo"]]);
    expect(state.setup.scan!.services.flatMap((s) => s.access).filter((a) => a.removable)).toEqual([]);
    expect(JSON.stringify(state)).not.toMatch(/demo_[0-9a-f]{24}/);
  });

  it("keeps its outcomes as its checks run, without a real request, and takes in nothing real", async () => {
    const real = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("The demo must not reach the network"));
    let clock = new Date("2026-10-21T12:00:00Z");
    const watch = demoWatch(() => clock);
    await seedDemo(watch, PAGE);
    clock = new Date(clock.getTime() + 3_600_000);
    await watch.runner.tick();
    const outcomes = () => Object.fromEntries(readState(watch).checks.filter((c) => c.state === "on").map((c) => [c.id, c.lastOutcome]));
    expect(Object.entries(outcomes()).filter(([, outcome]) => outcome !== "pass")).toEqual([["custom:billing-api:health", "fail"]]);
    expect(watch.store.check("custom:storefront:answers")!.lastRunAt).toBe(clock.toISOString());
    expect(real).not.toHaveBeenCalled();
    // A sample Watch scans nothing, takes no key and makes no secret, by the page or an agent alike.
    const refusal = (work: () => unknown) => {
      try {
        work();
      } catch (error) {
        return [(error as Error).message, (error as { status?: number }).status];
      }
      return null;
    };
    expect(refusal(() => watch.scanner.start())).toEqual([SAMPLE_ONLY.reads, 403]);
    expect(refusal(() => makeAlertSecret(watch))).toEqual([SAMPLE_ONLY.secret, 403]);
    expect(refusal(() => watch.removeKey("key-demo-stripe"))).toEqual([SAMPLE_ONLY.keys, 403]);
    await expect(watch.addKey({ vendor: "stripe", value: "anything-at-all" })).rejects.toMatchObject({ message: SAMPLE_ONLY.keys, status: 403 });
    expect(watch.keys()).toHaveLength(1);
  });

  it("lists only the workflow a check asks for, as gh would", async () => {
    const run = demoRun(() => new Date("2026-10-21T12:00:00Z"));
    const names = async (...more: Array<string>) =>
      (JSON.parse((await run("gh", ["run", "list", "--repo", "example/storefront", ...more])).stdout) as Array<{ workflowName: string }>).map((r) => r.workflowName);
    expect(await names()).toEqual(["CI", "Lint"]);
    expect(await names("--workflow", "CI")).toEqual(["CI"]);
    expect(await names("--workflow", "deploy")).toEqual([]);
  });

  it("answers anything outside the sample as not part of the demo", async () => {
    const now = () => new Date("2026-10-21T12:00:00Z");
    expect((await demoFetch(now)("https://api.github.com/user")).status).toBe(404);
    expect(await demoRun(now)("git", ["remote", "-v"])).toMatchObject({ missing: true });
    expect(await demoRun(now)("aws", ["s3", "ls"])).toMatchObject({ code: 1, stderr: "Not part of the demo" });
    expect(await demoRun(now)("gh", ["repo", "delete", "example/storefront"])).toMatchObject({ code: 1 });
  });

  it("runs from the CLI on this machine only, on canned answers whatever the environment says, and leaves nothing once stopped", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "t3w-demo-cli-"));
    dirs.push(scratch);
    // The person's own AWS file, which the demo must not read.
    writeFileSync(join(scratch, "theirs"), "[profile theirs-prod]\nregion = eu-west-1\n[profile theirs-dev]\nregion = eu-west-1\n");
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address() as AddressInfo;
        probe.close(() => resolve(free));
      });
    });
    const child = spawn(process.execPath, [join(import.meta.dirname, "cli.ts"), "demo", "--port", String(port)], {
      env: { ...process.env, TMPDIR: scratch, T3_WATCH_HOST: "0.0.0.0", T3_WATCH_PORT: "1", AWS_CONFIG_FILE: join(scratch, "theirs") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // What it prints holds a sign-in link, so the checks below say only whether a line is there.
    let printed = "";
    let errors = "";
    child.stdout.on("data", (chunk: Buffer) => {
      printed += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString("utf8");
    });
    let code: number | null | undefined;
    const exited = new Promise<void>((resolve) =>
      child.once("exit", (exitCode) => {
        code = exitCode;
        resolve();
      }),
    );
    try {
      await vi.waitFor(
        () => {
          if (code !== undefined) throw new Error(`The demo stopped at start: ${errors}`);
          expect(printed.includes("Stop it with Ctrl-C")).toBe(true);
        },
        { timeout: 20_000, interval: 100 },
      );
      expect(printed.includes(`runs at http://127.0.0.1:${port} `)).toBe(true);
      const folders = readdirSync(scratch).filter((name) => name.startsWith("t3-watch-demo-"));
      expect(folders).toHaveLength(1);
      const config = JSON.parse(readFileSync(join(scratch, folders[0]!, "config.json"), "utf8")) as { token: string } & Record<string, unknown>;
      expect(config).toMatchObject({ host: "127.0.0.1", port, roots: [], publicUrl: null, reads: DEMO_READS });
      const base = `http://127.0.0.1:${port}`;
      // Signed out, the page says how to get into the demo, not into a real Watch.
      expect(await (await fetch(`${base}/`)).text()).toContain("Stop it and start it again");
      const asWatch = { authorization: `Bearer ${config.token}` };
      // Its test alert was accepted, which only the canned webhook does; the real one is never asked.
      const state = (await (await fetch(`${base}/api/state`, { headers: asWatch })).json()) as { alerts: { lastTest: { ok: boolean } }; keys: Array<unknown> };
      expect([state.alerts.lastTest.ok, state.keys.length]).toEqual([true, 1]);
      // It reads its own AWS file, with one profile, never the person's, with two.
      const setup = (await (await fetch(`${base}/api/setup`, { headers: asWatch })).json()) as { sources: { logins: Array<{ id: string; detail: string }> } };
      expect(setup.sources.logins.find((login) => login.id === "aws")?.detail).toBe("1 profile here. Watch reads each account's identity and metrics.");
      const key = await fetch(`${base}/api/keys`, { method: "POST", headers: { ...asWatch, "content-type": "application/json" }, body: JSON.stringify({ vendor: "stripe", value: "anything-at-all" }) });
      expect([key.status, ((await key.json()) as { error: string }).error]).toEqual([403, SAMPLE_ONLY.keys]);
    } finally {
      child.kill("SIGINT");
      await exited;
    }
    expect(code).toBe(0);
    expect(readdirSync(scratch)).toEqual(["theirs"]);
  }, 30_000);

  it("takes only a port", () => {
    expect(demoPort([])).toBe(DEMO_PORT);
    expect(demoPort(["--port", "9000"])).toBe(9000);
    const usage = `t3-watch demo takes only --port and a port number from 1024 to 65535, such as ${DEMO_PORT}`;
    for (const args of [["--port", "x"], ["--port"], ["--verbose"], ["--port", "0x1f"], ["--port", "1e3"], ["--port=9000"], ["--port", "80"], ["--port", "70000"], ["--port", "9000", "--port", "x"]])
      expect(() => demoPort(args)).toThrow(usage);
  });
});
