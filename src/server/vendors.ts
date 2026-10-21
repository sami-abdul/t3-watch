/**
 * Vendors are data. A description says how to spot a vendor in a project, where its key lives,
 * how to send the key, which read-only call proves the key works, and which checks to offer.
 * The engine here turns a description and a key into GET requests to the vendor's API origin,
 * and nowhere else.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import type { CheckResult } from "./checks/types.ts";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/);
const apiPath = z
  .string()
  .regex(/^\/[A-Za-z0-9._~\-/%]*$/, "a path starting with /, without a query");
const query = z.record(z.string(), z.string()).optional();
/** Dot path into a JSON reply, such as "data.company_id". Empty means the reply itself. */
const field = z.string().regex(/^[A-Za-z0-9_.]*$/);

export const VendorCheckSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("key"), id, intent: z.string().min(3).max(200) }),
  z.object({
    type: z.literal("fresh"),
    id,
    intent: z.string().min(3).max(200),
    path: apiPath,
    query,
    items: field,
    time: field,
    maxAgeSeconds: z.number().int().min(60).max(90 * 86400),
    /** Off by default in setup, for checks that only make sense for busy accounts. */
    optional: z.boolean().optional(),
  }),
]);

export const VendorSchema = z.object({
  id,
  label: z.string().min(1).max(60),
  detect: z.object({
    npm: z.array(z.string()).default([]),
    python: z.array(z.string()).default([]),
    envPrefix: z.string().regex(/^[A-Z][A-Z0-9_]*_$/).optional(),
  }),
  /** Vendors that need a sign-in flow Watch does not have yet. */
  signIn: z.literal("oauth").optional(),
  key: z
    .object({
      envNames: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).min(1),
      keyUrl: z.url(),
      auth: z.discriminatedUnion("type", [
        z.object({ type: z.literal("bearer") }),
        z.object({ type: z.literal("header"), name: z.string().regex(/^[A-Za-z0-9-]+$/) }),
        z.object({ type: z.literal("basic") }),
      ]),
      /** Extra fixed headers such as an API version. Never a secret. */
      headers: z.record(z.string(), z.string()).optional(),
      personal: z.boolean().optional(),
      /** A key matching this pattern can make changes; setup warns about it. */
      canWrite: z.string().optional(),
    })
    .optional(),
  api: z
    .object({
      origin: z.url().refine((u) => {
        const url = new URL(u);
        return url.protocol === "https:" && url.origin === u;
      }, "an https origin with no path"),
    })
    .optional(),
  keyCheck: z
    .object({
      path: apiPath,
      query,
      account: field.optional(),
      /** Tried in order when the main path answers 403, for keys restricted to fewer reads. */
      fallbacks: z.array(apiPath).optional(),
    })
    .optional(),
  checks: z.array(VendorCheckSchema).default([]),
  cadenceSeconds: z.number().int().min(60).max(86400).default(3600),
});
export type Vendor = z.infer<typeof VendorSchema>;
export type VendorCheck = z.infer<typeof VendorCheckSchema>;

export const validateVendor = (input: unknown): Vendor => {
  const vendor = VendorSchema.parse(input);
  if (vendor.signIn === undefined && (vendor.key === undefined || vendor.api === undefined))
    throw new Error("A vendor needs key, api and keyCheck, or signIn");
  if (vendor.key !== undefined && vendor.keyCheck === undefined)
    throw new Error("A vendor with a key needs a keyCheck");
  return vendor;
};

// A path, not a URL's pathname, which keeps %20 for a space and a leading slash before C: on Windows.
const catalogDir = fileURLToPath(new URL("../../catalog/", import.meta.url));

/** The shipped catalog plus approved local descriptions, local ones winning by id. */
export const loadCatalog = (extra: ReadonlyArray<unknown> = [], dir = catalogDir) => {
  const vendors = new Map<string, Vendor>();
  if (existsSync(dir))
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).toSorted()) {
      const vendor = validateVendor(JSON.parse(readFileSync(join(dir, file), "utf8")));
      vendors.set(vendor.id, vendor);
    }
  for (const description of extra) {
    try {
      const vendor = validateVendor(description);
      vendors.set(vendor.id, vendor);
    } catch {
      // A local description that no longer validates is skipped, not fatal.
    }
  }
  return vendors;
};

export const readField = (value: unknown, path: string): unknown =>
  path === ""
    ? value
    : path.split(".").reduce<unknown>(
        (current, part) =>
          current !== null && typeof current === "object"
            ? (current as Record<string, unknown>)[part]
            : undefined,
        value,
      );

/** Seconds since epoch from an ISO string, "YYYY-MM-DD HH:MM:SS" (UTC), or unix s/ms. */
export const parseTime = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value))
    return value > 1e12 ? value / 1000 : value;
  if (typeof value !== "string" || value === "") return null;
  if (/^\d+$/.test(value)) return parseTime(Number(value));
  const text = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms / 1000;
};

