import { describe, expect, it } from "vitest";

import { GitHubConfig } from "./checks/github.ts";
import { type CheckContext, runCheck } from "./checks/index.ts";
import { noAnswer } from "./checks/network.ts";
import type { Check } from "./store.ts";
import { fakeDeps, fetchFailed, jsonResponse, testWatch } from "./testkit.ts";

const base = { cadenceSeconds: 300, keyId: null, origin: "user" as const };

describe("check kinds", () => {
  it("http fails on a wrong status and passes on the expected text", async () => {
    const { deps } = fakeDeps({
      fetch: (url) =>
        url.pathname === "/down" ? new Response("no", { status: 503 }) : new Response("all good", { status: 200 }),
    });
    const watch = testWatch(deps);
    const down = watch.defineCheck({ ...base, id: "a", serviceId: "s", kind: "http", intent: "x", config: { url: "https://x.test/down" } }, "on");
    const up = watch.defineCheck({ ...base, id: "b", serviceId: "s", kind: "http", intent: "x", config: { url: "https://x.test/up", contains: "good" } }, "on");
    expect((await watch.runner.trial(down)).summary).toBe("Answered 503");
    expect((await watch.runner.trial(up)).outcome).toBe("pass");
  });

  it("github fails when the latest finished run of a workflow failed", async () => {
    const runs = [
      { status: "in_progress", conclusion: "", workflowName: "CI", displayTitle: "wip", url: "u0", createdAt: "t" },
      { status: "completed", conclusion: "failure", workflowName: "CI", displayTitle: "fix", url: "u1", createdAt: "t" },
      { status: "completed", conclusion: "success", workflowName: "Release", displayTitle: "r", url: "u2", createdAt: "t" },
      { status: "completed", conclusion: "success", workflowName: "CI", displayTitle: "old", url: "u3", createdAt: "t" },
    ];
    const { deps, calls } = fakeDeps({ commands: { gh: { stdout: JSON.stringify(runs) } } });
    const watch = testWatch(deps);
    const check = watch.defineCheck({ ...base, id: "g", serviceId: "s", kind: "github", intent: "x", config: { repo: "acme/api", branch: "main" } }, "on");
    const result = await watch.runner.trial(check);
    expect(result.outcome).toBe("fail");
    expect(result.summary).toBe("CI failed on main in acme/api");
    expect(calls[0]!.args).toContain("--branch");
  });

  it("github with maxAgeSeconds fails when the newest success is too old", async () => {
    // The fake clock reads 2026-10-15T10:00:00Z.
    let runs = [
      { status: "completed", conclusion: "success", workflowName: "refresh", displayTitle: "r", url: "u1", createdAt: "2026-10-15T03:00:00Z" },
      { status: "completed", conclusion: "success", workflowName: "refresh", displayTitle: "r", url: "u2", createdAt: "2026-10-14T23:00:00Z" },
    ];
    const { deps } = fakeDeps({ commands: { gh: () => ({ stdout: JSON.stringify(runs) }) } });
    const watch = testWatch(deps);
    const check = watch.defineCheck({ ...base, id: "g", serviceId: "s", kind: "github", intent: "x", config: { repo: "acme/site", workflow: "refresh.yml", maxAgeSeconds: 21600 } }, "on");
    const stale = await watch.runner.trial(check);
    expect([stale.outcome, stale.summary]).toEqual(["fail", "Last successful run 7 hours ago on acme/site, more than 6 hours"]);
    runs = [{ ...runs[0]!, createdAt: "2026-10-15T05:00:00Z" }, ...runs];
    const fresh = await watch.runner.trial(check);
    expect([fresh.outcome, fresh.summary]).toEqual(["pass", "1 workflow passing on acme/site, last success 5 hours ago"]);
    // Skipped runs reaching back past the limit, with no success among them: stale.
    runs = runs.map((run) => ({ ...run, conclusion: "skipped" }));
    const skipped = await watch.runner.trial(check);
    expect([skipped.outcome, skipped.summary]).toEqual(["fail", "No successful run for more than 6 hours on acme/site"]);
    // A single cancelled run from an hour ago says nothing about the limit yet.
    runs = [{ ...runs[0]!, conclusion: "cancelled", createdAt: "2026-10-15T09:00:00Z" }];
    const early = await watch.runner.trial(check);
    expect([early.outcome, early.summary]).toEqual(["unknown", "No successful run in the last 1 finished run yet"]);
    runs = runs.map((run) => ({ ...run, status: "queued", conclusion: "" }));
    expect((await watch.runner.trial(check)).outcome).toBe("unknown");
  });

  it("github refuses maxAgeSeconds without a workflow", () => {
    expect(GitHubConfig.safeParse({ repo: "acme/site", maxAgeSeconds: 21600 }).success).toBe(false);
    expect(GitHubConfig.safeParse({ repo: "acme/site", workflow: "refresh.yml", maxAgeSeconds: 21600 }).success).toBe(true);
  });

  it("github says to install gh when it is missing", async () => {
    const { deps } = fakeDeps({});
    const watch = testWatch(deps);
    const check = watch.defineCheck({ ...base, id: "g", serviceId: "s", kind: "github", intent: "x", config: { repo: "acme/api" } }, "on");
    expect((await watch.runner.trial(check)).summary).toContain("Install the GitHub CLI");
  });

  it("aws metric treats the comparison as the breach and can accept no data", async () => {
    let points: Array<Record<string, number>> = [{ Sum: 2 }, { Sum: 1 }];
    const { deps } = fakeDeps({ commands: { aws: () => ({ stdout: JSON.stringify({ Datapoints: points }) }) } });
    const watch = testWatch(deps);
    const config = {
      region: "us-east-1", namespace: "AWS/Lambda", metric: "Errors", statistic: "Sum",
      periodSeconds: 3600, windowSeconds: 3600, comparison: ">", threshold: 0, missingIsOk: true,
    };
    const check = watch.defineCheck({ ...base, id: "m", serviceId: "s", kind: "aws_metric", intent: "x", config }, "on");
    const failing = await watch.runner.trial(check);
    expect([failing.outcome, failing.summary]).toEqual(["fail", "Errors: 3"]);
    points = [];
    expect((await watch.runner.trial(check)).outcome).toBe("pass");
  });

  it("aws metric names the renew command when the SSO login expired", async () => {
    const { deps } = fakeDeps({ commands: { aws: { code: 255, stderr: "Error when retrieving token from sso: Token has expired" } } });
    const watch = testWatch(deps);
    const check = watch.defineCheck({
      ...base, id: "m", serviceId: "s", kind: "aws_metric", intent: "x",
      config: { profile: "prod", region: "us-east-1", namespace: "AWS/Lambda", metric: "Errors", statistic: "Sum", periodSeconds: 3600, windowSeconds: 3600, comparison: ">", threshold: 0 },
    }, "on");
    expect((await watch.runner.trial(check)).summary).toBe("The AWS login expired. Run aws sso login --profile prod");
  });

  it("heartbeat passes while pings arrive and fails when they stop", async () => {
    const fake = fakeDeps({});
    const watch = testWatch(fake.deps);
    const check = watch.defineCheck({
      ...base, id: "h", serviceId: "s", kind: "heartbeat", intent: "x",
      config: { token: "abcdefghijklmnop1234", periodSeconds: 3600, graceSeconds: 60 },
    }, "on");
    expect((await watch.runner.trial(check)).outcome).toBe("unknown");
    watch.store.addHeartbeat("h", watch.now(), "success");
    expect((await watch.runner.trial(check)).outcome).toBe("pass");
    fake.advance(3700);
    expect((await watch.runner.trial(check)).outcome).toBe("fail");
  });

  it("vendor checks need a key and never echo it", async () => {
    const { deps } = fakeDeps({ fetch: () => jsonResponse(200, { data: { company_id: 7 } }) });
    const watch = testWatch(deps);
    const added = await watch.addKey({ vendor: "pipedrive", value: "pd-secret-value-123" });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(JSON.stringify(added)).not.toContain("pd-secret-value-123");
    expect(added.key.last4).toBe("-123");
    const check = watch.defineCheck({
      ...base, id: "v", serviceId: "s", kind: "vendor", intent: "x", keyId: added.key.id,
      config: { vendor: "pipedrive", check: "key" },
    }, "on");
    expect((await watch.runner.trial(check)).summary).toBe("Pipedrive accepts the key for 7");
    watch.removeKey(added.key.id);
    expect((await watch.runner.trial(check)).summary).toBe("Add a Pipedrive key");
    expect(watch.store.check("v")!.state).toBe("paused");
  });

  it("keeps a key the vendor rejects out of the store", async () => {
    const { deps } = fakeDeps({ fetch: () => jsonResponse(401, {}) });
    const watch = testWatch(deps);
    const added = await watch.addKey({ vendor: "pipedrive", value: "pd-wrong-value-123" });
    expect(added.ok).toBe(false);
    expect(watch.keys()).toHaveLength(0);
  });
});

