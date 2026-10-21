/**
 * The page on the tailnet. Install serves it over HTTPS with `tailscale serve`, never `funnel`,
 * so it opens on the person's own devices and never on the public internet.
 */
import { bareHost } from "./hosts.ts";
import { firstLine, type RunProc } from "./proc.ts";

export interface Tailnet {
  /** The Tailscale CLI that answered. */
  readonly cli: string;
  /** This machine's tailnet name, without the trailing dot. */
  readonly dnsName: string;
  /** Whether the tailnet issues HTTPS certificates for that name. */
  readonly https: boolean;
}

/** Why the page cannot go on the tailnet, and what the person can do about it, when anything. */
export interface Refusal {
  readonly problem: string;
  readonly fix: string | null;
}

export type TailnetLookup = Tailnet | { readonly missing: true } | Refusal;

/** The CLI on PATH, then the one inside the macOS app. */
const CLIS = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];


/** This machine on its tailnet, or why it is not: no Tailscale, not running, or no name. */
export const findTailnet = async (run: RunProc): Promise<TailnetLookup> => {
  for (const cli of CLIS) {
    const result = await run(cli, ["status", "--json"], { timeoutMs: 10_000 });
    if (result.missing) continue;
    let status: { BackendState?: unknown; Self?: { DNSName?: unknown }; CertDomains?: unknown };
    try {
      status = JSON.parse(result.stdout) as typeof status;
    } catch {
      return { problem: `tailscale status said "${firstLine(result.stderr || result.stdout) || "nothing"}"`, fix: null };
    }
    if (status.BackendState !== "Running")
      return {
        problem: `Tailscale is not connected here (${typeof status.BackendState === "string" ? status.BackendState : "no state"})`,
        fix: "Connect it with tailscale up, then install again.",
      };
    const dnsName = typeof status.Self?.DNSName === "string" ? status.Self.DNSName.replace(/\.$/, "") : "";
    if (dnsName === "") return { problem: "this machine has no tailnet name", fix: "Turn on MagicDNS in the Tailscale admin console, then install again." };
    const https = Array.isArray(status.CertDomains) && status.CertDomains.includes(dnsName);
    return { cli, dnsName, https };
  }
  return { missing: true };
};

type ServeBlock = {
  TCP?: Record<string, { HTTPS?: unknown } | null>;
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: unknown }> }>;
  AllowFunnel?: Record<string, unknown>;
};

/** One served port: where "/" proxies to, and what else is true of it. */
export interface Served {
  readonly target: string | null;
  /** Other paths, a plain TCP forward, or a foreground session: Watch never takes or removes it. */
  readonly others: boolean;
  /** Served over HTTPS; a plain HTTP route cannot carry the https:// address install writes. */
  readonly https: boolean;
  /** Open to the public internet through Funnel, which Watch never uses. */
  readonly funnel: boolean;
}

/**
 * The ports Tailscale serves here, or null when Watch cannot tell, since a port it missed could be
 * taken over. Ports a foreground `tailscale serve` session holds count as taken.
 */
export const servedPorts = async (run: RunProc, tailnet: Tailnet): Promise<Map<number, Served> | null> => {
  const result = await run(tailnet.cli, ["serve", "status", "--json"], { timeoutMs: 10_000 });
  if (result.code !== 0) return null;
  let config: ServeBlock & { Foreground?: Record<string, ServeBlock> };
  try {
    config = JSON.parse(result.stdout.trim() || "{}") as typeof config;
  } catch {
    return null;
  }
  const ports = new Map<number, Served>();
  const portOf = (hostPort: string) => Number(hostPort.split(":").at(-1));
  const tcp = config.TCP ?? {};
  for (const [port, entry] of Object.entries(tcp)) ports.set(Number(port), { target: null, others: true, https: entry?.HTTPS === true, funnel: false });
  for (const [hostPort, web] of Object.entries(config.Web ?? {})) {
    const handlers = web?.Handlers ?? {};
    const proxy = handlers["/"]?.Proxy;
    ports.set(portOf(hostPort), {
      target: typeof proxy === "string" ? proxy : null,
      others: Object.keys(handlers).some((path) => path !== "/"),
      https: tcp[String(portOf(hostPort))]?.HTTPS === true,
      funnel: config.AllowFunnel?.[hostPort] === true,
    });
  }
  for (const session of Object.values(config.Foreground ?? {}))
    for (const port of [...Object.keys(session?.TCP ?? {}).map(Number), ...Object.keys(session?.Web ?? {}).map(portOf)])
      ports.set(port, { target: null, others: true, https: false, funnel: false });
  return ports;
};

