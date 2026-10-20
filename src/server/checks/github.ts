import { z } from "zod";

import { describeAge } from "../vendors.ts";
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
}
const FAILED = new Set(["failure", "timed_out", "startup_failure", "action_required"]);
const IGNORED = new Set(["cancelled", "skipped", "neutral", "stale", ""]);

/**
 * Fails when the latest finished run of any workflow on the branch failed, or, with
 * maxAgeSeconds, when the newest successful run is older than that.
 */
export const runGitHub: CheckRunner = async (check, { deps }) => {
  const parsed = GitHubConfig.safeParse(check.config);
  if (!parsed.success) return unknown("The check's settings are invalid");
  const c = parsed.data;
  const result = await deps.run("gh", [
    "run",
    "list",
    "--repo",
    c.repo,
    ...(c.branch === undefined ? [] : ["--branch", c.branch]),
    ...(c.workflow === undefined ? [] : ["--workflow", c.workflow]),
    "--limit",
    "30",
    "--json",
    "status,conclusion,workflowName,displayTitle,url,createdAt",
  ]);
  if (result.missing) return unknown("Install the GitHub CLI (gh) on this machine");
  if (result.code !== 0)
    return /auth|login|401/i.test(result.stderr)
      ? unknown("The GitHub CLI is not logged in. Run gh auth login")
      : unknown(`gh could not read runs: ${result.stderr.trim().slice(0, 160)}`);
  let runs: Array<RunRow>;
  try {
    runs = JSON.parse(result.stdout) as Array<RunRow>;
  } catch {
    return unknown("gh returned unreadable output");
  }
  const latest = new Map<string, RunRow>();
  for (const run of runs) {
    if (run.status !== "completed" || IGNORED.has(run.conclusion ?? "")) continue;
    if (!latest.has(run.workflowName)) latest.set(run.workflowName, run);
  }
  const where = c.branch === undefined ? c.repo : `${c.branch} in ${c.repo}`;
  if (latest.size === 0) {
    // A schedule that only gets skipped or cancelled has gone stale too.
    const finished = runs.filter((run) => run.status === "completed").length;
    return c.maxAgeSeconds !== undefined && finished > 0
      ? { outcome: "fail", summary: `No successful run in the last ${finished} finished runs on ${where}`, evidence: { finished } }
      : unknown("No finished runs yet");
  }
  const failed = [...latest.values()].filter((run) => FAILED.has(run.conclusion));
  if (failed.length > 0)
    return {
      outcome: "fail",
      summary: `${failed.map((r) => r.workflowName).join(", ")} failed on ${where}`,
      evidence: { runs: failed.map((r) => ({ workflow: r.workflowName, title: r.displayTitle, url: r.url, at: r.createdAt })) },
    };
  const passing = `${latest.size} workflow${latest.size === 1 ? "" : "s"} passing on ${where}`;
  if (c.maxAgeSeconds === undefined)
    return { outcome: "pass", summary: passing, evidence: { workflows: [...latest.keys()] } };
  // No run failed, so the latest finished run of the one workflow is its newest success.
  const lastSuccessAt = [...latest.values()][0]!.createdAt;
  if (Number.isNaN(Date.parse(lastSuccessAt))) return unknown("gh gave no start time for the latest run");
  const age = (deps.now().getTime() - Date.parse(lastSuccessAt)) / 1000;
  if (age > c.maxAgeSeconds)
    return {
      outcome: "fail",
      summary: `Last successful run ${describeAge(age)} ago on ${where}, more than ${describeAge(c.maxAgeSeconds)}`,
      evidence: { lastSuccessAt, maxAgeSeconds: c.maxAgeSeconds },
    };
  return {
    outcome: "pass",
    summary: `${passing}, last success ${describeAge(age)} ago`,
    evidence: { workflows: [...latest.keys()], lastSuccessAt },
  };
};
