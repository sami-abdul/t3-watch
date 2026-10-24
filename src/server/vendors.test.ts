import { describe, expect, it } from "vitest";

import { fakeDeps, jsonResponse } from "./testkit.ts";
import { loadCatalog, parseTime, runFreshCheck, runKeyCheck, validateVendor } from "./vendors.ts";

const catalog = loadCatalog();
const stripe = catalog.get("stripe")!;
const pipedrive = catalog.get("pipedrive")!;

describe("vendor catalog", () => {
  it("loads every shipped description", () => {
    expect(catalog.size).toBeGreaterThanOrEqual(10);
    expect(catalog.get("xero")?.signIn).toBe("oauth");
  });

  it("rejects a description whose API is not an https origin", () => {
    const bad = { ...JSON.parse(JSON.stringify(pipedrive)), api: { origin: "http://api.pipedrive.com" } };
    expect(() => validateVendor(bad)).toThrow();
  });

  it("lets a local description replace a shipped one", () => {
    const local = { ...JSON.parse(JSON.stringify(pipedrive)), label: "Pipedrive EU" };
    expect(loadCatalog([local]).get("pipedrive")?.label).toBe("Pipedrive EU");
  });
});

describe("vendor engine", () => {
  it("sends the key as the description says and reads the account", async () => {
    const { deps, requests } = fakeDeps({
      fetch: () => jsonResponse(200, { data: { company_id: 42 } }),
    });
    const result = await runKeyCheck(pipedrive, "secret-token", deps.fetch);
    expect(result.outcome).toBe("pass");
    expect(result.account).toBe("42");
    expect(requests[0]!.url).toBe("https://api.pipedrive.com/api/v1/users/me");
    expect(requests[0]!.headers["x-api-token"]).toBe("secret-token");
    expect(result.summary).not.toContain("secret-token");
  });

  it("tries the fallback path for a restricted key", async () => {
    const { deps, requests } = fakeDeps({
      fetch: (url) => (url.pathname === "/v1/account" ? jsonResponse(403, {}) : jsonResponse(200, { data: [] })),
    });
    const result = await runKeyCheck(stripe, "rk_live_abcdefgh", deps.fetch);
    expect(result.outcome).toBe("pass");
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(["/v1/account", "/v1/events"]);
  });

  it("fails a rejected key and calls a network error unknown", async () => {
    const rejected = fakeDeps({ fetch: () => jsonResponse(401, {}) });
    expect((await runKeyCheck(pipedrive, "k", rejected.deps.fetch)).summary).toContain("rejected");
    const offline = fakeDeps({ fetch: () => Promise.reject(new Error("ECONNRESET")) });
    expect((await runKeyCheck(pipedrive, "k", offline.deps.fetch)).outcome).toBe("unknown");
  });

  it("refuses to follow a path to another host", async () => {
    const { deps, requests } = fakeDeps({ fetch: () => jsonResponse(200, {}) });
    const evil = { ...pipedrive, keyCheck: { path: "//evil.example/steal" } };
    const result = await runKeyCheck(evil, "k", deps.fetch);
    expect(result.outcome).toBe("unknown");
    expect(requests).toHaveLength(0);
  });

  it("judges freshness from the newest item", async () => {
    const check = pipedrive.checks.find((c) => c.type === "fresh")!;
    if (check.type !== "fresh") throw new Error("expected a fresh check");
    const now = new Date("2026-10-15T10:00:00Z");
    const recent = fakeDeps({ fetch: () => jsonResponse(200, { data: [{ update_time: "2026-10-15T08:00:00Z" }] }) });
    expect((await runFreshCheck(pipedrive, check, "k", recent.deps.fetch, now)).outcome).toBe("pass");
    const stale = fakeDeps({ fetch: () => jsonResponse(200, { data: [{ update_time: "2026-10-10 08:00:00" }] }) });
    const result = await runFreshCheck(pipedrive, check, "k", stale.deps.fetch, now);
    expect(result.outcome).toBe("fail");
    expect(result.summary).toBe("Nothing new for 5 days");
  });

  it("parses the time formats vendors use", () => {
    expect(parseTime(1_700_000_000)).toBe(1_700_000_000);
    expect(parseTime(1_700_000_000_000)).toBe(1_700_000_000);
    expect(parseTime("2026-10-15 08:00:00")).toBe(Date.parse("2026-10-15T08:00:00Z") / 1000);
    expect(parseTime("nope")).toBeNull();
  });
});

