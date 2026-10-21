import { execFile } from "node:child_process";

export interface ProcResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The command is not installed. */
  readonly missing: boolean;
  readonly timedOut: boolean;
}
export type RunProc = (
  command: string,
  args: ReadonlyArray<string>,
  /** `env` adds variables for the command; an undefined value removes one it would inherit. */
  options?: { readonly cwd?: string; readonly timeoutMs?: number; readonly env?: Readonly<Record<string, string | undefined>> },
) => Promise<ProcResult>;

export const runProc: RunProc = (command, args, options = {}) =>
  new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 20_000,
        maxBuffer: 4 * 1024 * 1024,
        env: Object.fromEntries(
          Object.entries({ ...process.env, AWS_PAGER: "", GH_PROMPT_DISABLED: "1", NO_COLOR: "1", ...options.env }).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
      },
      (error, stdout, stderr) => {
        const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        resolve({
          code: failure === null ? 0 : typeof failure.code === "number" ? failure.code : null,
          stdout: String(stdout),
          stderr: String(stderr),
          missing: failure?.code === "ENOENT",
          timedOut: failure?.killed === true,
        });
      },
    );
  });

/** What checks and the scan reach the outside world through, so tests can replace it. */
export interface Deps {
  readonly run: RunProc;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
}
export const liveDeps: Deps = { run: runProc, fetch: globalThis.fetch, now: () => new Date() };
