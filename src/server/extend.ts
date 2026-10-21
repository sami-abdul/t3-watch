import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";

import { deliverAlerts, makeAlertSecret, sendTestAlert } from "./alerts.ts";
import { type Watch, WatchError } from "./app.ts";
import { pageUrl, saveConfig, type WatchConfig } from "./config.ts";
import { decideDraft } from "./drafts.ts";
import { fromPage, hasPageSession, hasToken, type Route, readJson, sendJson } from "./http.ts";
import { makeMcpServer } from "./mcp.ts";

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

  const settings: Route = async (request, response, url) => {
    if (url.pathname !== "/api/settings") return false;
    if (request.method === "GET") {
      const { token: _, ...rest } = options.config();
      sendJson(response, 200, rest);
      return true;
    }
    if (request.method !== "POST") return false;
    const body = await readJson(request);
    const roots = body.roots;
    if (!Array.isArray(roots) || roots.some((r) => typeof r !== "string" || !r.startsWith("/")))
      throw new WatchError("roots must be a list of absolute folder paths");
    saveConfig({ ...options.config(), roots: roots as Array<string> }, options.home);
    const { token: _, ...rest } = options.reloadConfig();
    sendJson(response, 200, rest);
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
    const config = options.config();
    if (!hasPageSession(request, watch.store, watch.deps.now()) || !fromPage(request, config.publicUrl))
      throw new WatchError("Make the signing secret on the Watch page", 403);
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

  // Stateless MCP: a fresh server per request, behind the same token as the API.
  const mcp: Route = async (request, response, url) => {
    if (url.pathname !== "/mcp") return false;
    const server = makeMcpServer(watch, { root: options.root ?? process.cwd(), pageUrl: page });
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
    void deliverAlerts(watch, page())
      .catch((error: unknown) => console.error("t3-watch could not send alerts", error))
      .finally(() => {
        sending = false;
      });
  };
  let unsubscribe: (() => void) | null = null;

  return {
    routes: [settings, drafts, alertSecret, alertTest, mcp] as ReadonlyArray<Route>,
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
