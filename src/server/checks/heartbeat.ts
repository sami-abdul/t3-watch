import { z } from "zod";

import { describeAge } from "../vendors.ts";
import { type CheckRunner, unknown } from "./types.ts";

export const HeartbeatConfig = z.object({
  /** The secret part of the ping URL. */
  token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  periodSeconds: z.number().int().min(60).max(31 * 86400),
  graceSeconds: z.number().int().min(0).max(86400).default(300),
});

/** Passes while the job keeps pinging within its period plus grace. */
export const runHeartbeat: CheckRunner = async (check, { store, deps }) => {
  const parsed = HeartbeatConfig.safeParse(check.config);
  if (!parsed.success) return unknown("The check's settings are invalid");
  const c = parsed.data;
  const success = store.lastHeartbeat(check.id, "success");
  const failure = store.lastHeartbeat(check.id, "fail");
  if (failure !== null && (success === null || failure > success))
    return { outcome: "fail", summary: "The job reported a failure", evidence: { failedAt: failure } };
  if (success === null) return unknown("No ping yet");
  const age = (deps.now().getTime() - Date.parse(success)) / 1000;
  return age <= c.periodSeconds + c.graceSeconds
    ? { outcome: "pass", summary: `Last ping ${describeAge(age)} ago`, evidence: { lastAt: success } }
    : { outcome: "fail", summary: `No ping for ${describeAge(age)}`, evidence: { lastAt: success } };
};
