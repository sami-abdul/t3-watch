import { useState } from "react";

import type { FoundService, Scan } from "../server/scan.ts";
import type { WatchClient } from "./client.ts";
import { typeClass } from "~/fluid/lib/type-scale";
import { Button } from "~/fluid/ui/button";
import { InputField, InputGroup } from "~/fluid/ui/input-group";
import { cn } from "~/lib/utils";
import {
  accessRows,
  applyPayload,
  checkAvailable,
  defaultTicks,
  reviewGroups,
  type Ticks,
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

export function Empty({ client, onScan }: { readonly client: WatchClient; readonly onScan: () => void }) {
  const [starting, setStarting] = useState(false);
  return (
    <div className="space-y-4">
      <Heading as="h1">Watch keeps an eye on everything you run</Heading>
      <Muted>
        Watch reads the projects and logins already on this machine, finds the services you depend on, and suggests
        checks. It only reads, and keys stay on this machine.
      </Muted>
      <Button
        loading={starting}
        onClick={async () => {
          setStarting(true);
          await client.scan();
          onScan();
        }}
      >
        Set up Watch
      </Button>
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
}: {
  readonly client: WatchClient;
  readonly scan: Scan;
  readonly onApplied: () => void;
  readonly onRescan: () => void;
}) {
  const [ticks, setTicks] = useState<Ticks>(() => defaultTicks(scan));
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = reviewGroups(scan);
  const payload = applyPayload(scan, ticks);
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
              ? { checked: ticks.access.has(row.accessKey), onToggle: () => setTicks({ ...ticks, access: toggle(ticks.access, row.accessKey) }) }
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
                detail: available ? s.summary : "Needs the key you unticked",
                badge: outcomeTone[s.outcome],
                checked: available && ticks.checks.has(s.checkId),
                onToggle: available ? () => setTicks({ ...ticks, checks: toggle(ticks.checks, s.checkId) }) : null,
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Muted className={typeClass("caption")}>Untick what you don't want. You can change any of it later.</Muted>
        <span className="flex gap-2">
          <Button variant="ghost" onClick={onRescan}>
            Scan again
          </Button>
          <Button
            loading={applying}
            onClick={async () => {
              setApplying(true);
              setError(null);
              try {
                const result = await client.apply(payload);
                if (result.failures.length > 0) setError(result.failures.map((f) => f.message).join(". "));
                onApplied();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setApplying(false);
              }
            }}
          >
            {watchLabel(payload.turnOn.length)}
          </Button>
        </span>
      </div>
      {error !== null ? <Muted className="text-destructive">{error}</Muted> : null}
    </div>
  );
}
