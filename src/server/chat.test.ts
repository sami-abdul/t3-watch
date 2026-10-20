import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import { alertSettings, deliverAlerts, makeAlertSecret, setAlerts } from "./alerts.ts";
import type { Watch } from "./app.ts";
import type { WatchConfig } from "./config.ts";
import { decideDraft, draftCheck, draftVendor } from "./drafts.ts";
import { extendServer } from "./extend.ts";
import { makeHttpServer } from "./http.ts";
import { fakeDeps, jsonResponse, testWatch } from "./testkit.ts";

const config: WatchConfig = { port: 0, host: "127.0.0.1", token: "chat-token-123", roots: [], publicUrl: "https://watch.example" };
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const connect = async (watch: Watch) => {
  const extension = extendServer({ watch, config: () => config, reloadConfig: () => config, home: "/nonexistent", root: process.cwd() });
  const server = makeHttpServer({ watch, config: () => config, webDir: "/nonexistent", extraRoutes: extension.routes });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => server.close());
  const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${config.token}` } } }));
  closers.push(() => void client.close());
  return { client, url };
};

const firstText = (result: { content?: Array<{ type: string; text?: string }> }) => result.content?.[0]?.text ?? "";

describe("mcp", () => {
  it("lists the tools with read-only hints and the inline view", async () => {
    const { client } = await connect(testWatch(fakeDeps({}).deps));
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of ["watch_home", "watch_status", "watch_check", "watch_scan", "watch_apply", "watch_set_check", "watch_draft_check", "watch_draft_vendor", "watch_note", "watch_set_alerts"])
      expect(byName.has(name), name).toBe(true);
    expect(byName.get("watch_status")!.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("watch_set_check")!.annotations?.readOnlyHint).toBe(false);
    expect((byName.get("watch_home")!._meta as { ui: { resourceUri: string } }).ui.resourceUri).toBe("ui://t3-watch/home");
    const resource = await client.readResource({ uri: "ui://t3-watch/home" });
    expect(resource.contents[0]!.mimeType).toBe("text/html;profile=mcp-app");
  });

  it("puts Home's summary in the structured content too", async () => {
    const { client } = await connect(testWatch(fakeDeps({}).deps));
    const home = await client.callTool({ name: "watch_home", arguments: {} });
    const summary = (home.structuredContent as { summary: string }).summary;
    expect(summary).toBe("Watch is not set up yet. Call watch_scan.");
    expect(firstText(home as never)).toBe(summary);
  });

  it("makes a one-time sign-in link the page accepts once", async () => {
    const { client, url } = await connect(testWatch(fakeDeps({}).deps));
    expect(client.getInstructions()).toContain("watch_sign_in_link");
    const result = await client.callTool({ name: "watch_sign_in_link", arguments: {} });
    const link = firstText(result as never).split("\n")[0]!;
    expect(link).toMatch(/^https:\/\/watch\.example\/signin\?code=[A-Za-z0-9_-]{32}$/);
    expect(link).not.toContain(config.token);
    const signin = new URL(`/signin${new URL(link).search}`, url);
    expect((await fetch(signin, { redirect: "manual" })).status).toBe(302);
    expect((await fetch(signin, { redirect: "manual" })).status).toBe(401);
  });

  it("refuses MCP without the token", async () => {
    const { url } = await connect(testWatch(fakeDeps({}).deps));
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(response.status).toBe(401);
  });

  it("pauses a check from chat and reports status as text", async () => {
    const watch = testWatch(fakeDeps({ fetch: () => new Response("", { status: 500 }) }).deps);
    watch.defineCheck({ id: "site", serviceId: "s", kind: "http", intent: "Site is up", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" }, "on");
    await watch.runner.tick();
    const { client } = await connect(watch);
    const status = await client.callTool({ name: "watch_status", arguments: {} });
    expect(firstText(status as never)).toContain("1 broken");
    await client.callTool({ name: "watch_set_check", arguments: { checkId: "site", action: "pause" } });
    expect(watch.store.check("site")!.state).toBe("paused");
    const missing = await client.callTool({ name: "watch_check", arguments: { checkId: "nope" } });
    expect(missing.isError).toBe(true);
  });
});

describe("drafts", () => {
  it("runs a drafted check once and keeps it off until approved", async () => {
    const watch = testWatch(fakeDeps({ fetch: () => new Response("ok", { status: 200 }) }).deps);
    const { check, result } = await draftCheck(watch, { service: "Marketing site", kind: "http", intent: "Home page answers", config: { url: "https://x.test" } });
    expect(result.outcome).toBe("pass");
    expect(check.state).toBe("draft");
    expect(watch.store.runs(check.id)).toHaveLength(0);
    await watch.runner.tick();
    expect(watch.store.runs(check.id)).toHaveLength(0);
    await decideDraft(watch, "check", check.id, "approve");
    expect(watch.store.check(check.id)!.state).toBe("on");
  });

  it("rejects invalid drafts and stores nothing", async () => {
    const watch = testWatch(fakeDeps({}).deps);
    await expect(draftCheck(watch, { service: "x", kind: "http", intent: "bad", config: { url: "ftp://x" } })).rejects.toThrow("invalid");
    await expect(
      draftVendor(watch, { id: "acme", label: "Acme", detect: {}, key: { envNames: ["ACME_KEY"], keyUrl: "https://acme.test/keys", auth: { type: "bearer" } }, api: { origin: "http://api.acme.test" }, keyCheck: { path: "/me" } }),
    ).rejects.toThrow("invalid");
    expect(watch.store.checks()).toHaveLength(0);
    expect(watch.store.vendorDrafts()).toHaveLength(0);
  });

  it("adds an approved vendor to the catalog", async () => {
    const watch = testWatch(fakeDeps({}).deps);
    const { id } = await draftVendor(watch, {
      id: "acme", label: "Acme", detect: { envPrefix: "ACME_" },
      key: { envNames: ["ACME_KEY"], keyUrl: "https://acme.test/keys", auth: { type: "bearer" } },
      api: { origin: "https://api.acme.test" }, keyCheck: { path: "/me" },
      checks: [{ type: "key", id: "key", intent: "The Acme key still works" }],
    });
    expect(watch.vendors().has("acme")).toBe(false);
    await decideDraft(watch, "vendor", id, "approve");
    expect(watch.vendors().get("acme")?.label).toBe("Acme");
  });
});

describe("alerts", () => {
  it("sends each change once, signed, and retries a failed send", async () => {
    let up = false;
    const received: Array<{ body: string; signature: string | null }> = [];
    const fake = fakeDeps({
      fetch: (url, init) => {
        if (url.hostname === "x.test") return new Response("", { status: up ? 200 : 500 });
        received.push({ body: String(init.body), signature: new Headers(init.headers).get("x-watch-signature") });
        return up ? jsonResponse(200, {}) : jsonResponse(500, {});
      },
    });
    const watch = testWatch(fake.deps);
    setAlerts(watch, { url: "https://t3.example/hook", secret: "a-signing-secret-1234" });
    watch.defineCheck({ id: "site", serviceId: "s", kind: "http", intent: "Site is up", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" }, "on");
    await watch.runner.tick();
    expect(await deliverAlerts(watch, "https://watch.example")).toBe(0);
    expect(watch.store.pendingEvents()).toHaveLength(1);
    up = true;
    expect(await deliverAlerts(watch, "https://watch.example")).toBe(1);
    expect(await deliverAlerts(watch, "https://watch.example")).toBe(0);
    const last = received.at(-1)!;
    expect(JSON.parse(last.body).text).toBe("Watch check failed: Site is up. Answered 500");
    expect(last.signature).toBe(`sha256=${createHmac("sha256", "a-signing-secret-1234").update(last.body).digest("hex")}`);
  });

  it("leads with the change, so an intent naming the healthy state still reads right", async () => {
    let up = false;
    const sent: Array<string> = [];
    const fake = fakeDeps({
      fetch: (url, init) => {
        if (url.hostname === "x.test") return new Response("", { status: up ? 200 : 500 });
        sent.push(JSON.parse(String(init.body)).text);
        return jsonResponse(200, {});
      },
    });
    const watch = testWatch(fake.deps);
    setAlerts(watch, { url: "https://t3.example/hook" });
    watch.upsertService({ id: "github:example/api", vendor: "github", label: "example/api", target: "example/api", reachable: true, note: null, foundIn: [] });
    watch.defineCheck({ id: "ci", serviceId: "github:example/api", kind: "http", intent: "CI on main is passing", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" }, "on");
    await watch.runner.tick();
    up = true;
    fake.advance(61);
    await watch.runner.tick();
    expect(await deliverAlerts(watch, "https://watch.example")).toBe(2);
    expect(sent[0]).toBe("Watch check failed: example/api: CI on main is passing. Answered 500");
    expect(sent[1]).toMatch(/^Watch check passing again: example\/api: CI on main is passing\. Answered 200 in \d+ ms$/);
  });

  it("makes the signing secret only for the signed-in page and keeps it out of state", async () => {
    const watch = testWatch(fakeDeps({}).deps);
    const { url } = await connect(watch);
    const auth = { authorization: `Bearer ${config.token}` };
    const page = { cookie: `t3w=${config.token}`, origin: url.origin };
    const make = (headers: Record<string, string>) => fetch(new URL("/api/alerts/secret", url), { method: "POST", headers });
    expect((await make({})).status).toBe(401);
    // The API token agents hold is not enough, nor is the cookie from another origin.
    expect((await make(auth)).status).toBe(403);
    expect((await make({ ...page, origin: "http://evil.test" })).status).toBe(403);
    expect((await make({ ...page, "sec-fetch-site": "same-site" })).status).toBe(403);
    expect(alertSettings(watch).secret).toBeNull();
    // A forwarded host is not trusted; publicUrl names a proxy's origin.
    expect((await make({ ...page, origin: "http://evil.test", "x-forwarded-host": "evil.test" })).status).toBe(403);
    expect((await make({ ...page, origin: "https://watch.example" })).status).toBe(200);
    const response = await make(page);
    const { secret } = (await response.json()) as { secret: string };
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(alertSettings(watch).secret).toBe(secret);
    const state = await (await fetch(new URL("/api/state", url), { headers: auth })).text();
    expect(state).not.toContain(secret);
    expect(JSON.parse(state).alerts.signed).toBe(true);
  });

  it("refuses a secret over MCP and keeps the one made on the page", async () => {
    const watch = testWatch(fakeDeps({}).deps);
    const { client } = await connect(watch);
    expect(client.getInstructions()).toContain("request_secret");
    expect(client.getInstructions()).toContain("secretRef");
    const secret = makeAlertSecret(watch);
    const refused = await client.callTool({ name: "watch_set_alerts", arguments: { url: "https://t3.example/hook", secret: "chat-secret-1234567890" } });
    expect(refused.isError).toBe(true);
    expect(firstText(refused as never)).toContain("Make a signing secret");
    expect(alertSettings(watch)).toEqual({ url: null, secret });
    // A null secret is what some clients send for a field they leave out.
    const set = await client.callTool({ name: "watch_set_alerts", arguments: { url: "https://t3.example/hook", secret: null } });
    expect(firstText(set as never)).toBe("Alerts go to https://t3.example/hook, signed.");
    expect(alertSettings(watch)).toEqual({ url: "https://t3.example/hook", secret });
  });

  it("sends nothing while checks keep passing", async () => {
    const fake = fakeDeps({ fetch: (url) => (url.hostname === "x.test" ? new Response("", { status: 200 }) : jsonResponse(200, {})) });
    const watch = testWatch(fake.deps);
    setAlerts(watch, { url: "https://t3.example/hook" });
    watch.defineCheck({ id: "site", serviceId: "s", kind: "http", intent: "x", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" }, "on");
    await watch.runner.tick();
    fake.advance(61);
    await watch.runner.tick();
    expect(await deliverAlerts(watch, "https://watch.example")).toBe(0);
  });
});
