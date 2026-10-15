import type { Check, CheckKind } from "../store.ts";
import { AwsMetricConfig, runAwsMetric } from "./aws.ts";
import { GitHubConfig, runGitHub } from "./github.ts";
import { HeartbeatConfig, runHeartbeat } from "./heartbeat.ts";
import { HttpConfig, runHttp } from "./http.ts";
import { type CheckContext, type CheckResult, type CheckRunner, unknown } from "./types.ts";
import { runVendor, VendorCheckConfig } from "./vendor.ts";

const runners: Record<CheckKind, CheckRunner> = {
  http: runHttp,
  github: runGitHub,
  aws_metric: runAwsMetric,
  heartbeat: runHeartbeat,
  vendor: runVendor,
};
export const configSchemas = {
  http: HttpConfig,
  github: GitHubConfig,
  aws_metric: AwsMetricConfig,
  heartbeat: HeartbeatConfig,
  vendor: VendorCheckConfig,
} as const;
export const checkKinds = Object.keys(runners) as Array<CheckKind>;

/** Runs a check once. Never throws: a broken check is an unknown result. */
export const runCheck = async (check: Check, context: CheckContext): Promise<CheckResult> => {
  try {
    const result = await runners[check.kind](check, context);
    return { ...result, summary: result.summary.slice(0, 300) };
  } catch (error) {
    return unknown(`The check crashed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300));
  }
};

export type { CheckContext, CheckResult };
