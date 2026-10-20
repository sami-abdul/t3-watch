import { describe, expect, it } from "vitest";

import { DEFAULT_PROBE_URLS, makeConnectivity, needsInternet } from "./connectivity.ts";
import { fakeDeps } from "./testkit.ts";

const setup = (probeUrls?: ReadonlyArray<string>) => {
  const net = { up: true, calls: [] as Array<string> };
  const fake = fakeDeps({
    fetch: (url) => {
      net.calls.push(url.toString());
      if (!net.up) throw new TypeError("fetch failed");
      return new Response(null, { status: 204 });
    },
  });
  return { link: makeConnectivity(fake.deps, () => probeUrls), net, advance: fake.advance };
};

describe("connectivity", () => {
  it("shares one probe among checks that fail together, reused for 15 seconds", async () => {
    const { link, net, advance } = setup();
    expect(await Promise.all([link.hold(), link.hold(), link.hold()])).toEqual([false, false, false]);
    expect(net.calls).toEqual([...DEFAULT_PROBE_URLS]);
    advance(10);
    await link.hold();
    expect(net.calls).toHaveLength(2);
    advance(6);
    await link.hold();
    expect(net.calls).toHaveLength(4);
  });

  it("holds while no probe address answers, until a check passes or the evidence lapses", async () => {
    const { link, net, advance } = setup();
    net.up = false;
    expect(await link.hold()).toBe(true);
    expect(link.link().offlineSince).toBe("2026-10-15T10:00:00.000Z");
    // A later failed probe keeps the time the spell began.
    advance(20);
    expect(await link.hold()).toBe(true);
    expect(link.link().offlineSince).toBe("2026-10-15T10:00:00.000Z");
    // A check that passes proves the link, even against the probe's reused answer.
    link.sawInternet();
    expect(link.link().offlineSince).toBeNull();
    expect(await link.hold()).toBe(false);
    // Without a failed probe for 30 minutes, Watch stops counting itself offline.
    advance(16);
    expect(await link.hold()).toBe(true);
    advance(31 * 60);
    expect(link.link().offlineSince).toBeNull();
  });

  it("lets a pass outrank a probe that began before it", async () => {
    const pending: Array<(error: Error) => void> = [];
    const fake = fakeDeps({ fetch: () => new Promise<Response>((_resolve, reject) => pending.push(reject)) });
    const link = makeConnectivity(fake.deps);
    const held = link.hold();
    link.sawInternet();
    for (const reject of pending) reject(new TypeError("fetch failed"));
    expect(await held).toBe(false);
    expect(link.link().offlineSince).toBeNull();
  });

  it("probes the configured addresses, and an empty list never holds", async () => {
    const custom = setup(["https://probe.example/ok"]);
    await custom.link.hold();
    expect(custom.net.calls).toEqual(["https://probe.example/ok"]);
    const off = setup([]);
    off.net.up = false;
    expect(await off.link.hold()).toBe(false);
    expect(off.net.calls).toEqual([]);
    // A malformed setting falls back to the defaults.
    const bad = setup(["ftp://probe.example/"]);
    await bad.link.hold();
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
