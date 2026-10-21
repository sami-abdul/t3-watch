import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { alertHost } from "./alerts.ts";
import { makeWatch } from "./app.ts";
import type { WatchConfig } from "./config.ts";
import { listenHosts, loadConfig, localUrl, pageUrl, saveConfig, watchHome } from "./config.ts";
import { makeHttpServer } from "./http.ts";
import { firstLine, liveDeps, type ProcResult, type RunProc, runProc } from "./proc.ts";
import { homeEnv, type ProviderHome, providerHomes, readT3Settings, t3SettingsFile } from "./providers.ts";
import { choosePort, findTailnet, type Refusal, sendsToWatch, servedPorts, serveWatch, tailnetUrl, unserve, watchTarget } from "./tailscale.ts";
import { makeSignInCode, SIGN_IN_MINUTES, signInLink } from "./signin.ts";
import type { WatchState } from "./state.ts";
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
    probeUrls: () => config.probeUrls,
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

/** One request to the local service with this folder's token: its answer, or why there was none. */
const askWatch = async (config: WatchConfig, path: string, ms: number, post = false): Promise<Response | "slow" | "absent"> => {
  try {
    return await fetch(`${localUrl(config)}${path}`, {
      method: post ? "POST" : "GET",
      headers: { authorization: `Bearer ${config.token}`, ...(post ? { "content-type": "application/json" } : {}) },
      ...(post ? { body: "{}" } : {}),
      signal: AbortSignal.timeout(ms),
    });
  } catch (error) {
    return timedOut(error) ? "slow" : "absent";
  }
};

const refusedText = (config: WatchConfig, home: string) =>
  `Something at ${localUrl(config)} refused this folder's token, so it is not the Watch for ${home}.`;

