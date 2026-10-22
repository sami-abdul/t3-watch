/**
 * The Home view inside a chat, as an MCP App. Same components as the page; every action is a
 * Watch tool call through the host, which asks the person before anything that changes state.
 */
import { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import type { AlertResult } from "../server/alerts.ts";
import type { Run } from "../server/store.ts";
import { VERSION_MARK } from "../server/version-mark.ts";
import { App } from "./App.tsx";
import type { SetupView, WatchClient, WatchState } from "./client.ts";
import "./index.css";

// The server writes its own version over the mark as it serves this view.
const app = new McpApp({ name: "t3-watch", version: VERSION_MARK });
let pageUrl: string | null = null;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) {
    const first = result.content?.[0];
    throw new Error(first !== undefined && first.type === "text" ? first.text : `${name} failed`);
  }
  return result;
};

const mcpClient: WatchClient = {
  surface: "chat",
  state: async () => {
    const result = await call("watch_state");
    const state = result.structuredContent as unknown as WatchState & { pageUrl: string };
    pageUrl = state.pageUrl;
    return state;
  },
  scan: async () => {
    await call("watch_start_scan");
  },
  setup: async () => (await call("watch_sources")).structuredContent as unknown as SetupView,
  // What Watch may read is chosen on the page, never from a chat.
  saveChoice: null,
  apply: async (input) => {
    const result = await call("watch_apply", { turnOn: [...input.turnOn], removeKeys: [...input.removeKeys] });
    const first = result.content?.[0];
    return JSON.parse(first !== undefined && first.type === "text" ? first.text : "{}") as { turnedOn: number; failures: [] };
  },
  setCheck: async (id, action, until) => {
    await call("watch_set_check", { checkId: id, action, ...(until === undefined ? {} : { until }) });
  },
  runs: async (id) => ((await call("watch_runs", { checkId: id })).structuredContent as { runs: Array<Run> }).runs,
  draft: async (id, action, kind) => {
    await call("watch_decide_draft", { id, kind, decision: action });
  },
  // Checks are edited, deleted and restored by the person on the page, never from a chat.
  editCheck: null,
  deleteCheck: null,
  restoreCheck: null,
  // Keys are never typed into a chat surface: Add key opens the page instead.
  addKey: null,
  removeKey: null,
  roots: null,
  saveRoots: null,
  makeAlertSecret: null,
  testAlert: async () => (await call("watch_test_alert")).structuredContent as unknown as AlertResult,
  ask: async (text) => {
    await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    return "Sent to the Watch thread.";
  },
  openPage: () => {
    if (pageUrl !== null) void app.openLink({ url: pageUrl });
  },
};

const applyTheme = () => {
  const theme = app.getHostContext()?.theme;
  const dark = theme === undefined ? window.matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
  document.documentElement.classList.toggle("dark", dark);
};

app.addEventListener("hostcontextchanged", applyTheme);
await app.connect();
applyTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App client={mcpClient} />
  </StrictMode>,
);
