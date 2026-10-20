/**
 * A run that did not pass, waiting for a second before its check fails. No runtime imports, so the
 * page can use the wording too.
 */
import type { Outcome } from "./store.ts";

export interface PendingRun {
  readonly outcome: Outcome;
  readonly summary: string;
  readonly at: string;
}

/** How a pending run reads in the history, the status and on the page. */
export const pendingText = (outcome: Outcome) =>
  outcome === "unknown" ? "Could not run once, checking again" : "Failed once, checking again";
