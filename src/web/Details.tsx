import { useEffect, useState } from "react";

import type { Run } from "../server/store.ts";
import type { CheckView, WatchState } from "../server/state.ts";
import type { CheckEditInput, WatchClient } from "./client.ts";
import { typeClass } from "~/fluid/lib/type-scale";
import { Button } from "~/fluid/ui/button";
import { cn } from "~/lib/utils";
import { AlertsPanel } from "./Alerts.tsx";
import { ago, canDelete, canEdit, type EditForm, editFormOf, editOf, joinParts } from "./logic.ts";
import { Heading, Muted, outcomeTone, RowList, Section, type Tone } from "./ui.tsx";

const stateTone: Record<string, Tone> = {
  on: { color: "green", label: "On" },
  paused: { color: "gray", label: "Paused" },
  off: { color: "gray", label: "Off" },
  proposed: { color: "blue", label: "Suggested" },
  draft: { color: "violet", label: "Draft" },
};

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

/** Edit for one check: its name, how often it runs and its settings. Watch says what it refuses. */
function EditPanel({
  check,
  config,
  onSave,
  onCancel,
}: {
  readonly check: CheckView;
  /** The check's settings as stored, fetched when Edit was pressed. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly onSave: (edit: CheckEditInput) => Promise<void>;
  readonly onCancel: () => void;
}) {
  // Taken once, so a refresh while the person types leaves what they typed.
  const [form, setForm] = useState<EditForm>(() => editFormOf(check, config));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const parsed = editOf(form);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(parsed.edit);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const field = cn("w-full rounded-lg border border-border bg-transparent px-3 py-2 text-foreground", typeClass("body"));
  const label = cn("block text-muted-foreground", typeClass("caption"));
  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="space-y-0.5">
        <span className={cn("block text-foreground", typeClass("body"))}>
          {check.serviceLabel}: {check.intent}
        </span>
        <Muted className={typeClass("caption")}>{joinParts(check.target, check.cadence)}</Muted>
      </div>
      <label className="block space-y-1">
        <span className={label}>Name</span>
        <input className={field} value={form.intent} onChange={(e) => setForm({ ...form, intent: e.target.value })} />
      </label>
      <label className="block space-y-1">
        <span className={label}>Runs every, in minutes</span>
        <input className={cn(field, "max-w-40")} inputMode="numeric" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
      </label>
      {form.settings !== null ? (
        <label className="block space-y-1">
          <span className={label}>Settings, as JSON</span>
          <textarea
            className={cn(field, "font-mono", typeClass("caption"))}
            rows={Math.min(14, form.settings.split("\n").length + 1)}
            spellCheck={false}
            value={form.settings}
            onChange={(e) => setForm({ ...form, settings: e.target.value })}
          />
        </label>
      ) : (
        <Muted className={typeClass("caption")}>
          {check.kind === "vendor" ? "Its settings come from its vendor's description" : "This version of Watch cannot change this kind of check's settings"}, so
          only its name and how often it runs change here.
        </Muted>
      )}
      {check.kind === "heartbeat" ? <Muted className={typeClass("caption")}>Its ping address stays the same.</Muted> : null}
      {error !== null ? <Muted className="text-destructive">{error}</Muted> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button loading={saving} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}

export function Details({
  client,
  state,
  refresh,
  onBack,
  focus = null,
}: {
  readonly client: WatchClient;
  readonly state: WatchState;
  /** Reads the state again; the promise settles once the new state is in. */
  readonly refresh: () => void | Promise<void>;
  readonly onBack: () => void;
  /** A section to scroll to when Details opens, such as Alerts from Home's notice. */
  readonly focus?: "alerts" | null;
}) {
  const now = new Date(state.generatedAt);
  const [error, setError] = useState<string | null>(null);
  const [roots, setRoots] = useState<string | null>(null);
  const [configured, setConfigured] = useState<ReadonlyArray<string> | null>(null);
  useEffect(() => {
    if (focus !== null) document.getElementById(focus)?.scrollIntoView({ block: "start" });
  }, [focus]);
  const [rootsError, setRootsError] = useState<string | null>(null);
  // Tries again on every refresh until the folder list loads. A reply that arrives after a newer
  // request, or after a save, is ignored.
  useEffect(() => {
    if (configured !== null) return;
    let current = true;
    client.roots?.().then(
      (list) => {
        if (!current) return;
        setConfigured(list);
        setRootsError(null);
      },
      (e: unknown) => {
        if (current) setRootsError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      current = false;
    };
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
  // One check at a time is edited, from its settings as stored, or asked about before it is deleted.
  const [editing, setEditing] = useState<{ readonly id: string; readonly config: Readonly<Record<string, unknown>> } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Heartbeat ping addresses the person asked to see, which the state leaves out.
  const [pings, setPings] = useState<Readonly<Record<string, string>>>({});
  const editingCheck =
    editing === null || client.editCheck === null ? null : (state.checks.find((c) => c.id === editing.id && canEdit(c)) ?? null);
  // A check deleted or turned into something else meanwhile closes its form, or its question.
  const deletable = deleting !== null && state.checks.some((c) => c.id === deleting && canDelete(c));
  useEffect(() => {
    if (editing !== null && editingCheck === null) setEditing(null);
    if (deleting !== null && !deletable) setDeleting(null);
  }, [editing, editingCheck, deleting, deletable]);
  const actions = (check: CheckView) => {
    const snoozed = check.snoozedUntil !== null && Date.parse(check.snoozedUntil) > now.getTime();
    if (deleting === check.id && client.deleteCheck !== null)
      return (
        <>
          <Button size="compact" variant="ghost" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            size="compact"
            variant="secondary"
            onClick={() =>
              act(async () => {
                await client.deleteCheck!(check.id);
                setDeleting(null);
              })
            }
          >
            Delete it
          </Button>
        </>
      );
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
        {check.kind === "heartbeat" && client.checkSettings !== null && pings[check.id] === undefined ? (
          <Button
            size="compact"
            variant="ghost"
            onClick={() =>
              act(async () => {
                const { pingPath } = await client.checkSettings!(check.id);
                if (pingPath !== null) setPings((shown) => ({ ...shown, [check.id]: pingPath }));
              })
            }
          >
            Ping address
          </Button>
        ) : null}
        {client.editCheck !== null && client.checkSettings !== null && canEdit(check) ? (
          <Button
            size="compact"
            variant="ghost"
            onClick={() =>
              act(async () => {
                setDeleting(null);
                setEditing({ id: check.id, config: (await client.checkSettings!(check.id)).config });
              })
            }
          >
            Edit
          </Button>
        ) : null}
        {client.deleteCheck !== null && canDelete(check) ? (
          <Button size="compact" variant="ghost" onClick={() => setDeleting(check.id)}>
            Delete
          </Button>
        ) : null}
      </>
    );
  };
  const order = ["on", "draft", "paused", "proposed", "off"];
  const checks = state.checks.filter((c) => c.state !== "deleted").toSorted((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  const deleted = state.checks.filter((c) => c.state === "deleted").toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Heading as="h1">Details</Heading>
        <Button variant="ghost" onClick={onBack}>
          Back to Home
        </Button>
      </div>
      {error !== null ? <Muted className="text-destructive">{error}</Muted> : null}

      <Section title={editingCheck !== null ? "Edit check" : `Checks (${checks.length})`}>
        {editingCheck !== null ? (
          <EditPanel
            key={editingCheck.id}
            check={editingCheck}
            config={editing!.config}
            onCancel={() => setEditing(null)}
            onSave={async (edit) => {
              await client.editCheck!(editingCheck.id, edit);
              // The list it returns to shows the edit, so Edit opened again starts from it.
              await refresh();
              setEditing(null);
            }}
          />
        ) : (
          <RowList
            label="Checks"
            rows={checks.map((check) => {
              const snoozed = check.snoozedUntil !== null && Date.parse(check.snoozedUntil) > now.getTime();
              return {
                key: check.id,
                title: `${check.serviceLabel}: ${check.intent}`,
                detail:
                  deleting === check.id
                    ? "Delete this check? It stops running and leaves Home. Its runs and changes stay, and Restore under Deleted checks brings it back."
                    : joinParts(
                        snoozed ? `Snoozed until ${new Date(check.snoozedUntil!).toLocaleString()}` : null,
                        check.target,
                        check.cadence,
                        check.lastSummary === null ? "Not run yet" : `${check.lastSummary} · ${ago(check.lastRunAt, now)}`,
                        check.kind !== "heartbeat"
                          ? null
                          : pings[check.id] !== undefined
                            ? `Ping ${location.origin}${pings[check.id]} from the job (add ?status=fail on failure)`
                            : client.checkSettings === null
                              ? "Its ping address shows on the Watch page"
                              : null,
                      ),
                badge: stateTone[check.state] ?? null,
                action: actions(check),
              };
            })}
          />
        )}
      </Section>

      {deleted.length > 0 ? (
        <Section title={`Deleted checks (${deleted.length})`}>
          <Muted className={typeClass("caption")}>
            These no longer run. Each keeps its history{client.restoreCheck !== null ? ", and Restore brings it back paused" : ""}.
          </Muted>
          <RowList
            label="Deleted checks"
            rows={deleted.map((check) => ({
              key: check.id,
              title: `${check.serviceLabel}: ${check.intent}`,
              detail: joinParts(`Deleted ${ago(check.updatedAt, now)}`, check.target, check.lastSummary === null ? "Never ran" : `Last: ${check.lastSummary}`),
              action: (
                <>
                  <Runs client={client} check={check} />
                  {client.restoreCheck !== null ? (
                    <Button size="compact" variant="secondary" onClick={() => act(() => client.restoreCheck!(check.id))}>
                      Restore
                    </Button>
                  ) : null}
                </>
              ),
            }))}
          />
        </Section>
      ) : null}

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

      <AlertsPanel client={client} state={state} refresh={refresh} />

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
