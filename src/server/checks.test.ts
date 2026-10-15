import { describe, expect, it } from "vitest";

import { fakeDeps, jsonResponse, testWatch } from "./testkit.ts";

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
