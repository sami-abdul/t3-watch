import { useEffect, useState } from "react";

import type { Run } from "../server/store.ts";
import type { CheckView, WatchState } from "../server/state.ts";
import type { WatchClient } from "./client.ts";
import { typeClass } from "~/fluid/lib/type-scale";
import { Button } from "~/fluid/ui/button";
import { cn } from "~/lib/utils";
import { ago } from "./logic.ts";
import { Heading, Muted, outcomeTone, RowList, Section, type Tone } from "./ui.tsx";

const stateTone: Record<string, Tone> = {
  on: { color: "green", label: "On" },
  paused: { color: "gray", label: "Paused" },
  off: { color: "gray", label: "Off" },
  proposed: { color: "blue", label: "Suggested" },
  draft: { color: "violet", label: "Draft" },
};

const cadence = (seconds: number) =>
  seconds % 3600 === 0 ? `every ${seconds / 3600} h` : `every ${Math.round(seconds / 60)} min`;

function Runs({ client, check }: { readonly client: WatchClient; readonly check: CheckView }) {
  const [runs, setRuns] = useState<ReadonlyArray<Run> | null>(null);
  if (runs === null)
    return (
      <Button size="compact" variant="ghost" onClick={async () => setRuns(await client.runs(check.id))}>
        History
      </Button>
    );
  return (
    <span className={cn("block w-full text-muted-foreground", typeClass("caption"))}>
      {runs.length === 0
        ? "No runs yet"
        : runs.slice(0, 8).map((run) => (
            <span key={run.id} className="block">
              {new Date(run.at).toLocaleString()} · {outcomeTone[run.outcome].label} · {run.summary}
            </span>
          ))}
    </span>
  );
}

