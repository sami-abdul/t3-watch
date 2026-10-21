import { useEffect, useState } from "react";

import type { Reads } from "../server/config.ts";
import type { FoundService, Scan } from "../server/scan.ts";
import type { SetupView, WatchClient } from "./client.ts";
import { typeClass } from "~/fluid/lib/type-scale";
import { Button } from "~/fluid/ui/button";
import { InputField, InputGroup } from "~/fluid/ui/input-group";
import { cn } from "~/lib/utils";
import {
  accessRows,
  applyPayload,
  checkAvailable,
  defaultTicks,
  isNewCheck,
  joinParts,
  reviewGroups,
  type Ticks,
  applyChanges,
  suggestionDetail,
  toggle,
  warningText,
  watchLabel,
} from "./logic.ts";
import { Heading, Muted, outcomeTone, RowList, Section, type Tone } from "./ui.tsx";

const accessTone: Record<string, Tone> = {
  works: { color: "green", label: "Works" },
  failed: { color: "red", label: "Not working" },
  expired: { color: "amber", label: "Expired" },
  removed: { color: "gray", label: "Removed" },
};

/**
 * What Watch may read: the folders and logins it would read, each a tick, saved before the scan.
 * In a chat the choice is shown, and changed on the page.
 */
export function Choose({
  client,
  firstRun,
  onScan,
  onCancel,
}: {
  readonly client: WatchClient;
  readonly firstRun: boolean;
  /** Called once the scan starts, with what the saved choice changed, if anything. */
  readonly onScan: (note: string | null) => void;
  readonly onCancel: (() => void) | null;
}) {
  const [view, setView] = useState<SetupView | null>(null);
  const [folders, setFolders] = useState<ReadonlyArray<string>>([]);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [reads, setReads] = useState<Reads | null>(null);
  const [adding, setAdding] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    client.setup().then(
      (next) => {
        if (!current) return;
        setView(next);
        // The service lists ticked and unticked folders alike, so an unticked one can come back.
        setFolders(next.sources.folders.map((f) => f.path));
        setTicked(new Set(next.choice.roots));
        setReads(next.choice.reads);
      },
      (e: unknown) => {
        if (current) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      current = false;
    };
  }, [client]);
  if (view === null || reads === null)
    return <Muted className={error === null ? undefined : "text-destructive"}>{error ?? "Looking at what Watch could read…"}</Muted>;

  const editable = client.saveChoice !== null;
  const known = new Map(view.sources.folders.map((f) => [f.path, f]));
  const addFolder = () => {
    const path = adding.trim().replace(/(.)\/+$/, "$1");
    if (!path.startsWith("/")) {
      setError("A folder is a full path, such as /home/you/code.");
      return;
    }
    setFolders(folders.includes(path) ? folders : [...folders, path]);
    setTicked(new Set([...ticked, path]));
    setAdding("");
    setError(null);
  };
  const scan = async () => {
    setStarting(true);
    setError(null);
    try {
      const changed =
        client.saveChoice === null
          ? null
          : await client.saveChoice({ roots: folders.filter((f) => ticked.has(f)), skippedRoots: folders.filter((f) => !ticked.has(f)), reads });
      await client.scan();
      const plural = (n: number) => `${n} check${n === 1 ? "" : "s"}`;
      onScan(
        [
          changed !== null && changed.paused > 0 ? `Paused ${plural(changed.paused)} that use${changed.paused === 1 ? "s" : ""} a login you turned off.` : null,
          changed !== null && changed.resumed > 0 ? `Resumed ${plural(changed.resumed)} that use${changed.resumed === 1 ? "s" : ""} a login you turned back on.` : null,
        ]
          .filter(Boolean)
          .join(" ") || null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  };
  // Without ticks in a chat, say plainly what Watch leaves alone.
  const off = (allowed: boolean): Tone | null => (editable || allowed ? null : { color: "gray", label: "Not read" });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Heading as="h1">{firstRun ? "Watch keeps an eye on everything you run" : "What Watch may read"}</Heading>
        <Muted>
          {firstRun
            ? "First, choose what Watch may read. From what you tick it finds the services you depend on and suggests checks. It only reads, and keys stay on this machine."
            : "Watch reads only what is ticked. A scan finds new services and suggests checks for them."}
        </Muted>
      </div>
      <Section title="Folders">
        <RowList
          label="Folders"
          rows={folders.map((path) => {
            const folder = known.get(path);
            return {
              key: path,
              title: path,
              detail:
                folder === undefined
                  ? "Added. Watch looks inside when it scans."
                  : !folder.exists
                    ? "Not found on this machine"
                    : `${folder.repositories} git ${folder.repositories === 1 ? "repository" : "repositories"}`,
              checked: ticked.has(path),
              onToggle: editable ? () => setTicked(toggle(ticked, path)) : null,
              badge: off(ticked.has(path)),
            };
          })}
        />
        {editable ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-80 max-w-full">
              <InputGroup size="compact">
                <InputField index={0} label="Another folder" value={adding} onChange={setAdding} />
              </InputGroup>
            </div>
            <Button size="compact" variant="secondary" disabled={adding.trim() === ""} onClick={addFolder}>
              Add
            </Button>
          </div>
        ) : null}
      </Section>
      <Section title="Logins">
        <RowList
          label="Logins"
          rows={view.sources.logins.map((login) => ({
            key: login.id,
            title: login.label,
            detail: !reads[login.id]
              ? // Turning GitHub or AWS off pauses the checks that use it; .env keys already stored stay.
                login.id === "envFiles"
                ? "Watch opens no .env file. Keys it stored before stay until you remove them in Details."
                : `${login.available === null ? "Turned off." : login.detail} Checks that use it pause while it is off.`
              : login.available === null
                ? "Watch looks for it when it scans."
                : login.detail,
            checked: reads[login.id],
            onToggle: editable ? () => setReads({ ...reads, [login.id]: !reads[login.id] }) : null,
            badge: off(reads[login.id]),
          }))}
        />
      </Section>
      {!editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <Muted className={typeClass("caption")}>What Watch may read is changed on the Watch page.</Muted>
          {client.openPage !== null ? (
            <Button size="compact" variant="secondary" onClick={client.openPage}>
              Open the page
            </Button>
          ) : null}
        </div>
      ) : null}
      {error !== null ? <Muted className="text-destructive">{error}</Muted> : null}
      <div className="flex flex-wrap gap-2">
        {/* A chat cannot make the first choice, and a new install does not scan without one. */}
        {editable || view.choice.chosen || !firstRun ? (
          <Button loading={starting} onClick={scan}>
            {editable ? "Scan these" : "Scan"}
          </Button>
        ) : null}
        {onCancel !== null ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function Scanning({ step }: { readonly step: string | null }) {
  // Plain text, no spinner: the step line changes as the scan moves, which is the progress.
  return (
    <div className="space-y-2">
      <Heading as="h1">Setting up Watch</Heading>
      <Muted>{step ?? "Starting"}…</Muted>
      <Muted className={typeClass("caption")}>This takes about half a minute.</Muted>
    </div>
  );
}

function AddKey({
  client,
  service,
  onAdded,
}: {
  readonly client: WatchClient;
  readonly service: FoundService;
  readonly onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const addKey = service.addKey!;
  if (client.addKey === null)
    return (
      <Button size="compact" variant="secondary" onClick={() => client.openPage?.()}>
        Add key on the page
      </Button>
    );
  if (!open)
    return (
      <span className="flex flex-col items-end gap-1">
        {message !== null ? <span className={cn("text-muted-foreground", typeClass("caption"))}>{message.text}</span> : null}
        <Button size="compact" variant="secondary" onClick={() => setOpen(true)}>
          Add key
        </Button>
      </span>
    );
  const save = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const result = await client.addKey!(addKey.vendor, value);
      if (result.ok) {
        setValue("");
        setOpen(false);
        setMessage({ text: `${result.summary}. Finding checks…`, failed: false });
        onAdded();
      } else setMessage({ text: `${result.summary}. Check it and try again.`, failed: true });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), failed: true });
    } finally {
      setTesting(false);
    }
  };
  return (
    <span className="flex w-72 flex-col gap-2">
      <InputGroup size="compact">
        <InputField
          index={0}
          label={`${service.label} key`}
          type="password"
          autoComplete="off"
          value={value}
          onChange={setValue}
          {...(message?.failed ? { error: message.text } : {})}
        />
      </InputGroup>
      <span className="flex items-center justify-between gap-2">
        <a className={cn("text-muted-foreground underline", typeClass("caption"))} href={addKey.keyUrl} target="_blank" rel="noreferrer">
          Where to get one
        </a>
        <span className="flex gap-1.5">
          <Button size="compact" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="compact" loading={testing} disabled={value.trim().length < 8} onClick={save}>
            Test and save
          </Button>
        </span>
      </span>
    </span>
  );
}