describe("requests that get no answer", () => {
  it("are named in words, with the ones a slow link of Watch's own explains marked", () => {
    expect(noAnswer(fetchFailed("UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error"), 15_000)).toEqual({
      reason: "the connection timed out",
      code: "UND_ERR_CONNECT_TIMEOUT",
      link: true,
    });
    expect(noAnswer(fetchFailed("ECONNRESET", "read ECONNRESET"), 15_000)).toMatchObject({ reason: "the connection was reset", link: true });
    expect(noAnswer(fetchFailed("EAI_AGAIN", "getaddrinfo EAI_AGAIN x.test"), 15_000)).toMatchObject({ reason: "the name lookup did not finish", link: true });
    // The site's own failures are not the link's.
    expect(noAnswer(fetchFailed("ECONNREFUSED", "connect ECONNREFUSED 192.0.2.1:443"), 15_000)).toMatchObject({ reason: "the server refused the connection", link: false });
    // A lookup that failed for want of a connection reads as a missing name on macOS and Windows.
    expect(noAnswer(fetchFailed("ENOTFOUND", "getaddrinfo ENOTFOUND x.test"), 15_000)).toMatchObject({ reason: "the name could not be found", link: true });
    expect(noAnswer(fetchFailed("CERT_HAS_EXPIRED", "certificate has expired"), 15_000)).toEqual({
      reason: "certificate has expired",
      code: "CERT_HAS_EXPIRED",
      link: false,
    });
    // Every address failing at once comes as each one's error together, under the first's code.
    const everyAddress = (...codes: Array<string>) =>
      new TypeError("fetch failed", {
        cause: Object.assign(new AggregateError(codes.map((code) => Object.assign(new Error(`connect ${code}`), { code }))), { code: codes[0] }),
      });
    expect(noAnswer(everyAddress("ETIMEDOUT", "ENETUNREACH"), 15_000)).toMatchObject({ reason: "the connection timed out", code: "ETIMEDOUT", link: true });
    // An address that refused is the site answering, whichever address timed out first.
    expect(noAnswer(everyAddress("ETIMEDOUT", "ECONNREFUSED"), 15_000)).toMatchObject({ reason: "the server refused the connection", code: "ECONNREFUSED", link: false });
    // The check's own deadline, and a failure with no reason at all, which stays the site's.
    expect(noAnswer(new DOMException("The operation was aborted due to timeout", "TimeoutError"), 45_000)).toEqual({
      reason: "no answer within 45 seconds",
      code: "timeout",
      link: true,
    });
    expect(noAnswer(new TypeError("fetch failed"), 15_000)).toEqual({ reason: "the request could not be made", code: null, link: false });
    // An error about the request itself may quote a header, and so a key, which is never shown.
    const quoted = noAnswer(new TypeError('Headers.append: "Bearer my-vendor-key-value" is an invalid header value.'), 15_000);
    expect(quoted).toEqual({ reason: "the request could not be made", code: null, link: false });
  });

  it("show in the HTTP and vendor checks' results, which wait longer after a held run", async () => {
    let failure: unknown = null;
    const { deps } = fakeDeps({
      fetch: () => {
        if (failure !== null) throw failure;
        return jsonResponse(200, { data: { company_id: 7 } });
      },
    });
    const watch = testWatch(deps);
    const added = await watch.addKey({ vendor: "pipedrive", value: "pd-secret-value-123" });
    if (!added.ok) throw new Error(added.summary);
    const site = watch.defineCheck({ ...base, id: "site", serviceId: "s", kind: "http", intent: "x", config: { url: "https://x.test/" } }, "on");
    const vendor = watch.defineCheck({ ...base, id: "v", serviceId: "s", kind: "vendor", intent: "x", keyId: added.key.id, config: { vendor: "pipedrive", check: "key" } }, "on");
    const context: CheckContext = { deps, store: watch.store, keyring: watch.keyring, vendors: () => watch.vendors() };
    const run = (check: Check, patient = false) => runCheck(check, { ...context, patient });
    failure = fetchFailed("UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error");
    expect(await run(site)).toEqual({
      outcome: "fail",
      summary: "Could not connect: the connection timed out",
      evidence: { connection: "UND_ERR_CONNECT_TIMEOUT", link: true },
    });
    expect(await run(vendor)).toEqual({
      outcome: "unknown",
      summary: "Could not reach Pipedrive: the connection timed out",
      evidence: { connection: "UND_ERR_CONNECT_TIMEOUT", link: true },
    });
    failure = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect((await run(site)).summary).toBe("No answer within 15 seconds");
    expect((await run(site, true)).summary).toBe("No answer within 45 seconds");
    expect((await run(vendor, true)).summary).toBe("Pipedrive did not answer within 45 seconds");
  });
});
