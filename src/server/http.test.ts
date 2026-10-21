import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { makeWatch } from "./app.ts";
import type { WatchConfig } from "./config.ts";
import { DEMO_SIGN_IN_HELP } from "./demo.ts";
import { makeHttpServer } from "./http.ts";
import { makeSignInCode, startSession } from "./signin.ts";
import { fakeDeps, testWatch } from "./testkit.ts";

/** A heartbeat ping token for tests, not a secret. */
const PING_TOKEN = "abcdefghijklmnop1234"; // gitleaks:allow

const config: WatchConfig = { port: 0, host: "127.0.0.1", token: "test-token-123", roots: [], publicUrl: null };
const servers: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

const serve = async () => {
  const fake = fakeDeps({});
  const watch = testWatch(fake.deps);
  const server = makeHttpServer({ watch, config: () => config, webDir: "/nonexistent" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { watch, advance: fake.advance, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

describe("http", () => {
  it("requires the token on the API", async () => {
    const { base } = await serve();
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
    const ok = await fetch(`${base}/api/state`, { headers: { authorization: "Bearer test-token-123" } });
    expect(ok.status).toBe(200);
  });

  it("signs in once with a one-time link and sets a cookie", async () => {
    const { base, watch, advance } = await serve();
    const code = makeSignInCode(watch.store, watch.deps.now());
    // Opening the link, as a chat preview would, shows a button and spends nothing.
    const opened = await fetch(`${base}/signin?code=${code}`);
    expect(opened.status).toBe(200);
    expect(opened.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(opened.headers.get("referrer-policy")).toBe("same-origin");
    expect(await opened.text()).toContain(`name="code" value="${code}"`);
    expect((await fetch(`${base}/signin?code=${code}`, { method: "HEAD" })).status).toBe(200);
    const press = (value: string, origin: string | null = base) =>
      fetch(`${base}/signin`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", ...(origin === null ? {} : { origin }) },
        body: new URLSearchParams({ code: value }).toString(),
      });
    // A press from another site, or with no origin, is refused and leaves the code usable.
    expect((await press(code, "https://elsewhere.example")).status).toBe(403);
    expect((await press(code, null)).status).toBe(403);
    const response = await press(code);
    expect(response.status).toBe(302);
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    expect((await fetch(`${base}/api/state`, { headers: { cookie } })).status).toBe(200);
    // The browser gets its own session, never the access token, and the token is no cookie.
    expect(cookie).not.toContain("test-token-123");
    expect((await fetch(`${base}/api/state`, { headers: { cookie: "t3w=test-token-123" } })).status).toBe(401);
    // A malformed cookie is a plain refusal, not a server error.
    expect((await fetch(`${base}/api/state`, { headers: { cookie: "t3w=%E0%A4%A" } })).status).toBe(401);
    expect((await fetch(`${base}/`, { headers: { cookie: "t3w=%E0%A4%A" } })).status).toBe(401);
    // Signing out ends the session.
    watch.store.clearSessions();
    expect((await fetch(`${base}/api/state`, { headers: { cookie } })).status).toBe(401);
    // The same code again, a malformed one, and a link carrying the access token are refused.
    expect((await press(code)).status).toBe(401);
    // A spent link shows no button, and neither does an expired one.
    expect((await fetch(`${base}/signin?code=${code}`)).status).toBe(401);
    const late = makeSignInCode(watch.store, watch.deps.now());
    advance(11 * 60);
    expect((await fetch(`${base}/signin?code=${late}`)).status).toBe(401);
    expect((await fetch(`${base}/signin?code=<script>`)).status).toBe(401);
    expect((await fetch(`${base}/signin?token=test-token-123`)).status).toBe(401);
  });

  it("takes the browser's word on where a press came from", async () => {
    const { base, watch } = await serve();
    const press = (headers: Record<string, string>) =>
      fetch(`${base}/signin`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
        body: new URLSearchParams({ code: makeSignInCode(watch.store, watch.deps.now()) }).toString(),
      });
    // same-origin settles it before Origin or Host are read, so Origin: null from a privacy setting
    // or a Host rewritten by a proxy no longer locks anyone out.
    expect((await press({ "sec-fetch-site": "same-origin", origin: "null" })).status).toBe(302);
    // Another site or a sibling port is refused even when its Origin looks right.
    expect((await press({ "sec-fetch-site": "cross-site", origin: base })).status).toBe(403);
    expect((await press({ "sec-fetch-site": "same-site", origin: base })).status).toBe(403);
  });

  it("refuses a form or JSON body over its limit", async () => {
    const { base } = await serve();
    const form = await fetch(`${base}/signin`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: base },
      body: `code=${"x".repeat(5000)}`,
    });
    expect(form.status).toBe(413);
    const json = await fetch(`${base}/api/keys`, {
      method: "POST",
      headers: { authorization: "Bearer test-token-123", "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(65 * 1024) }),
    });
    expect(json.status).toBe(413);
  });

  it("accepts heartbeats without the token but only for known checks", async () => {
    const { base, watch } = await serve();
    watch.defineCheck(
      { id: "h", serviceId: "s", kind: "heartbeat", intent: "x", config: { token: PING_TOKEN, periodSeconds: 3600 }, keyId: null, cadenceSeconds: 300, origin: "user" },
      "on",
    );
    expect((await fetch(`${base}/hb/${PING_TOKEN}`, { method: "POST" })).status).toBe(200);
    expect(watch.store.lastHeartbeat("h", "success")).not.toBeNull();
    expect((await fetch(`${base}/hb/zzzzzzzzzzzzzzzzzzzz`)).status).toBe(404);
  });

  it("gives a demo its own session cookie, kept until the browser closes, and its own sign-in words", async () => {
    const watch = makeWatch({ home: null, dbFile: ":memory:", deps: fakeDeps({}).deps, sample: true });
    const server = makeHttpServer({ watch, config: () => config, webDir: "/nonexistent", signInHelp: DEMO_SIGN_IN_HELP });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const pressed = await fetch(`${base}/signin`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: base },
      body: new URLSearchParams({ code: makeSignInCode(watch.store, watch.deps.now()) }).toString(),
    });
    const set = pressed.headers.get("set-cookie")!;
    expect(set).toMatch(/^t3w-demo=[^;]+; Path=\/; HttpOnly; SameSite=Lax$/);
    const session = set.split(";")[0]!.split("=")[1]!;
    expect((await fetch(`${base}/api/state`, { headers: { cookie: `t3w-demo=${session}` } })).status).toBe(200);
    // A real Watch's cookie on the same host is a different one, so neither replaces the other.
    expect((await fetch(`${base}/api/state`, { headers: { cookie: `t3w=${session}` } })).status).toBe(401);
    expect(((await (await fetch(`${base}/api/state`)).json()) as { error: string }).error).toBe("Sign in to the demo with the link it printed when it started");
    expect(await (await fetch(`${base}/signin?code=spent`)).text()).toContain("Stop the demo and start it again for a new link.");
  });

  it("edits, deletes and restores checks for a browser on the page only", async () => {
    const { base, watch } = await serve();
    watch.defineCheck(
      { id: "h", serviceId: "s", kind: "heartbeat", intent: "Backup pings", config: { token: PING_TOKEN, periodSeconds: 3600 }, keyId: null, cadenceSeconds: 300, origin: "agent" },
      "on",
    );
    const cookie = `t3w=${startSession(watch.store, watch.deps.now())}`;
    const post = (action: string, headers: Record<string, string>, body: unknown = {}) =>
      fetch(`${base}/api/checks/h/${action}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const page = { cookie, "sec-fetch-site": "same-origin" };
    // Neither the token agents hold nor a page on another site may change a check.
    expect((await post("delete", { authorization: "Bearer test-token-123" })).status).toBe(403);
    expect((await post("delete", { cookie, "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await post("delete", { cookie, origin: "https://elsewhere.example" })).status).toBe(403);
    expect(watch.store.check("h")!.state).toBe("on");
    const edited = await post("edit", page, { intent: "Nightly backup pings", cadenceMinutes: 10, config: { periodSeconds: 7200 }, updatedAt: watch.store.check("h")!.updatedAt });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { check: { intent: string } }).check.intent).toBe("Nightly backup pings");
    const refused = await post("edit", page, { intent: "Nightly backup pings", cadenceMinutes: 10, config: { period: 7200 }, updatedAt: watch.store.check("h")!.updatedAt });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe("period is not a setting of a heartbeat check. It has periodSeconds, graceSeconds.");
    // A deleted heartbeat's ping address stops answering until it is restored.
    expect((await post("delete", page)).status).toBe(200);
    expect((await fetch(`${base}/hb/${PING_TOKEN}`)).status).toBe(404);
    expect((await post("edit", page, { intent: "x", cadenceMinutes: 10 })).status).toBe(409);
    expect((await post("restore", page)).status).toBe(200);
    expect(watch.store.check("h")!.state).toBe("paused");
    expect((await fetch(`${base}/hb/${PING_TOKEN}`)).status).toBe(200);
    expect((await fetch(`${base}/api/checks/nope/delete`, { method: "POST", headers: page })).status).toBe(404);
  });
});