export function Review({
  client,
  scan,
  onApplied,
  onRescan,
  onChoose,
  onBack,
}: {
  readonly client: WatchClient;
  readonly scan: Scan;
  /** Called once applied, with what failed, if anything, for the next screen to show. */
  readonly onApplied: (failures: string | null) => void;
  /** Scans again at once with the saved choice, as after a key is added. */
  readonly onRescan: () => void;
  /** Shows what Watch may read before scanning again. */
  readonly onChoose: () => void;
  /** Back to Home without applying, when the review was opened from there. */
  readonly onBack: (() => void) | null;
}) {
  const [ticks, setTicks] = useState<Ticks>(() => defaultTicks(scan));
  const [applying, setApplying] = useState(false);
  // What Watch these will apply and the changes it listed, held while the list is open, so the list
  // stays what the person saw even as the state refreshes behind it.
  const [confirming, setConfirming] = useState<{ readonly payload: ReturnType<typeof applyPayload>; readonly changes: ReturnType<typeof applyChanges> } | null>(null);
  // Changing a tick closes the list: it showed the ticks as they were.
  const changeTicks = (next: Ticks) => {
    setTicks(next);
    setConfirming(null);
  };
  const [error, setError] = useState<string | null>(null);
  const groups = reviewGroups(scan);
  const payload = applyPayload(scan, ticks);
  const apply = async (chosen: ReturnType<typeof applyPayload>) => {
    setApplying(true);
    setError(null);
    try {
      const result = await client.apply(chosen);
      onApplied(result.failures.length > 0 ? result.failures.map((f) => f.message).join(". ") : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };
  const ready = scan.services.filter((s) => s.reachable).length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Heading as="h1">
          Found {scan.services.length} service{scan.services.length === 1 ? "" : "s"}. {ready} {ready === 1 ? "is" : "are"} ready.
        </Heading>
        <Muted>
          Read {scan.repositories} repositor{scan.repositories === 1 ? "y" : "ies"} under {scan.roots.join(", ") || "no folders"}. Each
          check below has already run once.
        </Muted>
      </div>

      <Section title="Access">
        <RowList
          label="Access"
          rows={accessRows(groups.ready).map((row) => ({
            key: row.accessKey,
            title: row.service,
            detail: [row.source, row.detail, ...row.warnings.map((w) => warningText[w])].filter(Boolean).join(" · "),
            badge: accessTone[row.status] ?? null,
            ...(row.removable
              ? { checked: ticks.access.has(row.accessKey), onToggle: () => changeTicks({ ...ticks, access: toggle(ticks.access, row.accessKey) }) }
              : {}),
          }))}
        />
      </Section>

      {groups.unreachable.length > 0 ? (
        <Section title="Found, but Watch can't reach them">
          <RowList
            label="Not reachable"
            rows={groups.unreachable.map((service) => ({
              key: service.serviceId,
              title: service.label,
              detail: [service.note, `Found in ${service.foundIn.slice(0, 2).join(", ")}`, ...service.access.map((a) => `${a.source}: ${a.detail ?? a.status}`)]
                .filter(Boolean)
                .join(" · "),
              action: service.addKey !== null ? <AddKey client={client} service={service} onAdded={onRescan} /> : null,
            }))}
          />
        </Section>
      ) : null}

      <Section title="What Watch will check">
        {scan.suggestions.length === 0 ? (
          <Muted>Nothing to check yet. Add a key above, or ask the Watch thread to write a check.</Muted>
        ) : (
          <RowList
            label="Checks"
            rows={scan.suggestions.map((s) => {
              const available = checkAvailable(scan, ticks, s.checkId);
              return {
                key: s.checkId,
                title: `${s.title}: ${s.intent}`,
                // New since the last review, so the checks Home counted are easy to find.
                detail: joinParts(isNewCheck(scan, s) ? "New" : null, available ? suggestionDetail(s, `Ran once: ${s.summary}`) : "Needs the key you unticked"),
                badge: outcomeTone[s.outcome],
                checked: available && ticks.checks.has(s.checkId),
                onToggle: available ? () => changeTicks({ ...ticks, checks: toggle(ticks.checks, s.checkId) }) : null,
              };
            })}
          />
        )}
        {groups.quiet.length > 0 ? (
          <Muted className={typeClass("caption")}>
            {groups.quiet.length} more repositor{groups.quiet.length === 1 ? "y has" : "ies have"} no GitHub Actions runs yet:{" "}
            {groups.quiet.map((s) => s.label).join(", ")}.
          </Muted>
        ) : null}
      </Section>

      {confirming !== null ? (
        (() => {
          const changes = confirming.changes;
          const onlyTurnOn = changes.pause.length === 0 && changes.removeKeys.length === 0;
          const n = changes.turnOn.length;
          return (
            <Section title={onlyTurnOn ? (n === 1 ? "Turn this check on?" : `Turn these ${n} checks on?`) : "Apply these changes?"}>
              {changes.turnOn.length > 0 ? (
                <>
                  <Muted className={typeClass("caption")}>
                    {onlyTurnOn ? (n === 1 ? "It runs" : "Each runs") : "These turn on and each runs"} on its own, as often as shown, until you pause it.
                  </Muted>
                  <RowList label="Checks to turn on" rows={changes.turnOn} />
                </>
              ) : null}
              {changes.pause.length > 0 ? (
                <>
                  <Muted className={typeClass("caption")}>Unticked, so these stop running until you turn them back on.</Muted>
                  <RowList label="Checks to pause" rows={changes.pause} />
                </>
              ) : null}
              {changes.removeKeys.length > 0 ? (
                <>
                  <Muted className={typeClass("caption")}>Unticked, so Watch deletes these keys and checks that need them stop.</Muted>
                  <RowList label="Keys to remove" rows={changes.removeKeys} />
                </>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                {/* Backing out mid-apply would not stop it, so Back waits for the answer. */}
                <Button variant="ghost" disabled={applying} onClick={() => setConfirming(null)}>
                  Back
                </Button>
                <Button loading={applying} onClick={() => apply(confirming.payload)}>
                  {onlyTurnOn ? (n === 1 ? "Turn it on" : "Turn them on") : "Apply"}
                </Button>
              </div>
            </Section>
          );
        })()
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Muted className={typeClass("caption")}>Untick what you don't want. You can change any of it later.</Muted>
          <span className="flex gap-2">
            {onBack !== null ? (
              <Button variant="ghost" onClick={onBack}>
                Back to Home
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onChoose}>
              Scan again
            </Button>
            {/* Applying that turns nothing on, pauses nothing and removes no key needs no list. */}
            <Button
              loading={applying}
              onClick={() => {
                const changes = applyChanges(scan, payload);
                if (changes.turnOn.length + changes.pause.length + changes.removeKeys.length === 0) void apply(payload);
                else setConfirming({ payload, changes });
              }}
            >
              {watchLabel(payload.turnOn.length)}
            </Button>
          </span>
        </div>
      )}
      {error !== null ? <Muted className="text-destructive">{error}</Muted> : null}
    </div>
  );
}
