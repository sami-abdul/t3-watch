import { z } from "zod";

import { type CheckRunner, unknown } from "./types.ts";

export const HttpConfig = z.object({
  url: z.url().refine((u) => /^https?:$/.test(new URL(u).protocol), "http or https"),
  /** Exact status to expect. Without it any 2xx passes. */
  expectStatus: z.number().int().min(100).max(599).optional(),
  /** Text the body must contain. */
  contains: z.string().min(1).max(500).optional(),
});

export const runHttp: CheckRunner = async (check, { deps }) => {
  const parsed = HttpConfig.safeParse(check.config);
  if (!parsed.success) return unknown("The check's settings are invalid");
  const c = parsed.data;
  const started = Date.now();
  try {
    const response = await deps.fetch(c.url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "t3-watch" },
    });
    const ms = Date.now() - started;
    const body = c.contains === undefined ? "" : await response.text();
    const statusOk =
      c.expectStatus === undefined
        ? response.status >= 200 && response.status < 300
        : response.status === c.expectStatus;
    const evidence = { status: response.status, ms };
    if (!statusOk) return { outcome: "fail", summary: `Answered ${response.status}`, evidence };
    if (c.contains !== undefined && !body.includes(c.contains))
      return { outcome: "fail", summary: `Answered ${response.status} without the expected text`, evidence };
    return { outcome: "pass", summary: `Answered ${response.status} in ${ms} ms`, evidence };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A URL nobody can reach is a failure of the thing watched, not of the check.
    if (/abort|timeout/i.test(message))
      return { outcome: "fail", summary: "No answer within 15 seconds", evidence: {} };
    return { outcome: "fail", summary: `Could not connect: ${message.slice(0, 120)}`, evidence: {} };
  }
};
