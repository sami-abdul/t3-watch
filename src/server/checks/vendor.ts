import { z } from "zod";

import { runFreshCheck, runKeyCheck } from "../vendors.ts";
import { type CheckRunner, unknown } from "./types.ts";

export const VendorCheckConfig = z.object({
  vendor: z.string(),
  /** The id of a check in the vendor's description. */
  check: z.string(),
});

export const runVendor: CheckRunner = async (check, { vendors, keyring, deps, store }) => {
  const parsed = VendorCheckConfig.safeParse(check.config);
  if (!parsed.success) return unknown("The check's settings are invalid");
  const vendor = vendors().get(parsed.data.vendor);
  if (vendor === undefined) return unknown(`No description for ${parsed.data.vendor}`);
  const definition = vendor.checks.find((c) => c.id === parsed.data.check);
  if (definition === undefined) return unknown(`${vendor.label} has no check ${parsed.data.check}`);
  const key = check.keyId === null ? null : keyring.reveal(check.keyId);
  if (key === null) return unknown(`Add a ${vendor.label} key`);
  if (definition.type === "key") {
    const result = await runKeyCheck(vendor, key, deps.fetch);
    if (result.outcome === "pass" && check.keyId !== null) store.setKeyAccount(check.keyId, result.account);
    return { outcome: result.outcome, summary: result.summary, evidence: result.evidence };
  }
  return runFreshCheck(vendor, definition, key, deps.fetch, deps.now());
};