export const probe = async (config: WatchConfig, ms = PROBE_MS): Promise<Probe> => {
  const response = await askWatch(config, "/api/state", ms);
  if (typeof response === "string") return { kind: response };
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
const freshSignInLink = (home: string, config: WatchConfig) => {
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

const scopeArgs = (provider: ProviderHome) => (provider.cli === "claude" ? ["-s", "user"] : []);

/** A command to copy later, with the home variable set or unset in front. */
const laterCommand = (provider: ProviderHome, args: ReadonlyArray<string>) =>
  [
    ...Object.entries(homeEnv(provider)).map(([name, value]) => (value === undefined ? `env -u ${name}` : `${name}=${shellQuote(value)}`)),
    shellQuote(provider.command),
    ...args.map(shellQuote),
  ].join(" ");

/** How a failed run reads: a hang, or what the CLI said, or its exit code. */
const failureText = (result: ProcResult, hung: string, verb: "add" | "remove") =>
  result.timedOut ? hung : `could not ${verb} the MCP server: ${firstLine(result.stderr) || `exit ${result.code}`}`;

const removedText = (result: ProcResult) =>
  // Codex answers "No MCP server named ... found." with exit 0, so the words come first.
  /no mcp server/i.test(`${result.stderr} ${result.stdout}`)
    ? `had no ${SERVICE} MCP server`
    : result.missing
      ? "not installed"
      : result.code === 0
        ? `removed the ${SERVICE} MCP server`
        : failureText(result, "did not answer in time, so the MCP server may still be there", "remove");

const addedText = (result: ProcResult, provider: ProviderHome, add: ReadonlyArray<string>) =>
  result.missing
    ? `not installed. Later run: ${laterCommand(provider, add)}`
    : result.code === 0
      ? `added the ${SERVICE} MCP server`
      : failureText(result, "did not answer in time, so the MCP server may be half added; run install again", "add");

/**
 * Adds Watch's MCP server to the default Codex and Claude Code homes, or with `all` to every
 * provider home in T3's settings too, or removes it from them. Says what happened in each home,
 * and how many more homes --all would cover.
 */
export const registerMcp = async (options: {
  readonly all: boolean;
  readonly remove?: boolean;
  readonly settings?: unknown;
  readonly run?: RunProc;
  /** The environment whose CLAUDE_CONFIG_DIR and CODEX_HOME name the default homes. */
  readonly env?: NodeJS.ProcessEnv;
  readonly exists?: (path: string) => boolean;
}) => {
  const run = options.run ?? runProc;
  const [node, bin] = binCommand();
  const { settings, problem } =
    options.settings === undefined
      ? readT3Settings()
      : { settings: options.settings, problem: options.settings === null ? `no settings at ${t3SettingsFile()}` : null };
  const { defaults, extra, skipped } = providerHomes(settings, { includeDisabled: options.remove === true, env: options.env });
  const lines: Array<string> = [];
  // One home at a time: Codex homes can share files, and two writers would lose an entry.
  const exists = options.exists ?? existsSync;
  for (const provider of options.all ? [...defaults, ...extra] : defaults) {
    // A home not made yet has nothing to remove, and a CLI pointed at it may refuse to start.
    if (provider.home !== null && !exists(provider.home)) {
      lines.push(`${provider.label}: ${options.remove === true ? `had no ${SERVICE} MCP server` : "skipped, its home does not exist yet"}`);
      continue;
    }
    const env = homeEnv(provider);
    const inHome = async (args: ReadonlyArray<string>) => {
      const result = await run(provider.command, args, { env });
      return result.missing && provider.fallback !== undefined ? run(provider.fallback, args, { env }) : result;
    };
    const removed = await inHome(["mcp", "remove", ...scopeArgs(provider), SERVICE]);
    if (options.remove === true) {
      lines.push(`${provider.label}: ${removedText(removed)}`);
      continue;
    }
    const add = ["mcp", "add", ...scopeArgs(provider), SERVICE, "--", node!, bin!, "mcp"];
    lines.push(`${provider.label}: ${addedText(await inHome(add), provider, add)}`);
  }
  if (options.all) {
    if (problem !== null) lines.push(`T3 Code: ${problem}, so only the default homes.`);
    for (const left of skipped) lines.push(`${left.label}: skipped, ${left.reason}`);
  } else if (extra.length > 0) {
    const more = extra.length;
    lines.push(
      `T3 Code lists ${more} more provider home${more === 1 ? "" : "s"}. To cover ${more === 1 ? "it" : "them"} too: t3-watch ${options.remove === true ? "uninstall" : "install"} --all`,
    );
  }
  return lines;
};

const STAYS = "so the page stays on this machine";

const refused = (refusal: Refusal) => `Tailscale: ${refusal.problem}, ${STAYS}.${refusal.fix === null ? "" : ` ${refusal.fix}`}`;

const withoutTailnet = ({ tailnetUrl: _url, tailnetRoute: _route, ...rest }: WatchConfig): WatchConfig => rest;

export interface TailnetStep {
  readonly config: WatchConfig;
  readonly lines: ReadonlyArray<string>;
  /** The address to check once the service runs, when install serves the page. */
  readonly url: string | null;
  /** Puts the route and config back when the rest of install fails. */
  readonly undo: (() => Promise<void>) | null;
}

/**
 * Serves the page on the tailnet when Tailscale runs here. Config records the address install set
 * as tailnetUrl, and tailnetRoute says whether install made that route or found it, so only a
 * route install made is ever taken down. A publicUrl install did not set is the person's and is
 * left alone without asking Tailscale anything. With `skip`, an earlier install's route comes off.
 * When Tailscale refuses, links fall back to this machine and the record stays for a later run.
 */
export const tailnetPage = async (
  config: WatchConfig,
  home: string,
  options: { readonly run?: RunProc; readonly skip?: boolean } = {},
): Promise<TailnetStep> => {
  const run = options.run ?? runProc;
  const same = (line: string): TailnetStep => ({ config, lines: [line], url: null, undo: null });
  if (options.skip === true) {
    if (config.tailnetUrl === undefined) return same(`Tailscale: skipped with --no-tailscale, ${STAYS}.`);
    // An earlier install served the page; --no-tailscale takes it back off the tailnet.
    const stopped = (await stopTailnetPage(config, home, run))!;
    return { config: stopped.config, lines: [`${stopped.line} The page stays on this machine, as --no-tailscale asks.`], url: null, undo: null };
  }
  if (config.publicUrl !== null && config.publicUrl !== config.tailnetUrl)
    return same(`Tailscale: publicUrl is ${config.publicUrl}, and install did not set it, so Watch leaves it. Remove it from config.json to have install serve the page on your tailnet.`);
  const local = (line: string): TailnetStep => {
    if (config.publicUrl === null) return same(line);
    const next = { ...config, publicUrl: null };
    saveConfig(next, home);
    return { config: next, lines: [line], url: null, undo: async () => saveConfig(config, home) };
  };
  const tailnet = await findTailnet(run);
  if ("missing" in tailnet) return local(`Tailscale: not installed, ${STAYS}. With Tailscale running, install serves it on your tailnet over HTTPS.`);
  if ("problem" in tailnet) return local(refused(tailnet));
  if (!tailnet.https)
    return local(refused({ problem: "this tailnet has HTTPS certificates off", fix: "Turn them on in the Tailscale admin console, under DNS, then install again." }));
  const ports = await servedPorts(run, tailnet);
  if (ports === null) return local(refused({ problem: "Watch could not read what Tailscale serves here", fix: "Check tailscale serve status, then install again." }));
  const warnings = [...ports]
    .filter(([, served]) => served.funnel && sendsToWatch(served, config.port))
    .map(([port]) => `Tailscale: port ${port} sends the page to the public internet through Funnel, which Watch never does. Turn it off with tailscale funnel --https=${port} off.`);
  // The route recorded before: put back if it is gone, used again while it still serves Watch.
  const previous = config.tailnetUrl === undefined ? null : URL.parse(config.tailnetUrl);
  const previousPort =
    previous !== null && previous.protocol === "https:" && previous.hostname.toLowerCase() === tailnet.dnsName.toLowerCase() ? Number(previous.port || 443) : null;
  const served = previousPort === null ? undefined : ports.get(previousPort);
  const choice =
    previousPort !== null && served === undefined
      ? { port: previousPort, existing: false, made: true }
      : previousPort !== null && sendsToWatch(served, config.port) && served!.https && !served!.funnel
        ? { port: previousPort, existing: true, made: config.tailnetRoute === "made" }
        : choosePort(ports, config.port);
  if (choice === null) return local(refused({ problem: `HTTPS ports ${config.port + 1} to ${config.port + 20} are all taken`, fix: null }));
  if (!choice.existing) {
    const result = await serveWatch(run, tailnet, choice.port, watchTarget(config.host, config.port));
    if (!result.ok) return { ...local(refused(result)), lines: [refused(result), ...warnings] };
  }
  const url = tailnetUrl(tailnet, choice.port);
  const next: WatchConfig = { ...config, publicUrl: url, tailnetUrl: url, tailnetRoute: choice.made ? "made" : "found" };
  saveConfig(next, home);
  return {
    config: next,
    lines: [`Tailscale: ${choice.existing ? "already serving" : "serving"} the page on your tailnet at ${url}`, ...warnings],
    url,
    undo: async () => {
      if (!choice.existing) await unserve(run, tailnet, choice.port);
      saveConfig(config, home);
    },
  };
};

/**
 * Takes down the route install made, while it still sends to Watch alone on this machine, and
 * points links back at the machine. A route install found is left. The record goes once the
 * route is known gone or not install's, so a run that could not check leaves it for the next.
 * Null when install recorded nothing.
 */
export const stopTailnetPage = async (config: WatchConfig, home: string, run: RunProc = runProc) => {
  const url = config.tailnetUrl;
  if (url === undefined) return null;
  const finish = (line: string, gone: boolean) => {
    const base = gone ? withoutTailnet(config) : config;
    const next: WatchConfig = { ...base, publicUrl: config.publicUrl === url ? null : config.publicUrl };
    saveConfig(next, home);
    return { config: next, line };
  };
  const parsed = URL.parse(url);
  if (parsed === null || parsed.protocol !== "https:") return finish("Tailscale: the recorded address was not one install writes, so it was cleared.", true);
  const port = Number(parsed.port || 443);
  if (config.tailnetRoute !== "made") return finish(`Tailscale: install found the route on port ${port} rather than making it, so it was left.`, true);
  const tailnet = await findTailnet(run);
  if (!("dnsName" in tailnet))
    return finish(`Tailscale: could not check what port ${port} serves, so it was left. If it still serves the page, run tailscale serve --https=${port} off`, false);
  if (parsed.hostname.toLowerCase() !== tailnet.dnsName.toLowerCase())
    return finish(`Tailscale: the recorded address names ${parsed.hostname}, not this machine, so its route was left and the record cleared.`, true);
  const ports = await servedPorts(run, tailnet);
  if (ports === null)
    return finish(`Tailscale: could not check what port ${port} serves, so it was left. If it still serves the page, run tailscale serve --https=${port} off`, false);
  const served = ports.get(port);
  if (served === undefined) return finish(`Tailscale: was not serving the page on port ${port} any more.`, true);
  if (!sendsToWatch(served, config.port)) return finish(`Tailscale: port ${port} serves something else now, so it was left as it is.`, true);
  if (served.others)
    return finish(`Tailscale: port ${port} serves other paths besides the page, so it was left. Remove the page's / handler there with tailscale serve when you no longer want it.`, false);
  return (await unserve(run, tailnet, port))
    ? finish(`Tailscale: stopped serving the page on port ${port}.`, true)
    : finish(`Tailscale: could not stop serving port ${port}. Run tailscale serve --https=${port} off`, false);
};

/** Whether the tailnet address answers after the restart; a first certificate can take seconds. */
const answersAt = async (url: string) => {
  let reason = "no answer";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      void response.body?.cancel().catch(() => {});
      // Before sign-in, the page answers 401 with its sign-in note.
      if (response.status === 401 || response.ok) return `Checked: ${url} answers over HTTPS.`;
      reason = `HTTP ${response.status}`;
    } catch (error) {
      reason = error instanceof Error && error.cause instanceof Error ? error.cause.message : error instanceof Error ? error.message : String(error);
    }
  }
  return `Tailscale serves ${url}, but it did not answer yet (${reason}). Try it again in a minute.`;
};

