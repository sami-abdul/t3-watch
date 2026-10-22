import { z } from "zod";

import { firstLine, type ProcResult, type RunProc } from "../proc.ts";
import { describeAge } from "../vendors.ts";
import { PATIENT_ANSWER_MS } from "./network.ts";
import { type CheckRunner, unknown } from "./types.ts";

const repoName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/);
const argument = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_./ -]{0,199}$/);
export const GitHubConfig = z
  .object({
    repo: repoName,
    branch: argument.optional(),
    workflow: argument.optional(),
    /**
     * Also fail when the workflow's newest successful run started longer ago than this. For
     * scheduled workflows, whose last result stays green after GitHub skips or disables them.
     */
    maxAgeSeconds: z.number().int().min(300).max(90 * 86400).optional(),
  })
  .refine((c) => c.maxAgeSeconds === undefined || c.workflow !== undefined, {
    message: "maxAgeSeconds needs a workflow, or another workflow's success would hide a stalled schedule",
    path: ["maxAgeSeconds"],
  });

interface RunRow {
  readonly status: string;
  readonly conclusion: string;
  readonly workflowName: string;
  readonly displayTitle: string;
  readonly url: string;
  readonly createdAt: string;
  readonly databaseId?: number;
  /** Changes when the run is started again. */
  readonly updatedAt?: string;
}
const FAILED = new Set(["failure", "timed_out", "startup_failure", "action_required"]);
const IGNORED = new Set(["cancelled", "skipped", "neutral", "stale", ""]);

/**
 * GitHub's words on a job it would not start for billing, such as "The job was not started because
 * recent account payments have failed or your spending limit needs to be increased". Only its own
 * phrases, so a runner group or an environment that merely has billing in its name does not match.
 */
const BILLING = /not started because\b.*\b(account payments have failed|spending limit|billing issue|budget is preventing)/is;

/** The parts of GitHub's answers about a run that the check reads; anything else in them is ignored. */
const JobsPage = z.object({ total_count: z.number().optional().catch(undefined), jobs: z.array(z.unknown()) });
const Job = z.object({
  id: z.number().optional().catch(undefined),
  conclusion: z.string().nullish().catch(null),
  steps: z.array(z.unknown()).nullish().catch(null),
});
type Job = z.infer<typeof Job>;
const Annotation = z.object({ annotation_level: z.string(), message: z.string().nullish().catch(null) });

const parseJson = (stdout: string): unknown => {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return undefined;
  }
};

/** The items that fit `schema`, without those that do not. */
const each = <T>(schema: z.ZodType<T>, items: ReadonlyArray<unknown>) =>
  items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });

/** How long a gh call may take, and how long after a held run, when the link may still be slow. */
const GH_MS = 20_000;
const ghMs = (patient: boolean | undefined) => (patient === true ? PATIENT_ANSWER_MS : GH_MS);

/** Why a gh call gave no answer, in words. */
const ghError = (answer: ProcResult, timeoutMs: number) =>
  answer.timedOut ? `gh did not answer within ${timeoutMs / 1000} seconds` : firstLine(answer.stderr) || `gh exit ${answer.code ?? "unknown"}`;