// Cases are independent of catalog JSON, taken from the linked vendor docs. No real keys or accounts.
const additions = [
  { id: "vercel", url: "https://api.vercel.com/v2/user", body: { user: { id: "user_fixture" } }, account: "user_fixture", env: "VERCEL_TOKEN" },
  { id: "cloudflare", url: "https://api.cloudflare.com/client/v4/user", body: { success: true, result: { id: "user_fixture" } }, account: "user_fixture", env: "CLOUDFLARE_API_TOKEN" },
  { id: "neon", url: "https://console.neon.tech/api/v2/users/me/organizations", body: { organizations: [] }, account: null, env: "NEON_API_KEY" },
  { id: "supabase", url: "https://api.supabase.com/v1/projects", body: [], account: null, env: "SUPABASE_ACCESS_TOKEN" },
  { id: "render", url: "https://api.render.com/v1/services?limit=1", body: [], account: null, env: "RENDER_API_KEY" },
  { id: "sendgrid", url: "https://api.sendgrid.com/v3/scopes", body: { scopes: ["mail.send"] }, account: null, env: "SENDGRID_API_KEY" },
  { id: "resend", url: "https://api.resend.com/domains", body: { object: "list", data: [] }, account: null, env: "RESEND_API_KEY" },
  { id: "gitlab", url: "https://gitlab.com/api/v4/user", body: { id: 42, username: "fixture-user" }, account: "42", env: "GITLAB_TOKEN" },
  { id: "digitalocean", url: "https://api.digitalocean.com/v2/account", body: { account: { uuid: "fixture-account", status: "active" } }, account: "fixture-account", env: "DIGITALOCEAN_TOKEN" },
];

describe.each(additions)("$id documented key check", ({ id, url, body, account, env }) => {
  it("uses the documented GET and header, accepts an empty account, and keeps the key out of results", async () => {
    const vendor = catalog.get(id)!;
    const fake = fakeDeps({ fetch: (_url, init) => {
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("manual");
      expect(init.body).toBeUndefined();
      return jsonResponse(200, body);
    } });
    const result = await runKeyCheck(vendor, "synthetic-key-only", fake.deps.fetch);
    expect(result.outcome).toBe("pass");
    expect(result.account).toBe(account);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.url).toBe(url);
    expect(fake.requests[0]!.headers[id === "gitlab" ? "private-token" : "authorization"]).toBe(id === "gitlab" ? "synthetic-key-only" : "Bearer synthetic-key-only");
    expect(JSON.stringify(result)).not.toContain("synthetic-key-only");
    expect(vendor.key!.envNames).toContain(env);
    expect(vendor.checks).toEqual([{ id: "key", type: "key", intent: expect.any(String) }]);
  });

  it.each([401, 403])("fails a rejected or insufficiently scoped key, HTTP %i", async (status) => {
    const fake = fakeDeps({ fetch: () => jsonResponse(status, { message: "synthetic-key-only" }) });
    const result = await runKeyCheck(catalog.get(id)!, "synthetic-key-only", fake.deps.fetch);
    expect(result.outcome).toBe("fail");
    expect(result.account).toBeNull();
    expect(JSON.stringify(result)).not.toContain("synthetic-key-only");
    expect(fake.requests).toHaveLength(1);
  });

  it.each([302, 429, 503])("reports HTTP %i as unknown without a second request", async (status) => {
    const fake = fakeDeps({ fetch: () => new Response("", { status, headers: { location: "https://elsewhere.example" } }) });
    expect((await runKeyCheck(catalog.get(id)!, "synthetic-key-only", fake.deps.fetch)).outcome).toBe("unknown");
    expect(fake.requests).toHaveLength(1);
  });
});

it("does not mistake project, database or multi-part credentials for these management API tokens", () => {
  expect(catalog.get("supabase")!.key!.envNames).toEqual(["SUPABASE_ACCESS_TOKEN"]);
  expect(catalog.get("neon")!.key!.envNames).toEqual(["NEON_API_KEY"]);
  expect(catalog.get("resend")!.key!.canWrite).toBeDefined();
  expect(catalog.has("twilio")).toBe(false);
  expect(catalog.has("linear")).toBe(false);
});
