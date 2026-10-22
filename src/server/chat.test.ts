import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import { alertSettings, deliverAlerts, lastAlertDelivery, lastAlertTest, makeAlertSecret, sendTestAlert, setAlerts } from "./alerts.ts";
import { makeWatch, type Watch } from "./app.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, readsOf, saveConfig, type WatchConfig } from "./config.ts";
import { decideDraft, draftCheck, draftVendor } from "./drafts.ts";
import { extendServer } from "./extend.ts";
import { makeHttpServer } from "./http.ts";
import { homeText, readState } from "./state.ts";
import { startSession } from "./signin.ts";
import { fakeDeps, jsonResponse, testWatch } from "./testkit.ts";
import { VERSION_MARK } from "./version-mark.ts";

// A made-up test secret, so the secret scanner may skip it.
const SIGNING_SECRET = "a-signing-secret-1234"; // gitleaks:allow
const config: WatchConfig = { port: 0, host: "127.0.0.1", token: "chat-token-123", roots: [], publicUrl: "https://watch.example" };
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const connect = async (watch: Watch, root = process.cwd()) => {
  const extension = extendServer({ watch, config: () => config, reloadConfig: () => config, home: "/nonexistent", root });
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

  it("hands agents check settings without secrets, in the view's state and in watch_check", async () => {
    const watch = testWatch(fakeDeps({}).deps);
    const token = "hb-agent-test-token-0123456789"; // gitleaks:allow
    watch.defineCheck({ id: "api", serviceId: "s", kind: "http", intent: "API answers", config: { url: "https://monitor:open-sesame@api.example/v1?key=abc" }, keyId: null, cadenceSeconds: 300, origin: "user" }, "on"); // gitleaks:allow
    watch.defineCheck({ id: "h", serviceId: "s", kind: "heartbeat", intent: "Backup pings", config: { token, periodSeconds: 3600 }, keyId: null, cadenceSeconds: 300, origin: "user" }, "on");
    const { client } = await connect(watch);
    // watch_state is the inline view's, but a client that does not know views lists it like any tool.
    const results = [
      await client.callTool({ name: "watch_state", arguments: {} }),
      await client.callTool({ name: "watch_home", arguments: {} }),
      await client.callTool({ name: "watch_check", arguments: { checkId: "api" } }),
      await client.callTool({ name: "watch_check", arguments: { checkId: "h" } }),
    ];
    for (const result of results) expect(JSON.stringify(result)).not.toMatch(new RegExp(`${token}|open-sesame|key=abc|/hb/`));
    expect(JSON.stringify(results[0])).toContain("https://api.example/v1?…");
    expect(JSON.stringify(results[2])).toContain("https://api.example/v1?…");
  });

  it("shows a vendor draft by its name, the API it reads and its test, never its description", async () => {
    const watch = testWatch(fakeDeps({}).deps);
    // An agent wrote secrets where a description takes free text: a header, the key check's query,
    // and a check's query.
    await draftVendor(watch, {
      id: "acme",
      label: "Acme",
      detect: {},
      key: { envNames: ["ACME_KEY"], keyUrl: "https://acme.test/keys", auth: { type: "bearer" }, headers: { "X-Acme-Secret": "header-secret-value" } },
      api: { origin: "https://api.acme.test" },
      keyCheck: { path: "/me", query: { token: "keycheck-secret-value" } },
      checks: [{ type: "fresh", id: "orders", intent: "Orders keep coming", path: "/orders", query: { apikey: "check-secret-value" }, items: "data", time: "at", maxAgeSeconds: 3600 }],
    }); // gitleaks:allow
    const leaks = /header-secret-value|keycheck-secret-value|check-secret-value/;
    const state = readState(watch);
    expect(state.vendorDrafts).toEqual([{ id: "vendor-acme", label: "Acme", origin: "https://api.acme.test", testSummary: expect.any(String), createdAt: expect.any(String) }]);
    expect(JSON.stringify(state)).not.toMatch(leaks);
    const { client } = await connect(watch);
    expect(JSON.stringify(await client.callTool({ name: "watch_state", arguments: {} }))).not.toMatch(leaks);
    expect(homeText(state)).toContain("Vendor drafts waiting: Acme");
  });

  it("names a service's product for Home, or goes back to the guess", async () => {
    const watch = testWatch(fakeDeps({}).deps);
    watch.upsertService({ id: "custom:shop", vendor: "custom", label: "shop.example.com", target: "https://shop.example.com", reachable: true, note: null, foundIn: [] });
    const { client } = await connect(watch);
    const set = (serviceId: string, product: string) => client.callTool({ name: "watch_set_product", arguments: { serviceId, product } });
    expect(firstText((await set("custom:shop", "  Storefront  ")) as never)).toBe("shop.example.com is now part of Storefront.");
    expect(watch.store.service("custom:shop")!.product).toBe("Storefront");
    expect(readState(watch).services.find((s) => s.id === "custom:shop")!.product).toBe("Storefront");
    // Refused: a service Watch does not have, a name past 60 characters, one with control
    // characters, and one with no letter or digit, which Home could not group by.
    for (const [serviceId, product, error] of [
      ["custom:nope", "Storefront", "No service custom:nope. watch_check shows a check's service, with its id."],
      ["custom:shop", "x".repeat(61), "at most 60 characters"],
      ["custom:shop", "Store\u0007front", "no control characters"],
      ["custom:shop", "!!!", "needs a letter or a digit"],
      ["custom:shop", "Store\u202Efront", "no control characters"],
      ["custom:shop", "Shop\u200F (EU)", "no control characters"],
      ["custom:shop", "Store\u{E0041}front", "no control characters"],
      ["custom:shop", "東".repeat(61), "at most 60 characters"],
    ] as const) {
      const refused = await set(serviceId, product);
      expect(refused.isError).toBe(true);
      expect(firstText(refused as never)).toContain(error);
    }
    expect(watch.store.service("custom:shop")!.product).toBe("Storefront");
    // The status names products named by hand, as spelt, for services Home shows, which have a
    // check on; and a second spelling of one is pointed out.
    watch.upsertService({ id: "custom:api", vendor: "custom", label: "api.example.com", target: "https://api.example.com", reachable: true, note: null, foundIn: [] });
    expect(homeText(readState(watch))).not.toContain("Products named by hand");
    watch.defineCheck({ id: "shop-up", serviceId: "custom:shop", kind: "http", intent: "Shop answers", config: { url: "https://shop.example.com/" }, keyId: null, cadenceSeconds: 300, origin: "user" }, "on");
    expect(homeText(readState(watch))).toContain("Products named by hand:\n- Storefront: shop.example.com");
    // A product has one spelling: naming it in a new one respells it for its other services.
    expect(firstText((await set("custom:api", "StoreFront")) as never)).toBe(
      "api.example.com is now part of StoreFront. shop.example.com was in it under another spelling and now uses this one.",
    );
    expect([watch.store.service("custom:shop")!.product, watch.store.service("custom:api")!.product]).toEqual(["StoreFront", "StoreFront"]);
    // Characters, not UTF-16 units, count toward the limit, and joiners some scripts and emoji need pass.
    for (const name of ["\u{20000}".repeat(31), "می\u200Cخانه", "👩\u200D💻 Tools"]) expect((await set("custom:shop", name)).isError, name).toBeFalsy();
    expect(firstText((await set("custom:shop", " ")) as never)).toBe("shop.example.com goes back to the product Watch guesses from names.");
    expect(watch.store.service("custom:shop")!.product).toBeNull();
  });

  it("serves the inline view with its own version written in, as the server reports it", async () => {
    const root = mkdtempSync(join(tmpdir(), "t3w-view-"));
    try {
      mkdirSync(join(root, "dist", "app"), { recursive: true });
      writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.8.7" }));
      // As the build leaves it: the mark where the version goes.
      writeFileSync(join(root, "dist", "app", "app.html"), `<script>new App({name:"t3-watch",version:\`${VERSION_MARK}\`})</script>`);
      const { client } = await connect(testWatch(fakeDeps({}).deps), root);
      const [view] = (await client.readResource({ uri: "ui://t3-watch/home" })).contents;
      const text = view !== undefined && "text" in view ? view.text : "";
      expect(text).toContain("version:`9.8.7`");
      expect(text).not.toContain(VERSION_MARK);
      expect(client.getServerVersion()?.version).toBe("9.8.7");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("puts Home's summary in the structured content too", async () => {
    const { client } = await connect(testWatch(fakeDeps({}).deps));
    const home = await client.callTool({ name: "watch_home", arguments: {} });
    const summary = (home.structuredContent as { summary: string }).summary;
    expect(summary).toBe("Watch is not set up yet. Ask the person to open the page, choose what Watch may read and press Scan these.");
    expect(firstText(home as never)).toBe(summary);
  });

  it("says first when Watch cannot reach the internet", async () => {
    // Holding on, nothing on the network answers, and one check that needs the internet fails.
    const fake = fakeDeps({});
    const watch = testWatch(fake.deps, () => undefined);
    watch.defineCheck(
      { id: "site", serviceId: "s", kind: "http", intent: "x", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" },
      "on",
    );
    await watch.runner.tick();
    const { client } = await connect(watch);
    const text = firstText((await client.callTool({ name: "watch_status", arguments: {} })) as never);
    expect(text.split("\n")[0]).toBe(
      "Watch cannot reach the internet since 2026-10-15 10:00 UTC. Failures of checks that need it are held for up to an hour each, and nothing alerts meanwhile.",
    );
    expect(watch.store.check("site")!.lastOutcome).toBeNull();
    // After an hour of the check's runs held, its failure is recorded, while Watch still says it is offline.
    // 60 held runs, then one recorded and pending, then a second in a row that fails the check.
    for (let i = 0; i < 61; i++) {
      fake.advance(61);
      await watch.runner.tick();
    }
    const later = firstText((await client.callTool({ name: "watch_status", arguments: {} })) as never);
    expect(later.split("\n")[0]).toMatch(/^Watch cannot reach the internet since 2026-10-15 10:00 UTC\./);
    expect(watch.store.check("site")!.lastOutcome).toBe("fail");
  });

  it("makes a one-time sign-in link the page accepts once", async () => {
    const { client, url } = await connect(testWatch(fakeDeps({}).deps));
    expect(client.getInstructions()).toContain("watch_sign_in_link");
    const result = await client.callTool({ name: "watch_sign_in_link", arguments: {} });
    const link = firstText(result as never).split("\n")[0]!;
    expect(link).toMatch(/^https:\/\/watch\.example\/signin\?code=[A-Za-z0-9_-]{32}$/);
    expect(link).not.toContain(config.token);
    const press = () =>
      fetch(new URL("/signin", url), {
        method: "POST",
        redirect: "manual",
        // A browser on the link's page sends publicUrl's origin, as it would behind a proxy.
        headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(link).origin },
        body: `code=${new URL(link).searchParams.get("code")}`,
      });
    expect((await press()).status).toBe(302);
    expect((await press()).status).toBe(401);
  });

  it("refuses MCP without the token", async () => {
    const { url } = await connect(testWatch(fakeDeps({}).deps));
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(response.status).toBe(401);
  });

  it("pauses a check from chat and reports status as text", async () => {
    const fake = fakeDeps({ fetch: () => new Response("", { status: 500 }) });
    const watch = testWatch(fake.deps);
    watch.defineCheck({ id: "site", serviceId: "s", kind: "http", intent: "Site is up", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" }, "on");
    // The second failing run in a row fails the check.
    await watch.runner.tick();
    fake.advance(61);
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
    setAlerts(watch, { url: "https://t3.example/hook", secret: SIGNING_SECRET });
    watch.defineCheck({ id: "site", serviceId: "s", kind: "http", intent: "Site is up", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" }, "on");
    await watch.runner.tick();
    fake.advance(61);
    await watch.runner.tick();
    expect(await deliverAlerts(watch, "https://watch.example")).toBe(0);
    expect(watch.store.pendingEvents()).toHaveLength(1);
    // A failed send shows on the page, not only in the queue.
    expect(lastAlertDelivery(watch)).toMatchObject({ ok: false, status: 500, message: "The webhook answered HTTP 500, so alerts may not arrive." });
    up = true;
    expect(await deliverAlerts(watch, "https://watch.example")).toBe(1);
    expect(lastAlertDelivery(watch)).toMatchObject({ ok: true, status: 200, message: "The webhook accepted the last alert." });
    makeAlertSecret(watch);
    expect(lastAlertDelivery(watch)).toBeNull();
    expect(await deliverAlerts(watch, "https://watch.example")).toBe(0);
    const last = received.at(-1)!;
    expect(JSON.parse(last.body).text).toBe("Watch check failed: Site is up. Answered 500");
    expect(last.signature).toBe(`sha256=${createHmac("sha256", SIGNING_SECRET).update(last.body).digest("hex")}`);
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
    fake.advance(61);
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
    const page = { cookie: `t3w=${startSession(watch.store, new Date())}`, origin: url.origin };
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
    expect(firstText(set as never)).toBe("Alerts go to t3.example, signed. Confirm the webhook accepts them with watch_test_alert.");
    expect(alertSettings(watch)).toEqual({ url: "https://t3.example/hook", secret });
  });

  it("keeps no delivery result, and the event, when the settings change while it is out", async () => {
    let watch: Watch | null = null;
    const fake = fakeDeps({
      fetch: (url) => {
        if (url.hostname === "x.test") return new Response("", { status: 500 });
        // The person makes a new secret while the alert is on its way, and the task refuses the old one.
        makeAlertSecret(watch!);
        return new Response("", { status: 401 });
      },
    });
    watch = testWatch(fake.deps);
    setAlerts(watch, { url: "https://t3.example/hook", secret: SIGNING_SECRET });
    watch.defineCheck({ id: "site", serviceId: "s", kind: "http", intent: "Site is up", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" }, "on");
    await watch.runner.tick();
    fake.advance(61);
    await watch.runner.tick();
    expect(await deliverAlerts(watch, "https://watch.example")).toBe(0);
    expect(lastAlertDelivery(watch)).toBeNull();
    // Still pending, so the next pass sends it signed with the new secret.
    expect(watch.store.pendingEvents()).toHaveLength(1);
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

describe("test alerts", () => {
  const hook = "https://t3.example/hooks/task-capability-123";
  const webhook = (answer: () => Response) => {
    const received: Array<{ body: string; signature: string | null; redirect: string | undefined }> = [];
    const fake = fakeDeps({
      fetch: (_url, init) => {
        received.push({ body: String(init.body), signature: new Headers(init.headers).get("x-watch-signature"), redirect: init.redirect });
        return answer();
      },
    });
    return { fake, received, watch: testWatch(fake.deps) };
  };

  it("sends a signed test, keeps the result and shows the host, never the address", async () => {
    const { fake, received, watch } = webhook(() => new Response("", { status: 202 }));
    setAlerts(watch, { url: hook, secret: SIGNING_SECRET });
    const result = await sendTestAlert(watch, "https://watch.example");
    expect(result).toEqual({ at: "2026-10-15T10:00:00.000Z", ok: true, status: 202, message: "The webhook accepted a signed test alert, so alerts reach the thread it wakes." });
    const sent = JSON.parse(received[0]!.body);
    expect(sent.kind).toBe("watch.test");
    expect(sent.checkId).toBeNull();
    expect(sent.text).toContain("only a test, so there is no check to look into");
    expect(received[0]!.signature).toBe(`sha256=${createHmac("sha256", SIGNING_SECRET).update(received[0]!.body).digest("hex")}`);
    // A redirect is answered, not followed.
    expect(received[0]!.redirect).toBe("manual");
    expect(lastAlertTest(watch)).toEqual(result);
    const { url } = await connect(watch);
    const state = await (await fetch(new URL("/api/state", url), { headers: { authorization: `Bearer ${config.token}` } })).text();
    expect(state).not.toContain("task-capability-123");
    expect(JSON.parse(state).alerts).toEqual({ on: true, host: "t3.example", signed: true, lastTest: result, lastDelivery: null });
    // Nothing joins the queue of change events.
    expect(watch.store.pendingEvents()).toHaveLength(0);
    fake.advance(11);
  });

  it("says why a webhook refused, did not answer, or is gone", async () => {
    let answer: () => Response = () => new Response("", { status: 401 });
    const { fake, watch } = webhook(() => answer());
    setAlerts(watch, { url: hook, secret: SIGNING_SECRET });
    const refused = await sendTestAlert(watch, "https://watch.example");
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("does not have Watch's current signing secret");
    fake.advance(11);
    answer = () => {
      throw new Error("");
    };
    expect((await sendTestAlert(watch, "https://watch.example")).message).toBe("Watch could not reach the webhook: no reason given.");
    fake.advance(11);
    answer = () => {
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND t3.example") });
    };
    expect((await sendTestAlert(watch, "https://watch.example")).message).toBe("Watch could not reach the webhook: getaddrinfo ENOTFOUND t3.example.");
    fake.advance(11);
    answer = () => new Response("", { status: 302, headers: { location: "https://login.example/" } });
    const redirected = await sendTestAlert(watch, "https://watch.example");
    expect(redirected.ok).toBe(false);
    expect(redirected.message).toContain("a redirect, so alerts would not arrive");
    fake.advance(11);
    answer = () => new Response("", { status: 404 });
    expect((await sendTestAlert(watch, "https://watch.example")).message).toContain("its task may be gone");
    fake.advance(11);
    setAlerts(watch, { url: hook, secret: null });
    answer = () => new Response("", { status: 401 });
    expect((await sendTestAlert(watch, "https://watch.example")).message).toContain("it expects a signature");
  });

  it("spaces tests apart, refuses one with alerts off, and forgets a result when the secret or address changes", async () => {
    const { fake, received, watch } = webhook(() => new Response("", { status: 202 }));
    await expect(sendTestAlert(watch, "https://watch.example")).rejects.toThrow("Alerts are off");
    setAlerts(watch, { url: hook, secret: SIGNING_SECRET });
    await sendTestAlert(watch, "https://watch.example");
    fake.advance(3);
    await expect(sendTestAlert(watch, "https://watch.example")).rejects.toThrow("Wait 10 seconds");
    expect(received).toHaveLength(1);
    fake.advance(8);
    await sendTestAlert(watch, "https://watch.example");
    expect(received).toHaveLength(2);
    makeAlertSecret(watch);
    expect(lastAlertTest(watch)).toBeNull();
    fake.advance(11);
    await sendTestAlert(watch, "https://watch.example");
    setAlerts(watch, { url: "https://t3.example/hooks/another" });
    expect(lastAlertTest(watch)).toBeNull();
    // New settings do not reset the gap, so the thread still wakes once per 10 seconds.
    await expect(sendTestAlert(watch, "https://watch.example")).rejects.toThrow("Wait 10 seconds");
    // The same address again keeps the result.
    fake.advance(11);
    await sendTestAlert(watch, "https://watch.example");
    setAlerts(watch, { url: "https://t3.example/hooks/another" });
    expect(lastAlertTest(watch)).not.toBeNull();
  });

  it("follows a redirect that keeps the POST, never down to http, and no other", async () => {
    const asked: Array<string> = [];
    const signals: Array<AbortSignal | null | undefined> = [];
    const fake = fakeDeps({
      fetch: (url, init) => {
        asked.push(url.href);
        signals.push(init.signal);
        if (url.pathname === "/moved") return new Response("", { status: 308, headers: { location: "/hooks/new" } });
        if (url.pathname === "/insecure") return new Response("", { status: 307, headers: { location: "http://t3.example/hooks/new" } });
        if (url.pathname === "/login") return new Response("", { status: 302, headers: { location: "/hooks/new" } });
        return new Response("", { status: 202 });
      },
    });
    const watch = testWatch(fake.deps);
    setAlerts(watch, { url: "https://t3.example/moved", secret: SIGNING_SECRET });
    expect((await sendTestAlert(watch, "https://watch.example")).ok).toBe(true);
    expect(asked).toEqual(["https://t3.example/moved", "https://t3.example/hooks/new"]);
    // One deadline covers the whole chain.
    expect(signals[1]).toBe(signals[0]);
    for (const path of ["/insecure", "/login"]) {
      fake.advance(11);
      asked.length = 0;
      setAlerts(watch, { url: `https://t3.example${path}` });
      const result = await sendTestAlert(watch, "https://watch.example");
      expect(result.ok).toBe(false);
      expect(result.message).toContain("a redirect, so alerts would not arrive");
      expect(asked).toEqual([`https://t3.example${path}`]);
    }
  });

  it("keeps no result for settings replaced while a test was out", async () => {
    let release: (response: Response) => void = () => {};
    const { watch } = webhook(() => new Promise<Response>((resolve) => (release = resolve)) as unknown as Response);
    setAlerts(watch, { url: hook, secret: SIGNING_SECRET });
    const pending = sendTestAlert(watch, "https://watch.example");
    await expect(sendTestAlert(watch, "https://watch.example")).rejects.toThrow("Wait 10 seconds");
    makeAlertSecret(watch);
    release(new Response("", { status: 202 }));
    expect((await pending).message).toContain("settings changed while it was out");
    expect(lastAlertTest(watch)).toBeNull();
  });

  it("takes a test from the token or from the signed-in page itself, never from another site", async () => {
    const { fake, received, watch } = webhook(() => new Response("", { status: 202 }));
    setAlerts(watch, { url: hook, secret: SIGNING_SECRET });
    const { url } = await connect(watch);
    const page = { cookie: `t3w=${startSession(watch.store, new Date())}` };
    const send = (headers: Record<string, string>) => fetch(new URL("/api/alerts/test", url), { method: "POST", headers });
    expect((await send({})).status).toBe(401);
    expect((await send({ ...page, origin: "http://evil.test" })).status).toBe(403);
    expect((await send({ ...page, "sec-fetch-site": "same-site" })).status).toBe(403);
    expect(received).toHaveLength(0);
    const fromPage = await send({ ...page, "sec-fetch-site": "same-origin" });
    expect(fromPage.status).toBe(200);
    expect(((await fromPage.json()) as { ok: boolean }).ok).toBe(true);
    fake.advance(11);
    const byToken = await send({ authorization: `Bearer ${config.token}` });
    expect(byToken.status).toBe(200);
    expect((await send({ authorization: `Bearer ${config.token}` })).status).toBe(429);
    expect(received).toHaveLength(2);
  });

  it("offers watch_test_alert to agents, naming the host only", async () => {
    const { watch } = webhook(() => new Response("", { status: 202 }));
    const { client } = await connect(watch);
    expect(client.getInstructions()).toContain("watch_test_alert");
    const off = await client.callTool({ name: "watch_test_alert", arguments: {} });
    expect(off.isError).toBe(true);
    setAlerts(watch, { url: hook, secret: SIGNING_SECRET });
    expect(firstText((await client.callTool({ name: "watch_alerts", arguments: {} })) as never)).toBe(
      "Alerts go to t3.example, signed. No test alert since they were set: send one with watch_test_alert.",
    );
    const tested = await client.callTool({ name: "watch_test_alert", arguments: {} });
    expect(firstText(tested as never)).toBe("The webhook accepted a signed test alert, so alerts reach the thread it wakes.");
    expect((tested.structuredContent as { ok: boolean }).ok).toBe(true);
    const shown = firstText((await client.callTool({ name: "watch_alerts", arguments: {} })) as never);
    expect(shown).toContain("Last test at 2026-10-15T10:00:00.000Z: The webhook accepted");
    expect(shown).not.toContain("task-capability-123");
  });
});

describe("what setup may read", () => {
  it("is shown with each folder's repositories, and saved only as a full, valid choice", async () => {
    const home = mkdtempSync(join(tmpdir(), "t3w-setup-"));
    const awsConfig = process.env.AWS_CONFIG_FILE;
    // This machine's own AWS profiles stay out of the test.
    process.env.AWS_CONFIG_FILE = join(home, "no-aws-config");
    try {
      let current: WatchConfig = { ...config, roots: [home] };
      saveConfig(current, home);
      // A new install: no scan yet, and no choice.
      const watch = makeWatch({
        home: null,
        dbFile: ":memory:",
        deps: fakeDeps({ commands: { gh: { stdout: "octo\n" } } }).deps,
        roots: () => current.roots,
        reads: () => readsOf(current),
        chosen: () => current.reads !== undefined,
      });
      watch.defineCheck({ id: "ci", serviceId: "github:a/b", kind: "github", intent: "CI passes", config: { repo: "a/b" }, keyId: null, cadenceSeconds: 600, origin: "user" }, "on");
      watch.defineCheck({ id: "lambda", serviceId: "aws:1", kind: "aws_metric", intent: "No errors", config: {}, keyId: null, cadenceSeconds: 600, origin: "user" }, "on");
      const extension = extendServer({ watch, config: () => current, reloadConfig: () => (current = loadConfig(home)), home, root: process.cwd() });
      const server = makeHttpServer({ watch, config: () => current, webDir: "/nonexistent", extraRoutes: extension.routes });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      closers.push(() => server.close());
      const url = new URL("/api/setup", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      const auth = { authorization: `Bearer ${config.token}`, "content-type": "application/json" };
      const shown = (await (await fetch(url, { headers: auth })).json()) as { sources: { folders: unknown; logins: Array<{ id: string; available: boolean }> }; choice: unknown };
      expect(shown.sources.folders).toEqual([{ path: home, exists: true, repositories: 0 }]);
      expect(shown.sources.logins.map((l) => [l.id, l.available])).toEqual([["github", true], ["aws", false], ["envFiles", true]]);
      expect(shown.choice).toEqual({ roots: [home], skippedRoots: [], reads: { github: true, aws: true, envFiles: true }, chosen: false });
      // Before the person has chosen, nothing scans.
      const scanUrl = new URL("/api/scan", url);
      expect((await fetch(scanUrl, { method: "POST", headers: auth })).status).toBe(409);
      // The person chooses on the page itself; the token agents hold is not enough.
      const page = { cookie: `t3w=${startSession(watch.store, new Date())}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };
      const save = (body: unknown) => fetch(url, { method: "POST", headers: page, body: JSON.stringify(body) });
      expect((await fetch(url, { method: "POST", headers: auth, body: JSON.stringify({ roots: [home], reads: { github: true, aws: true, envFiles: true } }) })).status).toBe(403);
      expect((await save({ roots: ["code"], reads: { github: true, aws: true, envFiles: true } })).status).toBe(400);
      expect((await save({ roots: [home], reads: { github: true, aws: false } })).status).toBe(400);
      // One spelling per folder, and an unticked one is kept so the page still lists it.
      const saved = await save({ roots: [home, `${home}/`, `${home}/x/..`], skippedRoots: ["/srv/old", home], reads: { github: true, aws: false, envFiles: false } });
      expect(saved.status).toBe(200);
      // Turning AWS off pauses the check that uses it; GitHub's stays on.
      expect(await saved.json()).toEqual({
        choice: { roots: [home], skippedRoots: ["/srv/old"], reads: { github: true, aws: false, envFiles: false }, chosen: true },
        paused: 1,
        resumed: 0,
      });
      expect(watch.store.check("lambda")!.state).toBe("paused");
      expect(watch.store.check("ci")!.state).toBe("on");
      // While AWS is off, its check cannot be turned back on by hand either.
      await expect(watch.setCheck("lambda", "resume")).rejects.toThrow("turned off in What Watch may read");
      const file = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
      expect(file.reads).toEqual({ github: true, aws: false, envFiles: false });
      expect(file.skippedRoots).toEqual(["/srv/old"]);
      const listed = (await (await fetch(url, { headers: auth })).json()) as { sources: { folders: Array<{ path: string }>; logins: Array<{ id: string; detail: string }> } };
      expect(listed.sources.folders.map((f) => f.path)).toEqual([home, "/srv/old"]);
      // A login the person turned off is not even looked at.
      expect(listed.sources.logins.find((l) => l.id === "aws")).toMatchObject({ available: null, detail: "Turned off, so Watch does not look at it." });
      // Turned back on, the check the choice paused comes back.
      const back = await save({ roots: [home], skippedRoots: ["/srv/old"], reads: { github: true, aws: true, envFiles: false } });
      expect(((await back.json()) as { resumed: number }).resumed).toBe(1);
      expect(watch.store.check("lambda")!.state).toBe("on");
      expect((await fetch(scanUrl, { method: "POST", headers: auth })).status).toBe(202);
    } finally {
      if (awsConfig === undefined) delete process.env.AWS_CONFIG_FILE;
      else process.env.AWS_CONFIG_FILE = awsConfig;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("is told to agents by watch_sources", async () => {
    // A new install whose person has not chosen yet.
    const { client } = await connect(makeWatch({ home: null, dbFile: ":memory:", deps: fakeDeps({ commands: { gh: { stdout: "gh version 2.81.0\n" } } }).deps, chosen: () => false }));
    const result = await client.callTool({ name: "watch_sources", arguments: {} });
    const structured = result.structuredContent as { choice: unknown; sources: { folders: unknown } };
    expect(structured.choice).toEqual({ roots: [], skippedRoots: [], reads: { github: true, aws: true, envFiles: true }, chosen: false });
    expect(structured.sources.folders).toEqual([]);
    // Agents scan only after the person has chosen on the page.
    const refused = await client.callTool({ name: "watch_scan", arguments: {} });
    expect(refused.isError).toBe(true);
    expect(firstText(refused as never)).toContain("has not been told what it may read yet");
  });
});
