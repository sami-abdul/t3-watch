import { describe, expect, it } from "vitest";

import { GitHubConfig } from "./checks/github.ts";
import { type CheckContext, runCheck } from "./checks/index.ts";
import { noAnswer } from "./checks/network.ts";
import type { ProcResult, RunProc } from "./proc.ts";
import type { Check } from "./store.ts";
import { fakeDeps, fetchFailed, jsonResponse, testWatch } from "./testkit.ts";

const base = { cadenceSeconds: 300, keyId: null, origin: "user" as const };

// GitHub's own words on a job it would not start, as on 22 October.
const BLOCKED = "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings";
const billing = [{ annotation_level: "failure", message: BLOCKED }];
// An hour before the fake clock, unless a test says otherwise.
const ghRun = (id: number, conclusion: string, workflowName = "CI", createdAt = "2026-10-15T09:00:00Z") => ({
  status: "completed", conclusion, workflowName, displayTitle: `run ${id}`,
  url: `https://github.com/acme/api/actions/runs/${id}`, createdAt, updatedAt: createdAt, databaseId: id,
});
const unstartedJob = (id: number) => ({ id, conclusion: "failure", steps: [] });
const ranJob = (id: number, conclusion = "failure") => ({ id, conclusion, steps: [{ name: "test" }] });

interface GitHubWorld {
  runs: Array<Record<string, unknown>>;
  /** Each run's jobs, by run id. */
  jobs: Record<number, Array<unknown>>;
  /** Each job's annotations, by job id. */
  annotations: Record<number, Array<unknown>>;
  /** Answers by path, ahead of the others. */
  answers: Record<string, Partial<ProcResult>>;
}

/** A gh that answers from `world` as it is at each call. */
const fakeGh = (world: GitHubWorld) => (args: ReadonlyArray<string>): Partial<ProcResult> => {
  if (args[0] === "run") return { stdout: JSON.stringify(world.runs) };
  const path = args[1] ?? "";
  const answer = world.answers[path];
  if (answer !== undefined) return answer;
  const jobs = /^repos\/acme\/[a-z]+\/actions\/runs\/(\d+)\/jobs\?per_page=100&page=1$/.exec(path);
  if (jobs !== null) {
    const list = world.jobs[Number(jobs[1])] ?? [];
    return { stdout: JSON.stringify({ total_count: list.length, jobs: list }) };
  }
  const notes = /^repos\/acme\/[a-z]+\/check-runs\/(\d+)\/annotations$/.exec(path);
  if (notes !== null) return { stdout: JSON.stringify(world.annotations[Number(notes[1])] ?? []) };
  return { code: 1, stderr: "unexpected" };
};

