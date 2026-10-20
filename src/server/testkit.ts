import { makeWatch } from "./app.ts";
import type { Deps, ProcResult, RunProc } from "./proc.ts";

export type FakeRoute = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** Deps with a scripted process runner, a scripted fetch and a movable clock. */
export const fakeDeps = (options: {
  readonly commands?: Record<string, Partial<ProcResult> | ((args: ReadonlyArray<string>) => Partial<ProcResult>)>;
  readonly fetch?: FakeRoute;
  readonly now?: string;
}) => {
  let clock = new Date(options.now ?? "2026-10-15T10:00:00.000Z");
  const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const run: RunProc = async (command, args) => {
    calls.push({ command, args });
    const entry = options.commands?.[command];
    if (entry === undefined)
      return { code: null, stdout: "", stderr: "", missing: true, timedOut: false };
    const partial = typeof entry === "function" ? entry(args) : entry;
    return { code: 0, stdout: "", stderr: "", missing: false, timedOut: false, ...partial };
  };
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push({ url: url.toString(), headers: Object.fromEntries(new Headers(init.headers).entries()) });
    if (options.fetch === undefined) throw new Error("network disabled in tests");
    return options.fetch(url, init);
  }) as typeof fetch;
  const deps: Deps = { run, fetch: fetchImpl, now: () => clock };
  return {
    deps,
    calls,
    requests,
    advance: (seconds: number) => {
      clock = new Date(clock.getTime() + seconds * 1000);
    },
  };
};

export const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A Watch on an in-memory database. Holding is off unless a test passes probe addresses. */
export const testWatch = (deps: Deps, probeUrls: () => unknown = () => []) =>
  makeWatch({ home: null, dbFile: ":memory:", deps, probeUrls });
