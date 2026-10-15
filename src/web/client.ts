import type { CheckAction } from "../server/app.ts";
import type { Run } from "../server/store.ts";
import type { WatchState } from "../server/state.ts";

export type { WatchState };
export type AddKeyResult =
  | { readonly ok: true; readonly summary: string; readonly key: { readonly id: string; readonly account: string | null } }
  | { readonly ok: false; readonly summary: string };

/** What the views need from Watch. The page talks HTTP; the chat view talks MCP tools. */
export interface WatchClient {
  readonly surface: "page" | "chat";
  readonly state: () => Promise<WatchState>;
  readonly scan: () => Promise<void>;
  readonly apply: (input: { turnOn: ReadonlyArray<string>; removeKeys: ReadonlyArray<string> }) => Promise<{ turnedOn: number; failures: ReadonlyArray<{ id: string; message: string }> }>;
  readonly setCheck: (id: string, action: CheckAction, until?: string) => Promise<void>;
  readonly runs: (id: string) => Promise<ReadonlyArray<Run>>;
  readonly draft: (id: string, action: "approve" | "discard", kind: "check" | "vendor") => Promise<void>;
  /** Null where keys cannot be pasted, such as inside a chat: there `openPage` is used. */
  readonly addKey: ((vendor: string, value: string) => Promise<AddKeyResult>) | null;
  readonly removeKey: ((id: string) => Promise<void>) | null;
  readonly saveRoots: ((roots: ReadonlyArray<string>) => Promise<void>) | null;
  /** Hands a question to the Watch thread. Returns what the person should know. */
  readonly ask: (text: string) => Promise<string>;
  readonly openPage: (() => void) | null;
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Watch answered ${response.status}`);
  return body as T;
};
const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const httpClient: WatchClient = {
  surface: "page",
  state: () => request<WatchState>("/api/state"),
  scan: async () => {
    await post("/api/scan");
  },
  apply: (input) => post("/api/apply", input),
  setCheck: async (id, action, until) => {
    await post(`/api/checks/${encodeURIComponent(id)}/${action}`, until === undefined ? {} : { until });
  },
  runs: async (id) => (await request<{ runs: Array<Run> }>(`/api/checks/${encodeURIComponent(id)}/runs`)).runs,
  draft: async (id, action, kind) => {
    await post(`/api/drafts/${kind}/${encodeURIComponent(id)}/${action}`);
  },
  addKey: (vendor, value) => post<AddKeyResult>("/api/keys", { vendor, value }),
  removeKey: async (id) => {
    await request(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  saveRoots: async (roots) => {
    await post("/api/settings", { roots });
  },
  ask: async (text) => {
    await navigator.clipboard.writeText(text);
    return "Copied. Paste it into your Watch thread.";
  },
  openPage: null,
};
