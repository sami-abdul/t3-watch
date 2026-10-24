import { describe, expect, it } from "vitest";

import type { Scan } from "../server/scan.ts";
import type { CheckView, WatchState } from "../server/state.ts";
import { accessRows, alertSteps, alertsNotice, applyChanges, canDelete, canEdit, editFormOf, editOf, isNewCheck, latestAlertResult, needsHandover, newChecksToReview, productGroups, productsOf, productSummary, applyPayload, defaultTicks, homeModel, pageView, reviewGroups, toggle, watchLabel } from "./logic.ts";

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
  createdAt: "", updatedAt: "", serviceLabel: "S", serviceProduct: null, note: null, target: "GET https://x.test/", cadence: "every 1 min", ...over,
});
const state = (over: Partial<WatchState>): WatchState => ({
  slack: { on: false, lastTest: null, lastDelivery: null },
  generatedAt: "2026-10-15T10:00:00.000Z", services: [], checks: [], keys: [], events: [], notes: [], vendorDrafts: [],
  alerts: { on: false, host: null, signed: false, lastTest: null, lastDelivery: null }, setup: { scan: null, status: { running: false, step: null, error: null } }, link: { offlineSince: null, probesDisagree: false, slowSince: null }, vendors: [], ...over,
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
    // A repository whose check the person deleted has runs: it is not quiet, and its login still shows.
    const deleted = reviewGroups({ ...scan, suggestions: scan.suggestions.filter((s) => s.serviceId !== "github:acme/api") });
    expect(deleted.quiet.map((s) => s.label)).toEqual(["acme/docs"]);
    expect(accessRows(deleted.ready).map((r) => r.service)).toEqual(["Stripe", "GitHub"]);
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
    expect(model.onCount).toBe(12);
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

describe("Home by product", () => {
  const site = check({ id: "site", serviceId: "custom:shop", serviceLabel: "Shop", intent: "Site answers", lastOutcome: "pass" });
  const ci = check({ id: "ci", serviceId: "github:acme/shop", serviceLabel: "acme/shop", intent: "CI on main is passing", lastOutcome: "fail" });

  it("joins a site and its repository under the site's name, and keeps everything else apart", () => {
    const productOf = productsOf([site, ci]);
    expect(productOf(ci)).toEqual(productOf(site));
    expect(productOf(site)).toEqual({ key: "custom:shop", label: "Shop" });
    // A site's id is its name cut at 40 characters, as drafts.ts makes it; its full name still finds the repository.
    const name = "The quite long product name for the client portal";
    const long = check({ serviceId: `custom:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`, serviceLabel: name });
    const longRepo = check({ serviceId: "github:acme/the-quite-long-product-name-for-the-client-portal", serviceLabel: "acme/the-quite-long-product-name-for-the-client-portal" });
    expect(productsOf([long, longRepo])(longRepo).key).toBe(long.serviceId);
    // Two repositories of one name under different owners, with no site, stay two products, owner and all.
    const a = check({ serviceId: "github:acme/api", serviceLabel: "acme/api" });
    const b = check({ serviceId: "github:example/api", serviceLabel: "example/api" });
    expect(productsOf([a, b])(a).key).not.toBe(productsOf([a, b])(b).key);
    expect(productsOf([a])(a).label).toBe("acme/api");
    const stripe = check({ serviceId: "vendor:stripe", serviceLabel: "Stripe" });
    expect(productsOf([stripe])(stripe)).toEqual({ key: "vendor:stripe", label: "Stripe" });
    // A site named like two repositories joins neither: it cannot tell which is its own.
    const apiSite = check({ serviceId: "custom:api", serviceLabel: "API" });
    const both = productsOf([apiSite, a, b]);
    expect(new Set([both(apiSite).key, both(a).key, both(b).key]).size).toBe(3);
  });

  it("matches a site by its own id, and by its label only when the id was cut from it", () => {
    // A generic label is not a name the id was cut from, so it claims no repository.
    const labelled = check({ serviceId: "custom:shop-site", serviceLabel: "Website" });
    const website = check({ serviceId: "github:acme/website", serviceLabel: "acme/website" });
    expect(productsOf([labelled, website])(website).key).toBe("github:acme/website");
    // Two sites whose names match once punctuation goes stay two products, and the repository of
    // that name joins neither.
    const first = check({ serviceId: "custom:my-app", serviceLabel: "My App" });
    const second = check({ serviceId: "custom:myapp", serviceLabel: "MyApp" });
    const repo = check({ serviceId: "github:acme/my-app", serviceLabel: "acme/my-app" });
    const productOf = productsOf([first, second, repo]);
    expect([productOf(first), productOf(second), productOf(repo)]).toEqual([
      { key: "custom:my-app", label: "My App" },
      { key: "custom:myapp", label: "MyApp" },
      { key: "github:acme/my-app", label: "acme/my-app" },
    ]);
  });

  it("counts each product's checks by outcome, finds its worst state and puts problems first", () => {
    const solo = check({ id: "solo", serviceId: "github:acme/zeta", serviceLabel: "acme/zeta", intent: "CI", lastOutcome: "pass" });
    const paused = check({ id: "off", serviceId: "custom:paused", serviceLabel: "Paused one", state: "paused" });
    const fresh = check({ id: "fresh", serviceId: "custom:new-site", serviceLabel: "New site", intent: "Answers", lastOutcome: null });
    const stuck = check({ id: "stuck", serviceId: "custom:jobs", serviceLabel: "Jobs", intent: "Nightly job pings", lastOutcome: "unknown" });
    const waiting = check({ id: "waiting", serviceId: "custom:jobs", serviceLabel: "Jobs", intent: "Backup pings", lastOutcome: null });
    // The repository comes first, yet the group takes the site's name.
    const groups = productGroups(state({ checks: [ci, solo, site, paused, fresh, stuck, waiting] }));
    expect(groups.map((g) => [g.label, g.checks.length, g.worst, g.mixed])).toEqual([
      ["Shop", 2, "fail", true],
      ["Jobs", 2, "unknown", false],
      ["New site", 1, null, false],
      ["acme/zeta", 1, "pass", false],
    ]);
    expect(groups[0]!.checks.map((c) => c.id)).toEqual(["ci", "site"]);
    expect(productSummary(groups[0]!)).toBe("1 failing, 1 passing");
    expect(productSummary(groups[1]!)).toBe("1 could not run, 1 waiting for a first run");
    // Not run yet is not a failure.
    expect(productSummary(groups[2]!)).toBe("1 waiting for a first run");
    expect(productSummary(groups[3]!)).toBe("Passing");
    // A site that is not watched does not rename its repository's group.
    const declined = { ...site, state: "off" as const };
    expect(productGroups(state({ checks: [declined, ci] })).map((g) => g.label)).toEqual(["acme/shop"]);
  });

  it("counts new checks to review only after a scan has been applied, as the review marks them", () => {
    const suggestion = { checkId: "n", serviceId: "s", title: "S", intent: "i", outcome: "pass", summary: "", state: "proposed", suggested: true } as const;
    const decided = { ...suggestion, checkId: "d", state: "off" } as const;
    // Not ticked by default, as when its first run could not finish, yet still nobody has decided on it.
    const unticked = { ...suggestion, checkId: "u", suggested: false } as const;
    const withScan = (s: Scan) => state({ setup: { scan: s, status: { running: false, step: null, error: null } } });
    expect(newChecksToReview(state({}))).toBe(0);
    const first = { ...scan, appliedAt: null, suggestions: [suggestion] };
    expect(newChecksToReview(withScan(first))).toBe(0);
    expect(isNewCheck(first, suggestion)).toBe(false);
    const later = { ...scan, appliedAt: "2026-10-15T09:00:00Z", suggestions: [suggestion, decided, unticked] };
    expect(newChecksToReview(withScan(later))).toBe(2);
    expect(later.suggestions.filter((s) => isNewCheck(later, s)).map((s) => s.checkId)).toEqual(["n", "u"]);
  });
});

describe("review ticks", () => {
  it("follow the checks as they stand now, not as the scan found them", () => {
    const [first, second] = scan.suggestions;
    const now = { ...scan, suggestions: [{ ...first!, suggested: true, state: "paused" as const }, { ...second!, suggested: false, state: "on" as const }] };
    // Paused since the scan: unticked. Turned on since: ticked.
    expect([...defaultTicks(now).checks]).toEqual([second!.checkId]);
  });
});

describe("Edit and Delete", () => {
  it("offer Edit on checks that are on or paused, and Delete on all but drafts", () => {
    expect((["on", "paused", "proposed", "off", "draft", "deleted"] as const).map((state) => [canEdit({ state }), canDelete({ state })])).toEqual([
      [true, true],
      [true, true],
      [false, true],
      [false, true],
      [false, false],
      [false, false],
    ]);
  });

  it("group by a product someone named, ahead of the guess, and bring a repository of that name along", () => {
    const site = check({ id: "site", serviceId: "custom:shop", serviceLabel: "shop.example.com" });
    const repo = check({ id: "ci", serviceId: "github:acme/storefront", serviceLabel: "acme/storefront" });
    const other = check({ id: "api", serviceId: "custom:api", serviceLabel: "api.example.com" });
    // Guessed from names, the site and its repository stay apart.
    const guessed = productsOf([site, repo, other]);
    expect([guessed(site).label, guessed(repo).label]).toEqual(["shop.example.com", "acme/storefront"]);
    // Named after the repository, the site brings it along, under the name as written.
    const storefront = { ...site, serviceProduct: "Storefront" };
    const named = productsOf([storefront, repo, other]);
    expect(named(storefront)).toEqual({ key: "product:storefront", label: "Storefront" });
    expect(named(repo)).toEqual(named(storefront));
    expect(named(other)).toEqual({ key: "custom:api", label: "api.example.com" });
    // A name given to a service wins over the repository's own match.
    const apart = { ...repo, serviceProduct: "Build tools" };
    expect(productsOf([storefront, apart])(apart)).toEqual({ key: "product:buildtools", label: "Build tools" });
    // Two spellings of one name make one product; a name with no letters or digits is no name.
    const shout = { ...other, serviceProduct: "STOREFRONT" };
    expect(productsOf([storefront, shout])(shout).key).toBe("product:storefront");
    // A repository that matched a site by its name follows that site into the product it is named.
    const shop = check({ id: "shop-ci", serviceId: "github:acme/shop", serviceLabel: "acme/shop" });
    const renamed = { ...site, serviceProduct: "Boutique" };
    expect(productsOf([renamed, shop])(shop)).toEqual({ key: "product:boutique", label: "Boutique" });
    // A repository stays with its own site's named product, whatever else is named after it.
    const boutiqueSite = { ...check({ id: "sf", serviceId: "custom:storefront", serviceLabel: "storefront.example.com" }), serviceProduct: "Boutique" };
    const ownRepo = check({ id: "sf-ci", serviceId: "github:acme/storefront", serviceLabel: "acme/storefront" });
    expect(productsOf([boutiqueSite, ownRepo, { ...other, serviceProduct: "Storefront" }])(ownRepo).key).toBe("product:boutique");
    // A repository goes wherever its site goes, the site's full name included.
    const aliasSite = check({ id: "shop-up", serviceId: "custom:shop", serviceLabel: "shop.example.com" });
    const aliasRepo = check({ id: "shop-ci", serviceId: "github:acme/shop", serviceLabel: "acme/shop" });
    const byFullName = { ...other, serviceProduct: "shop.example.com" };
    const alias = productsOf([aliasSite, aliasRepo, byFullName]);
    expect([alias(aliasSite).key, alias(aliasRepo).key]).toEqual(["product:shopexamplecom", "product:shopexamplecom"]);
    // Naming another service after a site and its repository keeps the pair together in it.
    const pairSite = check({ id: "sf", serviceId: "custom:storefront", serviceLabel: "storefront.example.com" });
    const pairRepo = check({ id: "sf-ci", serviceId: "github:acme/storefront", serviceLabel: "acme/storefront" });
    const api = { ...other, serviceProduct: "Storefront" };
    const together = productsOf([pairSite, pairRepo, api]);
    expect([together(pairSite).key, together(pairRepo).key, together(api).key]).toEqual(["product:storefront", "product:storefront", "product:storefront"]);
    // Names in any script, compared without case or accents.
    const tokyo = { ...site, serviceProduct: "Boutique 東京" };
    const osaka = { ...other, serviceProduct: "Boutique 大阪" };
    const byCity = productsOf([tokyo, osaka]);
    expect([byCity(tokyo).label, byCity(osaka).label]).toEqual(["Boutique 東京", "Boutique 大阪"]);
    expect(productsOf([{ ...site, serviceProduct: "Café" }, { ...other, serviceProduct: "Cafe" }])({ ...other, serviceProduct: "Cafe" }).key).toBe("product:cafe");
    expect(productsOf([{ ...site, serviceProduct: "…" }])({ ...site, serviceProduct: "…" })).toEqual({ key: "custom:shop", label: "shop.example.com" });
    // A state from a Watch older than the page has no product field at all.
    const older = { ...site, serviceProduct: undefined } as unknown as typeof site;
    expect(productsOf([older])(older)).toEqual({ key: "custom:shop", label: "shop.example.com" });
  });

  it("start from one read of the stored check, with a vendor check's settings left out", () => {
    // The state carries the address without its secrets; Edit starts from it as stored, so saving
    // it unchanged keeps them.
    const config = { url: "https://monitor:open-sesame@shop.example/?key=abc", contains: "Welcome" }; // gitleaks:allow
    const stored = { intent: "Site answers", cadenceSeconds: 900, kind: "http" as const, config, updatedAt: "2026-10-15T09:00:00Z" };
    expect(editFormOf(stored)).toEqual({ intent: "Site answers", minutes: "15", settings: JSON.stringify(config, null, 2), updatedAt: "2026-10-15T09:00:00Z" });
    // A cadence that is not whole minutes shows as it is, and goes back unchanged.
    expect(editFormOf({ ...stored, cadenceSeconds: 90 }).minutes).toBe("1.5");
    // A heartbeat's settings come without its ping token, which never changes here.
    expect(JSON.parse(editFormOf({ ...stored, kind: "heartbeat", config: { periodSeconds: 3600 } }).settings!)).toEqual({ periodSeconds: 3600 });
    expect(editFormOf({ ...stored, kind: "vendor", config: { vendor: "stripe", check: "key" } }).settings).toBeNull();
    // A kind from another build of Watch keeps its settings out of the form, so a rename still saves.
    expect(editFormOf({ ...stored, kind: "dns" as never, config: { name: "shop.example" } }).settings).toBeNull();
  });

  it("save against the version its settings came from, never a newer one the page read since", () => {
    // Settings read before another tab saved, while the page's state already shows that save: the
    // form keeps the older version, so Watch refuses the save instead of writing old settings back.
    const older = { intent: "Site answers", cadenceSeconds: 900, kind: "http" as const, config: { url: "https://old.example/" }, updatedAt: "2026-10-15T09:00:00Z" };
    const form = editFormOf(older);
    expect(form.updatedAt).toBe("2026-10-15T09:00:00Z");
    expect(JSON.parse(form.settings!)).toEqual({ url: "https://old.example/" });
    expect(editOf(form)).toMatchObject({ edit: { updatedAt: "2026-10-15T09:00:00Z", config: { url: "https://old.example/" } } });
  });

  it("send what was typed, and stop only at settings that are not JSON", () => {
    const at = "2026-10-15T09:00:00Z";
    expect(editOf({ intent: "Shop answers", minutes: " 5 ", settings: '{"url":"https://shop.example/health"}', updatedAt: at })).toEqual({
      edit: { intent: "Shop answers", cadenceMinutes: 5, config: { url: "https://shop.example/health" }, updatedAt: at },
    });
    expect(editOf({ intent: "Key works", minutes: "60", settings: null, updatedAt: at })).toEqual({ edit: { intent: "Key works", cadenceMinutes: 60, updatedAt: at } });
    // Watch refuses a missing or broken number with its own reason.
    expect(editOf({ intent: "x", minutes: "", settings: null, updatedAt: at })).toEqual({ edit: { intent: "x", cadenceMinutes: Number.NaN, updatedAt: at } });
    expect(editOf({ intent: "x", minutes: "5", settings: "{url:", updatedAt: at })).toEqual({ error: expect.stringMatching(/^The settings are not valid JSON: /) });
  });
});
