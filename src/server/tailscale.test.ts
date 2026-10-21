import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { stopTailnetPage, tailnetPage } from "./cli.ts";
import type { WatchConfig } from "./config.ts";
import type { ProcResult } from "./proc.ts";
import { choosePort, findTailnet, type Served, sendsToWatch, servedPorts, serveWatch, usable, watchTarget } from "./tailscale.ts";

const MAC_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const NAME = "box.tail1234.ts.net";
const running = { BackendState: "Running", Self: { DNSName: `${NAME}.` }, CertDomains: [NAME] };
const tailnet = { cli: "tailscale", dnsName: NAME, https: true };

/** Serve status for HTTPS routes, each port's "/" proxying where given, shaped like Tailscale's own. */
const serving = (routes: Record<number, string>, extra: { funnel?: ReadonlyArray<number>; http?: ReadonlyArray<number>; paths?: Record<number, string> } = {}) => ({
  TCP: Object.fromEntries(Object.keys(routes).map((port) => [port, extra.http?.includes(Number(port)) ? { HTTP: true } : { HTTPS: true }])),
  Web: Object.fromEntries(
    Object.entries(routes).map(([port, proxy]) => [
      `${NAME}:${port}`,
      { Handlers: { "/": { Proxy: proxy }, ...(extra.paths?.[Number(port)] ? { [extra.paths[Number(port)]!]: { Proxy: "http://127.0.0.1:3000" } } : {}) } },
    ]),
  ),
  AllowFunnel: Object.fromEntries((extra.funnel ?? []).map((port) => [`${NAME}:${port}`, true])),
});
const WATCH = "http://127.0.0.1:8460";
// A machine that already serves two other apps.
const others = serving({ 443: "http://127.0.0.1:3000", 8461: "http://127.0.0.1:3001" });

const ok = (stdout: unknown = ""): Partial<ProcResult> => ({ code: 0, stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout) });

/** A fake Tailscale: answers by subcommand and records every call. */
const tailscale = (answers: { status?: Partial<ProcResult>; serveStatus?: Partial<ProcResult>; serve?: Partial<ProcResult>; missing?: ReadonlyArray<string> }) => {
  const calls: Array<string> = [];
  const run = async (command: string, args: ReadonlyArray<string>) => {
    calls.push([command, ...args].join(" "));
    const base = { code: 0, stdout: "", stderr: "", missing: false, timedOut: false };
    if (answers.missing?.includes(command)) return { ...base, code: null, missing: true } as ProcResult;
    const answer = args[0] === "status" ? answers.status : args[1] === "status" ? answers.serveStatus : answers.serve;
    return { ...base, ...answer } as ProcResult;
  };
  return { calls, run };
};
const up = (serveStatus: unknown, more: { serve?: Partial<ProcResult> } = {}) => tailscale({ status: ok(running), serveStatus: ok(serveStatus), ...more });

const config = (over: Partial<WatchConfig> = {}): WatchConfig => ({ port: 8460, host: "127.0.0.1", token: "t", roots: [], publicUrl: null, ...over });
const made = (port: number, over: Partial<WatchConfig> = {}) => config({ publicUrl: `https://${NAME}:${port}`, tailnetUrl: `https://${NAME}:${port}`, tailnetRoute: "made", ...over });

const homes: Array<string> = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
const scratchHome = () => {
  const home = mkdtempSync(join(tmpdir(), "t3w-tailnet-"));
  homes.push(home);
  return home;
};
const saved = (home: string) => JSON.parse(readFileSync(join(home, "config.json"), "utf8")) as WatchConfig;
const at = (target: string | null, over: Partial<Served> = {}): Served => ({ target, others: false, https: true, funnel: false, ...over });

