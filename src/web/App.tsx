import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useState } from "react";

import type { WatchClient, WatchState } from "./client.ts";
import { Details } from "./Details.tsx";
import { Home } from "./Home.tsx";
import { pageView } from "./logic.ts";
import { Choose, Review, Scanning } from "./Setup.tsx";
import { Muted } from "./ui.tsx";

/** Watch's whole UI. The page and the chat view differ only in the client they pass. */
export function App({ client, initial = null }: { readonly client: WatchClient; readonly initial?: WatchState | null }) {
  const [state, setState] = useState<WatchState | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [wantsReview, setWantsReview] = useState(false);
  // Add services and Scan again show what Watch may read before scanning.
  const [choosing, setChoosing] = useState(false);
  // What the last action changed or why it failed; refreshing the state leaves it in place.
  const [note, setNote] = useState<{ readonly text: string; readonly failed: boolean } | null>(null);
  // Details, and the section it opens on.
  const [details, setDetails] = useState<false | "top" | "alerts">(false);

  // Settles once the new state is in, for a view that waits on it.
  const refresh = useCallback(
    () =>
      client
        .state()
        .then((next) => {
          setState(next);
          setError(null);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))),
    [client],
  );

  const scanning = state?.setup.status.running ?? false;
  useEffect(() => {
    refresh();
    // Follow a running scan closely; otherwise a slow refresh keeps results current.
    const timer = setInterval(refresh, scanning ? 1500 : 15_000);
    return () => clearInterval(timer);
  }, [refresh, scanning]);

  const chooseThenScan = () => {
    setDetails(false);
    setNote(null);
    setChoosing(true);
  };
  // A key added in the review is read at once, with the choice already saved.
  const rescan = async () => {
    setWantsReview(true);
    setNote(null);
    try {
      await client.scan();
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), failed: true });
    }
    refresh();
  };
  const scanned = (text: string | null) => {
    setChoosing(false);
    setWantsReview(true);
    setNote(text === null ? null : { text, failed: false });
    refresh();
  };

  let body;
  if (state === null) body = <Muted>{error ?? "Loading…"}</Muted>;
  else if (details !== false)
    body = (
      <Details client={client} state={state} refresh={refresh} onBack={() => setDetails(false)} focus={details === "alerts" ? "alerts" : null} />
    );
  else {
    const view = pageView(state, wantsReview);
    if (view === "scanning") body = <Scanning step={state.setup.status.step} />;
    else if (view === "empty") body = <Choose client={client} firstRun onScan={scanned} onCancel={null} />;
    else if (choosing) body = <Choose client={client} firstRun={false} onScan={scanned} onCancel={() => setChoosing(false)} />;
    else if (view === "review")
      body = (
        <Review
          // A new scan starts the ticks over.
          key={state.setup.scan!.scannedAt}
          client={client}
          scan={state.setup.scan!}
          onApplied={(failures) => {
            setWantsReview(false);
            setNote(failures === null ? null : { text: failures, failed: true });
            refresh();
          }}
          onRescan={rescan}
          onChoose={chooseThenScan}
          // A scan applied before can wait: the person came to look, not to decide now.
          onBack={state.setup.scan!.appliedAt === null ? null : () => setWantsReview(false)}
        />
      );
    else
      body = (
        <Home
          client={client}
          state={state}
          refresh={refresh}
          onAddServices={chooseThenScan}
          onDetails={(focus) => setDetails(focus ?? "top")}
          onReview={() => setWantsReview(true)}
        />
      );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className={client.surface === "page" ? "mx-auto max-w-3xl px-5 py-10" : "p-4"}>
        {state?.setup.status.error ? <Muted className="mb-4 text-destructive">Setup failed: {state.setup.status.error}</Muted> : null}
        {error !== null && state !== null ? <Muted className="mb-4 text-destructive">{error}</Muted> : null}
        {note !== null ? <Muted className={note.failed ? "mb-4 text-destructive" : "mb-4"}>{note.text}</Muted> : null}
        {body}
      </main>
    </MotionConfig>
  );
}
