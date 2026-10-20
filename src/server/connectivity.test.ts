import { describe, expect, it } from "vitest";

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
  const link = makeConnectivity(fake.deps, testWatch(fake.deps).store, () => probeUrls);
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
    // This machine, the local network and the tailnet need no internet.
    for (const url of [
      "http://localhost:8080/",
      "http://localhost./",
      "http://127.0.0.1/",
      "http://0.0.0.0:8460/",
      "http://[::1]:3000/",
      "http://[::ffff:127.0.0.1]/",
      "http://app.localhost/",
      "http://192.168.1.10/",
      "http://10.0.0.2/",
      "http://172.20.0.5/",
      "http://100.65.64.7:8460/",
      "http://[fd7a:115c:a1e0::1]/",
      "http://nas.local/",
      "https://leviathan.tail5ed0f2.ts.net:8461/",
    ])
      expect(needsInternet({ kind: "http", config: { url } }), url).toBe(false);
    for (const url of ["https://example.com/", "http://172.32.0.1/", "http://8.8.8.8/", "http://[2606:4700::1111]/"])
      expect(needsInternet({ kind: "http", config: { url } }), url).toBe(true);
    expect(needsInternet({ kind: "github", config: {} })).toBe(true);
  });
});