describe("tailnet lookup", () => {
  it("finds the machine's name and certificates, or says why not and what to do", async () => {
    expect(await findTailnet(tailscale({ status: ok(running) }).run)).toEqual(tailnet);
    expect(await findTailnet(tailscale({ status: ok({ ...running, CertDomains: [] }) }).run)).toMatchObject({ https: false });
    expect(await findTailnet(tailscale({ status: ok({ BackendState: "Stopped" }) }).run)).toEqual({
      problem: "Tailscale is not connected here (Stopped)",
      fix: "Connect it with tailscale up, then install again.",
    });
    expect(await findTailnet(tailscale({ status: ok({ BackendState: "Running", Self: {} }) }).run)).toEqual({
      problem: "this machine has no tailnet name",
      fix: "Turn on MagicDNS in the Tailscale admin console, then install again.",
    });
    expect(await findTailnet(tailscale({ status: { code: 1, stderr: "failed to connect to local tailscaled" } }).run)).toEqual({
      problem: 'tailscale status said "failed to connect to local tailscaled"',
      fix: null,
    });
    expect(await findTailnet(tailscale({ missing: ["tailscale", MAC_CLI] }).run)).toEqual({ missing: true });
  });

  it("falls back to the CLI inside the macOS app", async () => {
    const { calls, run } = tailscale({ status: ok(running), missing: ["tailscale"] });
    expect(await findTailnet(run)).toMatchObject({ cli: MAC_CLI });
    expect(calls).toEqual(["tailscale status --json", `${MAC_CLI} status --json`]);
  });

  it("reads each served port's target, HTTPS, Funnel, other paths and foreground sessions", async () => {
    const ports = await servedPorts(up(serving({ 443: "http://127.0.0.1:3000", 8461: WATCH, 8080: WATCH }, { funnel: [8461], http: [8080], paths: [] as never })).run, tailnet);
    expect(ports!.get(443)).toEqual(at("http://127.0.0.1:3000"));
    expect(ports!.get(8461)).toEqual(at(WATCH, { funnel: true }));
    expect(ports!.get(8080)).toEqual(at(WATCH, { https: false }));
    const shared = await servedPorts(up(serving({ 8461: WATCH }, { paths: { 8461: "/grafana" } })).run, tailnet);
    expect(shared!.get(8461)).toEqual(at(WATCH, { others: true }));
    const foreground = { Foreground: { session1: { TCP: { "9443": { HTTPS: true } }, Web: { [`${NAME}:9443`]: { Handlers: { "/": { Proxy: WATCH } } } } } } };
    expect((await servedPorts(up(foreground).run, tailnet))!.get(9443)).toEqual(at(null, { others: true, https: false }));
    expect((await servedPorts(up("").run, tailnet))!.size).toBe(0);
    // A failed or unreadable answer is not "nothing served": a port missed could be taken over.
    expect(await servedPorts(tailscale({ serveStatus: { code: 1, stderr: "boom" } }).run, tailnet)).toBeNull();
    expect(await servedPorts(up("not json").run, tailnet)).toBeNull();
  });

  it("knows Watch's loopback addresses, and which routes it can use", () => {
    expect(sendsToWatch(at("http://localhost:8460/"), 8460)).toBe(true);
    expect(sendsToWatch(at("http://[::1]:8460"), 8460)).toBe(true);
    expect(sendsToWatch(at("http://127.0.0.1:3001"), 8460)).toBe(false);
    expect(sendsToWatch(undefined, 8460)).toBe(false);
    expect(watchTarget("127.0.0.1", 8460)).toBe("http://127.0.0.1:8460");
    expect(watchTarget("100.64.0.7", 8460)).toBe("http://127.0.0.1:8460");
    expect(watchTarget("[::1]", 8460)).toBe("http://[::1]:8460");
    expect(usable(at(WATCH), 8460)).toBe(true);
    for (const off of [{ others: true }, { https: false }, { funnel: true }]) expect(usable(at(WATCH, off), 8460)).toBe(false);
  });

  it("uses a usable route to Watch someone made, else the first free port from Watch's port plus one", () => {
    expect(choosePort(new Map([[443, at("http://127.0.0.1:3000")], [9000, at(WATCH)]]), 8460)).toEqual({ port: 9000, existing: true, made: false });
    // Funnelled, plain HTTP or shared with other paths: never taken over.
    for (const off of [{ funnel: true }, { https: false }, { others: true }])
      expect(choosePort(new Map([[9000, at(WATCH, off)]]), 8460)).toEqual({ port: 8461, existing: false, made: true });
    expect(choosePort(new Map([[8461, at("http://127.0.0.1:3001")], [8462, at(null, { others: true })]]), 8460)).toEqual({ port: 8463, existing: false, made: true });
    expect(choosePort(new Map(Array.from({ length: 20 }, (_, i) => [8461 + i, at(null)] as const)), 8460)).toBeNull();
    expect(choosePort(new Map(), 65534)).toEqual({ port: 65535, existing: false, made: true });
    expect(choosePort(new Map([[65535, at(null)]]), 65534)).toBeNull();
  });

  it("says what stops a serve, with the link a tailnet without Serve prints", async () => {
    const serve = (answer: Partial<ProcResult>) => serveWatch(tailscale({ serve: answer }).run, tailnet, 8461, WATCH);
    expect(await serve({ code: 1, stdout: "Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=abc123\n" })).toEqual({
      ok: false,
      problem: "Serve is off for this tailnet",
      fix: "Turn it on at https://login.tailscale.com/f/serve?node=abc123, then install again.",
    });
    expect(await serve({ code: 1, stderr: "sending serve config: Access denied: serve config denied" })).toMatchObject({ fix: "Run sudo tailscale set --operator=$USER once, then install again." });
    expect(await serve({ code: null, timedOut: true })).toMatchObject({ problem: "tailscale serve did not finish within 30 seconds" });
    expect(await serve({ code: 0 })).toEqual({ ok: true });
  });
});

