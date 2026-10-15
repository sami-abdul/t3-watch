/**
 * What agents write. A drafted check is validated and run once, then waits for a person to turn
 * it on. A drafted vendor description is validated and, when a key exists, its key check runs.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { type WatchCore, WatchError } from "./app.ts";
import { configSchemas } from "./checks/index.ts";
import type { CheckKind } from "./store.ts";
import { runKeyCheck, validateVendor } from "./vendors.ts";

const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";

export const DraftCheckInput = z.object({
  /** An existing service id, or a name for a new one. */
  service: z.string().min(1).max(120),
  kind: z.enum(["http", "github", "aws_metric", "heartbeat", "vendor"]),
  intent: z.string().min(3).max(200),
  config: z.record(z.string(), z.unknown()),
  cadenceMinutes: z.number().int().min(1).max(1440).default(15),
});

export const draftCheck = async (watch: WatchCore, raw: z.input<typeof DraftCheckInput>) => {
  const input = DraftCheckInput.parse(raw);
  const kind = input.kind as CheckKind;
  const config: Record<string, unknown> = { ...input.config };
  // Heartbeat URLs carry a fresh secret the agent never chooses.
  if (kind === "heartbeat") config.token = randomBytes(16).toString("base64url");
  const parsed = configSchemas[kind].safeParse(config);
  if (!parsed.success)
    throw new WatchError(`The ${kind} settings are invalid: ${z.prettifyError(parsed.error)}`);
  let keyId: string | null = null;
  if (kind === "vendor") {
    const vendorId = String(config.vendor);
    const vendor = watch.vendors().get(vendorId);
    const definition = vendor?.checks.find((c) => c.id === config.check);
    if (vendor === undefined || definition === undefined)
      throw new WatchError(`No check ${String(config.check)} in the ${vendorId} description`);
    keyId = watch.store.keys().find((k) => k.vendor === vendorId)?.id ?? null;
    if (keyId === null) throw new WatchError(`Add a ${vendor.label} key on the page first`);
  }
  const existing = watch.store.service(input.service);
  const serviceId = existing?.id ?? `custom:${slug(input.service)}`;
  if (existing === null)
    watch.upsertService({ id: serviceId, vendor: "custom", label: input.service, target: null, reachable: true, note: null, foundIn: ["Added by the agent"] });
  const id = `${serviceId}:${slug(input.intent)}`;
  if (watch.store.check(id) !== null) throw new WatchError(`A check ${id} already exists`);
  const check = watch.defineCheck(
    { id, serviceId, kind, intent: input.intent, config: parsed.data as Record<string, unknown>, keyId, cadenceSeconds: input.cadenceMinutes * 60, origin: "agent" },
    "draft",
  );
  const result = await watch.runner.trial(check);
  watch.store.setTrialResult(id, result.outcome, result.summary, watch.now());
  return { check: watch.store.check(id)!, result };
};

export const draftVendor = async (watch: WatchCore, description: unknown) => {
  let vendor;
  try {
    vendor = validateVendor(description);
  } catch (error) {
    const message = error instanceof z.ZodError ? z.prettifyError(error) : error instanceof Error ? error.message : String(error);
    throw new WatchError(`The description is invalid: ${message}`);
  }
  let testSummary = "Not tested: add a key for it on the page, then draft it again";
  if (vendor.keyCheck !== undefined) {
    const keyId = watch.store.keys().find((k) => k.vendor === vendor.id)?.id;
    const key = keyId === undefined ? null : watch.keyring.reveal(keyId);
    if (key !== null) {
      const result = await runKeyCheck(vendor, key, watch.deps.fetch);
      testSummary = `Key check: ${result.summary}`;
    }
  }
  const id = `vendor-${vendor.id}`;
  watch.store.upsertVendorDraft({ id, description: vendor as unknown as Record<string, unknown>, state: "draft", testSummary, createdAt: watch.now() });
  return { id, testSummary };
};

export const decideDraft = async (
  watch: WatchCore,
  kind: "check" | "vendor",
  id: string,
  decision: "approve" | "discard",
) => {
  if (kind === "check") {
    const check = watch.store.check(id);
    if (check === null || check.state !== "draft") throw new WatchError(`No draft check ${id}`, 404);
    if (decision === "approve") await watch.setCheck(id, "on");
    else watch.store.deleteCheck(id);
    return;
  }
  const draft = watch.store.vendorDrafts().find((d) => d.id === id && d.state === "draft");
  if (draft === undefined) throw new WatchError(`No draft vendor ${id}`, 404);
  if (decision === "approve") {
    watch.store.upsertVendorDraft({ ...draft, state: "approved" });
    watch.reloadCatalog();
  } else watch.store.deleteVendorDraft(id);
};

export const addNote = (watch: WatchCore, checkId: string | null, text: string) => {
  if (checkId !== null && watch.store.check(checkId) === null) throw new WatchError(`No check ${checkId}`, 404);
  const trimmed = text.trim().slice(0, 1000);
  if (trimmed === "") throw new WatchError("A note needs text");
  watch.store.addNote(checkId, trimmed, watch.now());
};
