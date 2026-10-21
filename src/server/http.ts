import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { timingSafeEqual } from "node:crypto";

import { type CheckAction, type Watch, WatchError } from "./app.ts";
import type { WatchConfig } from "./config.ts";
import { deleteCheck, editCheck, restoreCheck } from "./edits.ts";
import { isLiveSignInCode, isSession, SESSION_DAYS, SIGN_IN_MINUTES, startSession, useSignInCode } from "./signin.ts";
import { readState } from "./state.ts";

const MAX_BODY = 64 * 1024;
/** A sign-in form holds one short code. */
const MAX_FORM = 4096;
/**
 * The page's session cookie. A demo's has a name of its own and lasts until the browser closes, so
 * signing in to a demo never replaces the session of a real Watch on the same host.
 */
const sessionCookie = (sample: boolean) => (sample ? { name: "t3w-demo", maxAge: null } : { name: "t3w", maxAge: SESSION_DAYS * 86_400 });

/** What the page says about signing in: after a spent link, to the API, and on the page itself. */
export interface SignInHelp {
  readonly link: string;
  readonly api: string;
  readonly page: string;
}

export const SIGN_IN_HELP: SignInHelp = {
  link: "Run t3-watch url for a new one, or ask your Watch thread.",
  api: "Sign in with a one-time link from t3-watch url",
  page: "Sign in with a one-time link: run t3-watch url, or ask your Watch thread for the page.",
};

type Session = Pick<Watch, "store" | "sample">;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

export type Route = (request: IncomingMessage, response: ServerResponse, url: URL) => Promise<boolean>;

const sameToken = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** The page's signed-in session: the cookie the sign-in link sets. */
export const hasPageSession = (request: IncomingMessage, watch: Session, now: Date) => {
  const { name: wanted } = sessionCookie(watch.sample);
  const cookie = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === wanted);
  // Session ids are URL-safe base64, so the value is compared as sent; nothing to decode.
  return cookie?.[1] !== undefined && isSession(watch.store, cookie[1], now);
};

/** Refuses all but a signed-in browser on the page itself: the person's own decisions, not an agent's or another site's. */
export const requirePage = (request: IncomingMessage, watch: Session, now: Date, publicUrl: string | null, message: string) => {
  if (!hasPageSession(request, watch, now) || !fromPage(request, publicUrl)) throw new WatchError(message, 403);
};

/** The access token agents and the CLI send as a bearer token. */
export const hasToken = (request: IncomingMessage, token: string) => {
  const header = request.headers.authorization ?? "";
  return header.startsWith("Bearer ") && sameToken(header.slice(7), token);
};

/** The access token agents and the CLI send, or a signed-in browser's session. */
export const isAuthorized = (request: IncomingMessage, token: string, watch: Session, now: Date) =>
  hasToken(request, token) || hasPageSession(request, watch, now);

/**
 * A request the page made from its own origin, not another site or a script without an Origin.
 * Browsers set Sec-Fetch-Site themselves and a page cannot forge it, so same-origin settles it,
 * even where a privacy setting sends Origin: null or a proxy rewrites Host. Browsers that leave it
 * out, as Chrome does over plain HTTP off localhost, are judged by their Origin.
 */
export const fromPage = (request: IncomingMessage, publicUrl: string | null) => {
  const site = request.headers["sec-fetch-site"];
  if (site !== undefined) return site === "same-origin";
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin === undefined) return false;
  // Behind a proxy that rewrites Host, publicUrl names the origin the browser uses.
  const allowed = [
    ...(host === undefined ? [] : [`http://${host}`, `https://${host}`]),
    ...(publicUrl === null ? [] : [URL.parse(publicUrl)?.origin ?? ""]),
  ];
  return allowed.includes(origin);
};

export const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
};

/** Reads a request body, refusing one larger than the limit. */
const readBody = async (request: IncomingMessage, limit: number) => {
  const chunks: Array<Buffer> = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new WatchError("Request too large", 413);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
};

const readForm = async (request: IncomingMessage) => new URLSearchParams((await readBody(request, MAX_FORM)).toString("utf8"));

