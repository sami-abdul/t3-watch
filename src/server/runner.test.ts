import { describe, expect, it } from "vitest";

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