describe("install's tailnet step", () => {
  it("serves the page on a free port, records the route as made, and can undo both", async () => {
    const home = scratchHome();
    const { calls, run } = up(others);
    const step = await tailnetPage(config(), home, { run });
    expect(step.url).toBe(`https://${NAME}:8462`);
    expect(step.lines).toEqual([`Tailscale: serving the page on your tailnet at https://${NAME}:8462`]);
    expect(saved(home)).toMatchObject({ publicUrl: `https://${NAME}:8462`, tailnetUrl: `https://${NAME}:8462`, tailnetRoute: "made" });
    // serve, never funnel, and only the one new port.
    expect(calls.filter((c) => !c.includes("status"))).toEqual(["tailscale serve --bg --https=8462 http://127.0.0.1:8460"]);
    expect(calls.some((c) => c.includes("funnel"))).toBe(false);
    await step.undo!();
    expect(calls.at(-1)).toBe("tailscale serve --https=8462 off");
    expect(saved(home).publicUrl).toBeNull();
    expect(saved(home).tailnetUrl).toBeUndefined();
  });

  it("records a route it found as found, and keeps managing the address it set", async () => {
    const home = scratchHome();
    const found = up(serving({ 9000: WATCH }));
    const step = await tailnetPage(config(), home, { run: found.run });
    expect(step.lines).toEqual([`Tailscale: already serving the page on your tailnet at https://${NAME}:9000`]);
    expect(found.calls.some((c) => c.includes("--bg"))).toBe(false);
    expect(saved(home)).toMatchObject({ publicUrl: `https://${NAME}:9000`, tailnetRoute: "found" });
    // The next install checks Tailscale again, and makes its own route if that one went away.
    const gone = up("{}");
    const again = await tailnetPage(saved(home), home, { run: gone.run });
    expect(again.url).toBe(`https://${NAME}:9000`);
    expect(gone.calls).toContain("tailscale serve --bg --https=9000 http://127.0.0.1:8460");
    expect(saved(home).tailnetRoute).toBe("made");
  });

  it("uses its own route again, other paths beside it or not, and moves off a port taken since", async () => {
    const shared = up(serving({ 8470: WATCH }, { paths: { 8470: "/grafana" } }));
    expect((await tailnetPage(made(8470), scratchHome(), { run: shared.run })).lines).toEqual([`Tailscale: already serving the page on your tailnet at https://${NAME}:8470`]);
    expect(shared.calls.some((c) => c.includes("--bg"))).toBe(false);
    const taken = up(serving({ 8470: "http://127.0.0.1:3000" }));
    expect((await tailnetPage(made(8470), scratchHome(), { run: taken.run })).url).toBe(`https://${NAME}:8461`);
  });

  it("warns about a route that puts the page on the public internet, and does not use it", async () => {
    const home = scratchHome();
    const step = await tailnetPage(config(), home, { run: up(serving({ 9000: WATCH }, { funnel: [9000] })).run });
    expect(step.url).toBe(`https://${NAME}:8461`);
    expect(step.lines[1]).toBe("Tailscale: port 9000 sends the page to the public internet through Funnel, which Watch never does. Turn it off with tailscale funnel --https=9000 off.");
  });

  it("leaves a publicUrl the person set without asking Tailscale anything", async () => {
    for (const set of [config({ publicUrl: "https://watch.example.com" }), made(8461, { publicUrl: "https://watch.example.com" })]) {
      const { calls, run } = up(others);
      const step = await tailnetPage(set, scratchHome(), { run });
      expect(step.lines).toEqual([
        "Tailscale: publicUrl is https://watch.example.com, and install did not set it, so Watch leaves it. Remove it from config.json to have install serve the page on your tailnet.",
      ]);
      expect(calls).toEqual([]);
    }
  });

  it("leaves the page on the machine and says why", async () => {
    const why = async (answers: Parameters<typeof tailscale>[0]) => {
      const { calls, run } = tailscale(answers);
      const step = await tailnetPage(config(), scratchHome(), { run });
      expect(step.url).toBeNull();
      expect(step.config.publicUrl).toBeNull();
      expect(calls.some((c) => c.includes("--bg")) && answers.serve === undefined).toBe(false);
      return step.lines[0]!;
    };
    expect(await why({ missing: ["tailscale", MAC_CLI] })).toBe(
      "Tailscale: not installed, so the page stays on this machine. With Tailscale running, install serves it on your tailnet over HTTPS.",
    );
    expect(await why({ status: ok({ BackendState: "Running", Self: {} }) })).toBe(
      "Tailscale: this machine has no tailnet name, so the page stays on this machine. Turn on MagicDNS in the Tailscale admin console, then install again.",
    );
    expect(await why({ status: ok({ ...running, CertDomains: [] }) })).toContain("this tailnet has HTTPS certificates off");
    expect(await why({ status: ok(running), serveStatus: { code: 1 } })).toContain("Watch could not read what Tailscale serves here");
    expect(await why({ status: ok(running), serveStatus: ok("{}"), serve: { code: 1, stderr: "Access denied: serve config denied" } })).toBe(
      "Tailscale: this user may not change what Tailscale serves, so the page stays on this machine. Run sudo tailscale set --operator=$USER once, then install again.",
    );
  });

  it("points links back at this machine when Tailscale fails later, keeping the record, and can undo that", async () => {
    const home = scratchHome();
    const step = await tailnetPage(made(8461), home, { run: tailscale({ status: ok({ BackendState: "NeedsLogin" }) }).run });
    expect(saved(home)).toMatchObject({ publicUrl: null, tailnetUrl: `https://${NAME}:8461`, tailnetRoute: "made" });
    await step.undo!();
    expect(saved(home).publicUrl).toBe(`https://${NAME}:8461`);
    // Once Tailscale is back, the same route is used again.
    const back = await tailnetPage({ ...saved(home), publicUrl: null }, home, { run: up(serving({ 8461: WATCH })).run });
    expect(back.lines).toEqual([`Tailscale: already serving the page on your tailnet at https://${NAME}:8461`]);
  });

  it("takes an earlier route off the tailnet with --no-tailscale, even after the person set publicUrl", async () => {
    const plain = tailscale({});
    expect((await tailnetPage(config(), scratchHome(), { run: plain.run, skip: true })).lines).toEqual([
      "Tailscale: skipped with --no-tailscale, so the page stays on this machine.",
    ]);
    expect(plain.calls).toEqual([]);
    const home = scratchHome();
    const { calls, run } = up(serving({ 8461: WATCH }));
    const step = await tailnetPage(made(8461, { publicUrl: "https://watch.example.com" }), home, { run, skip: true });
    expect(step.lines).toEqual(["Tailscale: stopped serving the page on port 8461. The page stays on this machine, as --no-tailscale asks."]);
    expect(calls).toContain("tailscale serve --https=8461 off");
    // The person's publicUrl is theirs to keep.
    expect(saved(home).publicUrl).toBe("https://watch.example.com");
    expect(saved(home).tailnetUrl).toBeUndefined();
  });
});

