import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";

import { deliverAlerts, makeAlertSecret, sendTestAlert } from "./alerts.ts";
import { SAMPLE_ONLY, type Watch, WatchError } from "./app.ts";
import { resolve } from "node:path";

import { pageUrl, READS, type Reads, readsOf, saveConfig, type WatchConfig } from "./config.ts";
import { decideDraft } from "./drafts.ts";
import { PAUSED_BY_CHOICE } from "./edits.ts";
import { fromPage, hasToken, requirePage, type Route, readJson, sendJson } from "./http.ts";
import { makeMcpServer } from "./mcp.ts";
import { readSources } from "./scan.ts";
import { deliverSlack, setSlack, testSlack } from "./slack.ts";

/** Routes and background work that build on the core service: settings, drafts, MCP, alerts. */
export const extendServer = (options: {
  readonly watch: Watch;
  readonly config: () => WatchConfig;
  readonly reloadConfig: () => WatchConfig;
  readonly home: string;
  readonly root?: string;
}) => {
  const { watch } = options;
  const page = () => pageUrl(options.config());

  const choiceOf = (config: WatchConfig) => ({
    roots: config.roots,
    skippedRoots: config.skippedRoots ?? [],
    reads: readsOf(config),
    chosen: config.reads !== undefined,
  });
  const folders = (value: unknown, name: string) => {
    if (!Array.isArray(value) || value.some((r) => typeof r !== "string" || !r.startsWith("/")))
      throw new WatchError(`${name} must be a list of absolute folder paths`);
    // One spelling per folder: /code/, /code and /x/../code are the same place.
    return [...new Set((value as Array<string>).map((r) => resolve(r)))];
  };

  const settings: Route = async (request, response, url) => {
    if (url.pathname !== "/api/settings") return false;
    if (request.method === "GET") {
      const { token: _, ...rest } = options.config();
      sendJson(response, 200, rest);
      return true;
    }
    if (request.method !== "POST") return false;
    if (watch.sample) throw new WatchError(SAMPLE_ONLY.reads, 403);
    const body = await readJson(request);
    saveConfig({ ...options.config(), roots: folders(body.roots, "roots") }, options.home);
    const { token: _, ...rest } = options.reloadConfig();
    sendJson(response, 200, rest);
    return true;
  };

  // What setup may read: the folders, ticked or not, with what each holds, and the saved choice.
  const setup: Route = async (request, response, url) => {
    if (url.pathname !== "/api/setup") return false;
    if (request.method === "POST") {
      if (watch.sample) throw new WatchError(SAMPLE_ONLY.reads, 403);
      // The person chooses on the page: neither the token agents hold nor another site may.
      requirePage(request, watch, watch.deps.now(), options.config().publicUrl, "Choose what Watch may read on the Watch page");
      const body = await readJson(request);
      const roots = folders(body.roots, "roots");
      const skippedRoots = (body.skippedRoots === undefined ? [] : folders(body.skippedRoots, "skippedRoots")).filter((r) => !roots.includes(r));
      const reads = body.reads as Record<string, unknown> | undefined;
      if (typeof reads !== "object" || reads === null || !READS.every((key) => typeof reads[key] === "boolean"))
        throw new WatchError(`reads must say true or false for ${READS.join(", ")}`);
      // A scan reads the choice when it starts, so one already running would ignore a new one.
      if (watch.scanner.status().running) throw new WatchError("A scan is running. Change what Watch may read once it finishes.", 409);
      const chosen = Object.fromEntries(READS.map((key) => [key, reads[key] === true])) as unknown as Reads;
      const before = readsOf(options.config());
      saveConfig({ ...options.config(), roots, skippedRoots, reads: chosen }, options.home);
      options.reloadConfig();
      // A login turned off stops being used, not only being read for setup: its checks pause, and
      // come back when it is turned on again. Checks the person paused themselves stay paused.
      const kindOf = { github: "github", aws: "aws_metric" } as const;
      const turnedOff = (["github", "aws"] as const).filter((login) => before[login] && !chosen[login]).map((login) => kindOf[login]);
      const turnedOn = (["github", "aws"] as const).filter((login) => !before[login] && chosen[login]).map((login) => kindOf[login]);
      const held = new Set(watch.store.getKv<Array<string>>(PAUSED_BY_CHOICE, []));
      const pausing = watch.store.checks().filter((c) => c.state === "on" && (turnedOff as Array<string>).includes(c.kind));
      for (const check of pausing) {
        await watch.setCheck(check.id, "pause");
        held.add(check.id);
      }
      const resuming = watch.store.checks().filter((c) => c.state === "paused" && held.has(c.id) && (turnedOn as Array<string>).includes(c.kind));
      for (const check of resuming) {
        await watch.setCheck(check.id, "resume");
        held.delete(check.id);
      }
      watch.store.setKv(PAUSED_BY_CHOICE, [...held]);
      sendJson(response, 200, { choice: choiceOf(options.config()), paused: pausing.length, resumed: resuming.length });
      return true;
    }
    if (request.method !== "GET") return false;
    const config = options.config();
    const listed = [...new Set([...config.roots, ...(config.skippedRoots ?? [])])];
    sendJson(response, 200, { sources: await readSources(watch, listed, readsOf(config)), choice: choiceOf(config) });
    return true;
  };

  const drafts: Route = async (request, response, url) => {
    const match = /^\/api\/drafts\/(check|vendor)\/([^/]+)\/(approve|discard)$/.exec(url.pathname);
    if (match === null || request.method !== "POST") return false;
    await decideDraft(watch, match[1] as "check" | "vendor", decodeURIComponent(match[2]!), match[3] as "approve" | "discard");
    sendJson(response, 200, { ok: true });
    return true;
  };

  // The reply is the secret itself, so it goes to a signed-in browser and not to the API token
  // agents use. That keeps it out of chats an agent writes by habit. It does not stop an agent
  // that deliberately signs a browser session in for itself, through a link from
  // watch_sign_in_link that the instructions say is for the person, or that reads Watch's files,
  // which anything running as this user can.
  const alertSecret: Route = async (request, response, url) => {
    if (url.pathname !== "/api/alerts/secret" || request.method !== "POST") return false;
    requirePage(request, watch, watch.deps.now(), options.config().publicUrl, "Make the signing secret on the Watch page");
    sendJson(response, 200, { secret: makeAlertSecret(watch) });
    return true;
  };

  // A test wakes the thread the webhook is bound to, so a browser has to send it from the page
  // itself; another site holding the cookie cannot. Agents and the CLI send the token.
  const alertTest: Route = async (request, response, url) => {
    if (url.pathname !== "/api/alerts/test" || request.method !== "POST") return false;
    const config = options.config();
    if (!hasToken(request, config.token) && !fromPage(request, config.publicUrl))
      throw new WatchError("Send test alerts from the Watch page", 403);
    sendJson(response, 200, await sendTestAlert(watch, page()));
    return true;
  };

  const slack: Route = async (request, response, url) => {
    if (!["/api/slack", "/api/slack/test"].includes(url.pathname) || request.method !== "POST") return false;
    requirePage(request, watch, watch.deps.now(), options.config().publicUrl, "Configure and test Slack on the Watch page");
    const result = url.pathname === "/api/slack/test" ? await testSlack(watch) : setSlack(watch, (await readJson(request)).url);
    sendJson(response, 200, result);
    return true;
  };

  // Stateless MCP: a fresh server per request, behind the same token as the API.
  const mcp: Route = async (request, response, url) => {
    if (url.pathname !== "/mcp") return false;
    const server = makeMcpServer(watch, {
      root: options.root ?? process.cwd(),
      pageUrl: page,
      choice: () => choiceOf(options.config()),
    });
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response);
    return true;
  };

  let timer: NodeJS.Timeout | null = null;
  let sending = false;
  const send = () => {
    if (sending) return;
    sending = true;
    void Promise.all([deliverAlerts(watch, page()), deliverSlack(watch, page())])
      .catch((error: unknown) => console.error("t3-watch could not send alerts", error))
      .finally(() => {
        sending = false;
      });
  };
  let unsubscribe: (() => void) | null = null;

  return {
    routes: [settings, setup, drafts, alertSecret, alertTest, slack, mcp] as ReadonlyArray<Route>,
    publicRoutes: [] as ReadonlyArray<Route>,
    start: () => {
      unsubscribe = watch.onEvent(send) as () => void;
      // Retries what failed to send.
      timer = setInterval(send, 60_000);
    },
    stop: () => {
      unsubscribe?.();
      if (timer !== null) clearInterval(timer);
    },
  };
};