/** The addresses Watch answers on from this machine, in the order tailscale serve should try them. */
const loopbackTargets = (watchPort: number) => [`http://127.0.0.1:${watchPort}`, `http://[::1]:${watchPort}`, `http://localhost:${watchPort}`];

/** Where tailscale serve reaches Watch: the loopback address it listens on. */
export const watchTarget = (host: string, watchPort: number) => {
  const [ipv4, ipv6, name] = loopbackTargets(watchPort);
  const bare = bareHost(host);
  return bare === "::1" ? ipv6! : bare === "localhost" ? name! : ipv4!;
};

/** Whether a served port's "/" proxies to Watch on this machine. */
export const sendsToWatch = (served: Served | undefined, watchPort: number) =>
  typeof served?.target === "string" && loopbackTargets(watchPort).includes(served.target.replace(/\/+$/, ""));

/** A route Watch can use for its https:// address: to Watch alone, over HTTPS, not on Funnel. */
export const usable = (served: Served | undefined, watchPort: number) =>
  served !== undefined && sendsToWatch(served, watchPort) && !served.others && served.https && !served.funnel;

/**
 * The HTTPS port for the page: a usable route to Watch someone made, found rather than made,
 * else the first free port from Watch's port plus one. Null when twenty in a row are taken.
 */
export const choosePort = (ports: ReadonlyMap<number, Served>, watchPort: number) => {
  for (const [port, served] of ports) if (usable(served, watchPort)) return { port, existing: true, made: false };
  for (let port = watchPort + 1; port < watchPort + 21 && port <= 65535; port += 1) if (!ports.has(port)) return { port, existing: false, made: true };
  return null;
};

/** Serves the page on one HTTPS port of the tailnet, or says why Tailscale would not. */
export const serveWatch = async (run: RunProc, tailnet: Tailnet, port: number, target: string): Promise<{ readonly ok: true } | (Refusal & { readonly ok: false })> => {
  const result = await run(tailnet.cli, ["serve", "--bg", `--https=${port}`, target], { timeoutMs: 30_000 });
  if (result.code === 0) return { ok: true };
  const output = `${result.stderr}\n${result.stdout}`;
  // A tailnet that never turned Serve on prints where to turn it on, then waits.
  const enable = /https:\/\/login\.tailscale\.com\/\S+/.exec(output)?.[0];
  if (enable !== undefined) return { ok: false, problem: "Serve is off for this tailnet", fix: `Turn it on at ${enable}, then install again.` };
  if (/access denied|permission|operator|sudo/i.test(output))
    return { ok: false, problem: "this user may not change what Tailscale serves", fix: "Run sudo tailscale set --operator=$USER once, then install again." };
  if (result.timedOut) return { ok: false, problem: "tailscale serve did not finish within 30 seconds", fix: null };
  return { ok: false, problem: `tailscale serve said "${firstLine(result.stderr || result.stdout) || `exit ${result.code}`}"`, fix: null };
};

/** Stops serving one HTTPS port. */
export const unserve = async (run: RunProc, tailnet: Tailnet, port: number) =>
  (await run(tailnet.cli, ["serve", `--https=${port}`, "off"], { timeoutMs: 30_000 })).code === 0;

export const tailnetUrl = (tailnet: Tailnet, port: number) => `https://${tailnet.dnsName}${port === 443 ? "" : `:${port}`}`;
