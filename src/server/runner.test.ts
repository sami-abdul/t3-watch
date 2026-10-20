import { describe, expect, it } from "vitest";

import { makeWatch } from "./app.ts";
import type { ChangeEvent } from "./store.ts";
import { fakeDeps, testWatch } from "./testkit.ts";

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
    expect(watch.store.runs("c")[0]!.evidence).toMatchObject({ pending: true });
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

  it("does not count a pending run left from long ago", async () => {
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
