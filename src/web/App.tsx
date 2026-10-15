import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useState } from "react";

import type { WatchClient, WatchState } from "./client.ts";
import { Details } from "./Details.tsx";
import { Home } from "./Home.tsx";
import { pageView } from "./logic.ts";
import { Empty, Review, Scanning } from "./Setup.tsx";
import { Muted } from "./ui.tsx";

/** Watch's whole UI. The page and the chat view differ only in the client they pass. */
export function App({ client, initial = null }: { readonly client: WatchClient; readonly initial?: WatchState | null }) {
  const [state, setState] = useState<WatchState | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [wantsReview, setWantsReview] = useState(false);
  const [details, setDetails] = useState(false);

  const refresh = useCallback(() => {
    client
      .state()
      .then((next) => {
        setState(next);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [client]);

  const scanning = state?.setup.status.running ?? false;
  useEffect(() => {
    refresh();
    // Follow a running scan closely; otherwise a slow refresh keeps results current.
    const timer = setInterval(refresh, scanning ? 1500 : 15_000);
    return () => clearInterval(timer);
  }, [refresh, scanning]);

  const startScan = async () => {
    setWantsReview(true);
    setDetails(false);
    await client.scan();
    refresh();
  };

  let body;
  if (state === null) body = <Muted>{error ?? "Loading…"}</Muted>;
  else if (details) body = <Details client={client} state={state} refresh={refresh} onBack={() => setDetails(false)} />;
  else {
    const view = pageView(state, wantsReview);
    if (view === "scanning") body = <Scanning step={state.setup.status.step} />;
    else if (view === "empty") body = <Empty client={client} onScan={() => { setWantsReview(true); refresh(); }} />;
    else if (view === "review")
      body = (
        <Review
          // A new scan starts the ticks over.
          key={state.setup.scan!.scannedAt}
          client={client}
          scan={state.setup.scan!}
          onApplied={() => {
            setWantsReview(false);
            refresh();
          }}
          onRescan={startScan}
        />
      );
    else
      body = (
        <Home client={client} state={state} refresh={refresh} onAddServices={startScan} onDetails={() => setDetails(true)} />
      );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className={client.surface === "page" ? "mx-auto max-w-3xl px-5 py-10" : "p-4"}>
        {state?.setup.status.error ? <Muted className="mb-4 text-destructive">Setup failed: {state.setup.status.error}</Muted> : null}
        {error !== null && state !== null ? <Muted className="mb-4 text-destructive">{error}</Muted> : null}
        {body}
      </main>
    </MotionConfig>
  );
}
