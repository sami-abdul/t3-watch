import { describe, expect, it } from "vitest";

import { makeWatch } from "./app.ts";
import { homeText, readState } from "./state.ts";
import type { ChangeEvent } from "./store.ts";
import { fakeDeps, fetchFailed, testWatch } from "./testkit.ts";

describe("runner", () => {
  it("runs due checks, records runs and emits one event per change", async () => {
    let status = 200;
    const fake = fakeDeps({ fetch: () => new Response("", { status }) });
    const watch = testWatch(fake.deps);
    const events: Array<ChangeEvent> = [];
    watch.onEvent((event) => events.push(event));
    watch.defineCheck(
      { id: "c", serviceId: "s", kind: "http", intent: "Site is up", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" },
      "on",
    );
    await watch.runner.tick();
    expect(events).toHaveLength(0);
    status = 500;
    fake.advance(30);
    await watch.runner.tick();
    expect(watch.store.runs("c")).toHaveLength(1);
    fake.advance(31);
    await watch.runner.tick();
    fake.advance(61);
    await watch.runner.tick();
    expect(events.map((e) => [e.from, e.to])).toEqual([["pass", "fail"]]);
    status = 200;
    fake.advance(61);
    await watch.runner.tick();
    expect(events.map((e) => e.to)).toEqual(["fail", "pass"]);
  });

  it("records an event for a new check only when its first two runs fail", async () => {
    const fake = fakeDeps({ fetch: () => new Response("", { status: 500 }) });
    const watch = testWatch(fake.deps);
    const events: Array<ChangeEvent> = [];
    watch.onEvent((event) => events.push(event));
    watch.defineCheck(
      { id: "c", serviceId: "s", kind: "http", intent: "x", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" },
      "on",
    );
    await watch.runner.tick();
    expect(events).toHaveLength(0);
    fake.advance(61);
    await watch.runner.tick();
    expect(events).toHaveLength(1);
  });

  it("keeps one bad run pending, and lets the next run clear it with no event", async () => {
    let status = 200;
    const fake = fakeDeps({ fetch: () => new Response("", { status }) });
    const watch = testWatch(fake.deps);
    const events: Array<ChangeEvent> = [];
    watch.onEvent((event) => events.push(event));
    watch.defineCheck(
      { id: "c", serviceId: "s", kind: "http", intent: "Site is up", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 300, origin: "user" },
      "on",
    );
    await watch.runner.tick();
    status = 500;
    fake.advance(301);
    await watch.runner.tick();
    expect(watch.store.check("c")!.lastOutcome).toBe("pass");
    expect(watch.store.check("c")!.pending).toMatchObject({ outcome: "fail" });
    expect(watch.store.runs("c")[0]!.summary).toMatch(/^Failed once, checking again: Answered 500/);
    expect(homeText(readState(watch))).toContain("Checking again after one bad run:\n- s: Site is up (c): Failed once, checking again: Answered 500");
    // The confirming run comes a minute later, not at the 5-minute cadence, and here it passes.
    status = 200;
    fake.advance(61);
    await watch.runner.tick();
    expect(watch.store.runs("c")).toHaveLength(3);
    expect(watch.store.check("c")!.lastOutcome).toBe("pass");
    expect(events).toEqual([]);
  });

  it("fails a check on the second bad run in a row, a minute after the first", async () => {
    let status = 200;
    const fake = fakeDeps({ fetch: () => new Response("", { status }) });
    const watch = testWatch(fake.deps);
    const events: Array<ChangeEvent> = [];
    watch.onEvent((event) => events.push(event));
    watch.defineCheck(
      { id: "c", serviceId: "s", kind: "http", intent: "Site is up", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 300, origin: "user" },
      "on",
    );
    await watch.runner.tick();
    status = 500;
    fake.advance(301);
    await watch.runner.tick();
    fake.advance(61);
    await watch.runner.tick();
    expect(watch.store.check("c")!.lastOutcome).toBe("fail");
    expect(events.map((e) => [e.from, e.to])).toEqual([["pass", "fail"]]);
    // Recovery counts at once.
    status = 200;
    fake.advance(301);
    await watch.runner.tick();
    expect(events.map((e) => e.to)).toEqual(["fail", "pass"]);
  });

  it("clears a pending run when the check is paused", async () => {
    let status = 200;
    const fake = fakeDeps({ fetch: () => new Response("", { status }) });
    const watch = testWatch(fake.deps);
    const events: Array<ChangeEvent> = [];
    watch.onEvent((event) => events.push(event));
    watch.defineCheck(
      { id: "c", serviceId: "s", kind: "http", intent: "Site is up", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" },
      "on",
    );
    await watch.runner.tick();
    status = 500;
    fake.advance(61);
    await watch.runner.tick();
    // Paused before the confirming run, and resumed ten minutes later.
    await watch.setCheck("c", "pause");
    fake.advance(600);
    await watch.setCheck("c", "resume");
    await watch.runner.tick();
    expect(watch.store.check("c")!.lastOutcome).toBe("pass");
    expect(events).toEqual([]);
  });

  it("records a run someone asked for as it is", async () => {
    let status = 200;
    const fake = fakeDeps({ fetch: () => new Response("", { status }) });
    const watch = testWatch(fake.deps);
    watch.defineCheck(
      { id: "c", serviceId: "s", kind: "http", intent: "Site is up", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 300, origin: "user" },
      "on",
    );
    await watch.runner.tick();
    status = 500;
    await watch.setCheck("c", "run");
    expect(watch.store.check("c")!.lastOutcome).toBe("fail");
    expect(watch.store.events().map((e) => e.to)).toEqual(["fail"]);
  });

  it("confirms within the cadence when that is under a minute", async () => {
    let status = 200;
    const fake = fakeDeps({ fetch: () => new Response("", { status }) });
    const watch = testWatch(fake.deps);
    watch.defineCheck(
      { id: "c", serviceId: "s", kind: "http", intent: "Site is up", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 30, origin: "user" },
      "on",
    );
    await watch.runner.tick();
    status = 500;
    fake.advance(31);
    await watch.runner.tick();
    fake.advance(31);
    await watch.runner.tick();
    expect(watch.store.check("c")!.lastOutcome).toBe("fail");
  });

  it("makes an event when a run that could not run confirms a pending failure", () => {
    const watch = testWatch(fakeDeps({}).deps);
    watch.defineCheck(
      { id: "c", serviceId: "s", kind: "http", intent: "Site is up", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" },
      "on",
    );
    const at = "2026-10-15T10:00:00.000Z";
    watch.store.recordPending("c", { outcome: "fail", summary: "Answered 500", evidence: {} }, at, 1, at);
    const event = watch.store.recordRun(watch.store.check("c")!, { outcome: "unknown", summary: "Could not run", evidence: {} }, at, 1, at);
    expect(event?.to).toBe("unknown");
    expect(watch.store.check("c")!.pending).toBeNull();
  });

  it("keeps a pending run through the same definition and clears it for a new one", () => {
    const watch = testWatch(fakeDeps({}).deps);
    const define = (url: string, keyId: string | null = null) =>
      watch.defineCheck(
        { id: "c", serviceId: "s", kind: "http", intent: "Site is up", config: { url }, keyId, cadenceSeconds: 60, origin: "user" },
        "on",
      );
    const at = "2026-10-15T10:00:00.000Z";
    const pend = () => watch.store.recordPending("c", { outcome: "fail", summary: "Answered 500", evidence: {} }, at, 1, at);
    define("https://x.test");
    pend();
    define("https://x.test");
    expect(watch.store.check("c")!.pending).toMatchObject({ outcome: "fail" });
    define("https://y.test");
    expect(watch.store.check("c")!.pending).toBeNull();
    pend();
    define("https://y.test", "key-2");
    expect(watch.store.check("c")!.pending).toBeNull();
  });

  it("says a pending run could not run when that is what happened", () => {
    const watch = testWatch(fakeDeps({}).deps);
    watch.defineCheck(
      { id: "c", serviceId: "s", kind: "http", intent: "Site is up", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" },
      "on",
    );
    const at = "2026-10-15T10:00:00.000Z";
    watch.store.recordPending("c", { outcome: "unknown", summary: "The key was refused", evidence: {} }, at, 1, at);
    expect(watch.store.runs("c")[0]!.summary).toBe("Could not run once, checking again: The key was refused");
  });

  it("skips paused and snoozed checks until the snooze ends", async () => {
    const fake = fakeDeps({ fetch: () => new Response("", { status: 200 }) });
    const watch = testWatch(fake.deps);
    watch.defineCheck(
      { id: "c", serviceId: "s", kind: "http", intent: "x", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" },
      "on",
    );
    await watch.setCheck("c", "pause");
    await watch.runner.tick();
    expect(watch.store.runs("c")).toHaveLength(0);
    await watch.setCheck("c", "snooze", "2026-10-15T12:00:00.000Z");
    await watch.runner.tick();
    expect(watch.store.runs("c")).toHaveLength(0);
    fake.advance(2 * 3600 + 1);
    await watch.runner.tick();
    expect(watch.store.runs("c")).toHaveLength(1);
    expect(watch.store.check("c")!.snoozedUntil).toBeNull();
  });
});

const SITE = "https://site.example/";

/**
 * A Watch with holding on, an internet link and a site that each go up and down, a NAS on the local
 * network that always answers, and one HTTP check on the site.
 */
const setup = () => {
  const net = { up: true, site: true, probes: 0 };
  const fake = fakeDeps({
    fetch: (url) => {
      if (url.hostname === "192.168.1.10") return new Response("ok");
      if (url.href !== SITE) net.probes++;
      if (!net.up) throw new TypeError("fetch failed");
      return url.href === SITE && !net.site ? new Response("down", { status: 503 }) : new Response("ok");
    },
  });
  const watch = makeWatch({ home: null, dbFile: ":memory:", deps: fake.deps });
  watch.defineCheck(
    { id: "site", serviceId: "s", kind: "http", intent: "The site answers", config: { url: SITE }, keyId: null, cadenceSeconds: 300, origin: "user" },
    "on",
  );
  return { watch, net, advance: fake.advance };
};

describe("runner while Watch is offline", () => {
  it("holds a failure while Watch cannot reach the internet, and records it once it can", async () => {
    const { watch, net, advance } = setup();
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastOutcome).toBe("pass");

    // The link drops: the check fails, no probe answers, and the failure is held.
    net.up = false;
    advance(301);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastOutcome).toBe("pass");
    expect(watch.store.events()).toEqual([]);
    expect(watch.store.runs("site")[0]!.summary).toMatch(/^Held while Watch could not reach the internet: Could not connect/);
    expect(watch.link().offlineSince).not.toBeNull();

    // The link is back but the site is down: that failure is real, once a second run confirms it.
    net.up = true;
    net.site = false;
    advance(301);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastOutcome).toBe("pass");
    advance(61);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastOutcome).toBe("fail");
    expect(watch.store.events().map((e) => `${e.from} -> ${e.to}`)).toEqual(["pass -> fail"]);
    expect(watch.link().offlineSince).toBeNull();
  });

  it("holds a check's failures for at most an hour in a row", async () => {
    const { watch, net, advance } = setup();
    await watch.runner.tick();
    net.up = false;
    for (let i = 0; i < 12; i++) {
      advance(301);
      await watch.runner.tick();
    }
    expect(watch.store.check("site")!.lastOutcome).toBe("pass");
    // Past the cap the failure is recorded as pending, and the next run fails the check.
    advance(301);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastOutcome).toBe("pass");
    advance(61);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastOutcome).toBe("fail");
    expect(watch.store.events().map((e) => `${e.from} -> ${e.to}`)).toEqual(["pass -> fail"]);
  });

  it("keeps a failing check's real reason once Watch knows it is offline", async () => {
    const { watch, net, advance } = setup();
    watch.defineCheck(
      { id: "other", serviceId: "s", kind: "http", intent: "Another site answers", config: { url: "https://other.example/" }, keyId: null, cadenceSeconds: 60, origin: "user" },
      "on",
    );
    net.site = false;
    await watch.runner.tick();
    advance(61);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastSummary).toMatch(/503/);
    // The link drops and the other site's failure shows Watch is offline before the site runs again.
    net.up = false;
    advance(61);
    await watch.runner.tick();
    expect(watch.link().offlineSince).not.toBeNull();
    advance(250);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastSummary).toMatch(/503/);
    expect(watch.store.runs("site")[0]!.summary).toMatch(/^Held while Watch could not reach the internet/);
  });

  it("keeps a check capped while Watch stays offline", async () => {
    const { watch, net, advance } = setup();
    await watch.runner.tick();
    net.up = false;
    for (let i = 0; i < 14; i++) {
      advance(301);
      await watch.runner.tick();
    }
    // The cap recorded the failure; the next one is recorded too, marked, with no second event.
    expect(watch.store.check("site")!.lastOutcome).toBe("fail");
    expect(watch.store.runs("site")[0]!.evidence).toMatchObject({ heldTooLong: true });
    expect(watch.store.events()).toHaveLength(1);
  });

  /** A Watch whose site request and probe each wait at a gate, to change the check mid-run. */
  const gated = () => {
    const gates = { site: Promise.resolve(), probe: Promise.resolve() };
    let reached = { site: () => {}, probe: () => {} };
    const at = (name: "site" | "probe") => {
      let open = () => {};
      gates[name] = new Promise<void>((resolve) => (open = resolve));
      const there = new Promise<void>((resolve) => (reached = { ...reached, [name]: resolve }));
      return { open, there };
    };
    let site = true;
    const fake = fakeDeps({
      fetch: async (url) => {
        const name = url.href === SITE ? "site" : "probe";
        reached[name]();
        await gates[name];
        if (name === "probe") return new Response(null, { status: 204 });
        return site ? new Response("ok") : new Response("down", { status: 503 });
      },
    });
    const watch = makeWatch({ home: null, dbFile: ":memory:", deps: fake.deps });
    const define = () =>
      watch.defineCheck(
        { id: "site", serviceId: "s", kind: "http", intent: "The site answers", config: { url: SITE }, keyId: null, cadenceSeconds: 300, origin: "user" },
        "on",
      );
    define();
    return { watch, fake, at, define, down: () => (site = false) };
  };

  it("lets a pause made during the probe win over the run", async () => {
    const { watch, fake, at, down } = gated();
    await watch.runner.tick();
    down();
    fake.advance(301);
    const probe = at("probe");
    const ticking = watch.runner.tick();
    await probe.there;
    await watch.setCheck("site", "pause");
    probe.open();
    await ticking;
    expect(watch.store.check("site")).toMatchObject({ state: "paused", pending: null, nextRunAt: null, lastOutcome: "pass" });
  });

  it("lets a pause made during the run itself win over it", async () => {
    const { watch, fake, at, down } = gated();
    await watch.runner.tick();
    down();
    fake.advance(301);
    const site = at("site");
    const ticking = watch.runner.tick();
    await site.there;
    await watch.setCheck("site", "pause");
    site.open();
    await ticking;
    expect(watch.store.check("site")).toMatchObject({ state: "paused", pending: null, nextRunAt: null, lastOutcome: "pass" });
  });

  it("keeps the run when the same definition is applied again during the probe", async () => {
    const { watch, fake, at, define, down } = gated();
    await watch.runner.tick();
    down();
    fake.advance(301);
    const probe = at("probe");
    const ticking = watch.runner.tick();
    await probe.there;
    define();
    probe.open();
    await ticking;
    expect(watch.store.check("site")!.pending).toMatchObject({ outcome: "fail" });
  });

  it("lets a held run sit between a pending run and the one that confirms it", async () => {
    const { watch, net, advance } = setup();
    await watch.runner.tick();
    net.site = false;
    advance(301);
    await watch.runner.tick();
    expect(watch.store.check("site")!.pending).toMatchObject({ outcome: "fail" });
    // The link drops for the next run, which is held, then comes back for the one after.
    net.up = false;
    advance(61);
    await watch.runner.tick();
    expect(watch.store.runs("site")[0]!.summary).toMatch(/^Held while/);
    net.up = true;
    advance(301);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastOutcome).toBe("fail");
    expect(watch.store.events().map((e) => `${e.from} -> ${e.to}`)).toEqual(["pass -> fail"]);
  });

  it("stops holding once the probe list disagrees with passing checks twice", async () => {
    const probes = new Set(["https://www.gstatic.com/generate_204", "https://one.one.one.one/cdn-cgi/trace"]);
    let siteUp = true;
    const fake = fakeDeps({
      fetch: (url) => {
        if (probes.has(url.href)) throw new TypeError("blocked");
        if (url.href === SITE && !siteUp) return new Response("down", { status: 503 });
        return new Response("ok");
      },
    });
    const watch = makeWatch({ home: null, dbFile: ":memory:", deps: fake.deps });
    const define = (id: string, url: string, cadenceSeconds: number) =>
      watch.defineCheck({ id, serviceId: "s", kind: "http", intent: id, config: { url }, keyId: null, cadenceSeconds, origin: "user" }, "on");
    define("site", SITE, 60);
    define("other", "https://other.example/", 3600);
    await watch.runner.tick();
    siteUp = false;
    // Twice: the site's failure finds the probes silent, then another public site answers anyway.
    for (let i = 0; i < 2; i++) {
      fake.advance(61);
      await watch.runner.tick();
      expect(watch.store.check("site")!.lastOutcome).toBe("pass");
      await watch.setCheck("other", "run");
    }
    expect(watch.link()).toEqual({ offlineSince: null, probesDisagree: true, slowSince: null });
    expect(homeText(readState(watch)).split("\n")[0]).toMatch(/^Watch's probe addresses do not answer .* set probeUrls in Watch's config\.json/);
    // No longer held: the next two failing runs fail the site and alert.
    fake.advance(61);
    await watch.runner.tick();
    fake.advance(61);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastOutcome).toBe("fail");
    expect(watch.store.events().map((e) => `${e.from} -> ${e.to}`)).toEqual(["pass -> fail"]);
  });

  it("does not hold up a scheduled run while the recheck it set off hangs", async () => {
    const probes = new Set(["https://www.gstatic.com/generate_204", "https://one.one.one.one/cdn-cgi/trace"]);
    const net = { siteUp: true, hang: false };
    const hanging: Array<(error: Error) => void> = [];
    const fake = fakeDeps({
      fetch: (url) => {
        if (probes.has(url.href)) {
          if (net.hang) return new Promise<Response>((_resolve, reject) => hanging.push(reject));
          throw new TypeError("blocked");
        }
        return url.href === SITE && !net.siteUp ? new Response("down", { status: 503 }) : new Response("ok");
      },
    });
    const watch = makeWatch({ home: null, dbFile: ":memory:", deps: fake.deps });
    const define = (id: string, url: string, cadenceSeconds: number) =>
      watch.defineCheck({ id, serviceId: "s", kind: "http", intent: id, config: { url }, keyId: null, cadenceSeconds, origin: "user" }, "on");
    define("site", SITE, 60);
    await watch.runner.tick();
    // The site fails and finds the probes silent, so Watch counts itself offline.
    net.siteUp = false;
    fake.advance(61);
    await watch.runner.tick();
    expect(watch.link().offlineSince).not.toBeNull();
    // A public check passes on its first scheduled run and sets off a recheck that hangs.
    net.hang = true;
    define("other", "https://other.example/", 3600);
    const finished = await Promise.race([
      watch.runner.tick().then(() => "finished"),
      new Promise((resolve) => setTimeout(() => resolve("waited"), 1000)),
    ]);
    expect(finished).toBe("finished");
    for (const reject of hanging) reject(new TypeError("fetch failed"));
  });

  it("does not probe for a failure that changes nothing", async () => {
    const { watch, net, advance } = setup();
    net.site = false;
    await watch.runner.tick();
    advance(61);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastOutcome).toBe("fail");
    const probes = net.probes;
    advance(301);
    await watch.runner.tick();
    expect(net.probes).toBe(probes);
  });

  it("holds a public failure even while a check on the local network passes", async () => {
    const { watch, net, advance } = setup();
    watch.defineCheck(
      { id: "nas", serviceId: "s", kind: "http", intent: "The NAS answers", config: { url: "http://192.168.1.10/" }, keyId: null, cadenceSeconds: 300, origin: "user" },
      "on",
    );
    await watch.runner.tick();
    net.up = false;
    advance(301);
    await watch.runner.tick();
    expect(watch.store.check("nas")!.lastOutcome).toBe("pass");
    expect(watch.store.check("site")!.lastOutcome).toBe("pass");
    expect(watch.store.events()).toEqual([]);
  });

  it("never holds a heartbeat, which needs no internet", async () => {
    const { watch, net, advance } = setup();
    watch.defineCheck(
      { id: "hb", serviceId: "s", kind: "heartbeat", intent: "The job pings", config: { token: "abcdefghijklmnop1234", periodSeconds: 60, graceSeconds: 0 }, keyId: null, cadenceSeconds: 60, origin: "user" },
      "on",
    );
    watch.store.addHeartbeat("hb", watch.now(), "success");
    await watch.runner.tick();
    expect(watch.store.check("hb")!.lastOutcome).toBe("pass");
    net.up = false;
    advance(120);
    await watch.runner.tick();
    advance(61);
    await watch.runner.tick();
    expect(watch.store.check("hb")!.lastOutcome).toBe("fail");
    expect(watch.store.events().some((e) => e.checkId === "hb" && e.to === "fail")).toBe(true);
  });
});

