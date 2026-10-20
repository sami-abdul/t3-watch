import { describe, expect, it } from "vitest";

import type { WatchConfig } from "./config.ts";
import { DEFAULT_PROBE_URLS, makeConnectivity, needsInternet } from "./connectivity.ts";
import { fakeDeps, testWatch } from "./testkit.ts";

const setup = (probeUrls?: ReadonlyArray<string>) => {
  const net = { up: true, calls: [] as Array<string> };
  const fake = fakeDeps({
    fetch: (url) => {
      net.calls.push(url.toString());
      if (!net.up) throw new TypeError("fetch failed");
      return new Response(null, { status: 204 });
    },
  });
  const config: WatchConfig = { port: 0, host: "127.0.0.1", token: "t", roots: [], publicUrl: null, ...(probeUrls === undefined ? {} : { probeUrls }) };
  const link = makeConnectivity(fake.deps, testWatch(fake.deps).store, () => config);
  return { link, net, advance: fake.advance };
};

describe("connectivity", () => {
  it("probes once for checks that fail together and reuses the answer for a minute", async () => {
    const { link, net, advance } = setup();
    expect(await Promise.all([link.online(), link.online(), link.online()])).toEqual([true, true, true]);
    expect(net.calls).toEqual([...DEFAULT_PROBE_URLS]);
    advance(30);
    await link.online();
    expect(net.calls).toHaveLength(2);
    advance(31);
    await link.online();
    expect(net.calls).toHaveLength(4);
  });

  it("goes offline when no probe address answers, and back online when a check passes", async () => {
    const { link, net, advance } = setup();
    net.up = false;
    expect(await link.online()).toBe(false);
    expect(link.link().offlineSince).toBe("2026-10-15T10:00:00.000Z");
    // Still offline a probe later, and it keeps the time it went offline.
    advance(120);
    expect(await link.online()).toBe(false);
    expect(link.link().offlineSince).toBe("2026-10-15T10:00:00.000Z");
    link.sawInternet();
    expect(link.link().offlineSince).toBeNull();
    // A recent pass answers without a probe.
    const probes = net.calls.length;
    expect(await link.online()).toBe(true);
    expect(net.calls).toHaveLength(probes);
  });

  it("probes the configured addresses, and an empty list never holds", async () => {
    const custom = setup(["https://probe.example/ok"]);
    await custom.link.online();
    expect(custom.net.calls).toEqual(["https://probe.example/ok"]);
    const off = setup([]);
    off.net.up = false;
    expect(await off.link.online()).toBe(true);
    expect(off.net.calls).toEqual([]);
    // A malformed setting falls back to the defaults.
    const bad = setup(["ftp://probe.example/"]);
    await bad.link.online();
    expect(bad.net.calls).toEqual([...DEFAULT_PROBE_URLS]);
  });

  it("knows which checks need the internet", () => {
    expect(needsInternet({ kind: "heartbeat", config: {} })).toBe(false);
    for (const url of ["http://localhost:8080/", "http://127.0.0.1/", "http://[::1]:3000/", "http://app.localhost/"])
      expect(needsInternet({ kind: "http", config: { url } })).toBe(false);
    expect(needsInternet({ kind: "http", config: { url: "https://example.com/" } })).toBe(true);
    expect(needsInternet({ kind: "github", config: {} })).toBe(true);
  });
});
