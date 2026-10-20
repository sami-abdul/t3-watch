/**
 * Watch over MCP. Agents investigate and author through these tools; the Home view renders
 * inline in hosts that support MCP Apps. Every tool calls the same methods as the page.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { alertSettings, setAlerts } from "./alerts.ts";
import { type Watch, WatchError } from "./app.ts";
import { addNote, decideDraft, DraftCheckInput, draftCheck, draftVendor } from "./drafts.ts";
import { makeSignInCode, SIGN_IN_MINUTES, signInLink } from "./signin.ts";
import { homeText, readState } from "./state.ts";

export const HOME_URI = "ui://t3-watch/home";

const INSTRUCTIONS = `t3-watch watches the systems this developer runs: CI, cloud accounts, API-key vendors, URLs and scheduled jobs. Checks are deterministic and run on Watch's own clock; you never run them on a timer yourself.

Roles: the page is for knowing and deciding (turn on, pause, add keys). You are for understanding and authoring: explain why something broke, suggest what to do, and draft new checks.

- Start with watch_home to show the state (it renders inline where the host supports it) or watch_status for text.
- Investigate a check with watch_check, then use gh, aws, logs or the repo to find the cause. Leave your conclusion with watch_note so it shows on the page.
- First setup: watch_scan, show the result, and let the person tick what to keep on the page or answer in words; then watch_apply.
- New checks: watch_draft_check. It runs once and waits for the person; never assume it is on. New vendors: watch_draft_vendor with a JSON description (see catalog/*.json in the t3-watch repo for the shape); GET-only, https origin.
- Never ask for, accept or repeat a key or token in chat. Keys are added on the page (Add key).
- When the person wants to open the page, call watch_sign_in_link and give them the link; it signs one browser in, once, within 10 minutes. Make one only when they ask. Never read ~/.t3-watch or Watch's access token.
- Alerts: to wake this thread when a check changes, first ask the person to open the Watch page (watch_sign_in_link if they need a link), go to Details and press Make a signing secret under Alerts; the page shows the secret once. Then call request_secret so they paste it into a private card. Never ask for the secret in chat, never make one yourself, and never write it anywhere. Create a T3 webhook task bound to this thread with schedule_task: schedule {"type":"webhook","signature":{"header":"X-Watch-Signature","encoding":"hex","prefix":"sha256=","secretRef":<the secretRef from request_secret>}} and a prompt like "Watch reported: {{body.text}}. Look into it with watch_check {{body.checkId}}, leave a watch_note, and tell me what to do." Pass only the returned webhookUrl to watch_set_alerts, and don't repeat the URL in a reply. If the person makes a new secret later, alerts fail until you give the task the new one the same way with update_scheduled_task. For a morning digest, schedule a weekday task that calls watch_status.
- Code fixes belong in a normal coding thread in that repository, ending in a pull request. Do not edit code from the Watch thread.`;

const SECRET_REFUSED =
  "Watch does not take a secret over chat, because it would stay in the transcript. Ask the person to press Make a signing secret under Alerts on the Watch page, collect it with request_secret, and attach it to the webhook task with signature.secretRef. Then call watch_set_alerts with the url only.";

const text = (value: string, structured?: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: value }],
  // Some clients, Claude Code among them, show the model only the structured content.
  ...(structured === undefined ? {} : { structuredContent: { summary: value, ...structured } }),
});
const json = (value: unknown) => JSON.stringify(value, null, 2);
const failure = (error: unknown) => ({
  content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
  isError: true,
});
const safely =
  <A>(work: (args: A) => Promise<ReturnType<typeof text>> | ReturnType<typeof text>) =>
  async (args: A) => {
    try {
      return await work(args);
    } catch (error) {
      return failure(error);
    }
  };

/** The app view's HTML, built by `pnpm build:app`. */
const appHtml = (root: string) => {
  const file = join(root, "dist", "app", "app.html");
  return existsSync(file)
    ? readFileSync(file, "utf8")
    : "<!doctype html><p>The Watch view is not built. Run pnpm build.</p>";
};

