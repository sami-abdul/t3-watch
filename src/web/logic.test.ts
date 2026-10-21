import { describe, expect, it } from "vitest";

import type { Scan } from "../server/scan.ts";
import type { CheckView, WatchState } from "../server/state.ts";
import { accessRows, alertSteps, alertsNotice, applyChanges, latestAlertResult, needsHandover, applyPayload, defaultTicks, homeModel, pageView, reviewGroups, toggle, watchLabel } from "./logic.ts";

const scan: Scan = {
  scannedAt: "2026-10-15T10:00:00.000Z",
  roots: ["/r"],
  repositories: 3,
  appliedAt: null,
  services: [
    {
      serviceId: "vendor:stripe", vendor: "stripe", label: "Stripe", foundIn: ["api/.env"], reachable: true, note: null,
      access: [{ accessKey: "env:a", source: "KEY in api/.env", status: "works", detail: null, account: null, warnings: [], keyId: "k1", removable: true }],
      addKey: { vendor: "stripe", keyUrl: "https://x" },
    },
    {
      serviceId: "github:acme/api", vendor: "github", label: "acme/api", foundIn: [], reachable: true, note: null,
      access: [{ accessKey: "machine:gh", source: "gh", status: "works", detail: null, account: "o", warnings: [], keyId: null, removable: false }],
      addKey: null,
    },
    {
      serviceId: "github:acme/docs", vendor: "github", label: "acme/docs", foundIn: [], reachable: true, note: "No GitHub Actions runs yet",
      access: [{ accessKey: "machine:gh", source: "gh", status: "works", detail: null, account: "o", warnings: [], keyId: null, removable: false }],
      addKey: null,
    },
    { serviceId: "vendor:xero", vendor: "xero", label: "Xero", foundIn: ["api"], reachable: false, note: "Not built", access: [], addKey: null },
  ],
  suggestions: [
    { checkId: "s:key", serviceId: "vendor:stripe", title: "Stripe", intent: "key", outcome: "pass", summary: "", state: "proposed", suggested: true },
    { checkId: "s:act", serviceId: "vendor:stripe", title: "Stripe", intent: "act", outcome: "pass", summary: "", state: "proposed", suggested: false },
    { checkId: "g:ci", serviceId: "github:acme/api", title: "acme/api", intent: "ci", outcome: "fail", summary: "", state: "proposed", suggested: true },
  ],
};

const check = (over: Partial<CheckView>): CheckView => ({
  id: "c", serviceId: "s", kind: "http", intent: "i", config: {}, keyId: null, cadenceSeconds: 60, state: "on", pending: null,
  snoozedUntil: null, nextRunAt: null, origin: "scan", lastOutcome: "pass", lastSummary: null, lastRunAt: null,
  createdAt: "", updatedAt: "", serviceLabel: "S", note: null, pingPath: null, target: "GET https://x.test/", cadence: "every 1 min", ...over,
});
const state = (over: Partial<WatchState>): WatchState => ({
  generatedAt: "2026-10-15T10:00:00.000Z", services: [], checks: [], keys: [], events: [], notes: [], vendorDrafts: [],
  alerts: { on: false, host: null, signed: false, lastTest: null, lastDelivery: null }, setup: { scan: null, status: { running: false, step: null, error: null } }, link: { offlineSince: null, probesDisagree: false }, vendors: [], ...over,
});

