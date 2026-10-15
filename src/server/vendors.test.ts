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
