import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { WatchConfig } from "./config.ts";
import { makeHttpServer } from "./http.ts";
import { makeSignInCode } from "./signin.ts";
import { fakeDeps, testWatch } from "./testkit.ts";

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

  it("accepts heartbeats without the token but only for known checks", async () => {
    const { base, watch } = await serve();
    watch.defineCheck(
      { id: "h", serviceId: "s", kind: "heartbeat", intent: "x", config: { token: "abcdefghijklmnop1234", periodSeconds: 3600 }, keyId: null, cadenceSeconds: 300, origin: "user" },
      "on",
    );
    expect((await fetch(`${base}/hb/abcdefghijklmnop1234`, { method: "POST" })).status).toBe(200);
    expect(watch.store.lastHeartbeat("h", "success")).not.toBeNull();
    expect((await fetch(`${base}/hb/zzzzzzzzzzzzzzzzzzzz`)).status).toBe(404);
  });
});