describe("uninstall's tailnet step", () => {
  it("stops only a route install made, and clears what install set", async () => {
    const home = scratchHome();
    const mine = up(serving({ 8461: WATCH }));
    expect((await stopTailnetPage(made(8461), home, mine.run))!.line).toBe("Tailscale: stopped serving the page on port 8461.");
    expect(mine.calls).toContain("tailscale serve --https=8461 off");
    expect(saved(home).publicUrl).toBeNull();
    expect(saved(home).tailnetUrl).toBeUndefined();
    const theirs = up(others);
    expect((await stopTailnetPage(made(8461), scratchHome(), theirs.run))!.line).toBe("Tailscale: port 8461 serves something else now, so it was left as it is.");
    expect(theirs.calls.some((c) => c.endsWith(" off"))).toBe(false);
    expect((await stopTailnetPage(made(8461), scratchHome(), up("{}").run))!.line).toBe("Tailscale: was not serving the page on port 8461 any more.");
  });

  it("leaves a found route, another machine's, or one it cannot check, and says so", async () => {
    const foundHome = scratchHome();
    const found = up(serving({ 9000: WATCH }));
    expect((await stopTailnetPage(made(9000, { tailnetRoute: "found" }), foundHome, found.run))!.line).toBe(
      "Tailscale: install found the route on port 9000 rather than making it, so it was left.",
    );
    expect(found.calls).toEqual([]);
    expect(saved(foundHome).publicUrl).toBeNull();
    const elsewhere = up(serving({ 8461: WATCH }));
    expect((await stopTailnetPage(made(8461, { tailnetUrl: "https://other.tail1234.ts.net:8461", publicUrl: null }), scratchHome(), elsewhere.run))!.line).toContain("not this machine");
    expect(elsewhere.calls.some((c) => c.endsWith(" off"))).toBe(false);
    expect((await stopTailnetPage(made(8461, { tailnetUrl: "box.ts.net:8461" }), scratchHome(), tailscale({}).run))!.line).toBe(
      "Tailscale: the recorded address was not one install writes, so it was cleared.",
    );
    // Not able to check: links come home, but the record stays for the next run.
    const awayHome = scratchHome();
    expect((await stopTailnetPage(made(8461), awayHome, tailscale({ missing: ["tailscale", MAC_CLI] }).run))!.line).toContain("run tailscale serve --https=8461 off");
    expect(saved(awayHome)).toMatchObject({ publicUrl: null, tailnetUrl: `https://${NAME}:8461` });
    const unknown = tailscale({ status: ok(running), serveStatus: { code: 1 } });
    expect((await stopTailnetPage(made(8461), scratchHome(), unknown.run))!.line).toContain("could not check what port 8461 serves");
    expect(unknown.calls.some((c) => c.endsWith(" off"))).toBe(false);
    const sharing = up(serving({ 8461: WATCH }, { paths: { 8461: "/grafana" } }));
    expect((await stopTailnetPage(made(8461), scratchHome(), sharing.run))!.line).toContain("serves other paths besides the page, so it was left");
    expect(sharing.calls.some((c) => c.endsWith(" off"))).toBe(false);
  });

  it("does nothing when install recorded no route", async () => {
    expect(await stopTailnetPage(config({ publicUrl: `https://${NAME}:8461` }), scratchHome(), tailscale({}).run)).toBeNull();
  });
});
