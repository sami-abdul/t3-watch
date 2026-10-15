import type { Watch } from "./app.ts";
import type { WatchConfig } from "./config.ts";
import type { Route } from "./http.ts";

/** Routes and background work that build on the core service. */
export const extendServer = (_options: {
  readonly watch: Watch;
  readonly config: () => WatchConfig;
  readonly reloadConfig: () => WatchConfig;
  readonly home: string;
}) => ({
  routes: [] as ReadonlyArray<Route>,
  publicRoutes: [] as ReadonlyArray<Route>,
  start: () => {},
  stop: () => {},
});
