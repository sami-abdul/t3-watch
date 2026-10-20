import { describe, expect, it } from "vitest";

import type { Scan } from "../server/scan.ts";
import type { CheckView, WatchState } from "../server/state.ts";
import { accessRows, applyPayload, defaultTicks, homeModel, pageView, reviewGroups, toggle, watchLabel } from "./logic.ts";

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
  id: "c", serviceId: "s", kind: "http", intent: "i", config: {}, keyId: null, cadenceSeconds: 60, state: "on",
  snoozedUntil: null, nextRunAt: null, origin: "scan", lastOutcome: "pass", lastSummary: null, lastRunAt: null,
  createdAt: "", updatedAt: "", serviceLabel: "S", note: null, pingPath: null, ...over,
});
const state = (over: Partial<WatchState>): WatchState => ({
  generatedAt: "2026-10-15T10:00:00.000Z", services: [], checks: [], keys: [], events: [], notes: [], vendorDrafts: [],
  alerts: { url: null, signed: false }, setup: { scan: null, status: { running: false, step: null, error: null } }, link: { offlineSince: null, holding: false }, vendors: [], ...over,
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
