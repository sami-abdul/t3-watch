import { useMemo, useState } from "react";

import { HELD_NOTICE, PROBES_DISAGREE_NOTICE, SLOW_NOTICE } from "../server/notices.ts";
import { pendingText } from "../server/pending.ts";
import type { CheckView, WatchState } from "../server/state.ts";
import type { WatchClient } from "./client.ts";
import { typeClass } from "~/fluid/lib/type-scale";
import { Button } from "~/fluid/ui/button";
import { cn } from "~/lib/utils";
import { ago, alertsNotice, askAbout, homeModel, joinParts, newChecksToReview, productGroups, productSummary } from "./logic.ts";
import { Heading, Muted, outcomeTone, RowList, Section } from "./ui.tsx";

const tomorrow = (now: Date) => new Date(now.getTime() + 24 * 3600 * 1000).toISOString();

export function Home({
  client,
  state,
  refresh,
  onAddServices,
  onDetails,
  onReview,
}: {
  readonly client: WatchClient;
  readonly state: WatchState;
  readonly refresh: () => void;
  readonly onAddServices: () => void;
  /** Opens Details, scrolled to a section when one is named. */
  readonly onDetails: (focus?: "alerts") => void;
  /** Opens the review of the latest scan. */
  readonly onReview: () => void;
}) {
  // Worked out once per state, not on every press or notice.
  const { model, alertsNote, products, toReview } = useMemo(
    () => ({ model: homeModel(state), alertsNote: alertsNotice(state), products: productGroups(state), toReview: newChecksToReview(state) }),
    [state],
  );
  const now = new Date(state.generatedAt);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showChecks, setShowChecks] = useState(false);
  const lastRun = state.checks.map((c) => c.lastRunAt).filter((t): t is string => t !== null).toSorted().at(-1) ?? null;
  const unreachable = state.services.filter((s) => !s.reachable);

  const act = async (id: string, work: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await work();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const checkActions = (check: CheckView) => (
    <>
      <Button size="compact" variant="ghost" loading={busy === `run:${check.id}`} onClick={() => act(`run:${check.id}`, () => client.setCheck(check.id, "run"))}>
        Run now
      </Button>
      <Button size="compact" variant="ghost" onClick={() => act(`snooze:${check.id}`, () => client.setCheck(check.id, "snooze", tomorrow(now)))}>
        Snooze a day
      </Button>
      <Button
        size="compact"
        variant="secondary"
        onClick={async () => setNotice(await client.ask(askAbout(check)))}
      >
        Ask why
      </Button>
    </>
  );
  const problemRows = (checks: ReadonlyArray<CheckView>) =>
    checks.map((check) => ({
      key: check.id,
      title: `${check.serviceLabel}: ${check.intent}`,
      detail: joinParts(check.lastSummary, check.note === null ? null : `Agent: ${check.note}`, `Checked ${ago(check.lastRunAt, now)}`),
      badge: outcomeTone[check.lastOutcome ?? "unknown"],
      action: checkActions(check),
    }));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Heading as="h1">{model.headline}</Heading>
        <Muted>
          {model.onCount} check{model.onCount === 1 ? "" : "s"} on · last run {ago(lastRun, now)}
          {model.paused.length > 0 ? ` · ${model.paused.length} paused` : ""}
        </Muted>
      </div>
      {state.link.offlineSince !== null ? (
        <Muted className="text-foreground">
          Watch lost its internet connection {ago(state.link.offlineSince, now)}. {HELD_NOTICE}
        </Muted>
      ) : null}
      {/* Truthy, not just set: a page newer than the service it talks to gets no such field. */}
      {state.link.slowSince ? (
        <Muted className="text-foreground">
          Watch's connection turned slow {ago(state.link.slowSince, now)}. {SLOW_NOTICE}
        </Muted>
      ) : null}
      {state.link.probesDisagree ? (
        <Muted className="text-foreground">
          {PROBES_DISAGREE_NOTICE}
        </Muted>
      ) : null}
      {alertsNote !== null ? (
        <div className="flex flex-wrap items-center gap-3">
          <Muted className="text-foreground">{alertsNote.text}</Muted>
          <Button size="compact" variant="secondary" onClick={() => onDetails("alerts")}>
            {alertsNote.button}
          </Button>
        </div>
      ) : null}
      {toReview > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Muted className="text-foreground">
            {toReview === 1 ? "1 new check to review" : `${toReview} new checks to review`}, from the last scan.
          </Muted>
          <Button size="compact" variant="secondary" onClick={onReview}>
            Review
          </Button>
        </div>
      ) : null}
      {notice !== null ? <Muted className="text-foreground">{notice}</Muted> : null}

      {model.failing.length > 0 ? (
        <Section title="Broken">
          <RowList label="Broken" rows={problemRows(model.failing)} />
        </Section>
      ) : null}

      {model.couldNotRun.length > 0 ? (
        <Section title="Could not run">
          <RowList label="Could not run" rows={problemRows(model.couldNotRun)} />
        </Section>
      ) : null}

      {model.drafts.length + state.vendorDrafts.length > 0 ? (
        <Section title="Waiting for you">
          <RowList
            label="Drafts"
            rows={[
              ...model.drafts.map((check) => ({
                key: check.id,
                title: `${check.serviceLabel}: ${check.intent}`,
                detail: `Written by the agent · ran once: ${check.lastSummary ?? "not yet"}`,
                badge: check.lastOutcome === null ? null : outcomeTone[check.lastOutcome],
                action: (
                  <>
                    <Button size="compact" variant="ghost" onClick={() => act(check.id, () => client.draft(check.id, "discard", "check"))}>
                      Discard
                    </Button>
                    <Button size="compact" loading={busy === check.id} onClick={() => act(check.id, () => client.draft(check.id, "approve", "check"))}>
                      Turn on
                    </Button>
                  </>
                ),
              })),
              ...state.vendorDrafts.map((draft) => ({
                key: draft.id,
                title: `New vendor: ${draft.label}`,
                detail: joinParts(draft.origin === null ? null : `Reads ${draft.origin}`, draft.testSummary ?? "Not tested yet"),
                action: (
                  <>
                    <Button size="compact" variant="ghost" onClick={() => act(draft.id, () => client.draft(draft.id, "discard", "vendor"))}>
                      Discard
                    </Button>
                    <Button size="compact" loading={busy === draft.id} onClick={() => act(draft.id, () => client.draft(draft.id, "approve", "vendor"))}>
                      Add vendor
                    </Button>
                  </>
                ),
              })),
            ]}
          />
        </Section>
      ) : null}

      {products.length > 0 ? (
        <Section
          title={`${products.length} product${products.length === 1 ? "" : "s"}`}
          aside={
            <Button size="compact" variant="ghost" onClick={() => setShowChecks(!showChecks)}>
              {showChecks ? "Hide checks" : "Show checks"}
            </Button>
          }
        >
          {showChecks ? (
            <div className="space-y-4">
              {products.map((product) => {
                // Failing and unrunnable checks are listed under Broken and Could not run, with their actions.
                const shown = product.checks.filter((c) => c.lastOutcome !== "fail" && c.lastOutcome !== "unknown");
                return (
                  <div key={product.key} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3 px-1">
                      <span className={cn("text-foreground", typeClass("body"))}>{product.label}</span>
                      <span className={cn("text-muted-foreground", typeClass("caption"))}>{productSummary(product)}</span>
                    </div>
                    {shown.length > 0 ? (
                      <RowList
                        label={product.label}
                        rows={shown.map((check) => ({
                          key: check.id,
                          title: check.intent,
                          detail: joinParts(
                            // A product made of several services says which one each check watches.
                            product.mixed ? check.serviceLabel : null,
                            check.pending !== null ? `${pendingText(check.pending.outcome)}: ${check.pending.summary}` : (check.lastSummary ?? "Waiting for its first run"),
                            ago(check.pending?.at ?? check.lastRunAt, now),
                          ),
                          badge: check.lastOutcome === null ? null : outcomeTone[check.lastOutcome],
                        }))}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            // Each product at a glance, problems first, so a failing one shows without pressing anything.
            <RowList
              label="Products"
              rows={products.map((product) => ({
                key: product.key,
                title: product.label,
                detail: productSummary(product),
                badge: product.worst === null ? null : outcomeTone[product.worst],
              }))}
            />
          )}
        </Section>
      ) : null}

      {unreachable.length > 0 ? (
        <Muted className={typeClass("caption")}>
          Watch can't reach {unreachable.map((s) => s.label).join(", ")}. Add services to connect them.
        </Muted>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onAddServices}>
          Add services
        </Button>
        <Button variant="ghost" onClick={() => onDetails()}>
          Details
        </Button>
      </div>
    </div>
  );
}
