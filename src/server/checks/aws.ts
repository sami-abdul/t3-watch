import { z } from "zod";

import { type CheckRunner, unknown } from "./types.ts";

const argument = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_./:@-]{0,199}$/);
export const AwsMetricConfig = z.object({
  profile: argument.optional(),
  region: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/),
  namespace: argument,
  metric: argument,
  dimensions: z.array(z.object({ name: argument, value: argument })).max(10).optional(),
  statistic: z.enum(["Sum", "Average", "Maximum", "Minimum", "SampleCount"]),
  periodSeconds: z.number().int().min(60).max(86400).refine((n) => n % 60 === 0),
  windowSeconds: z.number().int().min(60).max(14 * 86400),
  /** The breach condition: the check fails when the value compares true. */
  comparison: z.enum([">", ">=", "<", "<="]),
  threshold: z.number(),
  /** No datapoints in the window counts as passing, such as no errors from idle functions. */
  missingIsOk: z.boolean().optional(),
});

export const runAwsMetric: CheckRunner = async (check, { deps }) => {
  const parsed = AwsMetricConfig.safeParse(check.config);
  if (!parsed.success) return unknown("The check's settings are invalid");
  const c = parsed.data;
  const end = deps.now();
  const start = new Date(end.getTime() - c.windowSeconds * 1000);
  const result = await deps.run("aws", [
    "cloudwatch",
    "get-metric-statistics",
    "--namespace",
    c.namespace,
    "--metric-name",
    c.metric,
    "--start-time",
    start.toISOString(),
    "--end-time",
    end.toISOString(),
    "--period",
    String(c.periodSeconds),
    "--statistics",
    c.statistic,
    "--region",
    c.region,
    ...(c.profile === undefined ? [] : ["--profile", c.profile]),
    ...(c.dimensions === undefined || c.dimensions.length === 0
      ? []
      : ["--dimensions", ...c.dimensions.map((d) => `Name=${d.name},Value=${d.value}`)]),
    "--output",
    "json",
  ]);
  if (result.missing) return unknown("Install the AWS CLI on this machine");
  if (result.code !== 0) {
    if (/expired|sso|token/i.test(result.stderr))
      return unknown(
        `The AWS login expired. Run aws sso login${c.profile === undefined ? "" : ` --profile ${c.profile}`}`,
      );
    return unknown(`AWS could not read the metric: ${result.stderr.trim().slice(0, 160)}`);
  }
  let points: Array<Record<string, number>>;
  try {
    points = (JSON.parse(result.stdout) as { Datapoints?: Array<Record<string, number>> }).Datapoints ?? [];
  } catch {
    return unknown("AWS returned unreadable output");
  }
  const values = points.map((p) => p[c.statistic]).filter((v): v is number => typeof v === "number");
  if (values.length === 0)
    return c.missingIsOk === true
      ? { outcome: "pass", summary: `No ${c.metric} data in the window`, evidence: {} }
      : unknown(`No ${c.metric} data in the window`);
  const value =
    c.statistic === "Maximum"
      ? Math.max(...values)
      : c.statistic === "Minimum"
        ? Math.min(...values)
        : c.statistic === "Average"
          ? values.reduce((a, b) => a + b, 0) / values.length
          : values.reduce((a, b) => a + b, 0);
  const breach =
    c.comparison === ">"
      ? value > c.threshold
      : c.comparison === ">="
        ? value >= c.threshold
        : c.comparison === "<"
          ? value < c.threshold
          : value <= c.threshold;
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return {
    outcome: breach ? "fail" : "pass",
    summary: `${c.metric}: ${shown}`,
    evidence: { value, points: values.length },
  };
};
