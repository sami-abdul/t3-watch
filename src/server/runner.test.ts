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

  it("records an event for a first run only when it fails", async () => {
    const fake = fakeDeps({ fetch: () => new Response("", { status: 500 }) });
    const watch = testWatch(fake.deps);
    const events: Array<ChangeEvent> = [];
    watch.onEvent((event) => events.push(event));
    watch.defineCheck(
      { id: "c", serviceId: "s", kind: "http", intent: "x", config: { url: "https://x.test" }, keyId: null, cadenceSeconds: 60, origin: "user" },
      "on",
    );
    await watch.runner.tick();
    expect(events).toHaveLength(1);
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

/** A Watch with holding on, a link and a site that each go up and down, and one HTTP check. */
const setup = () => {
  const net = { up: true, site: true };
  const fake = fakeDeps({
    fetch: (url) => {
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

    // The link is back but the site is down: that failure is real.
    net.up = true;
    net.site = false;
    advance(301);
    await watch.runner.tick();
    expect(watch.store.check("site")!.lastOutcome).toBe("fail");
    expect(watch.store.events().map((e) => `${e.from} -> ${e.to}`)).toEqual(["pass -> fail"]);
    expect(watch.link().offlineSince).toBeNull();
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
    expect(watch.store.check("hb")!.lastOutcome).toBe("fail");
    expect(watch.store.events().some((e) => e.checkId === "hb" && e.to === "fail")).toBe(true);
  });
});
