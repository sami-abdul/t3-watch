import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeWatch } from "./app.ts";
import type { WatchConfig } from "./config.ts";
import { listenHosts, loadConfig, localUrl, pageUrl, watchHome } from "./config.ts";
import { makeHttpServer } from "./http.ts";
import { liveDeps, runProc } from "./proc.ts";
import { makeSignInCode, SIGN_IN_MINUTES, signInLink } from "./signin.ts";
import { openStore } from "./store.ts";
import { extendServer } from "./extend.ts";

const SERVICE = "t3-watch";
const LAUNCHD_LABEL = "dev.t3-watch.agent";

/** The package root, whether running from src/ or dist/. */
export const packageRoot = () => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Cannot find the t3-watch package root");
    dir = parent;
  }
  return dir;
};

const start = async () => {
  const home = watchHome();
  let config = loadConfig(home);
  const watch = makeWatch({
    home,
    dbFile: join(home, "watch.sqlite"),
    deps: liveDeps,
    roots: () => config.roots,
  });
  const extension = extendServer({
    watch,
    config: () => config,
    reloadConfig: () => (config = loadConfig(home)),
    home,
    root: packageRoot(),
  });
  const makeServer = () =>
    makeHttpServer({
      watch,
      config: () => config,
      webDir: join(packageRoot(), "dist", "web"),
      extraRoutes: extension.routes,
      publicRoutes: extension.publicRoutes,
    });
  const listen = (server: ReturnType<typeof makeServer>, host: string) =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, host, resolve);
    });
  const [primary, ...extra] = listenHosts(config);
  const servers = [makeServer()];
  await listen(servers[0]!, primary!);
  // Loopback lets a local proxy such as tailscale serve reach the page. Missing it is not fatal.
  for (const host of extra) {
    const server = makeServer();
    try {
      await listen(server, host);
      servers.push(server);
      console.log(`Also listening on http://${host}:${config.port}`);
    } catch (error) {
      console.error(`Could not also listen on ${host}:${config.port}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  watch.runner.start();
  extension.start();
  console.log(`t3-watch is running at ${pageUrl(config)}`);
  console.log("Sign in with a one-time link from: t3-watch url");
  const stop = () => {
    extension.stop();
    for (const server of servers) server.close();
    watch.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
};

const PROBE_MS = 3000;

export interface ProbeCheck {
  readonly state: string;
  readonly lastOutcome: string | null;
}

/**
 * What the local address says to this folder's token: a running Watch with its checks, a refused
 * token, an answer that is not Watch's state, no answer in time, or nothing listening at all.
 */
export type Probe =
  | { readonly kind: "running"; readonly checks: ReadonlyArray<ProbeCheck> }
  | { readonly kind: "unexpected"; readonly answer: string }
  | { readonly kind: "refused" | "slow" | "absent" };

const timedOut = (error: unknown) => error instanceof Error && error.name === "TimeoutError";

const isCheck = (value: unknown): value is ProbeCheck =>
  typeof value === "object" && value !== null && typeof (value as { state?: unknown }).state === "string";

const NOT_STATE = "something other than Watch's state";

export const probe = async (config: WatchConfig, ms = PROBE_MS): Promise<Probe> => {
  let response: Response;
  try {
    response = await fetch(`${localUrl(config)}/api/state`, {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(ms),
    });
  } catch (error) {
    return { kind: timedOut(error) ? "slow" : "absent" };
  }
  if (!response.ok) {
    // An unread body would hold the connection open and keep the CLI from exiting.
    void response.body?.cancel().catch(() => {});
    return response.status === 401 || response.status === 403
      ? { kind: "refused" }
      : { kind: "unexpected", answer: `HTTP ${response.status}` };
  }
  try {
    const checks = ((await response.json()) as { checks?: unknown } | null)?.checks;
    return Array.isArray(checks) && checks.every(isCheck) ? { kind: "running", checks } : { kind: "unexpected", answer: NOT_STATE };
  } catch (error) {
    return timedOut(error) ? { kind: "slow" } : { kind: "unexpected", answer: NOT_STATE };
  }
};

/** A one-time sign-in link, made in Watch's database so the running service accepts it. */
const freshSignInLink = (home: string) => {
  const config = loadConfig(home);
  const store = openStore(join(home, "watch.sqlite"));
  try {
    return signInLink(pageUrl(config), makeSignInCode(store, new Date()));
  } finally {
    store.close();
  }
};

const binCommand = () => [process.execPath, join(packageRoot(), "bin", "t3-watch.js")];

/** A word a POSIX shell reads back unchanged, for commands printed to copy. */
export const shellQuote = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`);

/**
 * A systemd unit value in double quotes. Specifiers (%) are always expanded; ExecStart also
 * expands $VARIABLES, so its words double the dollar signs too.
 */
export const systemdQuote = (value: string, execLine: boolean) => {
  let escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%");
  if (execLine) escaped = escaped.replace(/\$/g, "$$$$");
  return `"${escaped}"`;
};

const registerMcp = async () => {
  const [node, bin] = binCommand();
  const lines: Array<string> = [];
  for (const [cli, remove, add] of [
    ["codex", ["mcp", "remove", SERVICE], ["mcp", "add", SERVICE, "--", node!, bin!, "mcp"]],
    [
      "claude",
      ["mcp", "remove", "-s", "user", SERVICE],
      ["mcp", "add", "-s", "user", SERVICE, "--", node!, bin!, "mcp"],
    ],
  ] as const) {
    await runProc(cli, remove);
    const result = await runProc(cli, add);
    lines.push(
      result.missing
        ? `${cli}: not installed. Later run: ${cli} mcp add ${cli === "claude" ? "-s user " : ""}${SERVICE} -- ${shellQuote(node!)} ${shellQuote(bin!)} mcp`
        : result.code === 0
          ? `${cli}: added the ${SERVICE} MCP server`
          : `${cli}: could not add the MCP server: ${result.stderr.trim().slice(0, 200)}`,
    );
  }
  return lines;
};

const install = async () => {
  const [node, bin] = binCommand();
  if (!existsSync(join(packageRoot(), "dist", "server", "cli.js")))
    throw new Error("Build first: pnpm build");
  const home = watchHome();
  const config = loadConfig(home);
  const env = [`PATH=${process.env.PATH ?? ""}`, ...(process.env.T3_WATCH_HOME ? [`T3_WATCH_HOME=${home}`] : [])];
  if (platform() === "darwin") {
    const file = join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${bin}</string><string>start</string></array>
  <key>EnvironmentVariables</key><dict>${env
    .map((e) => e.split("="))
    .map(([k, ...v]) => `<key>${k}</key><string>${v.join("=")}</string>`)
    .join("")}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(home, "watch.log")}</string>
  <key>StandardErrorPath</key><string>${join(home, "watch.log")}</string>
</dict></plist>
`,
    );
    const uid = String(process.getuid?.() ?? "");
    await runProc("launchctl", ["bootout", `gui/${uid}`, file]);
    const loaded = await runProc("launchctl", ["bootstrap", `gui/${uid}`, file]);
    if (loaded.code !== 0) throw new Error(`launchctl failed: ${loaded.stderr.trim()}`);
  } else if (platform() === "linux") {
    const file = join(homedir(), ".config", "systemd", "user", `${SERVICE}.service`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `[Unit]
Description=t3-watch
After=network-online.target

[Service]
ExecStart=${systemdQuote(node!, true)} ${systemdQuote(bin!, true)} start
${env.map((e) => `Environment=${systemdQuote(e, false)}`).join("\n")}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`,
    );
    await runProc("systemctl", ["--user", "daemon-reload"]);
    const enabled = await runProc("systemctl", ["--user", "enable", "--now", SERVICE]);
    if (enabled.code !== 0) throw new Error(`systemctl failed: ${enabled.stderr.trim()}`);
    await runProc("systemctl", ["--user", "restart", SERVICE]);
  } else throw new Error("install supports Linux and macOS. Run t3-watch start yourself.");
  for (const line of await registerMcp()) console.log(line);
  console.log(`\nWatch runs in the background at ${pageUrl(config)}`);
  // The link is one-time and short-lived, and never carries the access token, so it is safe to
  // print even when an agent runs install.
  console.log(`Open this link within ${SIGN_IN_MINUTES} minutes to sign in. It works once: ${freshSignInLink(home)}`);
  console.log(`For another browser, run: ${shellQuote(node!)} ${shellQuote(bin!)} url`);
  if (platform() === "linux")
    console.log("To keep it running while you are logged out: loginctl enable-linger $USER");
};

const uninstall = async () => {
  if (platform() === "darwin") {
    const file = join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    await runProc("launchctl", ["bootout", `gui/${process.getuid?.() ?? ""}`, file]);
    rmSync(file, { force: true });
  } else if (platform() === "linux") {
    await runProc("systemctl", ["--user", "disable", "--now", SERVICE]);
    rmSync(join(homedir(), ".config", "systemd", "user", `${SERVICE}.service`), { force: true });
    await runProc("systemctl", ["--user", "daemon-reload"]);
  }
  await runProc("codex", ["mcp", "remove", SERVICE]);
  await runProc("claude", ["mcp", "remove", "-s", "user", SERVICE]);
  console.log(`Removed the service and MCP registrations. Your data stays in ${watchHome()}.`);
};

const status = async () => {
  const config = loadConfig();
  const result = await probe(config);
  if (result.kind === "running") {
    const on = result.checks.filter((c) => c.state === "on");
    const failing = on.filter((c) => c.lastOutcome === "fail").length;
    console.log(`Running. ${on.length} checks on, ${failing} failing. ${pageUrl(config)}`);
    return;
  }
  console.log(
    result.kind === "slow"
      ? `Watch did not answer at ${localUrl(config)} within ${PROBE_MS / 1000} seconds. It may be busy; try again.`
      : result.kind === "refused"
        ? `Something at ${localUrl(config)} refused this folder's token, so it is not the Watch for ${watchHome()}.`
        : result.kind === "unexpected"
          ? `${localUrl(config)} answered with ${result.answer}. If that is Watch, its log says why; if not, another program holds the port.`
          : "Not running. Start it with t3-watch start, or t3-watch install.",
  );
  process.exitCode = 1;
};

const HELP = `t3-watch: watches the systems you run.

  t3-watch start       Run the service in the foreground
  t3-watch install     Run it in the background at login and register it with Codex and Claude Code
  t3-watch uninstall   Undo install, keeping your data
  t3-watch url         Print a one-time sign-in link for the page
  t3-watch signout     Sign every browser out of the page; agents keep working
  t3-watch status      Say whether it is running and what is failing
  t3-watch mcp         MCP over stdio, for agents (install registers this)
`;

export const main = async (args: ReadonlyArray<string>) => {
  const command = args[0] ?? "help";
  try {
    if (command === "start") await start();
    else if (command === "install") await install();
    else if (command === "uninstall") await uninstall();
    else if (command === "signout") {
      const home = watchHome();
      const database = join(home, "watch.sqlite");
      // Opening the store would make an empty one, and "Signed out 0 browsers" would hide the typo.
      if (!existsSync(database)) {
        console.error(`No Watch in ${home}, so there is no browser to sign out.`);
        process.exitCode = 1;
        return;
      }
      const store = openStore(database);
      try {
        const ended = store.clearSessions();
        console.log(`Signed out ${ended} browser${ended === 1 ? "" : "s"}. Agents keep working. Sign in again with t3-watch url.`);
      } finally {
        store.close();
      }
    } else if (command === "url") {
      // The link alone on stdout, so scripts can take it; the notes go to stderr.
      const home = watchHome();
      console.log(freshSignInLink(home));
      console.error(`It works once, within ${SIGN_IN_MINUTES} minutes.`);
      const result = await probe(loadConfig(home));
      if (result.kind === "slow")
        console.error(`Watch did not answer within ${PROBE_MS / 1000} seconds, so this link is unchecked. It works if Watch is running with ${home}.`);
      else if (result.kind !== "running")
        console.error(`No Watch answers for ${home}, so the link works only once Watch runs with that folder.`);
    }
    else if (command === "status") await status();
    else if (command === "mcp") await (await import("./mcp-relay.ts")).relay();
    else console.log(HELP);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1])
  await main(process.argv.slice(2));
