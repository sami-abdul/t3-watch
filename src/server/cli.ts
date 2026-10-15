import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeWatch } from "./app.ts";
import { loadConfig, pageUrl, signInUrl, watchHome } from "./config.ts";
import { makeHttpServer } from "./http.ts";
import { liveDeps, runProc } from "./proc.ts";
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
  const extension = extendServer({ watch, config: () => config, reloadConfig: () => (config = loadConfig(home)), home });
  const server = makeHttpServer({
    watch,
    config: () => config,
    webDir: join(packageRoot(), "dist", "web"),
    extraRoutes: extension.routes,
    publicRoutes: extension.publicRoutes,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  watch.runner.start();
  extension.start();
  console.log(`t3-watch is running at ${pageUrl(config)}`);
  console.log(`Sign in: ${signInUrl(config)}`);
  const stop = () => {
    extension.stop();
    server.close();
    watch.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
};

const binCommand = () => [process.execPath, join(packageRoot(), "bin", "t3-watch.js")];

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
        ? `${cli}: not installed. Later run: ${cli} mcp add ${cli === "claude" ? "-s user " : ""}${SERVICE} -- ${node} ${bin} mcp`
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
ExecStart=${node} ${bin} start
${env.map((e) => `Environment="${e}"`).join("\n")}
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
  console.log(`Open this link once to sign in: ${signInUrl(config)}`);
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
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/state`, {
      headers: { authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(3000),
    });
    const state = (await response.json()) as { checks: Array<{ state: string; lastOutcome: string | null }> };
    const on = state.checks.filter((c) => c.state === "on");
    const failing = on.filter((c) => c.lastOutcome === "fail").length;
    console.log(`Running. ${on.length} checks on, ${failing} failing. ${pageUrl(config)}`);
  } catch {
    console.log("Not running. Start it with t3-watch start, or t3-watch install.");
    process.exitCode = 1;
  }
};

const HELP = `t3-watch: watches the systems you run.

  t3-watch start       Run the service in the foreground
  t3-watch install     Run it in the background at login and register it with Codex and Claude Code
  t3-watch uninstall   Undo install, keeping your data
  t3-watch url         Print the sign-in link for the page
  t3-watch status      Say whether it is running and what is failing
  t3-watch mcp         MCP over stdio, for agents (install registers this)
`;

export const main = async (args: ReadonlyArray<string>) => {
  const command = args[0] ?? "help";
  try {
    if (command === "start") await start();
    else if (command === "install") await install();
    else if (command === "uninstall") await uninstall();
    else if (command === "url") console.log(signInUrl(loadConfig()));
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