export interface VendorReply {
  readonly status: number;
  readonly body: unknown;
}

/** One GET to the vendor's API origin. Refuses any other host and any redirect. */
export const vendorGet = async (
  vendor: Vendor,
  key: string,
  path: string,
  params: Readonly<Record<string, string>> | undefined,
  fetchImpl: typeof fetch,
): Promise<VendorReply> => {
  if (vendor.api === undefined || vendor.key === undefined)
    throw new Error(`${vendor.label} has no API description`);
  const url = new URL(path, vendor.api.origin);
  if (url.origin !== vendor.api.origin) throw new Error("Refused a request outside the vendor's API");
  for (const [name, value] of Object.entries(params ?? {})) url.searchParams.set(name, value);
  const headers: Record<string, string> = { accept: "application/json", ...vendor.key.headers };
  const auth = vendor.key.auth;
  if (auth.type === "bearer") headers.authorization = `Bearer ${key}`;
  else if (auth.type === "header") headers[auth.name.toLowerCase()] = key;
  else headers.authorization = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, body };
};

const rejected = (status: number) => status === 401 || status === 403;

/** Proves a key works with the description's key check. */
export const runKeyCheck = async (
  vendor: Vendor,
  key: string,
  fetchImpl: typeof fetch,
): Promise<CheckResult & { account: string | null }> => {
  const keyCheck = vendor.keyCheck!;
  try {
    let reply = await vendorGet(vendor, key, keyCheck.path, keyCheck.query, fetchImpl);
    if (reply.status === 403)
      for (const path of keyCheck.fallbacks ?? []) {
        reply = await vendorGet(vendor, key, path, undefined, fetchImpl);
        if (reply.status < 300) break;
      }
    if (reply.status >= 200 && reply.status < 300) {
      const raw = keyCheck.account === undefined ? undefined : readField(reply.body, keyCheck.account);
      const account = raw === undefined || raw === null ? null : String(raw).slice(0, 120);
      return {
        outcome: "pass",
        summary: account === null ? `${vendor.label} accepts the key` : `${vendor.label} accepts the key for ${account}`,
        evidence: { status: reply.status },
        account,
      };
    }
    if (rejected(reply.status))
      return {
        outcome: "fail",
        summary: `${vendor.label} rejected the key (${reply.status})`,
        evidence: { status: reply.status },
        account: null,
      };
    return {
      outcome: "unknown",
      summary: `${vendor.label} answered ${reply.status}`,
      evidence: { status: reply.status },
      account: null,
    };
  } catch (error) {
    return { outcome: "unknown", summary: errorText(vendor, error), evidence: {}, account: null };
  }
};

/** Passes when the newest item in a list is younger than the check's maximum age. */
export const runFreshCheck = async (
  vendor: Vendor,
  check: Extract<VendorCheck, { type: "fresh" }>,
  key: string,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<CheckResult> => {
  try {
    const reply = await vendorGet(vendor, key, check.path, check.query, fetchImpl);
    if (rejected(reply.status))
      return {
        outcome: "fail",
        summary: `${vendor.label} rejected the key (${reply.status})`,
        evidence: { status: reply.status },
      };
    if (reply.status < 200 || reply.status >= 300)
      return { outcome: "unknown", summary: `${vendor.label} answered ${reply.status}`, evidence: { status: reply.status } };
    const items = readField(reply.body, check.items);
    if (!Array.isArray(items))
      return { outcome: "unknown", summary: `Could not read the list from ${vendor.label}`, evidence: {} };
    const times = items
      .map((item) => parseTime(readField(item, check.time)))
      .filter((t): t is number => t !== null);
    if (times.length === 0)
      return { outcome: "fail", summary: `${vendor.label} returned nothing recent`, evidence: { count: items.length } };
    const newest = Math.max(...times);
    const age = now.getTime() / 1000 - newest;
    const newestAt = new Date(newest * 1000).toISOString();
    return age <= check.maxAgeSeconds
      ? { outcome: "pass", summary: `Latest ${describeAge(age)} ago`, evidence: { newestAt } }
      : { outcome: "fail", summary: `Nothing new for ${describeAge(age)}`, evidence: { newestAt } };
  } catch (error) {
    return { outcome: "unknown", summary: errorText(vendor, error), evidence: {} };
  }
};

export const describeAge = (seconds: number) => {
  if (seconds < 90) return "a minute";
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 129600) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86400)} days`;
};

const errorText = (vendor: Vendor, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout/i.test(message)) return `${vendor.label} did not answer in time`;
  if (/Refused/.test(message)) return message;
  return `Could not reach ${vendor.label}`;
};