/** A GitHub check on main of acme/api, or on what `config` says, ways to look at it, and how long each gh call may take. */
const gitHubCheck = (world: GitHubWorld, config: Record<string, unknown> = { repo: "acme/api", branch: "main" }) => {
  const fake = fakeDeps({ commands: { gh: fakeGh(world) } });
  const timeouts: Array<number | undefined> = [];
  const run: RunProc = (command, args, options) => {
    timeouts.push(options?.timeoutMs);
    return fake.deps.run(command, args, options);
  };
  const deps = { ...fake.deps, run };
  const watch = testWatch(deps);
  const check = watch.defineCheck({ ...base, id: "g", serviceId: "s", kind: "github", intent: "x", config }, "on");
  const context: CheckContext = { deps, store: watch.store, keyring: watch.keyring, vendors: () => watch.vendors() };
  const result = (patient = false) => runCheck(check, { ...context, patient });
  const look = async (patient = false) => {
    const r = await result(patient);
    return [r.outcome, r.summary];
  };
  return { calls: fake.calls, timeouts, result, look };
};

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

  it("github says plainly when GitHub did not run CI because Actions is blocked on billing", async () => {
    const world: GitHubWorld = {
      runs: [ghRun(101, "failure"), ghRun(100, "success")],
      jobs: { 101: [unstartedJob(201)], 102: [unstartedJob(202)], 103: [unstartedJob(203)], 104: [unstartedJob(204)], 105: [unstartedJob(205)], 106: [unstartedJob(206)] },
      annotations: {
        201: [...billing, { annotation_level: "notice", message: "The ubuntu-latest label will migrate to Ubuntu 26" }],
        // A notice in GitHub's billing words, another reason, or billing only in a name is no billing block.
        202: [{ annotation_level: "notice", message: BLOCKED }],
        203: [{ annotation_level: "failure", message: "Process completed with exit code 1." }],
        204: [{ annotation_level: "failure", message: "The job was not started because the runner group 'billing-runners' has no online runners." }],
        205: [{ annotation_level: "failure", message: "The job was not started because your account is locked due to a billing issue." }],
        206: [{ annotation_level: "failure", message: "The job was not started because\nrecent account payments have failed." }],
      },
      answers: {},
    };
    const { calls, result, look } = gitHubCheck(world);
    expect(await result()).toMatchObject({
      outcome: "unknown",
      summary: "GitHub didn't run CI: Actions is blocked on billing",
      evidence: { billing: [{ workflow: "CI", url: "https://github.com/acme/api/actions/runs/101" }] },
    });
    expect(calls.map((c) => c.args.slice(0, 2).join(" "))).toEqual([
      "run list",
      "api repos/acme/api/actions/runs/101/jobs?per_page=100&page=1",
      "api repos/acme/api/check-runs/201/annotations",
    ]);
    // A finished run does not change, so the next look reads only the list of runs.
    calls.length = 0;
    expect((await result()).outcome).toBe("unknown");
    expect(calls.map((c) => c.args.slice(0, 2).join(" "))).toEqual(["run list"]);
    // A run started again is read afresh.
    world.runs = [{ ...ghRun(101, "failure"), updatedAt: "2026-10-15T09:40:00Z" }, ghRun(100, "success")];
    expect((await result()).outcome).toBe("unknown");
    expect(calls).toHaveLength(4);
    for (const [id, outcome] of [[102, "fail"], [103, "fail"], [104, "fail"], [105, "unknown"], [106, "unknown"]] as const) {
      world.runs = [ghRun(id, "failure"), ghRun(100, "success")];
      expect(await look()).toEqual([outcome, outcome === "fail" ? "CI failed on main in acme/api" : "GitHub didn't run CI: Actions is blocked on billing"]);
    }
  });

  it("github still fails a run that ran and failed or timed out, beside one GitHub did not run", async () => {
    const { result } = gitHubCheck({
      runs: [ghRun(1, "failure", "CI"), ghRun(2, "failure", "Lint"), ghRun(3, "timed_out", "E2E")],
      // CI's job ran a step and failed; Lint's never started; E2E's ran and timed out, beside one that never started.
      jobs: { 1: [ranJob(11)], 2: [unstartedJob(22)], 3: [unstartedJob(33), ranJob(34, "timed_out")] },
      annotations: { 22: billing, 33: billing },
      answers: {},
    });
    expect(await result()).toMatchObject({
      outcome: "fail",
      summary: "CI, E2E failed on main in acme/api; GitHub didn't run Lint: Actions is blocked on billing",
      evidence: { runs: [{ workflow: "CI" }, { workflow: "E2E" }], billing: [{ workflow: "Lint" }] },
    });
  });

  it("github keeps a real failure that GitHub has not run CI since", async () => {
    const world: GitHubWorld = {
      runs: [ghRun(13, "failure"), ghRun(12, "failure"), ghRun(11, "failure"), ghRun(10, "success")],
      jobs: { 13: [unstartedJob(130)], 12: [unstartedJob(120)], 11: [ranJob(110)] },
      annotations: { 130: billing, 120: billing },
      answers: {},
    };
    const { result, look } = gitHubCheck(world);
    // Main broke in run 11 and GitHub has refused every push since, so main is still broken as far as anyone knows.
    expect(await result()).toMatchObject({
      outcome: "fail",
      summary: "CI failed on main in acme/api; GitHub hasn't run CI since: Actions is blocked on billing",
      evidence: { runs: [{ url: "https://github.com/acme/api/actions/runs/11" }], billing: [{ url: "https://github.com/acme/api/actions/runs/13" }] },
    });
    // A push whose jobs GitHub fails to list for a moment changes nothing: it fails either way.
    world.runs = [ghRun(14, "failure"), ...world.runs];
    world.answers["repos/acme/api/actions/runs/14/jobs?per_page=100&page=1"] = { code: 1, stderr: "gh: HTTP 502: Bad Gateway" };
    expect(await result()).toMatchObject({
      outcome: "fail",
      summary: "CI failed on main in acme/api; GitHub hasn't run CI since: Actions is blocked on billing",
      evidence: { runs: [{ url: "https://github.com/acme/api/actions/runs/11" }], billing: [{ url: "https://github.com/acme/api/actions/runs/13" }] },
    });
    // The run named as failed is the one that failed, not one that could not be read.
    world.runs = [ghRun(13, "failure"), ghRun(14, "failure"), ghRun(11, "failure")];
    expect(await result()).toMatchObject({ outcome: "fail", evidence: { runs: [{ url: "https://github.com/acme/api/actions/runs/11" }] } });
    // Had run 11 passed, the runs GitHub refused would say only that.
    world.runs = [ghRun(13, "failure"), ghRun(12, "failure"), ghRun(10, "success")];
    expect(await look()).toEqual(["unknown", "GitHub didn't run CI: Actions is blocked on billing"]);
    // It looks back ten runs behind the latest, and no further.
    const refused = Array.from({ length: 11 }, (_, i) => 30 + i);
    for (const id of refused) {
      world.jobs[id] = [unstartedJob(id * 10)];
      world.annotations[id * 10] = billing;
    }
    world.runs = [...refused.slice(0, 10).map((id) => ghRun(id, "failure")), ghRun(11, "failure")];
    expect((await look())[0]).toBe("fail");
    world.runs = [...refused.map((id) => ghRun(id, "failure")), ghRun(11, "failure")];
    expect(await look()).toEqual(["unknown", "GitHub didn't run CI: Actions is blocked on billing"]);
  });

  it("github says it could not tell when GitHub's answer about a run that never started cannot be read", async () => {
    const world: GitHubWorld = { runs: [ghRun(1, "failure"), ghRun(0, "success")], jobs: { 1: [unstartedJob(11)], 4: [ranJob(40)] }, annotations: {}, answers: {} };
    const jobsOf = (id: number) => `repos/acme/api/actions/runs/${id}/jobs?per_page=100&page=1`;
    const notes = "repos/acme/api/check-runs/11/annotations";
    const { look, timeouts } = gitHubCheck(world);
    // Unreadable is not failed: a repository GitHub will not run must not fail on a moment's error.
    world.answers[jobsOf(1)] = { code: 1, stderr: "gh: HTTP 502: Bad Gateway (https://api.github.com/repos/acme/api/actions/runs/1/jobs)\nmore" };
    expect(await look()).toEqual(["unknown", "Could not tell whether GitHub ran CI: gh: HTTP 502: Bad Gateway (https://api.github.com/repos/acme/api/actions/runs/1/jobs)"]);
    world.answers[jobsOf(1)] = { code: null, timedOut: true };
    expect(await look()).toEqual(["unknown", "Could not tell whether GitHub ran CI: gh did not answer within 20 seconds"]);
    // After a held run, when Watch's link may still be slow, each gh call waits longer.
    timeouts.length = 0;
    expect(await look(true)).toEqual(["unknown", "Could not tell whether GitHub ran CI: gh did not answer within 45 seconds"]);
    expect(timeouts).toEqual([45_000, 45_000]);
    for (const odd of ["<html>", "null", JSON.stringify({ jobs: "none" }), JSON.stringify([1, 2])]) {
      world.answers[jobsOf(1)] = { stdout: odd };
      expect(await look()).toEqual(["unknown", "Could not tell whether GitHub ran CI: GitHub's list of jobs could not be read"]);
    }
    world.answers[jobsOf(1)] = { stdout: JSON.stringify({ total_count: 4, jobs: [null, 7, { id: "x", conclusion: "failure" }, unstartedJob(11)] }) };
    world.answers[notes] = { code: 1, stderr: "gh: Resource not accessible by integration (HTTP 403)" };
    expect(await look()).toEqual(["unknown", "Could not tell whether GitHub ran CI: gh: Resource not accessible by integration (HTTP 403)"]);
    world.answers[notes] = { stdout: JSON.stringify({ message: BLOCKED }) };
    expect(await look()).toEqual(["unknown", "Could not tell whether GitHub ran CI: GitHub's annotations could not be read"]);
    // Read once it can be, and kept.
    world.answers[notes] = { stdout: JSON.stringify([null, ...billing]) };
    expect(await look()).toEqual(["unknown", "GitHub didn't run CI: Actions is blocked on billing"]);
    world.answers[notes] = { code: 1, stderr: "gh: HTTP 502" };
    expect(await look()).toEqual(["unknown", "GitHub didn't run CI: Actions is blocked on billing"]);
    // Each workflow it cannot read comes with its own reason.
    world.runs = [ghRun(2, "failure", "CI"), ghRun(3, "failure", "Lint")];
    world.answers[jobsOf(2)] = { code: 1, stderr: "gh: HTTP 502" };
    world.answers[jobsOf(3)] = { code: 1, stderr: "gh: HTTP 403" };
    expect(await look()).toEqual(["unknown", "Could not tell whether GitHub ran CI: gh: HTTP 502; could not tell whether GitHub ran Lint: gh: HTTP 403"]);
    // Beside a run that really failed, one it cannot read counts as GitHub reports it.
    world.runs = [ghRun(2, "failure", "CI"), ghRun(4, "failure", "Lint")];
    expect(await look()).toEqual(["fail", "CI, Lint failed on main in acme/api"]);
  });

  it("github reads every page of a large run's jobs, and looks again while GitHub has said nothing", async () => {
    const world: GitHubWorld = { runs: [], jobs: { 8: [unstartedJob(81), unstartedJob(82)], 9: [unstartedJob(91)] }, annotations: { 82: billing, 1000: billing }, answers: {} };
    const page = (run: number, n: number, jobs: Array<unknown>, total: number) => {
      world.answers[`repos/acme/api/actions/runs/${run}/jobs?per_page=100&page=${n}`] = { stdout: JSON.stringify({ total_count: total, jobs }) };
    };
    const refused = Array.from({ length: 100 }, (_, i) => unstartedJob(1000 + i));
    const { look } = gitHubCheck(world);
    const lookAt = (id: number) => {
      world.runs = [ghRun(id, "failure"), ghRun(4, "success")];
      return look();
    };
    // A hundred jobs GitHub refused, and on the second page one that ran and failed.
    page(5, 1, refused, 101);
    page(5, 2, [ranJob(2000)], 101);
    expect(await lookAt(5)).toEqual(["fail", "CI failed on main in acme/api"]);
    page(6, 1, refused, 101);
    page(6, 2, [unstartedJob(2001)], 101);
    expect(await lookAt(6)).toEqual(["unknown", "GitHub didn't run CI: Actions is blocked on billing"]);
    // Past five pages a job that ran may hide, so the run counts as GitHub reports it.
    for (let n = 1; n <= 5; n++) page(7, n, refused, 600);
    expect(await lookAt(7)).toEqual(["fail", "CI failed on main in acme/api"]);
    // A job with no annotations yet: the next one is read.
    expect(await lookAt(8)).toEqual(["unknown", "GitHub didn't run CI: Actions is blocked on billing"]);
    // None has any yet, five minutes after the run: read again until GitHub says why.
    world.runs = [ghRun(9, "failure", "CI", "2026-10-15T09:55:00Z"), ghRun(4, "success")];
    expect(await look()).toEqual(["unknown", "Could not tell whether GitHub ran CI: GitHub has not said yet why its jobs did not start"]);
    world.annotations[91] = billing;
    expect(await look()).toEqual(["unknown", "GitHub didn't run CI: Actions is blocked on billing"]);
    // An hour after the run, GitHub's silence is its answer: the run counts as GitHub reports it.
    world.jobs[10] = [unstartedJob(101)];
    expect(await lookAt(10)).toEqual(["fail", "CI failed on main in acme/api"]);
  });

  it("github reads at most three workflows' runs at once", async () => {
    const workflows = ["A", "B", "C", "D", "E", "F"];
    const world: GitHubWorld = {
      runs: workflows.map((name, i) => ghRun(i + 1, "failure", name)),
      jobs: Object.fromEntries(workflows.map((_, i) => [i + 1, [unstartedJob((i + 1) * 10)]])),
      annotations: Object.fromEntries(workflows.map((_, i) => [(i + 1) * 10, billing])),
      answers: {},
    };
    let open = 0;
    let most = 0;
    const gh = fakeGh(world);
    const deps = {
      ...fakeDeps({}).deps,
      run: async (_command: string, args: ReadonlyArray<string>) => {
        open += 1;
        most = Math.max(most, open);
        await new Promise((resolve) => setTimeout(resolve, 2));
        open -= 1;
        return { code: 0, stdout: "", stderr: "", missing: false, timedOut: false, ...gh(args) };
      },
    };
    const watch = testWatch(deps);
    const check = watch.defineCheck({ ...base, id: "g", serviceId: "s", kind: "github", intent: "x", config: { repo: "acme/api", branch: "main" } }, "on");
    expect((await watch.runner.trial(check)).summary).toBe("GitHub didn't run A, B, C, D, E, F: Actions is blocked on billing");
    expect(most).toBe(3);
  });

  it("github keeps the verdicts of the runs it keeps looking at", async () => {
    // Run 1 of CI stays blocked while 600 runs of Lint come and go; it is read once.
    const world: GitHubWorld = { runs: [], jobs: { 1: [unstartedJob(10)] }, annotations: { 10: billing }, answers: {} };
    const { calls, result } = gitHubCheck(world);
    for (let id = 2; id <= 601; id++) {
      world.runs = [ghRun(id, "failure", "Lint"), ghRun(1, "failure", "CI")];
      world.jobs[id] = [unstartedJob(id * 10)];
      world.annotations[id * 10] = billing;
      await result();
    }
    expect(calls.filter((c) => c.args[1] === "repos/acme/api/actions/runs/1/jobs?per_page=100&page=1")).toHaveLength(1);
  });

  it("github with maxAgeSeconds still fails a schedule GitHub has not run for too long", async () => {
    // The fake clock reads 2026-10-15T10:00:00Z.
    const at = (id: number, conclusion: string, createdAt: string) => ({ ...ghRun(id, conclusion, "Nightly"), createdAt });
    const world: GitHubWorld = {
      runs: [at(2, "failure", "2026-10-15T09:00:00Z"), at(1, "success", "2026-10-15T05:00:00Z")],
      jobs: { 2: [unstartedJob(20)], 3: [unstartedJob(30)] },
      annotations: { 20: billing, 30: billing },
      answers: {},
    };
    const { result, look } = gitHubCheck(world, { repo: "acme/site", workflow: "nightly.yml", maxAgeSeconds: 21600 });
    expect(await look()).toEqual(["unknown", "GitHub didn't run Nightly: Actions is blocked on billing"]);
    world.runs = [world.runs[0]!, at(1, "success", "2026-10-15T03:00:00Z")];
    expect(await result()).toMatchObject({
      outcome: "fail",
      summary: "Last successful run 7 hours ago on acme/site, more than 6 hours; GitHub didn't run Nightly: Actions is blocked on billing",
      evidence: { billing: [{ workflow: "Nightly" }], lastSuccessAt: "2026-10-15T03:00:00Z", maxAgeSeconds: 21600 },
    });
    world.runs = [world.runs[0]!, at(3, "failure", "2026-10-15T01:00:00Z")];
    expect(await look()).toEqual(["fail", "No successful run for more than 6 hours on acme/site; GitHub didn't run Nightly: Actions is blocked on billing"]);
  });

  it("github tells a moment's empty list from a repository with no runs yet", async () => {
    // The fixture: what `gh run list` answered for main, runs first, then none at all.
    const fixture = [{ status: "completed", conclusion: "success", workflowName: "CI", displayTitle: "push", url: "https://github.com/acme/api/actions/runs/1", createdAt: "2026-10-15T09:00:00Z", databaseId: 1 }];
    let listing: Array<unknown> = fixture;
    let failing = false;
    const fake = fakeDeps({ commands: { gh: (args) => (args[0] !== "run" ? { code: 1, stderr: "unexpected" } : failing ? { code: 1, stderr: "gh: HTTP 502" } : { stdout: JSON.stringify(listing) }) } });
    const watch = testWatch(fake.deps);
    const define = (id: string, config: Record<string, unknown> = { repo: "acme/api", branch: "main" }) =>
      watch.defineCheck({ ...base, id, serviceId: "s", kind: "github", intent: "x", config }, "on");
    // A check that has never seen runs says so, as before.
    listing = [];
    expect(await watch.runner.trial(define("fresh"))).toMatchObject({ outcome: "unknown", summary: "No finished runs yet", evidence: { listed: 0 } });
    // One that listed runs, then could not read them for more than 30 runs, then listed none:
    // GitHub's moment, marked for the runner to hold.
    listing = fixture;
    define("ci");
    await watch.runner.tick();
    expect(watch.store.runs("ci", 1)[0]!.evidence).toEqual({ workflows: ["CI"], listed: 1, listedFor: { repo: "acme/api", branch: "main" } });
    failing = true;
    for (let i = 0; i < 31; i++) {
      fake.advance(301);
      await watch.runner.tick();
    }
    expect(watch.store.runs("ci", 100).filter((run) => run.evidence.listed === undefined)).toHaveLength(31);
    failing = false;
    listing = [];
    const moment = {
      outcome: "unknown",
      summary: "GitHub listed no runs for main in acme/api, though it had them before",
      evidence: { listed: 0, listedFor: { repo: "acme/api", branch: "main" }, hadRuns: true, transient: true },
    };
    expect(await watch.runner.trial(watch.store.check("ci")!)).toEqual(moment);
    // A snooze and a resume change no definition: the runs it listed still count.
    await watch.setCheck("ci", "snooze", new Date(fake.deps.now().getTime() + 3_600_000).toISOString());
    await watch.setCheck("ci", "resume");
    expect(await watch.runner.trial(watch.store.check("ci")!)).toEqual(moment);
    // The runs listed before an edit were another branch's: one that never ran has none yet.
    expect(await watch.runner.trial(define("ci", { repo: "acme/api", branch: "release" }))).toMatchObject({ summary: "No finished runs yet", evidence: { listed: 0 } });
    // A run kept from before Watch counted its listings says the repository had runs by what it
    // kept. With no branch, the repository is named, and a workflow when the check has one.
    const anyBranch = define("all", { repo: "acme/api" });
    watch.store.recordRun(anyBranch, { outcome: "pass", summary: "1 workflow passing on acme/api", evidence: { workflows: ["CI"] } }, "2026-10-15T10:00:00Z", 1, "2026-10-15T10:05:00Z");
    expect((await watch.runner.trial(watch.store.check("all")!)).summary).toBe("GitHub listed no runs for acme/api, though it had them before");
    const nightly = define("nightly", { repo: "acme/site", workflow: "refresh.yml" });
    watch.store.recordRun(nightly, { outcome: "pass", summary: "1 workflow passing on acme/site", evidence: { workflows: ["Refresh"] } }, "2026-10-15T10:00:00Z", 1, "2026-10-15T10:05:00Z");
    expect((await watch.runner.trial(watch.store.check("nightly")!)).summary).toBe("GitHub listed no runs for refresh.yml on acme/site, though it had them before");
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
