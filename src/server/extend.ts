import type { Watch } from "./app.ts";
import { saveConfig, type WatchConfig } from "./config.ts";
import { type Route, readJson, sendJson } from "./http.ts";
import { WatchError } from "./app.ts";

/** Routes and background work that build on the core service. */
export const extendServer = (options: {
  readonly watch: Watch;
  readonly config: () => WatchConfig;
  readonly reloadConfig: () => WatchConfig;
  readonly home: string;
}) => {
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
  return {
    routes: [settings] as ReadonlyArray<Route>,
    publicRoutes: [] as ReadonlyArray<Route>,
    start: () => {},
    stop: () => {},
  };
};
