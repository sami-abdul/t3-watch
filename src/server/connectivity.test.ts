import { describe, expect, it } from "vitest";

import { DEFAULT_PROBE_URLS, heldWhenOffline, makeConnectivity, onTheInternet, provesInternet, siteOf } from "./connectivity.ts";
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

/** One probe address that answers after `probe.ms` on the fake clock, or not at all while it is down. */
const timedSetup = () => {
  const probe = { ms: 100, up: true, calls: 0 };
  const fake = fakeDeps({
    fetch: async () => {
      probe.calls++;
      if (!probe.up) throw new TypeError("fetch failed");
      fake.advance(probe.ms / 1000);
      return new Response(null, { status: 204 });
    },
  });
  return { link: makeConnectivity(fake.deps, () => ["https://probe.test/"]), probe, advance: fake.advance };
};

describe("a slow link", () => {
  it("is a probe that takes a second or more, and holds only failures a slow link explains", async () => {
    const { link, probe, advance } = timedSetup();
    expect(await link.hold(true)).toBeNull();
    expect(link.slow()).toBe(false);
    probe.ms = 1500;
    advance(16);
    expect(await link.hold(true)).toBe("slow");
    expect(link.link()).toEqual({ offlineSince: null, probesDisagree: false, slowSince: "2026-10-15T10:00:17.600Z" });
    // A failure a slow link does not explain, such as an HTTP answer, is counted, even now.
    expect(await link.hold(false)).toBeNull();
    expect(link.slow()).toBe(true);
    // A later slow probe keeps the time the spell began, whatever failure set it off.
    advance(16);
    expect(await link.hold(false)).toBeNull();
    advance(29 * 60);
    expect(link.link().slowSince).toBe("2026-10-15T10:00:17.600Z");
  });

  it("is a smaller delay too while checks on two hosts newly fail at once", async () => {
    const { link, probe, advance } = timedSetup();
    probe.ms = 500;
    link.failed("a.test");
    expect(await link.hold(true)).toBeNull();
    // The same host again is still one host.
    advance(16);
    link.failed("a.test");
    expect(await link.hold(true)).toBeNull();
    advance(16);
    link.failed("b.test");
    expect(await link.hold(true)).toBe("slow");
    // Two minutes on, those failures no longer count as at once, and the spell ends.
    advance(150);
    link.failed("c.test");
    expect(await link.hold(true)).toBeNull();
    expect(link.slow()).toBe(false);
  });

  it("ends on a probe that no longer shows it, a quick pass, going offline, or half an hour without a slow probe", async () => {
    const { link, probe, advance } = timedSetup();
    probe.ms = 2000;
    expect(await link.hold(true)).toBe("slow");
    // A probe of 700 ms with one failing host is not slow, so the spell ends with it.
    probe.ms = 700;
    advance(16);
    expect(await link.hold(true)).toBeNull();
    expect(link.link().slowSince).toBeNull();
    probe.ms = 2000;
    advance(16);
    expect(await link.hold(true)).toBe("slow");
    // A pass that took two seconds says nothing about the link; one within 400 ms ends the spell.
    void link.sawInternet({ requestMs: 2000 });
    expect(link.slow()).toBe(true);
    void link.sawInternet({ requestMs: 150 });
    expect(link.slow()).toBe(false);
    advance(16);
    expect(await link.hold(true)).toBe("slow");
    // Offline ends it, and coming back does not bring the old spell back.
    probe.up = false;
    advance(16);
    expect(await link.hold(true)).toBe("offline");
    expect(link.link()).toMatchObject({ offlineSince: "2026-10-15T10:01:10.700Z", slowSince: null });
    probe.up = true;
    probe.ms = 100;
    advance(60);
    await link.sawInternet({ requestMs: 2500 });
    expect(link.link()).toMatchObject({ offlineSince: null, slowSince: null });
    probe.ms = 2000;
    advance(16);
    expect(await link.hold(true)).toBe("slow");
    advance(31 * 60);
    expect(link.link().slowSince).toBeNull();
  });

  it("lets a quick pass outrank a slow probe that began before it", async () => {
    const answers: Array<() => void> = [];
    const fake = fakeDeps({ fetch: () => new Promise<Response>((resolve) => answers.push(() => resolve(new Response(null, { status: 204 })))) });
    const link = makeConnectivity(fake.deps, () => ["https://probe.test/"]);
    const held = link.hold(true);
    fake.advance(1);
    void link.sawInternet({ requestMs: 120 });
    fake.advance(1);
    for (const answer of answers.splice(0)) answer();
    expect(await held).toBeNull();
    expect(link.slow()).toBe(false);
    // Nor does a slow answer reused from the 15 seconds after it.
    const again = timedSetup();
    again.probe.ms = 2000;
    expect(await again.link.hold(true)).toBe("slow");
    again.advance(5);
    void again.link.sawInternet({ requestMs: 150 });
    again.advance(5);
    expect(await again.link.hold(true)).toBeNull();
    expect(again.link.slow()).toBe(false);
  });

  it("takes probes that all run out of time while a check passes for a link that works, slowly", async () => {
    const timeouts: Array<() => void> = [];
    const fake = fakeDeps({
      fetch: () =>
        new Promise<Response>((_resolve, reject) => timeouts.push(() => reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")))),
    });
    const link = makeConnectivity(fake.deps, () => ["https://probe.test/"]);
    const held = link.hold(true);
    // A check finishes passing a second after the probe began, then the probe runs out of time.
    fake.advance(1);
    void link.sawInternet({ requestMs: 9000 });
    fake.advance(4);
    for (const timeout of timeouts.splice(0)) timeout();
    expect(await held).toBe("slow");
    expect(link.link()).toMatchObject({ offlineSince: null, slowSince: "2026-10-15T10:00:05.000Z" });
  });

  it("counts names on one site once, so two names on one server are not two sites failing", async () => {
    expect(["app.example.com", "Example.COM.", "a.b.example.co.uk", "192.0.2.1"].map(siteOf)).toEqual(["example.com", "example.com", "example.co.uk", "192.0.2.1"]);
    const { link, probe } = timedSetup();
    probe.ms = 500;
    link.failed("app.example.com");
    link.failed("api.example.com");
    expect(await link.hold(true)).toBeNull();
    link.failed("status.other.test");
    expect(await link.hold(true)).toBe("slow");
  });

  it("begins on a recheck that answers slowly, and keeps its order when the wall clock is set back", async () => {
    const { link, probe, advance } = timedSetup();
    probe.up = false;
    expect(await link.hold(true)).toBe("offline");
    // Back online: a check passes, and the recheck it sets off answers in 3 seconds.
    probe.up = true;
    probe.ms = 3000;
    advance(30);
    await link.sawInternet();
    expect(link.link()).toMatchObject({ offlineSince: null, slowSince: "2026-10-15T10:00:33.000Z" });
    // A quick pass, then the wall clock jumps back an hour: a later slow probe still counts.
    let steady = 0;
    const fake = fakeDeps({
      fetch: async () => {
        fake.advance(2);
        steady += 2000;
        return new Response(null, { status: 204 });
      },
    });
    const stepped = makeConnectivity({ ...fake.deps, monotonic: () => steady }, () => ["https://probe.test/"]);
    steady = 10_000;
    void stepped.sawInternet({ requestMs: 100 });
    fake.advance(-3600);
    steady += 20_000;
    expect(await stepped.hold(true)).toBe("slow");
  });

  it("counts time asleep and a step of the wall clock as each should", async () => {
    let steady = 0;
    const calls = { n: 0 };
    const fake = fakeDeps({
      fetch: async () => {
        calls.n++;
        fake.advance(2);
        steady += 2000;
        return new Response(null, { status: 204 });
      },
    });
    const link = makeConnectivity({ ...fake.deps, monotonic: () => steady }, () => ["https://probe.test/"]);
    expect(await link.hold(true)).toBe("slow");
    // Asleep for eight hours, the steady clock stands still and the wall clock does not: the spell lapses.
    fake.advance(8 * 3600);
    steady += 1000;
    expect(link.slow()).toBe(false);
    // A probe is not reused across a step of the wall clock back, though the steady clock says it is recent.
    expect(await link.hold(true)).toBe("slow");
    fake.advance(-3600);
    steady += 5000;
    await link.hold(true);
    expect(calls.n).toBe(3);
  });

  it("keeps a pass from before a step of the wall clock from hiding a link that then drops", async () => {
    let steady = 0;
    const net = { up: true };
    const fake = fakeDeps({
      fetch: async () => {
        if (!net.up) throw new TypeError("fetch failed");
        return new Response(null, { status: 204 });
      },
    });
    const link = makeConnectivity({ ...fake.deps, monotonic: () => steady }, () => ["https://probe.test/"]);
    void link.sawInternet();
    fake.advance(-3600);
    steady += 60_000;
    net.up = false;
    expect(await link.hold(true)).toBe("offline");
  });

  it("is told only by web and vendor checks on the public internet", () => {
    const http = (url: string) => ({ kind: "http" as const, config: { url } });
    expect(["https://shop.example.com/", "https://203.0.113.9/"].map((url) => onTheInternet(http(url)))).toEqual([true, true]);
    expect(["http://nas:8080/", "http://fritz.box/", "https://192.168.1.20/", "http://printer.lan/", "https://router.home/"].map((url) => onTheInternet(http(url)))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(onTheInternet({ kind: "github", config: { repo: "acme/api" } })).toBe(false);
  });

  it("never comes from an empty probe list", async () => {
    const none = makeConnectivity(fakeDeps({}).deps, () => []);
    none.failed("a.test");
    none.failed("b.test");
    expect(await none.hold(true)).toBeNull();
  });
});

describe("connectivity", () => {
  it("shares one probe among checks that fail together, reused for 15 seconds", async () => {
    const { link, net, advance } = setup();
    expect(await Promise.all([link.hold(), link.hold(), link.hold()])).toEqual([null, null, null]);
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
    expect(await link.hold()).toBe("offline");
    expect(link.link().offlineSince).toBe("2026-10-15T10:00:00.000Z");
    // A later failed probe keeps the time the spell began.
    advance(20);
    expect(await link.hold()).toBe("offline");
    expect(link.link().offlineSince).toBe("2026-10-15T10:00:00.000Z");
    // A check that passes proves the link, even against the probe's reused answer.
    link.sawInternet();
    expect(link.link().offlineSince).toBeNull();
    expect(await link.hold()).toBeNull();
    // Without a failed probe for 30 minutes, Watch stops counting itself offline.
    advance(16);
    expect(await link.hold()).toBe("offline");
    advance(31 * 60);
    expect(link.link().offlineSince).toBeNull();
  });

  it("lets a pass outrank a probe that began before it", async () => {
    const pending: Array<(error: Error) => void> = [];
    const fake = fakeDeps({ fetch: () => new Promise<Response>((_resolve, reject) => pending.push(reject)) });
    const link = makeConnectivity(fake.deps);
    const held = link.hold();
    // It finished passing after the probe began; one finished at the same instant would not outrank it.
    fake.advance(1);
    link.sawInternet();
    for (const reject of pending) reject(new TypeError("fetch failed"));
    expect(await held).toBeNull();
    expect(link.link().offlineSince).toBeNull();
  });

  it("doubts a probe list that disagrees with passing checks twice, and stops holding until a probe answers", async () => {
    const { link, net, advance } = setup();
    net.up = false;
    expect(await link.hold()).toBe("offline");
    // A check reached the internet anyway, and the fresh probe still gets no answer.
    await link.sawInternet();
    expect(link.link().probesDisagree).toBe(false);
    advance(16);
    expect(await link.hold()).toBe("offline");
    await link.sawInternet();
    expect(link.link()).toEqual({ offlineSince: null, probesDisagree: true, slowSince: null });
    advance(16);
    expect(await link.hold()).toBeNull();
    expect(link.offline()).toBe(false);
    // A probe that answers clears the doubt.
    net.up = true;
    advance(16);
    await link.hold();
    expect(link.link().probesDisagree).toBe(false);
  });

  it("keeps the doubt past an hour, rechecking the list every 5 minutes until it answers", async () => {
    const { link, net, advance } = setup();
    net.up = false;
    await link.hold();
    await link.sawInternet();
    advance(16);
    await link.hold();
    await link.sawInternet();
    expect(link.link().probesDisagree).toBe(true);
    advance(2 * 3600);
    expect(link.link().probesDisagree).toBe(true);
    // One recheck now, none a minute later, and once the list answers the doubt clears.
    const probes = net.calls.length;
    await link.sawInternet();
    expect(net.calls.length).toBeGreaterThan(probes);
    const rechecked = net.calls.length;
    advance(60);
    await link.sawInternet();
    expect(net.calls).toHaveLength(rechecked);
    net.up = true;
    advance(5 * 60);
    await link.sawInternet();
    expect(link.link().probesDisagree).toBe(false);
  });

  it("counts nothing from a slow recheck once a newer probe has answered", async () => {
    const net = { up: false, hang: false };
    const hanging: Array<(error: Error) => void> = [];
    const fake = fakeDeps({
      fetch: () => {
        if (net.hang) return new Promise<Response>((_resolve, reject) => hanging.push(reject));
        if (!net.up) throw new TypeError("fetch failed");
        return new Response(null, { status: 204 });
      },
    });
    const link = makeConnectivity(fake.deps);
    expect(await link.hold()).toBe("offline");
    net.hang = true;
    const slow = link.sawInternet();
    net.hang = false;
    net.up = true;
    fake.advance(16);
    expect(await link.hold()).toBeNull();
    for (const reject of hanging) reject(new TypeError("fetch failed"));
    await slow;
    // One real disagreement now would make two if the slow recheck had counted.
    net.up = false;
    fake.advance(16);
    await link.hold();
    await link.sawInternet();
    expect(link.link().probesDisagree).toBe(false);
  });

  it("does not let an answer from a probe begun before a newer disagreement clear it", async () => {
    const net = { up: false, hang: false };
    const hanging: Array<(response: Response) => void> = [];
    const fake = fakeDeps({
      fetch: () => {
        if (net.hang) return new Promise<Response>((resolve) => hanging.push(resolve));
        if (!net.up) throw new TypeError("fetch failed");
        return new Response(null, { status: 204 });
      },
    });
    const link = makeConnectivity(fake.deps);
    await link.hold();
    await link.sawInternet();
    fake.advance(16);
    await link.hold();
    // A probe begins and hangs; then a check passes and the fresh probe fails: the second disagreement.
    fake.advance(16);
    net.hang = true;
    const older = link.hold();
    net.hang = false;
    fake.advance(1);
    await link.sawInternet();
    expect(link.link().probesDisagree).toBe(true);
    // The older probe answers late, and the doubt stays.
    for (const resolve of hanging) resolve(new Response(null, { status: 204 }));
    await older;
    expect(link.link().probesDisagree).toBe(true);
  });

  it("lets a probe begun after a failing recheck clear the doubt, even when it answers later", async () => {
    const net = { up: false, hang: false };
    const hanging: Array<{ resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
    const fake = fakeDeps({
      fetch: () => {
        if (net.hang) return new Promise<Response>((resolve, reject) => hanging.push({ resolve, reject }));
        if (!net.up) throw new TypeError("fetch failed");
        return new Response(null, { status: 204 });
      },
    });
    const link = makeConnectivity(fake.deps);
    await link.hold();
    await link.sawInternet();
    fake.advance(16);
    await link.hold();
    // A recheck begins, then a probe; the recheck fails first, then the probe answers.
    net.hang = true;
    fake.advance(1);
    const recheck = link.sawInternet();
    // Past the 15-second reuse window, so the probe is a new one.
    fake.advance(15);
    const probe = link.hold();
    for (const pending of hanging.slice(0, 2)) pending.reject(new TypeError("fetch failed"));
    await recheck;
    expect(link.link().probesDisagree).toBe(true);
    hanging[2]!.resolve(new Response(null, { status: 204 }));
    await probe;
    expect(link.link().probesDisagree).toBe(false);
  });

  it("counts no disagreement when an outage simply ends", async () => {
    const { link, net, advance } = setup();
    for (let i = 0; i < 2; i++) {
      net.up = false;
      advance(16);
      expect(await link.hold()).toBe("offline");
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
    expect(await off.link.hold()).toBeNull();
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
