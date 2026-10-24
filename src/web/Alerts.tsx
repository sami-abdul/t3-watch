import { type ReactNode, useEffect, useState } from "react";

import type { WatchClient, WatchState } from "./client.ts";
import { typeClass } from "~/fluid/lib/type-scale";
import { Button } from "~/fluid/ui/button";
import { InputField, InputGroup } from "~/fluid/ui/input-group";
import { cn } from "~/lib/utils";
import type { AlertResult } from "../server/alerts.ts";
import { ago, alertSteps, needsHandover, type StepState } from "./logic.ts";
import { Muted, Section } from "./ui.tsx";

const SETUP_REQUEST = "Set up alerts";
const NEW_SECRET_REQUEST = "I made a new alerts signing secret";

function Step({ n, state, title, children }: { readonly n: number; readonly state: StepState; readonly title: string; readonly children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
          typeClass("caption"),
          state === "done"
            ? "border-transparent bg-foreground text-background"
            : state === "current"
              ? "border-foreground text-foreground"
              : "border-border text-muted-foreground",
        )}
      >
        {state === "done" ? "✓" : n}
      </span>
      <div className={cn("min-w-0 flex-1 space-y-2", state === "waiting" && "opacity-60")}>
        <p className={cn("text-foreground", typeClass("body"))}>
          {title}
          <span className="sr-only">{state === "done" ? ", done" : state === "current" ? ", next" : ""}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

/**
 * Connect alerts in three steps: a signing secret made here and shown once, the Watch thread
 * setting up a T3 webhook task that takes the secret through a private card, and a test alert
 * that proves the webhook accepts Watch's signature.
 */