/** The page a sign-in link opens: one button that posts the code. The code is URL-safe base64. */
const signInPage = (code: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to Watch</title>
<style>
body { font: 15px/1.5 system-ui, sans-serif; max-width: 28rem; margin: 15vh auto; padding: 0 1.25rem; color: #0a0a0a; background: #fff; }
p { color: #737373; }
button { font: inherit; padding: .5rem 1.1rem; border: 0; border-radius: .6rem; background: #171717; color: #fafafa; cursor: pointer; }
@media (prefers-color-scheme: dark) { body { background: #0a0a0a; color: #fafafa; } button { background: #fafafa; color: #0a0a0a; } }
</style></head>
<body><h1>Sign in to Watch</h1><p>This link works once, within ${SIGN_IN_MINUTES} minutes.</p>
<form method="post" action="/signin"><input type="hidden" name="code" value="${code}"><button type="submit">Sign in</button></form>
</body></html>
`;

export const readJson = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const body = await readBody(request, MAX_BODY);
  if (body.length === 0) return {};
  try {
    const parsed = JSON.parse(body.toString("utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new WatchError("Body must be a JSON object");
  }
};

const string = (value: unknown, name: string) => {
  if (typeof value !== "string" || value === "") throw new WatchError(`${name} is required`);
  return value;
};

/** Routes for the core service. Later changes add routes through `extraRoutes`. */
export const makeHttpServer = (options: {
  readonly watch: Watch;
  readonly config: () => WatchConfig;
  readonly webDir: string;
  readonly extraRoutes?: ReadonlyArray<Route>;
  readonly publicRoutes?: ReadonlyArray<Route>;
  /** How to sign in, for a Watch other than an installed one, such as the demo. */
  readonly signInHelp?: SignInHelp;
}) => {
  const { watch } = options;
  const help = options.signInHelp ?? SIGN_IN_HELP;

  const heartbeat: Route = async (request, response, url) => {
    const match = /^\/hb\/([A-Za-z0-9_-]{16,64})$/.exec(url.pathname);
    if (match === null || (request.method !== "GET" && request.method !== "POST")) return false;
    const check = watch.store
      .checks()
      // A deleted check's ping address stops answering until it is restored.
      .find((c) => c.kind === "heartbeat" && c.state !== "deleted" && c.config.token === match[1]);
    if (check === undefined) {
      sendJson(response, 404, { error: "Unknown heartbeat" });
      return true;
    }
    const status = url.searchParams.get("status") === "fail" ? "fail" : "success";
    watch.store.addHeartbeat(check.id, watch.now(), status);
    sendJson(response, 200, { ok: true });
    return true;
  };

  // Only one-time codes sign a browser in; a link carrying the access token is never accepted.
  // Opening a link shows a button whose POST spends the code, so a chat or mail preview that
  // fetches the link cannot use it up.
  const signin: Route = async (request, response, url) => {
    if (url.pathname !== "/signin") return false;
    const refuse = () => {
      response.writeHead(401, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end(`This sign-in link is not valid, was already used or is older than ${SIGN_IN_MINUTES} minutes. ${help.link}`);
      return true;
    };
    if (request.method === "GET" || request.method === "HEAD") {
      const code = url.searchParams.get("code") ?? "";
      // A spent or expired code gets no button, so nobody presses one that cannot work.
      if (!isLiveSignInCode(watch.store, code, watch.deps.now())) return refuse();
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        // Not no-referrer: under it a browser sends Origin: null on the form's POST, which the
        // origin check below refuses. same-origin still keeps the code out of other sites' logs.
        "referrer-policy": "same-origin",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      });
      response.end(signInPage(code));
      return true;
    }
    if (request.method !== "POST") return false;
    // The press must come from the page the link opened, so another site cannot spend a code.
    if (!fromPage(request, options.config().publicUrl)) {
      response.writeHead(403, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("Press Sign in on the page the link opens.");
      return true;
    }
    const form = await readForm(request);
    if (!useSignInCode(watch.store, form.get("code") ?? "", watch.deps.now())) return refuse();
    const session = startSession(watch.store, watch.deps.now());
    const secure = (options.config().publicUrl ?? "").startsWith("https:") ? "; Secure" : "";
    const cookie = sessionCookie(watch.sample);
    response.writeHead(302, {
      "set-cookie": `${cookie.name}=${session}; Path=/; HttpOnly; SameSite=Lax${cookie.maxAge === null ? "" : `; Max-Age=${cookie.maxAge}`}${secure}`,
      location: "/",
    });
    response.end();
    return true;
  };

  const api: Route = async (request, response, url) => {
    const path = url.pathname;
    const method = request.method ?? "GET";
    if (path === "/api/state" && method === "GET") {
      sendJson(response, 200, readState(watch));
      return true;
    }
    const checkAction = /^\/api\/checks\/([^/]+)\/(on|pause|resume|snooze|run)$/.exec(path);
    if (checkAction !== null && method === "POST") {
      const body = await readJson(request);
      const check = await watch.setCheck(
        decodeURIComponent(checkAction[1]!),
        checkAction[2] as CheckAction,
        typeof body.until === "string" ? body.until : undefined,
      );
      sendJson(response, 200, { check });
      return true;
    }
    const change = /^\/api\/checks\/([^/]+)\/(edit|delete|restore)$/.exec(path);
    if (change !== null && method === "POST") {
      // The person changes checks on the page: neither the token agents hold nor another site may.
      requirePage(request, watch, watch.deps.now(), options.config().publicUrl, "Edit and delete checks on the Watch page");
      const id = decodeURIComponent(change[1]!);
      const check =
        change[2] === "edit" ? editCheck(watch, id, await readJson(request)) : change[2] === "delete" ? deleteCheck(watch, id) : restoreCheck(watch, id);
      sendJson(response, 200, { check });
      return true;
    }
    const runs = /^\/api\/checks\/([^/]+)\/runs$/.exec(path);
    if (runs !== null && method === "GET") {
      sendJson(response, 200, { runs: watch.store.runs(decodeURIComponent(runs[1]!), 20) });
      return true;
    }
    if (path === "/api/keys" && method === "POST") {
      const body = await readJson(request);
      const result = await watch.addKey({
        vendor: string(body.vendor, "vendor"),
        value: string(body.value, "value"),
        ...(typeof body.label === "string" ? { label: body.label } : {}),
      });
      sendJson(response, 200, result);
      return true;
    }
    if (path === "/api/scan" && method === "POST") {
      // The scan takes a while; the page follows its step through /api/state.
      void watch.scanner.start().catch(() => {});
      sendJson(response, 202, { status: watch.scanner.status() });
      return true;
    }
    if (path === "/api/apply" && method === "POST") {
      const body = await readJson(request);
      const list = (value: unknown) =>
        Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
      sendJson(response, 200, await watch.applyScan({ turnOn: list(body.turnOn), removeKeys: list(body.removeKeys) }));
      return true;
    }
    const removeKey = /^\/api\/keys\/([^/]+)$/.exec(path);
    if (removeKey !== null && method === "DELETE") {
      watch.removeKey(decodeURIComponent(removeKey[1]!));
      sendJson(response, 200, { ok: true });
      return true;
    }
    return false;
  };

  const staticFiles: Route = async (request, response, url) => {
    if (request.method !== "GET") return false;
    const root = options.webDir;
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, relative);
    if (!file.startsWith(root)) return false;
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
    if (!existsSync(file)) {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("t3-watch is running. The page is not built: run pnpm build.");
      return true;
    }
    response.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=3600",
    });
    createReadStream(file).pipe(response);
    return true;
  };

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      for (const route of [heartbeat, signin, ...(options.publicRoutes ?? [])])
        if (await route(request, response, url)) return;
      const guarded = url.pathname.startsWith("/api/") || url.pathname === "/mcp";
      if (guarded && !isAuthorized(request, options.config().token, watch, watch.deps.now())) {
        sendJson(response, 401, { error: help.api });
        return;
      }
      for (const route of [api, ...(options.extraRoutes ?? [])])
        if (await route(request, response, url)) return;
      if (guarded) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      // The page's HTML only reaches people who signed in; the sign-in link sets the cookie.
      if (!isAuthorized(request, options.config().token, watch, watch.deps.now())) {
        response.writeHead(401, { "content-type": "text/plain" });
        response.end(help.page);
        return;
      }
      if (await staticFiles(request, response, url)) return;
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof WatchError) sendJson(response, error.status, { error: error.message });
      else {
        console.error("t3-watch request failed", error);
        sendJson(response, 500, { error: "Watch hit an error. Check its log." });
      }
    }
  };

  return createServer((request, response) => void handle(request, response));
};
