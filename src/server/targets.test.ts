import { describe, expect, it } from "vitest";

import type { Scan } from "./scan.ts";
import { readState } from "./state.ts";
import { checkTarget, span } from "./targets.ts";
import { fakeDeps, testWatch } from "./testkit.ts";
import type { Vendor } from "./vendors.ts";

const stripe = { id: "stripe", label: "Stripe", api: { origin: "https://api.stripe.com" } } as unknown as Vendor;
const target = (kind: string, config: Record<string, unknown>, keyLast4: string | null = null) =>
  checkTarget({ kind: kind as never, config }, { vendor: (id) => (id === "stripe" ? stripe : undefined), keyLast4 });

describe("check targets", () => {
  it("says in one sentence what each kind of check contacts", () => {
    expect(target("http", { url: "https://example.com/", contains: "MailFerret:" })).toBe('GET https://example.com/, expecting "MailFerret:"');
    expect(target("http", { url: "https://example.com/" })).toBe("GET https://example.com/");
    expect(target("github", { repo: "acme/api" })).toBe("GitHub Actions in acme/api, read with the gh login");
    expect(target("github", { repo: "acme/api", workflow: "nightly", branch: "main" })).toBe("GitHub Actions workflow nightly in acme/api on main, read with the gh login");
    expect(target("aws_metric", { namespace: "AWS/Lambda", metric: "Errors", region: "us-east-1", profile: "prod" })).toBe(
      "CloudWatch AWS/Lambda Errors in us-east-1, with AWS profile prod",
    );
    // Two checks on one metric differ by what they measure.
    expect(target("aws_metric", { namespace: "AWS/Lambda", metric: "Errors", region: "us-east-1", dimensions: [{ name: "FunctionName", value: "billing" }] })).toBe(
      "CloudWatch AWS/Lambda Errors for FunctionName billing in us-east-1",
    );
    expect(target("vendor", { vendor: "stripe", check: "activity" }, "1234")).toBe("Stripe's API at https://api.stripe.com, with the key ending 1234");
    expect(target("vendor", { vendor: "unknown-vendor", check: "x" })).toBe("unknown-vendor's API");
  });

  it("never names a secret, such as a heartbeat's ping token", () => {
    const heartbeat = target("heartbeat", { token: "hb-secret-token-0123456789", periodSeconds: 3600, graceSeconds: 300 });
    expect(heartbeat).toBe("Nothing outside: your job pings Watch at least every 1 h");
    expect(heartbeat).not.toContain("hb-secret-token");
    // Nor a password or a query string in an address.
    const url = target("http", { url: "https://user:pass@status.example.com/health?token=abc123" });
    expect(url).toBe("GET https://status.example.com/health?…");
    expect(url).not.toMatch(/pass|abc123/);
    // A capability URL carries its token in the path.
    expect(target("http", { url: "https://hooks.example.com/api/7f3c9e1b2a4d5c6e8f90/health" })).toBe("GET https://hooks.example.com/api/…/health");
    expect(target("http", { url: "https://hooks.example.com/t/AbCdEfGhIjKlMnOpQrStUvWx/ping" })).toBe("GET https://hooks.example.com/t/…/ping");
    // A malformed escape is shown as written, never thrown: the state read depends on it.
    expect(target("http", { url: "https://x.test/a%zzb" })).toBe("GET https://x.test/a%zzb");
  });

  it("stays readable when a config is missing parts", () => {
    expect(target("http", {})).toBe("GET an address");
    expect(target("http", { url: "https://x.test/", contains: "a".repeat(300) })).toBe(`GET https://x.test/, expecting "${"a".repeat(39)}…"`);
    expect(target("aws_metric", { region: "eu-west-1" })).toBe("CloudWatch a metric in eu-west-1");
    expect(target("heartbeat", {})).toBe("Nothing outside: your job pings Watch");
    expect(target("ftp", {})).toBe("A ftp check");
    expect(span(900)).toBe("15 min");
    expect(span(7200)).toBe("2 h");
    expect(span(172800)).toBe("2 d");
    // Exact, not rounded: a 90 second period is not "2 min".
    expect(span(90)).toBe("90 s");
    expect(span(150)).toBe("150 s");
  });

  it("reaches the state for every check and every suggestion, with its cadence", () => {
    const watch = testWatch(fakeDeps({}).deps);
    watch.defineCheck({ id: "site", serviceId: "s", kind: "http", intent: "Site answers", config: { url: "https://x.test/" }, keyId: null, cadenceSeconds: 900, origin: "scan" }, "proposed");
    const scan = { scannedAt: "2026-10-21T10:00:00Z", services: [], suggestions: [{ checkId: "site", serviceId: "s", title: "S", intent: "Site answers", outcome: "pass", summary: "Answered 200", state: "proposed", suggested: true }] } as unknown as Scan;
    watch.store.setKv("scan", scan);
    const state = readState(watch);
    expect(state.checks.find((c) => c.id === "site")!.target).toBe("GET https://x.test/");
    expect(state.setup.scan!.suggestions[0]).toMatchObject({ target: "GET https://x.test/", cadence: "every 15 min", state: "proposed", keyId: null });
    expect(state.checks.find((c) => c.id === "site")!.cadence).toBe("every 15 min");
    // The suggestion carries the check's state as it is now, not as it was at the scan.
    watch.store.setCheckState("site", "on", "2026-10-21T10:05:00Z");
    expect(readState(watch).setup.scan!.suggestions[0]!.state).toBe("on");
    // The stored scan keeps no target: it is worked out from the check as it stands.
    expect(watch.store.getKv<Scan>("scan", scan).suggestions[0]!.target).toBeUndefined();
  });
});