describe("review", () => {
  it("ticks suggested checks and stored keys", () => {
    const ticks = defaultTicks(scan);
    expect([...ticks.checks]).toEqual(["s:key", "g:ci"]);
    expect([...ticks.access]).toEqual(["env:a"]);
    expect(applyPayload(scan, ticks)).toEqual({ turnOn: ["s:key", "g:ci"], removeKeys: [] });
  });

  it("drops a key's checks when the key is unticked", () => {
    const ticks = defaultTicks(scan);
    const payload = applyPayload(scan, { ...ticks, access: toggle(ticks.access, "env:a") });
    expect(payload).toEqual({ turnOn: ["g:ci"], removeKeys: ["env:a"] });
    expect(watchLabel(payload.turnOn.length)).toBe("Watch this check");
  });

  it("folds repositories with nothing to watch and lists one row per login", () => {
    const groups = reviewGroups(scan);
    expect(groups.quiet.map((s) => s.label)).toEqual(["acme/docs"]);
    expect(groups.unreachable.map((s) => s.label)).toEqual(["Xero"]);
    expect(accessRows(groups.ready).map((r) => r.service)).toEqual(["Stripe", "GitHub"]);
  });
});

describe("page", () => {
  it("opens on the right screen", () => {
    expect(pageView(state({}), false)).toBe("empty");
    expect(pageView(state({ setup: { scan: null, status: { running: true, step: "x", error: null } } }), false)).toBe("scanning");
    expect(pageView(state({ setup: { scan, status: { running: false, step: null, error: null } } }), false)).toBe("review");
    const applied = { ...scan, appliedAt: "2026-10-15T10:01:00.000Z" };
    expect(pageView(state({ setup: { scan: applied, status: { running: false, step: null, error: null } } }), false)).toBe("home");
    expect(pageView(state({ setup: { scan: applied, status: { running: false, step: null, error: null } } }), true)).toBe("review");
  });

  it("leads Home with what is broken", () => {
    const model = homeModel(
      state({
        checks: [
          check({ id: "a", lastOutcome: "fail" }),
          ...Array.from({ length: 10 }, (_, i) => check({ id: `p${i}` })),
          check({ id: "u", lastOutcome: "unknown" }),
          check({ id: "z", state: "paused", lastOutcome: "fail" }),
        ],
      }),
    );
    expect(model.headline).toBe("1 thing is broken");
    expect(model.passing).toHaveLength(10);
    expect(model.couldNotRun.map((c) => c.id)).toEqual(["u"]);
    expect(homeModel(state({ checks: [check({})] })).headline).toBe("All clear");
  });
});

describe("alerts panel", () => {
  const off = { on: false, host: null, signed: false, lastTest: null, lastDelivery: null };
  const on = { on: true, host: "relay.t3.codes", signed: true, lastTest: null, lastDelivery: null };
  const result = (ok: boolean, at = "2026-10-15T09:59:00.000Z") => ({ at, ok, status: ok ? 202 : 401, message: ok ? "Accepted." : "Refused." });

  it("walks the three steps in order", () => {
    expect(alertSteps(off)).toEqual({ secret: "current", connected: "waiting", tested: "waiting" });
    expect(alertSteps({ ...off, signed: true })).toEqual({ secret: "done", connected: "current", tested: "waiting" });
    expect(alertSteps(on)).toEqual({ secret: "done", connected: "done", tested: "current" });
    expect(alertSteps({ ...on, lastTest: result(true) })).toEqual({ secret: "done", connected: "done", tested: "done" });
    expect(alertSteps({ ...on, lastTest: result(false) }).tested).toBe("current");
    // A real alert the webhook accepted proves the connection as well as a test does.
    expect(alertSteps({ ...on, lastDelivery: result(true) }).tested).toBe("done");
    // An unsigned address still needs its secret, and an unsigned alert proves no signature.
    expect(alertSteps({ ...on, signed: false }).secret).toBe("current");
    expect(alertSteps({ ...on, signed: false, lastTest: result(true) }).tested).toBe("current");
  });

  it("asks for the new secret's hand-over until an alert gets through again", () => {
    expect(needsHandover(on, true)).toBe(true);
    expect(needsHandover({ ...on, lastTest: result(false) }, true)).toBe(true);
    expect(needsHandover({ ...on, lastTest: result(true) }, true)).toBe(false);
    expect(needsHandover(on, false)).toBe(false);
    expect(needsHandover(off, true)).toBe(false);
  });

  it("goes by the newer of the last test and the last real alert", () => {
    const old = result(true, "2026-10-15T08:00:00.000Z");
    const recent = result(false, "2026-10-15T09:00:00.000Z");
    expect(latestAlertResult({ ...on, lastTest: old, lastDelivery: recent })).toBe(recent);
    expect(latestAlertResult({ ...on, lastTest: recent, lastDelivery: old })).toBe(recent);
    expect(latestAlertResult(on)).toBeNull();
  });

  it("speaks on Home when alerts are off with checks on, unsigned, untested or failing", () => {
    expect(alertsNotice(state({}))).toBeNull();
    expect(alertsNotice(state({ checks: [check({})] }))).toEqual({
      text: "Alerts are off, so nothing wakes your Watch thread when a check fails.",
      button: "Connect alerts",
    });
    expect(alertsNotice(state({ alerts: { ...on, signed: false } }))?.button).toBe("Fix alerts");
    expect(alertsNotice(state({ alerts: on }))?.button).toBe("Test alerts");
    expect(alertsNotice(state({ alerts: { ...on, lastTest: result(true) } }))).toBeNull();
    expect(alertsNotice(state({ alerts: { ...on, lastTest: result(false) } }))?.text).toBe("The last test alert was not accepted. Refused.");
    const failedLater = { ...on, lastTest: result(true, "2026-10-15T08:00:00.000Z"), lastDelivery: result(false, "2026-10-15T09:00:00.000Z") };
    expect(alertsNotice(state({ alerts: failedLater }))?.text).toBe("The last alert did not get through. Refused.");
    // A test that passed after the failed alert means the fix worked.
    const fixed = { ...failedLater, lastTest: result(true, "2026-10-15T09:30:00.000Z") };
    expect(alertsNotice(state({ alerts: fixed }))).toBeNull();
  });
});