export const makeMcpServer = (watch: Watch, options: { readonly root: string; readonly pageUrl: () => string }) => {
  const server = new McpServer({ name: "t3-watch", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
  const appOnly = { ui: { visibility: ["app"] } };

  registerAppResource(
    server,
    "Watch Home",
    HOME_URI,
    { mimeType: RESOURCE_MIME_TYPE, description: "Watch's Home view" },
    async () => ({
      contents: [{ uri: HOME_URI, mimeType: RESOURCE_MIME_TYPE, text: appHtml(options.root), _meta: { ui: { prefersBorder: false } } }],
    }),
  );

  registerAppTool(
    server,
    "watch_home",
    {
      title: "Show Watch",
      description: "Shows Watch's Home: what is broken, what waits for the person, and what passes. Renders as an interactive view where supported.",
      annotations: readOnly,
      _meta: { ui: { resourceUri: HOME_URI } },
    },
    async () => {
      return text(homeText(readState(watch)), { pageUrl: options.pageUrl() });
    },
  );

  server.registerTool(
    "watch_state",
    { description: "The full state for the Watch view.", annotations: readOnly, _meta: appOnly },
    async () => text("Watch state", { ...readState(watch), pageUrl: options.pageUrl() } as unknown as Record<string, unknown>),
  );

  server.registerTool(
    "watch_status",
    { description: "What is broken, what could not run, drafts waiting, and how many checks pass.", annotations: readOnly },
    async () => text(homeText(readState(watch))),
  );

  server.registerTool(
    "watch_check",
    {
      description: "One check's definition, recent runs with evidence, notes and changes. Use it to investigate.",
      inputSchema: z.object({ checkId: z.string() }),
      annotations: readOnly,
    },
    safely(async ({ checkId }: { checkId: string }) => {
      const check = watch.store.check(checkId);
      if (check === null) throw new Error(`No check ${checkId}. watch_status lists them.`);
      const { token: _, ...config } = check.config as Record<string, unknown>;
      return text(
        json({
          check: { ...check, config },
          service: watch.store.service(check.serviceId),
          runs: watch.store.runs(checkId, 10),
          notes: watch.store.notes(200).filter((n) => n.checkId === checkId).slice(0, 5),
          changes: watch.store.events(200).filter((e) => e.checkId === checkId).slice(0, 10),
        }),
      );
    }),
  );

  server.registerTool(
    "watch_scan",
    {
      description:
        "Runs setup: reads the repositories under the configured folders and the logins on this machine, stores working keys, proposes checks and runs each once. Takes about half a minute.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    safely(async () => {
      const scan = await watch.scanner.start();
      return text(
        json({
          services: scan.services.map((s) => ({ id: s.serviceId, label: s.label, reachable: s.reachable, note: s.note, access: s.access.map((a) => ({ key: a.accessKey, source: a.source, status: a.status, detail: a.detail, warnings: a.warnings })) })),
          suggestions: scan.suggestions.map((s) => ({ checkId: s.checkId, intent: `${s.title}: ${s.intent}`, outcome: s.outcome, summary: s.summary, suggested: s.suggested })),
          next: "Show this to the person, then call watch_apply with the checks they want on.",
        }),
      );
    }),
  );

  server.registerTool(
    "watch_start_scan",
    { description: "Starts setup in the background, for the Watch view.", annotations: { readOnlyHint: false, destructiveHint: false }, _meta: appOnly },
    async () => {
      void watch.scanner.start().catch(() => {});
      return text("Scanning");
    },
  );

  server.registerTool(
    "watch_apply",
    {
      description: "Applies the last scan: turns on the listed checks (or every suggested one) and removes the listed keys by access key.",
      inputSchema: z.object({
        turnOn: z.union([z.literal("suggested"), z.array(z.string())]),
        removeKeys: z.array(z.string()).default([]),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    safely(async ({ turnOn, removeKeys }: { turnOn: "suggested" | Array<string>; removeKeys: Array<string> }) => {
      const scan = readState(watch).setup.scan;
      if (scan === null) throw new Error("Run watch_scan first");
      const ids = turnOn === "suggested" ? scan.suggestions.filter((s) => s.suggested).map((s) => s.checkId) : turnOn;
      return text(json(await watch.applyScan({ turnOn: ids, removeKeys })));
    }),
  );

  server.registerTool(
    "watch_set_check",
    {
      description: "Turns a check on, pauses it, snoozes it until a time, resumes it, or runs it now.",
      inputSchema: z.object({
        checkId: z.string(),
        action: z.enum(["on", "pause", "resume", "snooze", "run"]),
        until: z.string().optional().describe("ISO time, for snooze"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    safely(async ({ checkId, action, until }: { checkId: string; action: "on" | "pause" | "resume" | "snooze" | "run"; until?: string }) => {
      const check = await watch.setCheck(checkId, action, until);
      return text(`${check.intent}: ${check.state}${check.snoozedUntil ? ` until ${check.snoozedUntil}` : ""}. Last result: ${check.lastSummary ?? "none yet"}`);
    }),
  );

  server.registerTool(
    "watch_draft_check",
    {
      description: `Drafts a check. Watch validates it and runs it once; it stays a draft until the person turns it on. Kinds and config:
- http: { url, expectStatus?, contains? }
- github: { repo: "owner/name", branch?, workflow?, maxAgeSeconds? } (maxAgeSeconds needs workflow and also fails when that workflow's newest successful run is older, for scheduled workflows)
- aws_metric: { profile?, region, namespace, metric, dimensions?: [{name,value}], statistic, periodSeconds, windowSeconds, comparison, threshold, missingIsOk? } (comparison is the failure condition)
- heartbeat: { periodSeconds, graceSeconds? } (Watch makes the ping URL)
- vendor: { vendor, check } (a check id from the vendor's description; needs a key added on the page)`,
      inputSchema: DraftCheckInput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    safely(async (input: z.input<typeof DraftCheckInput>) => {
      const { check, result } = await draftCheck(watch, input);
      const ping = check.kind === "heartbeat" ? ` Ping URL: ${options.pageUrl()}/hb/${String(check.config.token)}` : "";
      return text(`Drafted "${check.intent}" (${check.id}). It ran once: ${result.outcome}, ${result.summary}. The person turns it on from Watch.${ping}`);
    }),
  );

  server.registerTool(
    "watch_draft_vendor",
    {
      description:
        "Drafts a vendor description (JSON) so Watch can recognise and check a new API-key vendor. Validated, tested with a stored key when there is one, and kept as a draft until the person approves it.",
      inputSchema: z.object({ description: z.record(z.string(), z.unknown()) }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    safely(async ({ description }: { description: Record<string, unknown> }) => {
      const { id, testSummary } = await draftVendor(watch, description);
      return text(`Drafted vendor ${id}. ${testSummary}. The person approves it from Watch.`);
    }),
  );

  server.registerTool(
    "watch_decide_draft",
    {
      description: "Approves or discards a draft. Only the Watch view calls this, on the person's click.",
      inputSchema: z.object({ id: z.string(), kind: z.enum(["check", "vendor"]), decision: z.enum(["approve", "discard"]) }),
      annotations: { readOnlyHint: false, destructiveHint: true },
      _meta: appOnly,
    },
    safely(async ({ id, kind, decision }: { id: string; kind: "check" | "vendor"; decision: "approve" | "discard" }) => {
      await decideDraft(watch, kind, id, decision);
      return text(`${decision === "approve" ? "Approved" : "Discarded"} ${id}`);
    }),
  );

  server.registerTool(
    "watch_runs",
    { description: "Recent runs of one check, for the Watch view.", inputSchema: z.object({ checkId: z.string() }), annotations: readOnly, _meta: appOnly },
    async ({ checkId }: { checkId: string }) => text("runs", { runs: watch.store.runs(checkId, 20) } as unknown as Record<string, unknown>),
  );

  server.registerTool(
    "watch_note",
    {
      description: "Leaves a short note on a check (or on Watch as a whole), shown on Home next to it. Use it for what you found.",
      inputSchema: z.object({ checkId: z.string().nullable().default(null), text: z.string().min(1).max(1000) }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    safely(async ({ checkId, text: note }: { checkId: string | null; text: string }) => {
      addNote(watch, checkId, note);
      return text("Noted.");
    }),
  );

  server.registerTool(
    "watch_set_alerts",
    {
      description:
        "Sets where Watch sends a change event (one POST per check that starts or stops failing): normally a T3 webhook task URL. Pass url null to stop. Watch signs each body in X-Watch-Signature with the secret the person made on the page; this tool never takes a secret.",
      inputSchema: z.object({
        url: z.string().nullable(),
        secret: z.unknown().optional().describe("Never pass this. The person makes the secret on the Watch page; a secret passed here is refused."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    safely(async ({ url, secret }: { url: string | null; secret?: unknown }) => {
      // Some clients send null for every optional field they leave out.
      if (secret !== undefined && secret !== null) throw new WatchError(SECRET_REFUSED);
      const result = setAlerts(watch, { url });
      return text(
        result.url === null
          ? "Alerts are off."
          : `Alerts go to ${result.url}${result.signed ? ", signed" : ". They are not signed: ask the person to press Make a signing secret on the Watch page"}.`,
      );
    }),
  );

  server.registerTool(
    "watch_sign_in_link",
    {
      description: `Makes a link that signs a browser in to the Watch page. It works once, within ${SIGN_IN_MINUTES} minutes. Make one only when the person asks to open the page, and give it only to them.`,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async () =>
      text(`${signInLink(options.pageUrl(), makeSignInCode(watch.store, watch.deps.now()))}\nIt works once, within ${SIGN_IN_MINUTES} minutes.`),
  );

  server.registerTool(
    "watch_alerts",
    { description: "Where change events go, if anywhere.", annotations: readOnly },
    async () => {
      const settings = alertSettings(watch);
      return text(settings.url === null ? "Alerts are off." : `Alerts go to ${settings.url}${settings.secret ? ", signed" : ""}.`);
    },
  );

  return server;
};
