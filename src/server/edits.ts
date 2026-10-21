/**
 * What the person changes on the page: a check's name, how often it runs and its settings, and
 * deleting or restoring it. A deleted check keeps its runs and changes, so it comes back as it was.
 */
import { z } from "zod";

import { type WatchCore, WatchError } from "./app.ts";
import { configSchemas } from "./checks/index.ts";
import { DraftCheckInput } from "./drafts.ts";
import type { Check, CheckKind } from "./store.ts";

// The same bounds an agent's draft has, so a check edits within what it could be drafted with.
const INTENT = DraftCheckInput.shape.intent;
const MINUTES = DraftCheckInput.shape.cadenceMinutes.unwrap();

const KIND_NAMES: Record<CheckKind, string> = {
  http: "an HTTP check",
  github: "a GitHub check",
  aws_metric: "an AWS metric check",
  heartbeat: "a heartbeat check",
  vendor: "a vendor check",
};

/** The checks the login choice in What Watch may read paused, which it resumes when the login comes back. */
export const PAUSED_BY_CHOICE = "pausedByChoice";

/** The settings as the kind's schema reads them, so key order and defaults never count as a change. */
const normalised = (check: Pick<Check, "kind" | "config">) => {
  const parsed = configSchemas[check.kind].safeParse(check.config);
  return JSON.stringify(parsed.success ? parsed.data : check.config);
};

/**
 * New settings for a check, checked against its kind: no field the kind lacks, a repository's own
 * check stays on that repository, a vendor check's settings never change, and a heartbeat keeps
 * its ping token, which the page never shows.
 */
const settingsFor = (check: Check, given: unknown): Record<string, unknown> => {
  if (typeof given !== "object" || given === null || Array.isArray(given)) throw new WatchError("Settings must be a JSON object");
  if (check.kind === "vendor")
    throw new WatchError("A vendor check's settings come from its vendor's description, so only its name and how often it runs change here.");
  // A kind from another build of Watch has no schema here to check its settings against.
  const schema = (configSchemas as Partial<typeof configSchemas>)[check.kind];
  if (schema === undefined) throw new WatchError(`This version of Watch cannot change the settings of a ${String(check.kind)} check.`, 409);
  const fields = Object.keys(schema.shape).filter((field) => !(check.kind === "heartbeat" && field === "token"));
  const { token: _, ...rest } = given as Record<string, unknown>;
  const settings = check.kind === "heartbeat" ? rest : (given as Record<string, unknown>);
  const unknown = Object.keys(settings).filter((field) => !fields.includes(field));
  if (unknown.length > 0)
    throw new WatchError(`${unknown.join(", ")} ${unknown.length === 1 ? "is not a setting" : "are not settings"} of ${KIND_NAMES[check.kind]}. It has ${fields.join(", ")}.`);
  const parsed = schema.safeParse(check.kind === "heartbeat" ? { ...settings, token: check.config.token } : settings);
  if (!parsed.success) throw new WatchError(`The settings are not valid for ${KIND_NAMES[check.kind]}: ${z.prettifyError(parsed.error)}`);
  const config = parsed.data as Record<string, unknown>;
  // A check stays on what it reads: another repository, or another AWS profile and so maybe another
  // account, is another service, which an agent drafts.
  const repo = String(check.config.repo ?? "");
  if (check.kind === "github" && String(config.repo).toLowerCase() !== repo.toLowerCase())
    throw new WatchError(`This check watches ${repo}. To watch another repository, ask the Watch thread to draft a check for it.`);
  const profile = check.config.profile === undefined ? null : String(check.config.profile);
  if (check.kind === "aws_metric" && (config.profile === undefined ? null : String(config.profile)) !== profile)
    throw new WatchError(
      `This check reads AWS through ${profile === null ? "the default profile" : `the profile ${profile}`}. To read through another, ask the Watch thread to draft a check for it.`,
    );
  return config;
};

/** As the page sends it; each part is checked here, so a missing one is refused, not assumed. */
export interface CheckEdit {
  readonly intent?: unknown;
  readonly cadenceMinutes?: unknown;
  /** The new settings; left out, they stay as they are. */
  readonly config?: unknown;
  /** The check's updatedAt when Edit opened, so a change made since is not overwritten unseen. */
  readonly updatedAt?: unknown;
}