/** Maps items with at most `limit` calls at once, keeping their order. */
const inTurns = async <T, R>(items: ReadonlyArray<T>, limit: number, map: (item: T) => Promise<R>) => {
  const results: Array<R> = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await map(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/** How the check reads GitHub: which repository, through which gh, how patiently, as of when. */
interface Reader {
  readonly run: RunProc;
  readonly repo: string;
  readonly timeoutMs: number;
  readonly now: Date;
}

/**
 * What a failed run was: blocked when GitHub refused to start it for billing, ran when a job of it
 * ran its steps and failed or GitHub gave no billing reason, unread when GitHub's answer could not
 * be read, or is not there yet.
 */
type Verdict = { readonly kind: "blocked" } | { readonly kind: "ran" } | { readonly kind: "unread"; readonly why: string };

// A finished run's jobs and annotations do not change until it is started again, so a run is read
// until GitHub's answer settles it and then kept. Kept per deps, so every Watch, and every test,
// has its own.
const known = new WeakMap<RunProc, Map<string, Verdict>>();
const KNOWN_RUNS = 500;

const verdictOf = async (gh: Reader, row: RunRow): Promise<Verdict> => {
  if (row.databaseId === undefined) return { kind: "ran" };
  const key = `${gh.repo}#${row.databaseId}#${row.updatedAt ?? ""}`;
  const cache = known.get(gh.run) ?? new Map<string, Verdict>();
  known.set(gh.run, cache);
  const cached = cache.get(key);
  if (cached !== undefined) {
    // Moved to the back, so the runs of a long block outlast ones nobody looks at.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const { verdict, settled } = await readVerdict(gh, row, row.databaseId);
  if (settled) {
    cache.set(key, verdict);
    if (cache.size > KNOWN_RUNS) cache.delete(cache.keys().next().value!);
  }
  return verdict;
};

const JOB_PAGES = 5;

/** A run's jobs, up to five pages of a hundred, and whether that is all of them, or why they could not be read. */
const jobsOf = async (gh: Reader, runId: number): Promise<{ readonly why: string } | { readonly jobs: ReadonlyArray<Job>; readonly whole: boolean }> => {
  const jobs: Array<Job> = [];
  let seen = 0;
  for (let page = 1; page <= JOB_PAGES; page++) {
    const answer = await gh.run("gh", ["api", `repos/${gh.repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`], { timeoutMs: gh.timeoutMs });
    if (answer.code !== 0) return { why: ghError(answer, gh.timeoutMs) };
    const body = JobsPage.safeParse(parseJson(answer.stdout));
    if (!body.success) return { why: "GitHub's list of jobs could not be read" };
    jobs.push(...each(Job, body.data.jobs));
    seen += body.data.jobs.length;
    if (body.data.jobs.length < 100 || seen >= (body.data.total_count ?? 0)) return { jobs, whole: true };
  }
  return { jobs, whole: false };
};

// GitHub says why it did not start a job as it refuses it. A run that finished with no word yet is
// read again for this long after it started, and then counts as GitHub reports it.
const QUIET_MS = 10 * 60_000;

/**
 * Reads whether GitHub refused to start a failed run for billing: no job ran its steps and failed,
 * and a failed job that never started carries a failure annotation in GitHub's billing words. One
 * jobs call a page and up to two annotations calls. Settled when GitHub's answer decides it; an
 * answer that could not be read, or is not there yet, is read again next time.
 */
const readVerdict = async (gh: Reader, row: RunRow, runId: number): Promise<{ readonly verdict: Verdict; readonly settled: boolean }> => {
  const listed = await jobsOf(gh, runId);
  if ("why" in listed) return { verdict: { kind: "unread", why: listed.why }, settled: false };
  const ranSteps = (job: Job) => (job.steps?.length ?? 0) > 0;
  const failedJob = (job: Job) => FAILED.has(job.conclusion ?? "");
  // Billing stops a job before its first step; one that ran its steps and failed is a real failure,
  // and past the pages read there may be one.
  if (listed.jobs.some((job) => ranSteps(job) && failedJob(job)) || !listed.whole) return { verdict: { kind: "ran" }, settled: true };
  const unstarted = listed.jobs.filter((job) => !ranSteps(job) && failedJob(job) && job.id !== undefined);
  if (unstarted.length === 0) return { verdict: { kind: "ran" }, settled: true };
  let why: string | null = null;
  for (const job of unstarted.slice(0, 2)) {
    const notes = await gh.run("gh", ["api", `repos/${gh.repo}/check-runs/${job.id}/annotations`], { timeoutMs: gh.timeoutMs });
    const answer = notes.code === 0 ? parseJson(notes.stdout) : undefined;
    if (!Array.isArray(answer)) {
      why = notes.code === 0 ? "GitHub's annotations could not be read" : ghError(notes, gh.timeoutMs);
      continue;
    }
    const failures = each(Annotation, answer).filter((a) => a.annotation_level === "failure");
    if (failures.some((a) => BILLING.test(a.message ?? ""))) return { verdict: { kind: "blocked" }, settled: true };
    // GitHub gave another reason for not starting it.
    if (failures.length > 0) return { verdict: { kind: "ran" }, settled: true };
  }
  if (why !== null) return { verdict: { kind: "unread", why }, settled: false };
  return gh.now.getTime() - Date.parse(row.createdAt) < QUIET_MS
    ? { verdict: { kind: "unread", why: "GitHub has not said yet why its jobs did not start" }, settled: false }
    : { verdict: { kind: "ran" }, settled: true };
};

/**
 * Where a workflow whose latest finished run failed stands, looking back past runs GitHub refused
 * for billing to the last one that ran: failed when that one failed, blocked when it passed or is
 * out of sight, and unread when the latest run could not be read and nothing behind it failed.
 * `since` is the newest run GitHub refused after that failure.
 */
type Standing =
  | { readonly kind: "failed"; readonly run: RunRow; readonly since: RunRow | null }
  | { readonly kind: "blocked"; readonly run: RunRow }
  | { readonly kind: "unread"; readonly run: RunRow; readonly why: string };

/** How many runs behind the latest the check looks for the last one that ran. */
const LOOK_BACK = 10;

/** `rows` are the workflow's finished runs, newest first, the first of them failed. */
const standingOf = async (gh: Reader, rows: ReadonlyArray<RunRow>): Promise<Standing> => {
  const latest = rows[0]!;
  const first = await verdictOf(gh, latest);
  if (first.kind === "ran") return { kind: "failed", run: latest, since: null };
  let refused = first.kind === "blocked" ? latest : null;
  for (const row of rows.slice(1, 1 + LOOK_BACK)) {
    if (!FAILED.has(row.conclusion)) break;
    const verdict = await verdictOf(gh, row);
    if (verdict.kind === "blocked") refused ??= row;
    // A real failure behind decides it, whatever an unread run before it was.
    if (verdict.kind === "ran") return { kind: "failed", run: row, since: refused };
  }
  return first.kind === "blocked" ? { kind: "blocked", run: latest } : { kind: "unread", run: latest, why: first.why };
};

const runsOf = (rows: ReadonlyArray<RunRow>) => rows.map((r) => ({ workflow: r.workflowName, title: r.displayTitle, url: r.url, at: r.createdAt }));
const names = (rows: ReadonlyArray<RunRow>) => rows.map((r) => r.workflowName).join(", ");

/**
 * How long ago the newest finished success started, in seconds, or with none, how far back the
 * finished runs reach, which the newest success is older than; null when gh gave no time.
 */
const successAge = (finished: ReadonlyArray<RunRow>, now: Date) => {
  const success = finished.find((run) => run.conclusion === "success") ?? null;
  const from =
    success === null ? Math.min(...finished.map((run) => Date.parse(run.createdAt)).filter((t) => !Number.isNaN(t))) : Date.parse(success.createdAt);
  return { success, seconds: Number.isFinite(from) ? (now.getTime() - from) / 1000 : null };
};

/**
 * Fails when the latest finished run of any workflow on the branch failed, but says plainly when
 * GitHub refused to run it for billing, as a check that could not run, kept apart from real
 * failures; a real failure behind such runs still fails it. With maxAgeSeconds it also fails when
 * the workflow's newest success is older than that, including when no run read succeeded and
 * those runs reach back further than that.
 */
export const runGitHub: CheckRunner = async (check, { deps, patient }) => {
  const config = GitHubConfig.safeParse(check.config);
  if (!config.success) return unknown("The check's settings are invalid");
  const c = config.data;
  const gh: Reader = { run: deps.run, repo: c.repo, timeoutMs: ghMs(patient), now: deps.now() };
  const result = await deps.run(
    "gh",
    [
      "run",
      "list",
      "--repo",
      c.repo,
      ...(c.branch === undefined ? [] : ["--branch", c.branch]),
      ...(c.workflow === undefined ? [] : ["--workflow", c.workflow]),
      "--limit",
      "30",
      "--json",
      "status,conclusion,workflowName,displayTitle,url,createdAt,databaseId,updatedAt",
    ],
    { timeoutMs: gh.timeoutMs },
  );
  if (result.missing) return unknown("Install the GitHub CLI (gh) on this machine");
  if (result.code !== 0)
    return /auth|login|401/i.test(result.stderr)
      ? unknown("The GitHub CLI is not logged in. Run gh auth login")
      : unknown(`gh could not read runs: ${result.timedOut ? ghError(result, gh.timeoutMs) : result.stderr.trim().slice(0, 160)}`);
  const listed = parseJson(result.stdout);
  if (!Array.isArray(listed)) return unknown("gh returned unreadable output");
  const runs = listed as Array<RunRow>;
  const counted = runs.filter((run) => run.status === "completed" && !IGNORED.has(run.conclusion ?? ""));
  const latest = new Map<string, RunRow>();
  for (const run of counted) if (!latest.has(run.workflowName)) latest.set(run.workflowName, run);
  const where = c.branch === undefined ? c.repo : `${c.branch} in ${c.repo}`;
  const finished = runs.filter((run) => run.status === "completed");
  const age = successAge(finished, gh.now);
  const staleness = (maxAgeSeconds: number) =>
    age.success === null
      ? `No successful run for more than ${describeAge(maxAgeSeconds)} on ${where}`
      : `Last successful run ${describeAge(age.seconds ?? 0)} ago on ${where}, more than ${describeAge(maxAgeSeconds)}`;
  if (latest.size === 0) {
    if (c.maxAgeSeconds === undefined || finished.length === 0) return unknown("No finished runs yet");
    // No run read succeeded, so the newest success is older than the oldest of them. Only when
    // that reaches past the limit is the schedule known to be stale.
    return (age.seconds ?? 0) > c.maxAgeSeconds
      ? { outcome: "fail", summary: staleness(c.maxAgeSeconds), evidence: { finished: finished.length } }
      : unknown(`No successful run in the last ${finished.length} finished run${finished.length === 1 ? "" : "s"} yet`);
  }
  const failed = [...latest.values()].filter((run) => FAILED.has(run.conclusion));
  if (failed.length > 0) {
    // A run GitHub refused to start for billing is no failing build: it is said plainly, as a check
    // that could not run, and stays so from push to push, so it alerts once, not on every push.
    const standings = await inTurns(failed, 3, (row) => standingOf(gh, counted.filter((run) => run.workflowName === row.workflowName)));
    const failures = standings.filter((s) => s.kind === "failed");
    const blocked = standings.filter((s) => s.kind === "blocked").map((s) => s.run);
    const since = failures.flatMap((s) => (s.since === null ? [] : [s.since]));
    const unread = standings.filter((s) => s.kind === "unread");
    // Beside a real failure, a run whose answers could not be read counts as GitHub reports it.
    const real = failures.length === 0 ? [] : standings.flatMap((s) => (s.kind === "blocked" ? [] : [s.run]));
    const reasons = new Map<string, Array<RunRow>>();
    if (real.length === 0) for (const s of unread) reasons.set(s.why, [...(reasons.get(s.why) ?? []), s.run]);
    const notes = [
      ...(blocked.length === 0 ? [] : [`GitHub didn't run ${names(blocked)}: Actions is blocked on billing`]),
      ...(since.length === 0 ? [] : [`GitHub hasn't run ${names(since)} since: Actions is blocked on billing`]),
      ...[...reasons].map(([why, rows]) => `could not tell whether GitHub ran ${names(rows)}: ${why.slice(0, 160)}`),
    ];
    const evidence = {
      ...(real.length === 0 ? {} : { runs: runsOf(real) }),
      ...(blocked.length + since.length === 0 ? {} : { billing: runsOf([...blocked, ...since]) }),
      ...(reasons.size === 0 ? {} : { unread: runsOf(unread.map((s) => s.run)) }),
    };
    if (real.length > 0) return { outcome: "fail", summary: [`${names(real)} failed on ${where}`, ...notes].join("; "), evidence };
    const sentence = (parts: ReadonlyArray<string>) => {
      const text = parts.join("; ");
      return text.charAt(0).toUpperCase() + text.slice(1);
    };
    // A schedule GitHub has not run for longer than its limit is stale, whatever kept it from running.
    if (c.maxAgeSeconds !== undefined) {
      if (age.success !== null && age.seconds === null) return unknown(sentence(["gh gave no start time for the latest successful run", ...notes]), evidence);
      if ((age.seconds ?? 0) > c.maxAgeSeconds)
        return {
          outcome: "fail",
          summary: sentence([staleness(c.maxAgeSeconds), ...notes]),
          evidence: { ...evidence, ...(age.success === null ? {} : { lastSuccessAt: age.success.createdAt }), maxAgeSeconds: c.maxAgeSeconds },
        };
    }
    // Could not run: GitHub refused the runs, or its answer about them could not be read, as when
    // the runs themselves cannot be.
    return unknown(sentence(notes), evidence);
  }
  const passing = `${latest.size} workflow${latest.size === 1 ? "" : "s"} passing on ${where}`;
  if (c.maxAgeSeconds === undefined)
    return { outcome: "pass", summary: passing, evidence: { workflows: [...latest.keys()] } };
  // No run failed, so the one workflow's latest finished run is its newest success.
  if (age.success === null || age.seconds === null) return unknown("gh gave no start time for the latest run");
  const lastSuccessAt = age.success.createdAt;
  if (age.seconds > c.maxAgeSeconds)
    return { outcome: "fail", summary: staleness(c.maxAgeSeconds), evidence: { lastSuccessAt, maxAgeSeconds: c.maxAgeSeconds } };
  return {
    outcome: "pass",
    summary: `${passing}, last success ${describeAge(age.seconds)} ago`,
    evidence: { workflows: [...latest.keys()], lastSuccessAt },
  };
};