describe("applying the review", () => {
  it("lists what changes: checks turned on with targets, running checks paused, keys removed", () => {
    const [first, second] = scan.suggestions;
    const current = {
      ...scan,
      suggestions: [
        { ...first!, state: "proposed" as const, target: "Stripe's API at https://api.stripe.com, with the key ending 1234", cadence: "every 1 h" },
        { ...second!, state: "on" as const, target: "GitHub Actions in g/ci, read with the gh login", cadence: "every 15 min" },
      ],
    };
    const key = scan.services.flatMap((s) => s.access).find((a) => a.removable)!;
    const changes = applyChanges(current, { turnOn: [first!.checkId], removeKeys: [key.accessKey] });
    expect(changes.turnOn).toEqual([{ key: first!.checkId, title: `${first!.title}: ${first!.intent}`, detail: "Stripe's API at https://api.stripe.com, with the key ending 1234 · every 1 h" }]);
    // Unticked while it runs: it pauses.
    expect(changes.pause.map((c) => c.key)).toEqual([second!.checkId]);
    expect(changes.removeKeys).toEqual([{ key: key.accessKey, title: key.source, detail: "Watch deletes its copy of this key" }]);
    // A check already on stays on: nothing changes for it, so it is not listed.
    const again = applyChanges(current, { turnOn: [first!.checkId, second!.checkId], removeKeys: [] });
    expect(again.turnOn.map((c) => c.key)).toEqual([first!.checkId]);
    expect(again.pause).toEqual([]);
    expect(applyChanges(current, { turnOn: [second!.checkId], removeKeys: [] })).toEqual({ turnOn: [], pause: [], removeKeys: [] });
    // A check whose key the review removes neither turns on nor keeps running, as the service applies it.
    const keyed = { ...current, suggestions: [{ ...current.suggestions[0]!, keyId: key.keyId }, { ...current.suggestions[1]!, keyId: key.keyId }] };
    const losing = applyChanges(keyed, { turnOn: [first!.checkId, second!.checkId], removeKeys: [key.accessKey] });
    expect(losing.turnOn).toEqual([]);
    expect(losing.pause.map((c) => c.key)).toEqual([second!.checkId]);
  });
});