/**
 * Changes a check that is on or paused, keeping its id and so its runs and changes. The edit marks
 * it the person's, which a rescan leaves alone, and one that is on runs at the next tick.
 */
export const editCheck = (watch: WatchCore, id: string, edit: CheckEdit) => {
  const check = watch.requireLiveCheck(id);
  if (check.state !== "on" && check.state !== "paused")
    throw new WatchError(check.state === "draft" ? "Turn the draft on or discard it on Home first." : "Turn the check on in the review first.", 409);
  // A rescan, another tab or an agent may have changed it since the form was filled in.
  if (edit.updatedAt !== check.updatedAt)
    throw new WatchError("This check changed after Edit opened. Close Edit and open it again to see it as it is now.", 409);
  const intent = typeof edit.intent === "string" ? edit.intent.trim() : "";
  if (!INTENT.safeParse(intent).success) throw new WatchError(`Name the check in ${INTENT.minLength} to ${INTENT.maxLength} characters`);
  // A cadence left as it was stays, even one that is not whole minutes, such as a vendor's 90 seconds.
  const minutes = edit.cadenceMinutes;
  const sameCadence = typeof minutes === "number" && Number.isFinite(minutes) && Math.round(minutes * 60) === check.cadenceSeconds;
  if (!sameCadence && !MINUTES.safeParse(minutes).success)
    throw new WatchError(`Run it every ${MINUTES.minValue} to ${MINUTES.maxValue} minutes, in whole minutes`);
  const config = edit.config === undefined ? check.config : settingsFor(check, edit.config);
  const cadenceSeconds = sameCadence ? check.cadenceSeconds : (minutes as number) * 60;
  const settingsChanged = edit.config !== undefined && normalised({ kind: check.kind, config }) !== normalised(check);
  const runsDifferently = settingsChanged || cadenceSeconds !== check.cadenceSeconds;
  if (intent === check.intent && !runsDifferently) return check;
  const { pending: _, ...rest } = check;
  watch.store.upsertCheck({
    ...rest,
    intent,
    config: settingsChanged ? config : check.config,
    cadenceSeconds,
    origin: "user",
    // One that is on runs at the next tick when it now runs differently, so the change shows within
    // seconds; a new name alone needs no run.
    nextRunAt: check.state === "on" && runsDifferently ? null : check.nextRunAt,
    updatedAt: watch.now(),
  });
  return watch.store.check(id)!;
};

/** Marks a check deleted: it stops running and leaves Home and the review, and keeps its history. */
export const deleteCheck = (watch: WatchCore, id: string) => {
  const check = watch.requireCheck(id);
  if (check.state === "deleted") return check;
  if (check.state === "draft") throw new WatchError("Discard a draft on Home instead.", 409);
  // A change it has not sent yet waits unsent: the alert queue leaves out a deleted check.
  watch.store.setCheckState(id, "deleted", watch.now());
  // Restored, it waits for the person, so turning its login back on no longer resumes it.
  const held = watch.store.getKv<Array<string>>(PAUSED_BY_CHOICE, []);
  if (held.includes(id)) watch.store.setKv(PAUSED_BY_CHOICE, held.filter((heldId) => heldId !== id));
  return watch.store.check(id)!;
};

/**
 * Brings a deleted check back paused, with its history, for the person to turn on. One already
 * back is left as it is, so a second press changes nothing.
 */
export const restoreCheck = (watch: WatchCore, id: string) => {
  const check = watch.requireCheck(id);
  if (check.state !== "deleted") return check;
  // Keys may have changed while it was deleted, which a rescan would have followed: a vendor check
  // whose key is gone takes the vendor's key, as a draft does.
  const keys = watch.store.keys();
  if (check.kind === "vendor" && !keys.some((k) => k.id === check.keyId)) {
    const key = keys.find((k) => k.vendor === check.config.vendor);
    if (key !== undefined) watch.defineCheck({ ...check, keyId: key.id }, check.state);
  }
  watch.store.setCheckState(id, "paused", watch.now());
  return watch.store.check(id)!;
};