export function Details({
  client,
  state,
  refresh,
  onBack,
}: {
  readonly client: WatchClient;
  readonly state: WatchState;
  readonly refresh: () => void;
  readonly onBack: () => void;
}) {
  const now = new Date(state.generatedAt);
  const [error, setError] = useState<string | null>(null);
  const [roots, setRoots] = useState<string | null>(null);
  const [configured, setConfigured] = useState<ReadonlyArray<string> | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [makingSecret, setMakingSecret] = useState(false);
  // Replacing a secret while alerts are on stops them until the T3 task has the new one.
  const [confirmReplace, setConfirmReplace] = useState(false);
  const alertsOn = state.alerts.url !== null && state.alerts.signed;
  // Reset rather than hide, so the prompt is not already armed when alerts come back.
  useEffect(() => {
    if (!alertsOn) setConfirmReplace(false);
  }, [alertsOn]);
  const replacing = confirmReplace && alertsOn;
  const [rootsError, setRootsError] = useState<string | null>(null);
  // Tries again on every refresh until the folder list loads.
  useEffect(() => {
    if (configured !== null) return;
    client.roots?.().then(
      (list) => {
        setConfigured(list);
        setRootsError(null);
      },
      (e: unknown) => setRootsError(e instanceof Error ? e.message : String(e)),
    );
  }, [client, configured, state.generatedAt]);
  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      refresh();
    }
  };
  const actions = (check: CheckView) => {
    const snoozed = check.snoozedUntil !== null && Date.parse(check.snoozedUntil) > now.getTime();
    return (
      <>
        <Runs client={client} check={check} />
        {check.state === "on" && !snoozed ? (
          <Button size="compact" variant="ghost" onClick={() => act(() => client.setCheck(check.id, "pause"))}>
            Pause
          </Button>
        ) : null}
        {snoozed ? (
          <Button size="compact" variant="ghost" onClick={() => act(() => client.setCheck(check.id, "resume"))}>
            Resume
          </Button>
        ) : null}
        {check.state !== "on" && check.state !== "draft" ? (
          <Button size="compact" variant="secondary" onClick={() => act(() => client.setCheck(check.id, "on"))}>
            Turn on
          </Button>
        ) : null}
        <Button size="compact" variant="ghost" onClick={() => act(() => client.setCheck(check.id, "run"))}>
          Run now
        </Button>
      </>
    );
  };
  const order = ["on", "draft", "paused", "proposed", "off"];
  const checks = state.checks.toSorted((a, b) => order.indexOf(a.state) - order.indexOf(b.state));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Heading as="h1">Details</Heading>
        <Button variant="ghost" onClick={onBack}>
          Back to Home
        </Button>
      </div>
      {error !== null ? <Muted className="text-destructive">{error}</Muted> : null}

      <Section title={`Checks (${checks.length})`}>
        <RowList
          label="Checks"
          rows={checks.map((check) => {
            const snoozed = check.snoozedUntil !== null && Date.parse(check.snoozedUntil) > now.getTime();
            return {
              key: check.id,
              title: `${check.serviceLabel}: ${check.intent}`,
              detail: [
                snoozed ? `Snoozed until ${new Date(check.snoozedUntil!).toLocaleString()}` : null,
                `${check.kind} · ${cadence(check.cadenceSeconds)}`,
                check.lastSummary === null ? "Not run yet" : `${check.lastSummary} · ${ago(check.lastRunAt, now)}`,
                check.pingPath === null ? null : `Ping ${location.origin}${check.pingPath} from the job (add ?status=fail on failure)`,
              ]
                .filter(Boolean)
                .join(" · "),
              badge: stateTone[check.state] ?? null,
              action: actions(check),
            };
          })}
        />
      </Section>

      <Section title={`Keys (${state.keys.length})`}>
        {state.keys.length === 0 ? (
          <Muted>No keys stored. Logins such as gh and AWS profiles stay where they are.</Muted>
        ) : (
          <RowList
            label="Keys"
            rows={state.keys.map((key) => ({
              key: key.id,
              title: key.label,
              detail: [key.source, `ends ${key.last4}`, key.account === null ? null : `account ${key.account}`].filter(Boolean).join(" · "),
              action:
                client.removeKey === null ? null : (
                  <Button size="compact" variant="ghost" onClick={() => act(() => client.removeKey!(key.id))}>
                    Remove
                  </Button>
                ),
            }))}
          />
        )}
      </Section>

      <Section title="Alerts">
        <Muted>
          {state.alerts.url !== null
            ? `Changes go to ${state.alerts.url}, ${state.alerts.signed ? "signed" : "not signed"}.`
            : client.makeAlertSecret === null
              ? "Off. Make a signing secret on the Watch page, then ask the Watch thread to set up alerts."
              : state.alerts.signed
                ? "Off. A signing secret is ready: ask your Watch thread to set up alerts and paste the secret into the card it shows."
                : "Off. Make a signing secret, then ask your Watch thread to set up alerts. It creates a T3 webhook task and asks you to paste the secret into a private card."}
        </Muted>
        {client.makeAlertSecret === null ? null : secret !== null ? (
          <div className="space-y-2">
            <code className={cn("block select-all break-all rounded-lg border border-border p-3 font-mono text-foreground", typeClass("caption"))}>
              {secret}
            </code>
            <Muted className={typeClass("caption")}>
              Paste this into the card your Watch thread shows. It is shown once. Watch signs every alert with it from now on,
              and the T3 task refuses alerts until it has the same secret.
            </Muted>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="compact"
              variant="secondary"
              loading={makingSecret}
              onClick={async () => {
                if (alertsOn && !replacing) {
                  setConfirmReplace(true);
                  return;
                }
                setMakingSecret(true);
                await act(async () => setSecret(await client.makeAlertSecret!()));
                setMakingSecret(false);
                setConfirmReplace(false);
              }}
            >
              {replacing ? "Replace the secret" : state.alerts.signed ? "Make a new signing secret" : "Make a signing secret"}
            </Button>
            {replacing ? (
              <Button size="compact" variant="ghost" onClick={() => setConfirmReplace(false)}>
                Cancel
              </Button>
            ) : null}
            {state.alerts.signed ? (
              <Muted className={typeClass("caption")}>
                {replacing
                  ? "Alerts stop reaching your Watch thread until its T3 task has the new secret."
                  : "Replaces the current secret. Alerts fail until the T3 task has the new one."}
              </Muted>
            ) : null}
          </div>
        )}
      </Section>

      <Section title="Recent changes">
        {state.events.length === 0 ? (
          <Muted>No check has changed state yet.</Muted>
        ) : (
          <RowList
            label="Recent changes"
            rows={state.events.map((event) => ({
              key: String(event.id),
              title: `${state.checks.find((c) => c.id === event.checkId)?.intent ?? event.checkId}`,
              detail: `${new Date(event.at).toLocaleString()} · ${event.summary}${event.deliveredAt === null ? "" : " · sent to the Watch thread"}`,
              badge: outcomeTone[event.to],
            }))}
          />
        )}
      </Section>

      {client.saveRoots !== null ? (
        <Section title="Folders to scan">
          <textarea
            className={cn("w-full rounded-lg border border-border bg-transparent p-3 font-mono text-foreground", typeClass("caption"))}
            rows={3}
            // Never the last scan's folders: saving those would overwrite a config this page never read.
            value={roots ?? configured?.join("\n") ?? ""}
            placeholder={configured === null ? (rootsError === null ? "Loading…" : "") : undefined}
            disabled={configured === null}
            onChange={(e) => setRoots(e.target.value)}
          />
          {rootsError !== null ? <Muted className="text-destructive">Could not read the folder list: {rootsError}</Muted> : null}
          <Button
            size="compact"
            variant="secondary"
            disabled={roots === null || configured === null}
            onClick={() =>
              act(async () => {
                const list = (roots ?? "").split("\n").map((r) => r.trim()).filter(Boolean);
                await client.saveRoots!(list);
                setConfigured(list);
                setRoots(null);
              })
            }
          >
            Save folders
          </Button>
        </Section>
      ) : null}
    </div>
  );
}
