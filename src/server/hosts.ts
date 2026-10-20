/**
 * Where a host is: this machine, the local network, the tailnet or the internet. Addresses are
 * matched with node:net's BlockList, which also reads IPv4-mapped IPv6 forms.
 */
import { BlockList, isIP } from "node:net";

export type HostClass = "loopback" | "local" | "tailnet" | "internet";

const subnets = (list: ReadonlyArray<readonly [string, number, "ipv4" | "ipv6"]>) => {
  const block = new BlockList();
  for (const [address, prefix, family] of list) block.addSubnet(address, prefix, family);
  return block;
};

const LOOPBACK = subnets([
  ["127.0.0.0", 8, "ipv4"],
  ["::1", 128, "ipv6"],
]);
// Checked before LOCAL, because Tailscale's IPv6 range sits inside fc00::/7.
const TAILNET = subnets([
  ["100.64.0.0", 10, "ipv4"],
  ["fd7a:115c:a1e0::", 48, "ipv6"],
]);
const LOCAL = subnets([
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["::", 128, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
]);

/** Where a host name or address is, bracketed or not. Names count by their suffix. */
export const hostClass = (host: string): HostClass => {
  const bare = host.replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "").toLowerCase();
  const family = isIP(bare);
  if (family !== 0) {
    const type = family === 4 ? "ipv4" : "ipv6";
    if (LOOPBACK.check(bare, type)) return "loopback";
    if (TAILNET.check(bare, type)) return "tailnet";
    return LOCAL.check(bare, type) ? "local" : "internet";
  }
  if (bare === "localhost" || bare.endsWith(".localhost")) return "loopback";
  if (bare.endsWith(".ts.net")) return "tailnet";
  return /(^|\.)(local|lan|internal|home\.arpa)$/.test(bare) ? "local" : "internet";
};

export const isLoopbackHost = (host: string) => hostClass(host) === "loopback";
