import { describe, expect, it } from "vitest";

import { DEFAULT_PROBE_URLS, heldWhenOffline, makeConnectivity, provesInternet } from "./connectivity.ts";
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

  it("doubts a probe list that disagrees with passing checks twice, and stops holding until a probe answers", async () => {
    const { link, net, advance } = setup();
    net.up = false;
    expect(await link.hold()).toBe(true);
    // A check reached the internet anyway, and the fresh probe still gets no answer.
    await link.sawInternet();
    expect(link.link().probesDisagree).toBe(false);
    advance(16);
    expect(await link.hold()).toBe(true);
    await link.sawInternet();
    expect(link.link()).toEqual({ offlineSince: null, probesDisagree: true });
    advance(16);
    expect(await link.hold()).toBe(false);
    expect(link.offline()).toBe(false);
    // A probe that answers clears the doubt.
    net.up = true;
    advance(16);
    await link.hold();
    expect(link.link().probesDisagree).toBe(false);
  });

  it("counts no disagreement when an outage simply ends", async () => {
    const { link, net, advance } = setup();
    for (let i = 0; i < 2; i++) {
      net.up = false;
      advance(16);
      expect(await link.hold()).toBe(true);
      net.up = true;
      await link.sawInternet();
    }
    expect(link.link().probesDisagree).toBe(false);
  });

  it("lets disagreements more than an hour apart pass without doubt", async () => {
    const { link, net, advance } = setup();
    net.up = false;
    await link.hold();
    await link.sawInternet();
    advance(61 * 60);
    await link.hold();
    await link.sawInternet();
    expect(link.link().probesDisagree).toBe(false);
  });

  it("probes the configured addresses, and an empty list never holds", async () => {
    const custom = setup(["https://probe.example/ok"]);
    await custom.link.hold();
    expect(custom.net.calls).toEqual(["https://probe.example/ok"]);
    const off = setup([]);
    off.net.up = false;
    expect(await off.link.hold()).toBe(false);
    expect(off.net.calls).toEqual([]);
    // A setting with any address that does not parse falls back to the defaults.
    for (const setting of [["ftp://probe.example/"], ["https://probe .example/"], ["https://ok.example/", 7]]) {
      const bad = setup(setting as ReadonlyArray<string>);
      await bad.link.hold();
      expect(bad.net.calls).toEqual([...DEFAULT_PROBE_URLS]);
    }
  });

  it("holds every check but heartbeats and this machine's, and only internet passes prove the link", () => {
    const http = (url: string) => ({ kind: "http" as const, config: { url } });
    expect(heldWhenOffline({ kind: "heartbeat", config: {} })).toBe(false);
    // This machine, and a check that fails on its own settings, are never held.
    for (const url of ["http://127.0.0.1:8080/", "http://0.0.0.0:8460/", "not a url"]) expect(heldWhenOffline(http(url)), url).toBe(false);
    for (const url of ["http://192.168.1.10/", "https://leviathan.tail5ed0f2.ts.net:8461/", "https://example.com/"])
      expect(heldWhenOffline(http(url)), url).toBe(true);
    expect(heldWhenOffline({ kind: "github", config: {} })).toBe(true);
    // A pass on the local network or the tailnet says nothing about the internet.
    for (const url of ["http://127.0.0.1/", "http://nas.local/", "http://100.65.64.7:8460/", "not a url"])
      expect(provesInternet(http(url)), url).toBe(false);
    expect(provesInternet(http("https://example.com/"))).toBe(true);
    // A vendor check counts by its vendor's API origin.
    const vendors = new Map([
      ["public", { api: { origin: "https://api.vendor.example" } }],
      ["lan", { api: { origin: "https://svc.tail5ed0f2.ts.net" } }],
    ]);
    expect(provesInternet({ kind: "vendor", config: { vendor: "public" } }, vendors)).toBe(true);
    expect(provesInternet({ kind: "vendor", config: { vendor: "lan" } }, vendors)).toBe(false);
    expect(heldWhenOffline({ kind: "vendor", config: { vendor: "lan" } }, vendors)).toBe(true);
    expect(provesInternet({ kind: "heartbeat", config: {} })).toBe(false);
  });
});
