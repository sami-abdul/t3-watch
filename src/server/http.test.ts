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
  const watch = testWatch(fakeDeps({}).deps);
  const server = makeHttpServer({ watch, config: () => config, webDir: "/nonexistent" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { watch, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

describe("http", () => {
  it("requires the token on the API", async () => {
    const { base } = await serve();
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
    const ok = await fetch(`${base}/api/state`, { headers: { authorization: "Bearer test-token-123" } });
    expect(ok.status).toBe(200);
  });

  it("signs in once with a one-time link and sets a cookie", async () => {
    const { base, watch } = await serve();
    const code = makeSignInCode(watch.store, watch.deps.now());
    const response = await fetch(`${base}/signin?code=${code}`, { redirect: "manual" });
    expect(response.status).toBe(302);
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    expect((await fetch(`${base}/api/state`, { headers: { cookie } })).status).toBe(200);
    // The same link again, and a link carrying the access token, are refused.
    expect((await fetch(`${base}/signin?code=${code}`, { redirect: "manual" })).status).toBe(401);
    expect((await fetch(`${base}/signin?token=test-token-123`, { redirect: "manual" })).status).toBe(401);
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
