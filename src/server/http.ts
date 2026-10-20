import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { timingSafeEqual } from "node:crypto";

import { type CheckAction, type Watch, WatchError } from "./app.ts";
import type { WatchConfig } from "./config.ts";
import { useSignInCode } from "./signin.ts";
import { readState } from "./state.ts";

const MAX_BODY = 64 * 1024;
const COOKIE = "t3w";
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
export const hasPageSession = (request: IncomingMessage, token: string) => {
  const cookie = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === COOKIE);
  return cookie?.[1] !== undefined && sameToken(decodeURIComponent(cookie[1]), token);
};

export const isAuthorized = (request: IncomingMessage, token: string) => {
  const header = request.headers.authorization ?? "";
  if (header.startsWith("Bearer ") && sameToken(header.slice(7), token)) return true;
  return hasPageSession(request, token);
};

/** A request the page made from its own origin, not another site or a script without an Origin. */
export const fromPage = (request: IncomingMessage, publicUrl: string | null) => {
  const site = request.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin") return false;
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

export const readJson = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Array<Buffer> = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new WatchError("Request too large", 413);
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
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
}) => {
  const { watch } = options;

  const heartbeat: Route = async (request, response, url) => {
    const match = /^\/hb\/([A-Za-z0-9_-]{16,64})$/.exec(url.pathname);
    if (match === null || (request.method !== "GET" && request.method !== "POST")) return false;
    const check = watch.store
      .checks()
      .find((c) => c.kind === "heartbeat" && c.config.token === match[1]);
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
  const signin: Route = async (_request, response, url) => {
    if (url.pathname !== "/signin") return false;
    if (!useSignInCode(watch.store, url.searchParams.get("code") ?? "", watch.deps.now())) {
      response.writeHead(401, { "content-type": "text/plain" });
      response.end("This sign-in link is not valid, was already used or is older than 10 minutes. Run t3-watch url for a new one.");
      return true;
    }
    const token = options.config().token;
    const secure = (options.config().publicUrl ?? "").startsWith("https:") ? "; Secure" : "";
    response.writeHead(302, {
      "set-cookie": `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
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
      if (guarded && !isAuthorized(request, options.config().token)) {
        sendJson(response, 401, { error: "Sign in with the link from t3-watch url" });
        return;
      }
      for (const route of [api, ...(options.extraRoutes ?? [])])
        if (await route(request, response, url)) return;
      if (guarded) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      // The page's HTML only reaches people who signed in; the sign-in link sets the cookie.
      if (!isAuthorized(request, options.config().token)) {
        response.writeHead(401, { "content-type": "text/plain" });
        response.end("Sign in with the link from: t3-watch url");
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
