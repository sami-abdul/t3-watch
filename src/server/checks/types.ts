import type { Keyring } from "../keys.ts";
import type { Deps } from "../proc.ts";
import type { Check, Outcome, Store } from "../store.ts";
import type { Vendor } from "../vendors.ts";

export interface CheckResult {
  readonly outcome: Outcome;
  readonly summary: string;
  readonly evidence: Record<string, unknown>;
}
export interface CheckContext {
  readonly deps: Deps;
  readonly store: Store;
  readonly keyring: Keyring;
  readonly vendors: () => ReadonlyMap<string, Vendor>;
  /** Wait longer for an answer: the check's last run was held, so its link may still be slow. */
  readonly patient?: boolean;
}
export type CheckRunner = (check: Check, context: CheckContext) => Promise<CheckResult>;

export const unknown = (summary: string, evidence: Record<string, unknown> = {}): CheckResult => ({
  outcome: "unknown",
  summary,
  evidence,
});