export function AlertsPanel({
  client,
  state,
  refresh,
}: {
  readonly client: WatchClient;
  readonly state: WatchState;
  readonly refresh: () => void;
}) {
  const now = new Date(state.generatedAt);
  const alerts = state.alerts;
  const steps = alertSteps(alerts);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<"secret" | "ask" | "test" | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  // A result the service did not keep, because the settings changed while the test was out.
  const [justTested, setJustTested] = useState<AlertResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Replacing a secret while alerts are on stops them until the T3 task has the new one.
  const [confirmReplace, setConfirmReplace] = useState(false);
  const alertsOn = alerts.on && alerts.signed;
  // Reset rather than hide, so the prompt is not already armed when alerts come back.
  useEffect(() => {
    if (!alertsOn) setConfirmReplace(false);
  }, [alertsOn]);
  const replacing = confirmReplace && alertsOn;
  // A secret replaced while alerts are on reaches the T3 task only through the Watch thread.
  const handover = needsHandover(alerts, secret !== null);
  const shownTest = alerts.lastTest ?? justTested;
  const connected = handover ? "current" : steps.connected;

  const run = async (which: "secret" | "ask" | "test", work: () => Promise<unknown>) => {
    setBusy(which);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const status = alerts.on
    ? `On: changes go to ${alerts.host ?? "the webhook"}, ${alerts.signed ? "signed" : "not signed"}.`
    : "Off. Three steps connect them, so a check that starts failing wakes your Watch thread.";
  const caption = cn("text-muted-foreground", typeClass("caption"));

  return (
    <Section title="Alerts">
      <div id="alerts" className="scroll-mt-6 space-y-4">
        <Muted>{status}</Muted>
        {alerts.lastDelivery !== null ? (
          <p className={cn(typeClass("caption"), alerts.lastDelivery.ok ? "text-muted-foreground" : "text-destructive")}>
            Last alert {ago(alerts.lastDelivery.at, now)}: {alerts.lastDelivery.message}
          </p>
        ) : null}
        <ol className="space-y-5">
          <Step n={1} state={steps.secret} title={alerts.signed ? "Signing secret made" : "Make a signing secret"}>
            {secret !== null ? (
              <div className="space-y-2">
                <code className={cn("block select-all break-all rounded-lg border border-border p-3 font-mono text-foreground", typeClass("caption"))}>
                  {secret}
                </code>
                <p className={caption}>
                  It is shown once. Paste it into the private card your Watch thread opens in step 2, never into the chat itself. Watch
                  signs every alert with it, and the T3 task refuses alerts until it has the same secret.
                </p>
              </div>
            ) : client.makeAlertSecret === null ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className={caption}>
                  {alerts.signed
                    ? "Made on the Watch page. A new one is made there too, and replaces it."
                    : "Make it on the Watch page, which shows it once. A secret shown in a chat would stay in the transcript."}
                </p>
                {client.openPage !== null ? (
                  <Button size="compact" variant="secondary" onClick={client.openPage}>
                    Open the page
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="compact"
                  variant={alerts.signed ? "ghost" : "secondary"}
                  loading={busy === "secret"}
                  onClick={async () => {
                    if (alertsOn && !replacing) {
                      setConfirmReplace(true);
                      return;
                    }
                    await run("secret", async () => {
                      setSecret(await client.makeAlertSecret!());
                      setJustTested(null);
                    });
                    setConfirmReplace(false);
                  }}
                >
                  {replacing ? "Replace the secret" : alerts.signed ? "Make a new signing secret" : "Make a signing secret"}
                </Button>
                {replacing ? (
                  <Button size="compact" variant="ghost" onClick={() => setConfirmReplace(false)}>
                    Cancel
                  </Button>
                ) : null}
                {alerts.signed ? (
                  <p className={caption}>
                    {replacing
                      ? "Alerts stop reaching your Watch thread until its T3 task has the new secret."
                      : "A new one replaces the current secret. Alerts fail until the T3 task has it."}
                  </p>
                ) : null}
              </div>
            )}
          </Step>

          <Step
            n={2}
            state={connected}
            title={handover ? "Give the new secret to your Watch thread" : alerts.on ? "Watch thread connected" : "Ask your Watch thread to set up alerts"}
          >
            <p className={caption}>
              {handover
                ? `Say "${NEW_SECRET_REQUEST}" in your Watch thread. It opens a private card for the secret and updates its T3 webhook task; until then, the task refuses alerts.`
                : alerts.on
                  ? "To move alerts to another thread, ask that thread to set them up the same way."
                  : `Say "${SETUP_REQUEST}" in your Watch thread. It creates a T3 webhook task bound to the thread and opens a private card for the secret.`}
            </p>
            {alerts.on && !handover ? null : (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="compact"
                  variant="secondary"
                  loading={busy === "ask"}
                  onClick={() => run("ask", async () => setAsked(await client.ask(handover ? NEW_SECRET_REQUEST : SETUP_REQUEST)))}
                >
                  {client.surface === "chat" ? "Ask the Watch thread" : "Copy the request"}
                </Button>
                {asked !== null ? <p className={caption}>{asked}</p> : null}
              </div>
            )}
          </Step>

          <Step n={3} state={steps.tested} title="Send a test alert">
            <p className={caption}>
              Your Watch thread sends one when it finishes setting alerts up. Send another whenever you want to check; each wakes the
              thread once, with a message that needs no action.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="compact" variant={steps.tested === "done" ? "ghost" : "secondary"} disabled={!alerts.on} loading={busy === "test"} onClick={() => run("test", async () => setJustTested(await client.testAlert()))}>
                Send a test alert
              </Button>
              {shownTest !== null ? (
                <p className={cn(typeClass("caption"), shownTest.ok ? "text-muted-foreground" : "text-destructive")}>
                  {ago(shownTest.at, now)}: {shownTest.message}
                </p>
              ) : null}
            </div>
          </Step>
        </ol>
        {error !== null ? <Muted className="text-destructive">{error}</Muted> : null}
      </div>
      <SlackPanel client={client} state={state} refresh={refresh} />
    </Section>
  );
}

function SlackPanel({ client, state, refresh }: { readonly client: WatchClient; readonly state: WatchState; readonly refresh: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slack = state.slack;
  const caption = cn("text-muted-foreground", typeClass("caption"));
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); refresh(); }
  };
  return <div className="mt-6 space-y-3 border-t border-border pt-5">
    <h3 className={typeClass("body")}>Slack alerts</h3>
    <p className={caption}>{slack.on ? "Connected. Changes also go to the channel chosen in your Slack app." : "Connect a Slack incoming webhook to receive changes in a channel. T3 Code is not required."}</p>
    {client.saveSlack === null ? <div className="space-y-2"><p className={caption}>Paste the webhook on the Watch page. Its address is a secret and never belongs in chat.</p>{client.openPage !== null ? <Button size="compact" variant="secondary" onClick={client.openPage}>Open the page</Button> : null}</div> : <>
      <InputGroup size="compact"><InputField index={0} label={slack.on ? "Replacement Slack webhook URL" : "Slack webhook URL"} type="password" autoComplete="off" value={value} onChange={setValue} disabled={busy} /></InputGroup>
      <p className={caption}>The URL stays encrypted on this machine. Watch never shows it again. <a className="underline" href="https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/" target="_blank" rel="noreferrer">Create an incoming webhook</a> in your Slack app, then paste it here.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="compact" disabled={busy || value.trim() === ""} onClick={() => run(async () => { await client.saveSlack!(value); setValue(""); setMessage("Slack saved. Send a test to check the channel."); })}>{slack.on ? "Replace Slack webhook" : "Save Slack webhook"}</Button>
        {slack.on ? <><Button size="compact" variant="secondary" disabled={busy} onClick={() => run(async () => { const result = await client.testSlack!(); setMessage(result.message); })}>Send Slack test</Button><Button size="compact" variant="ghost" disabled={busy} onClick={() => run(async () => { await client.saveSlack!(null); setValue(""); setMessage("Slack disconnected."); })}>Disconnect Slack</Button></> : null}
      </div>
    </>}
    {slack.lastTest !== null ? <p className={cn(typeClass("caption"), slack.lastTest.ok ? "text-muted-foreground" : "text-destructive")}>Last Slack test {ago(slack.lastTest.at, new Date(state.generatedAt))}: {slack.lastTest.message}</p> : null}
    {slack.lastDelivery !== null ? <p className={cn(typeClass("caption"), slack.lastDelivery.ok ? "text-muted-foreground" : "text-destructive")}>Last Slack alert {ago(slack.lastDelivery.at, new Date(state.generatedAt))}: {slack.lastDelivery.message}</p> : null}
    {message !== null ? <p className={caption} role="status">{message}</p> : null}
    {error !== null ? <p className={cn(typeClass("caption"), "text-destructive")} role="alert">{error}</p> : null}
  </div>;
}