const OTHER = "https://other.example/";

/**
 * A Watch with one probe address that answers after `net.probeMs` on the fake clock, and two
 * sites that each answer, time out, refuse or say 503, with an HTTP check on each.
 */
const slowSetup = () => {
  type Site = "up" | "timeout" | "no answer" | "refused" | "down";
  const net = { probeMs: 100, site: "up" as Site, other: "up" as Site };
  const fake = fakeDeps({
    fetch: async (url) => {
      if (url.hostname === "probe.test") {
        // After the checks that fail together have failed, as a real probe would.
        await new Promise((resolve) => setImmediate(resolve));
        fake.advance(net.probeMs / 1000);
        return new Response(null, { status: 204 });
      }
      // A router at home answers at once, whatever the internet does.
      if (url.hostname === "fritz.box") return new Response("ok");
      const state = url.href === OTHER ? net.other : net.site;
      if (state === "timeout") throw fetchFailed("UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error");
      if (state === "no answer") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      if (state === "refused") throw fetchFailed("ECONNREFUSED", "connect ECONNREFUSED 192.0.2.1:443");
      return state === "down" ? new Response("down", { status: 503 }) : new Response("ok");
    },
  });
  const watch = makeWatch({ home: null, dbFile: ":memory:", deps: fake.deps, probeUrls: () => ["https://probe.test/"] });
  const check = (id: string, url: string, cadenceSeconds = 300) =>
    watch.defineCheck({ id, serviceId: "s", kind: "http", intent: `${id} answers`, config: { url }, keyId: null, cadenceSeconds, origin: "user" }, "on");
  check("site", SITE);
  return { watch, net, check, advance: fake.advance };
};