/** Writes the login service, launchd on macOS and systemd on Linux, and (re)starts it. */
const installService = async (config: WatchConfig, home: string, node: string, bin: string) => {
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
    return;
  }
  const file = join(homedir(), ".config", "systemd", "user", `${SERVICE}.service`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `[Unit]
Description=t3-watch
After=network-online.target

[Service]
ExecStart=${systemdQuote(node, true)} ${systemdQuote(bin, true)} start
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
};

const install = async (options: { readonly all: boolean; readonly tailscale: boolean }) => {
  const [node, bin] = binCommand();
  if (!existsSync(join(packageRoot(), "dist", "server", "cli.js")))
    throw new Error("Build first: pnpm build");
  if (platform() !== "darwin" && platform() !== "linux") throw new Error("install supports Linux and macOS. Run t3-watch start yourself.");
  const home = watchHome();
  // Before the service starts, so it starts with the tailnet address.
  const tailnet = await tailnetPage(loadConfig(home), home, { skip: !options.tailscale });
  const config = tailnet.config;
  for (const line of tailnet.lines) console.log(line);
  try {
    await installService(config, home, node!, bin!);
  } catch (error) {
    // Nothing would answer on the route if the service did not install, so it goes too.
    await tailnet.undo?.();
    throw error;
  }
  // Checking the address overlaps the MCP registrations.
  const answering = tailnet.url === null ? null : answersAt(tailnet.url);
  for (const line of await registerMcp({ all: options.all })) console.log(line);
  if (answering !== null) console.log(await answering);
  console.log(`\nWatch runs in the background at ${pageUrl(config)}`);
  // The link is one-time and short-lived, and never carries the access token, so it is safe to
  // print even when an agent runs install.
  console.log(`Open this link within ${SIGN_IN_MINUTES} minutes to sign in. It works once: ${freshSignInLink(home, config)}`);
  console.log(`For another browser, run: ${shellQuote(node!)} ${shellQuote(bin!)} url`);
  if (platform() === "linux")
    console.log("To keep it running while you are logged out: loginctl enable-linger $USER");
};

const uninstall = async (all: boolean) => {
  if (platform() === "darwin") {
    const file = join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    await runProc("launchctl", ["bootout", `gui/${process.getuid?.() ?? ""}`, file]);
    rmSync(file, { force: true });
  } else if (platform() === "linux") {
    await runProc("systemctl", ["--user", "disable", "--now", SERVICE]);
    rmSync(join(homedir(), ".config", "systemd", "user", `${SERVICE}.service`), { force: true });
    await runProc("systemctl", ["--user", "daemon-reload"]);
  }
  for (const line of await registerMcp({ all, remove: true })) console.log(line);
  const home = watchHome();
  if (holdsWatch(home)) {
    const stopped = await stopTailnetPage(loadConfig(home), home);
    if (stopped !== null) console.log(stopped.line);
  }
  console.log(`Removed the service. Your data stays in ${watchHome()}.`);
};

/** Whether a folder holds a Watch, checked before a command that would otherwise create one there. */
const holdsWatch = (home: string) => existsSync(join(home, "config.json")) || existsSync(join(home, "watch.sqlite"));

const status = async () => {
  const home = watchHome();
  if (!holdsWatch(home)) {
    console.log(`No Watch in ${home}. Set it up with t3-watch install.`);
    process.exitCode = 1;
    return;
  }
  const config = loadConfig(home);
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
        ? refusedText(config, home)
        : result.kind === "unexpected"
          ? `${localUrl(config)} answered with ${result.answer}. If that is Watch, its log says why; if not, another program holds the port.`
          : "Not running. Start it with t3-watch start, or t3-watch install.",
  );
  process.exitCode = 1;
};

type AlertsView = WatchState["alerts"];

/** Where alerts go and how the last test went, or with `test`, a test alert through the service. */
const alerts = async (sub: string | undefined) => {
  if (sub !== undefined && sub !== "test") {
    console.error(`t3-watch alerts takes no "${sub}". Try t3-watch alerts, or t3-watch alerts test.`);
    process.exitCode = 1;
    return;
  }
  const home = watchHome();
  if (!holdsWatch(home)) {
    console.error(`No Watch in ${home}. Set it up with t3-watch install.`);
    process.exitCode = 1;
    return;
  }
  const config = loadConfig(home);
  // The webhook gets 10 seconds to answer a test; the rest is room for the service.
  const response = await askWatch(config, sub === "test" ? "/api/alerts/test" : "/api/state", 20_000, sub === "test");
  if (typeof response === "string") {
    console.error(
      response === "slow"
        ? `Watch did not answer at ${localUrl(config)} within 20 seconds.`
        : `Watch is not running at ${localUrl(config)}. Start it with t3-watch start, or t3-watch install.`,
    );
    process.exitCode = 1;
    return;
  }
  if (response.status === 401 || response.status === 403) {
    void response.body?.cancel().catch(() => {});
    console.error(refusedText(config, home));
    process.exitCode = 1;
    return;
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    ok?: boolean;
    message?: string;
    alerts?: AlertsView;
  };
  if (!response.ok) {
    console.error(
      sub === "test" && response.status === 404
        ? "This Watch does not send test alerts yet. Restart it after the upgrade: t3-watch install, or systemctl --user restart t3-watch."
        : (body.error ?? `Watch answered HTTP ${response.status}`),
    );
    process.exitCode = 1;
    return;
  }
  if (sub === "test") {
    console.log(body.message ?? "Watch sent the test but gave no result.");
    if (body.ok !== true) process.exitCode = 1;
    return;
  }
  // A service not yet restarted after an upgrade still sends the address instead of on and host.
  const sent = body.alerts as (Partial<AlertsView> & { url?: string | null }) | undefined;
  const view: AlertsView | undefined =
    sent === undefined
      ? undefined
      : {
          on: sent.on ?? (sent.url !== undefined && sent.url !== null),
          host: sent.host ?? alertHost(sent.url ?? null),
          signed: sent.signed ?? false,
          lastTest: sent.lastTest ?? null,
          lastDelivery: sent.lastDelivery ?? null,
        };
  if (view === undefined || !view.on) {
    console.log("Alerts are off. Connect them on the page: Details, then Alerts.");
    return;
  }
  console.log(`Alerts go to ${view.host ?? "an unreadable address"}, ${view.signed ? "signed" : "not signed"}.`);
  console.log(view.lastTest === null ? "No test alert since they were set. Send one with t3-watch alerts test." : `Last test at ${view.lastTest.at}: ${view.lastTest.message}`);
  if (view.lastDelivery !== null) console.log(`Last alert at ${view.lastDelivery.at}: ${view.lastDelivery.message}`);
};

const HELP = `t3-watch: watches the systems you run.

  t3-watch start       Run the service in the foreground
  t3-watch install     Run it in the background at login and register it with Codex and Claude Code
                       --all: in every provider home T3 Code runs, too
                       --no-tailscale: keep the page on this machine, off your tailnet
  t3-watch uninstall   Undo install, keeping your data; --all for every T3 provider home
  t3-watch url         Print a one-time sign-in link for the page
  t3-watch signout     Sign every browser out of the page; agents keep working
  t3-watch status      Say whether it is running and what is failing
  t3-watch alerts      Say where alerts go and how the last test alert went
  t3-watch alerts test Send a signed test alert and say whether the webhook accepted it
  t3-watch mcp         MCP over stdio, for agents (install registers this)
`;

export const main = async (args: ReadonlyArray<string>) => {
  const command = args[0] ?? "help";
  try {
    if (command === "start") await start();
    else if (command === "install" || command === "uninstall") {
      const known = command === "install" ? ["--all", "--no-tailscale"] : ["--all"];
      const unknown = args.slice(1).filter((arg) => !known.includes(arg));
      if (unknown.length > 0) {
        console.error(`t3-watch ${command} takes only ${known.join(" and ")}, not ${unknown.join(" ")}`);
        process.exitCode = 1;
        return;
      }
      if (command === "install") await install({ all: args.includes("--all"), tailscale: !args.includes("--no-tailscale") });
      else await uninstall(args.includes("--all"));
    }
    else if (command === "signout") {
      const home = watchHome();
      // Opening the store would make an empty one, and "Signed out 0 browsers" would hide the typo.
      if (!holdsWatch(home)) {
        console.error(`No Watch in ${home}, so there is no browser to sign out.`);
        process.exitCode = 1;
        return;
      }
      const store = openStore(join(home, "watch.sqlite"));
      try {
        const ended = store.clearSessions();
        console.log(`Signed out ${ended} browser${ended === 1 ? "" : "s"}. Agents keep working. Sign in again with t3-watch url.`);
      } finally {
        store.close();
      }
    } else if (command === "url") {
      const home = watchHome();
      if (!holdsWatch(home)) {
        console.error(`No Watch in ${home}. Set it up with t3-watch install, or point T3_WATCH_HOME at Watch's folder.`);
        process.exitCode = 1;
        return;
      }
      const config = loadConfig(home);
      // The link alone on stdout, so scripts can take it; the notes go to stderr.
      console.log(freshSignInLink(home, config));
      console.error(`It works once, within ${SIGN_IN_MINUTES} minutes.`);
      const result = await probe(config);
      if (result.kind === "slow")
        console.error(`Watch did not answer within ${PROBE_MS / 1000} seconds, so this link is unchecked. It works if Watch is running with ${home}.`);
      else if (result.kind !== "running")
        console.error(`No Watch answers for ${home}, so the link works only once Watch runs with that folder.`);
    }
    else if (command === "status") await status();
    else if (command === "alerts") await alerts(args[1]);
    else if (command === "mcp") await (await import("./mcp-relay.ts")).relay();
    else console.log(HELP);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1])
  await main(process.argv.slice(2));
