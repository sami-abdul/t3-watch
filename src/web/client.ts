import type { AlertResult } from "../server/alerts.ts";
import type { CheckAction } from "../server/app.ts";
import type { Reads } from "../server/config.ts";
import type { SetupSources } from "../server/scan.ts";
import type { Run } from "../server/store.ts";
import type { storedSettings } from "../server/targets.ts";
import type { WatchState } from "../server/state.ts";

export type { WatchState };

/** The folders and logins setup may read, ticked, and the folders left unticked. */
export interface SetupChoice {
  readonly roots: ReadonlyArray<string>;
  readonly skippedRoots: ReadonlyArray<string>;
  readonly reads: Reads;
}

export interface SetupView {
  readonly sources: SetupSources;
  /** The saved choice, and whether the person has made one yet. */
  readonly choice: SetupChoice & { readonly chosen: boolean };
}
/** An edit as the page sends it: settings are left out for a vendor check, whose settings cannot change. */
export interface CheckEditInput {
  readonly intent: string;
  readonly cadenceMinutes: number;
  readonly config?: unknown;
  /** The check's updatedAt when Edit opened; Watch refuses the edit if the check changed since. */
  readonly updatedAt: string;
}

export type AddKeyResult =
  | { readonly ok: true; readonly summary: string; readonly key: { readonly id: string; readonly account: string | null } }
  | { readonly ok: false; readonly summary: string };

/** What the views need from Watch. The page talks HTTP; the chat view talks MCP tools. */
export interface WatchClient {
  readonly surface: "page" | "chat";
  readonly state: () => Promise<WatchState>;
  readonly scan: () => Promise<void>;
  /** The folders and logins setup may read, each with what it holds, and the saved choice. */
  readonly setup: () => Promise<SetupView>;
  /** Saves what setup may read. Null in a chat, where the choice is shown and changed on the page. */
  readonly saveChoice: ((choice: SetupChoice) => Promise<{ readonly paused: number; readonly resumed: number }>) | null;
  readonly apply: (input: { turnOn: ReadonlyArray<string>; removeKeys: ReadonlyArray<string> }) => Promise<{ turnedOn: number; failures: ReadonlyArray<{ id: string; message: string }> }>;
  readonly setCheck: (id: string, action: CheckAction, until?: string) => Promise<void>;
  /** Changes a check's name, how often it runs and its settings. Null in a chat: the person edits on the page. */
  readonly editCheck: ((id: string, edit: CheckEditInput) => Promise<void>) | null;
  /** Deletes a check, keeping its history. Null in a chat. */
  readonly deleteCheck: ((id: string) => Promise<void>) | null;
  /** Brings a deleted check back, paused. Null in a chat. */
  readonly restoreCheck: ((id: string) => Promise<void>) | null;
  /**
   * A check's settings as stored, and a heartbeat's ping address, which the state leaves out. Null
   * in a chat, where they would reach the agent: the person sees them on the page.
   */
  readonly checkSettings: ((id: string) => Promise<CheckSettings>) | null;
  readonly runs: (id: string) => Promise<ReadonlyArray<Run>>;
  readonly draft: (id: string, action: "approve" | "discard", kind: "check" | "vendor") => Promise<void>;
  /** Null where keys cannot be pasted, such as inside a chat: there `openPage` is used. */
  readonly addKey: ((vendor: string, value: string) => Promise<AddKeyResult>) | null;
  readonly removeKey: ((id: string) => Promise<void>) | null;
  /** The folders setup scans, from the config. Null where they cannot be edited. */
  readonly roots: (() => Promise<ReadonlyArray<string>>) | null;
  readonly saveRoots: ((roots: ReadonlyArray<string>) => Promise<void>) | null;
  /** Makes a new alert signing secret and returns it, once. Null in a chat, where it would stay in the transcript. */
  readonly makeAlertSecret: (() => Promise<string>) | null;
  /** Sends a signed test alert to the webhook and returns how it answered. */
  readonly testAlert: () => Promise<AlertResult>;
  /** Incoming-webhook URLs are pasted only on the page, never inside a chat. */
  readonly saveSlack: ((url: string | null) => Promise<void>) | null;
  readonly testSlack: (() => Promise<AlertResult>) | null;
  /** Hands a question to the Watch thread. Returns what the person should know. */
  readonly ask: (text: string) => Promise<string>;
  readonly openPage: (() => void) | null;
}

/** What the page fetches for Edit and a heartbeat's ping address, as the server builds it. */
export type CheckSettings = ReturnType<typeof storedSettings>;

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
  setup: () => request<SetupView>("/api/setup"),
  saveChoice: (choice) => post<{ paused: number; resumed: number }>("/api/setup", choice),
  apply: (input) => post("/api/apply", input),
  setCheck: async (id, action, until) => {
    await post(`/api/checks/${encodeURIComponent(id)}/${action}`, until === undefined ? {} : { until });
  },
  editCheck: async (id, edit) => {
    await post(`/api/checks/${encodeURIComponent(id)}/edit`, edit);
  },
  deleteCheck: async (id) => {
    await post(`/api/checks/${encodeURIComponent(id)}/delete`);
  },
  checkSettings: (id) => post<CheckSettings>(`/api/checks/${encodeURIComponent(id)}/settings`),
  restoreCheck: async (id) => {
    await post(`/api/checks/${encodeURIComponent(id)}/restore`);
  },
  runs: async (id) => (await request<{ runs: Array<Run> }>(`/api/checks/${encodeURIComponent(id)}/runs`)).runs,
  draft: async (id, action, kind) => {
    await post(`/api/drafts/${kind}/${encodeURIComponent(id)}/${action}`);
  },
  addKey: (vendor, value) => post<AddKeyResult>("/api/keys", { vendor, value }),
  removeKey: async (id) => {
    await request(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  roots: async () => (await request<{ roots: Array<string> }>("/api/settings")).roots,
  saveRoots: async (roots) => {
    await post("/api/settings", { roots });
  },
  makeAlertSecret: async () => (await post<{ secret: string }>("/api/alerts/secret")).secret,
  testAlert: () => post<AlertResult>("/api/alerts/test"),
  saveSlack: async (url) => { await post("/api/slack", { url }); },
  testSlack: () => post<AlertResult>("/api/slack/test"),
  ask: async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return "Copied. Paste it into your Watch thread.";
    } catch {
      // Browsers give no clipboard to plain-HTTP pages other than localhost, such as a tailnet name.
      return `Paste this into your Watch thread: ${text}`;
    }
  },
  openPage: null,
};