describe("runner while Watch's link is slow", () => {
  it("holds a connection failure while the probe answers slowly, then waits longer on the next run", async () => {
    const { watch, net, advance } = slowSetup();
    await watch.runner.tick();
    net.site = "timeout";
    net.probeMs = 2000;
    advance(301);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastOutcome).toBe("pass");
    expect(watch.store.events()).toEqual([]);
    expect(watch.store.runs("site")[0]!.summary).toBe("Held while Watch's connection was slow: Could not connect: the connection timed out");
    expect(watch.link().slowSince).not.toBeNull();
    expect(homeText(readState(watch)).split("\n")[0]).toMatch(/^Watch's connection has been slow since .+ UTC\. Web and vendor checks whose connections time out or drop are held/);
    // The next run waits 45 seconds rather than 15, and is held again while the link stays slow.
    net.site = "no answer";
    advance(301);
    await watch.runner.tick();
    expect(watch.store.runs("site")[0]!.summary).toBe("Held while Watch's connection was slow: No answer within 45 seconds");
    // The link recovers and the site answers: nothing was ever wrong, and nothing alerted.
    net.site = "up";
    net.probeMs = 100;
    advance(301);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastOutcome).toBe("pass");
    expect(watch.store.events()).toEqual([]);
    expect(watch.link().slowSince).toBeNull();
    // Patience ends with the streak: a run after a counted one waits 15 seconds again.
    net.site = "no answer";
    advance(301);
    await watch.runner.tick();
    expect(watch.store.runs("site")[0]!.summary).toBe("Failed once, checking again: No answer within 15 seconds");
  });

  it("counts what a slow link does not explain, and a connection failure on a quick link", async () => {
    const { watch, net, check, advance } = slowSetup();
    check("other", OTHER);
    await watch.runner.tick();
    // A refusal comes from the site, even while the other site's timeout shows the link is slow.
    net.site = "refused";
    net.other = "timeout";
    net.probeMs = 2000;
    advance(301);
    await watch.runner.tick();
    expect(watch.link().slowSince).not.toBeNull();
    advance(61);
    await watch.runner.tick();
    expect(watch.link().slowSince).not.toBeNull();
    expect(watch.store.check("site")!.lastSummary).toBe("Could not connect: the server refused the connection");
    expect(watch.store.events().map((e) => `${e.checkId}: ${e.from} -> ${e.to}`)).toEqual(["site: pass -> fail"]);
    expect(watch.store.runs("other")[0]!.summary).toMatch(/^Held while Watch's connection was slow/);
    // A timeout on a quick link is the site's too.
    const quick = slowSetup();
    await quick.watch.runner.tick();
    quick.net.site = "timeout";
    quick.advance(301);
    await quick.watch.runner.tick();
    quick.advance(61);
    await quick.watch.runner.tick();
    expect(quick.watch.store.check("site")!.lastOutcome).toBe("fail");
    expect(quick.watch.link().slowSince).toBeNull();
  });

  it("holds failures on two hosts at once while the probe is only a little slow", async () => {
    const { watch, net, check, advance } = slowSetup();
    check("other", OTHER);
    await watch.runner.tick();
    net.site = "timeout";
    net.other = "timeout";
    net.probeMs = 500;
    advance(301);
    await watch.runner.tick();
    expect(watch.store.runs("site")[0]!.summary).toMatch(/^Held while Watch's connection was slow/);
    expect(watch.store.runs("other")[0]!.summary).toMatch(/^Held while Watch's connection was slow/);
    expect(watch.store.events()).toEqual([]);
  });

  it("holds a slow link's failures for at most an hour in a row, then counts them with patience only after a held run", async () => {
    const { watch, net, advance } = slowSetup();
    await watch.runner.tick();
    net.site = "no answer";
    net.probeMs = 2000;
    for (let i = 0; i < 12; i++) {
      advance(301);
      await watch.runner.tick();
    }
    expect(watch.store.check("site")!.lastOutcome).toBe("pass");
    // The first held run waited 15 seconds, the ones after it 45. Runs come newest first.
    const held = watch.store.runs("site").map((r) => r.summary);
    expect([held[11], held[0]]).toEqual([
      "Held while Watch's connection was slow: No answer within 15 seconds",
      "Held while Watch's connection was slow: No answer within 45 seconds",
    ]);
    // Past the cap the run is pending, after a held run so with patience; the next one has none.
    advance(301);
    await watch.runner.tick();
    expect(watch.store.runs("site")[0]!.summary).toBe("Failed once, checking again: No answer within 45 seconds");
    advance(61);
    await watch.runner.tick();
    expect(watch.store.check("site")).toMatchObject({ lastOutcome: "fail", lastSummary: "No answer within 15 seconds" });
    expect(watch.store.events().map((e) => `${e.from} -> ${e.to}`)).toEqual(["pass -> fail"]);
  });

  it("holds a confirming run and another host's first failure that land in one batch", async () => {
    const { watch, net, check, advance } = slowSetup();
    check("other", OTHER, 60);
    await watch.runner.tick();
    // The site fails alone on a link only a little slow: pending, as before.
    net.site = "timeout";
    net.probeMs = 500;
    advance(301);
    await watch.runner.tick();
    expect(watch.store.runs("site")[0]!.summary).toBe("Failed once, checking again: Could not connect: the connection timed out");
    // Its confirming run and the other site's first failure come together: both are held.
    net.other = "timeout";
    advance(61);
    await watch.runner.tick();
    expect(watch.store.runs("site")[0]!.summary).toMatch(/^Held while Watch's connection was slow/);
    expect(watch.store.runs("other")[0]!.summary).toMatch(/^Held while Watch's connection was slow/);
    expect(watch.store.events()).toEqual([]);
  });

  it("still finds out a probe list a firewall drops, when checks pass quicker than the probes wait", async () => {
    const fake = fakeDeps({
      fetch: async (url) => {
        if (url.hostname === "probe.test") {
          fake.advance(5);
          throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        }
        if (url.href === OTHER) return new Response("down", { status: 503 });
        fake.advance(1.5);
        return new Response("ok");
      },
    });
    const watch = makeWatch({ home: null, dbFile: ":memory:", deps: fake.deps, probeUrls: () => ["https://probe.test/"] });
    for (const [id, url] of [["site", SITE], ["other", OTHER]] as const)
      watch.defineCheck({ id, serviceId: "s", kind: "http", intent: id, config: { url }, keyId: null, cadenceSeconds: 300, origin: "user" }, "on");
    watch.store.setTrialResult("other", "pass", "Answered 200", watch.now());
    for (let round = 0; round < 4; round++) {
      await watch.runner.tick();
      fake.advance(301);
      await new Promise((resolve) => setImmediate(resolve));
    }
    // A request that took 1.5 seconds cannot explain probes that waited 5: the list is in doubt, and holding stops.
    expect(watch.link().probesDisagree).toBe(true);
    expect(watch.store.events().map((e) => `${e.checkId}: ${e.from} -> ${e.to}`)).toEqual(["other: pass -> fail"]);
  });

  it("does not doubt the probe list when its probes time out right after a web request passed slower than they waited", async () => {
    const fake = fakeDeps({
      fetch: async (url) => {
        if (url.hostname === "probe.test") {
          fake.advance(5);
          throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        }
        if (url.href === OTHER) throw fetchFailed("UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error");
        // The site answers, after 8 seconds, as on a link with a round trip of about two seconds.
        fake.advance(8);
        return new Response("ok");
      },
    });
    const watch = makeWatch({ home: null, dbFile: ":memory:", deps: fake.deps, probeUrls: () => ["https://probe.test/"] });
    for (const [id, url] of [["site", SITE], ["other", OTHER]] as const)
      watch.defineCheck({ id, serviceId: "s", kind: "http", intent: id, config: { url }, keyId: null, cadenceSeconds: 300, origin: "user" }, "on");
    watch.store.setTrialResult("other", "pass", "Answered 200", watch.now());
    for (let round = 0; round < 4; round++) {
      await watch.runner.tick();
      fake.advance(301);
      // Let the recheck a pass set off finish, as the next tick would.
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(watch.link().probesDisagree).toBe(false);
    expect(watch.store.events()).toEqual([]);
    expect(watch.store.runs("other").every((r) => r.summary.startsWith("Held while"))).toBe(true);
  });

  it("does not let a pass from earlier in the batch outrank a probe a failure sets off", async () => {
    const fake = fakeDeps({
      fetch: async (url) => {
        if (url.hostname === "probe.test") throw new TypeError("fetch failed");
        if (url.href === OTHER) return new Response("ok");
        throw fetchFailed("UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error");
      },
    });
    const watch = makeWatch({ home: null, dbFile: ":memory:", deps: fake.deps, probeUrls: () => ["https://probe.test/"] });
    for (const [id, url] of [["site", SITE], ["other", OTHER]] as const)
      watch.defineCheck({ id, serviceId: "s", kind: "http", intent: id, config: { url }, keyId: null, cadenceSeconds: 300, origin: "user" }, "on");
    watch.store.setTrialResult("site", "pass", "Answered 200", watch.now());
    await watch.runner.tick();
    expect(watch.store.runs("site")[0]!.summary).toMatch(/^Held while Watch could not reach the internet/);
  });

  it("does not hold a check on the local network for a slow internet link, nor let its quick pass end the spell", async () => {
    const { watch, net, check, advance } = slowSetup();
    check("nas", "https://192.168.1.20/");
    check("named", "http://nas:8080/");
    check("router", "http://fritz.box/");
    await watch.runner.tick();
    net.site = "timeout";
    net.probeMs = 2000;
    advance(301);
    await watch.runner.tick();
    advance(61);
    await watch.runner.tick();
    expect(watch.store.check("nas")).toMatchObject({ lastOutcome: "fail", lastSummary: "Could not connect: the connection timed out" });
    expect(watch.store.check("named")).toMatchObject({ lastOutcome: "fail", lastSummary: "Could not connect: the connection timed out" });
    // The router answers in no time, as it does whatever the internet does; the spell goes on.
    expect(watch.store.check("router")!.lastOutcome).toBe("pass");
    expect(watch.link().slowSince).not.toBeNull();
  });

  it("records the rest of a batch when one run throws", async () => {
    const { watch, net, check, advance } = slowSetup();
    check("other", OTHER);
    const lastRunHeld = watch.store.lastRunHeld;
    Object.assign(watch.store, {
      lastRunHeld: (id: string) => {
        if (id === "other") throw new Error("disk I/O error");
        return lastRunHeld(id);
      },
    });
    const errors: Array<unknown> = [];
    const log = console.error;
    console.error = (...args: Array<unknown>) => errors.push(args);
    try {
      await watch.runner.tick();
    } finally {
      console.error = log;
    }
    expect(errors).toHaveLength(1);
    expect(watch.store.check("site")!.lastOutcome).toBe("pass");
    // The site is not left marked as running: its next run happens.
    net.site = "down";
    advance(301);
    await watch.runner.tick();
    expect(watch.store.runs("site")[0]!.summary).toBe("Failed once, checking again: Answered 503");
  });

  it("keeps a failing check's real reason once Watch knows its link is slow", async () => {
    const { watch, net, check, advance } = slowSetup();
    check("other", OTHER, 60);
    net.site = "down";
    await watch.runner.tick();
    advance(61);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastSummary).toBe("Answered 503");
    // The other site's failure shows the link is slow before the site runs again.
    net.site = "timeout";
    net.other = "timeout";
    net.probeMs = 2000;
    advance(61);
    await watch.runner.tick();
    expect(watch.link().slowSince).not.toBeNull();
    advance(250);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastSummary).toBe("Answered 503");
    expect(watch.store.runs("site")[0]!.summary).toMatch(/^Held while Watch's connection was slow/);
  });
});
