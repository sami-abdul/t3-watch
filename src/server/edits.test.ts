import { describe, expect, it } from "vitest";

import { deliverAlerts, setAlerts } from "./alerts.ts";
import { addNote, draftCheck } from "./drafts.ts";
import { type CheckEdit, deleteCheck, editCheck as editAt, PAUSED_BY_CHOICE, restoreCheck } from "./edits.ts";
import type { Scan } from "./scan.ts";
import { readState } from "./state.ts";
import { fakeDeps, testWatch } from "./testkit.ts";

/** A heartbeat ping token for tests, not a secret. */
const PING_TOKEN = "abcdefghijklmnop1234"; // gitleaks:allow

/** An edit from a form opened on the check as it stands now. */
const editCheck = (watch: ReturnType<typeof testWatch>, id: string, edit: CheckEdit) =>
  editAt(watch, id, { updatedAt: watch.store.check(id)?.updatedAt, ...edit });

const setup = () => {
  const fake = fakeDeps({ fetch: () => new Response("Welcome", { status: 200 }) });
  const watch = testWatch(fake.deps);
  watch.defineCheck(
    { id: "site", serviceId: "custom:shop", kind: "http", intent: "Site answers", config: { url: "https://shop.example/" }, keyId: null, cadenceSeconds: 900, origin: "agent" },
    "on",
  );
  return { watch, fake };
};

const refusal = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    return { message: (error as Error).message, status: (error as { status?: number }).status };
  }
  throw new Error("expected a refusal");
};

describe("editing a check", () => {
  it("changes its name, cadence and settings, keeping its id and history", async () => {
    const { watch, fake } = setup();
    await watch.runner.runNow(watch.store.check("site")!);
    const edited = editCheck(watch, "site", { intent: "  Shop answers  ", cadenceMinutes: 5, config: { url: "https://shop.example/health", contains: "Welcome" } });
    expect(edited).toMatchObject({ id: "site", intent: "Shop answers", cadenceSeconds: 300, origin: "user", nextRunAt: null });
    expect(edited.config).toEqual({ url: "https://shop.example/health", contains: "Welcome" });
    expect(watch.store.runs("site")).toHaveLength(1);
    // It is on, so the next tick runs it with the new address, and the history goes on.
    await watch.runner.tick();
    expect(fake.requests.at(-1)!.url).toBe("https://shop.example/health");
    expect(watch.store.runs("site")).toHaveLength(2);
    expect(readState(watch).checks.find((c) => c.id === "site")!.target).toBe('GET https://shop.example/health, expecting "Welcome"');
  });

  it("runs a check that is on again only when it now runs differently", async () => {
    const { watch } = setup();
    await watch.runner.runNow(watch.store.check("site")!);
    const due = watch.store.check("site")!.nextRunAt;
    expect(due).not.toBeNull();
    // A new name alone needs no run.
    expect(editCheck(watch, "site", { intent: "Shop answers", cadenceMinutes: 15 }).nextRunAt).toBe(due);
    expect(editCheck(watch, "site", { intent: "Shop answers", cadenceMinutes: 5 }).nextRunAt).toBeNull();
  });

  it("leaves a check alone when nothing changed, whatever order its settings came in", () => {
    const { watch } = setup();
    watch.defineCheck(
      { id: "hb", serviceId: "custom:jobs", kind: "heartbeat", intent: "Backup pings", config: { token: PING_TOKEN, periodSeconds: 3600 }, keyId: null, cadenceSeconds: 300, origin: "agent" },
      "paused",
    );
    const before = watch.store.check("hb")!;
    // The default grace the schema adds is not a change either.
    expect(editCheck(watch, "hb", { intent: "Backup pings", cadenceMinutes: 5, config: { graceSeconds: 300, periodSeconds: 3600 } })).toEqual(before);
    expect(watch.store.check("hb")!.origin).toBe("agent");
  });

  it("keeps a heartbeat's ping token, which the page never sends", () => {
    const { watch } = setup();
    watch.defineCheck(
      { id: "hb", serviceId: "custom:jobs", kind: "heartbeat", intent: "Backup pings", config: { token: PING_TOKEN, periodSeconds: 3600 }, keyId: null, cadenceSeconds: 300, origin: "agent" },
      "on",
    );
    const edited = editCheck(watch, "hb", { intent: "Backup pings", cadenceMinutes: 5, config: { periodSeconds: 7200, token: "zzzzzzzzzzzzzzzzzzzz" } });
    expect(edited.config).toEqual({ token: PING_TOKEN, periodSeconds: 7200, graceSeconds: 300 });
  });

  it("refuses settings the kind does not have or cannot take, and changes nothing", () => {
    const { watch } = setup();
    const before = watch.store.check("site")!;
    const edit = (config: unknown, more: Record<string, unknown> = {}) =>
      refusal(() => editCheck(watch, "site", { intent: "Site answers", cadenceMinutes: 15, config, ...more }));
    expect(edit({ url: "https://shop.example/", contain: "x" }).message).toBe("contain is not a setting of an HTTP check. It has url, expectStatus, contains.");
    expect(edit({ url: "https://shop.example/", a: 1, b: 2 }).message).toBe("a, b are not settings of an HTTP check. It has url, expectStatus, contains.");
    // A token is no HTTP setting; only a heartbeat's is kept out of sight.
    expect(edit({ url: "https://shop.example/", token: "x" }).message).toContain("token is not a setting");
    expect(edit({ url: "ftp://shop.example/" }).message).toMatch(/^The settings are not valid for an HTTP check: /);
    expect(edit([]).message).toBe("Settings must be a JSON object");
    expect(edit("{}").message).toBe("Settings must be a JSON object");
    expect(edit(undefined, { intent: "ab" }).message).toBe("Name the check in 3 to 200 characters");
    expect(edit(undefined, { intent: 3 }).message).toBe("Name the check in 3 to 200 characters");
    for (const cadenceMinutes of [0, 1.5, 1441, "5", undefined])
      expect(edit(undefined, { cadenceMinutes }).message).toBe("Run it every 1 to 1440 minutes, in whole minutes");
    expect(watch.store.check("site")).toEqual(before);
  });

  it("keeps a repository's own check on that repository, and a vendor check's settings as they are", () => {
    const { watch } = setup();
    watch.defineCheck(
      { id: "github:acme/shop:ci", serviceId: "github:acme/shop", kind: "github", intent: "CI on main is passing", config: { repo: "acme/shop", branch: "main" }, keyId: null, cadenceSeconds: 900, origin: "scan" },
      "on",
    );
    const ci = (config: Record<string, unknown>) => editCheck(watch, "github:acme/shop:ci", { intent: "CI on main is passing", cadenceMinutes: 15, config });
    expect(refusal(() => ci({ repo: "acme/other" })).message).toBe("This check watches acme/shop. To watch another repository, ask the Watch thread to draft a check for it.");
    expect(ci({ repo: "Acme/Shop", branch: "release" }).config).toEqual({ repo: "Acme/Shop", branch: "release" });
    // A check an agent drafted on that service for another repository stays on the one it watches.
    watch.defineCheck(
      { id: "github:acme/shop:deploy", serviceId: "github:acme/shop", kind: "github", intent: "Deploys pass", config: { repo: "acme/infra", workflow: "deploy" }, keyId: null, cadenceSeconds: 900, origin: "agent" },
      "on",
    );
    const deploy = (config: Record<string, unknown>) => editCheck(watch, "github:acme/shop:deploy", { intent: "Infra deploys pass", cadenceMinutes: 15, config });
    expect(deploy({ repo: "acme/infra", workflow: "deploy" }).intent).toBe("Infra deploys pass");
    expect(refusal(() => deploy({ repo: "acme/shop", workflow: "deploy" })).message).toBe(
      "This check watches acme/infra. To watch another repository, ask the Watch thread to draft a check for it.",
    );
    watch.defineCheck(
      { id: "vendor:stripe:key", serviceId: "vendor:stripe", kind: "vendor", intent: "The key works", config: { vendor: "stripe", check: "key" }, keyId: null, cadenceSeconds: 3600, origin: "scan" },
      "paused",
    );
    expect(refusal(() => editCheck(watch, "vendor:stripe:key", { intent: "The key works", cadenceMinutes: 60, config: { vendor: "stripe", check: "key" } })).message).toContain(
      "vendor's description",
    );
    expect(editCheck(watch, "vendor:stripe:key", { intent: "Stripe key works", cadenceMinutes: 120 })).toMatchObject({ intent: "Stripe key works", cadenceSeconds: 7200, state: "paused" });
    // Another AWS profile may be another account, which is another service.
    const metric = { region: "us-east-1", namespace: "AWS/Lambda", metric: "Errors", statistic: "Sum", periodSeconds: 3600, windowSeconds: 3600, comparison: ">", threshold: 0 };
    watch.defineCheck(
      { id: "aws:1:lambda-errors", serviceId: "aws:1", kind: "aws_metric", intent: "No Lambda errors", config: { ...metric, profile: "prod" }, keyId: null, cadenceSeconds: 900, origin: "scan" },
      "on",
    );
    const aws = (config: Record<string, unknown>) => editCheck(watch, "aws:1:lambda-errors", { intent: "No Lambda errors", cadenceMinutes: 15, config });
    expect(refusal(() => aws({ ...metric, profile: "staging" })).message).toBe(
      "This check reads AWS through the profile prod. To read through another, ask the Watch thread to draft a check for it.",
    );
    expect(refusal(() => aws(metric)).message).toContain("through the profile prod");
    expect(aws({ ...metric, profile: "prod", threshold: 5 }).config).toMatchObject({ profile: "prod", threshold: 5 });
  });

  it("refuses a form opened before the check last changed", () => {
    const { watch } = setup();
    const opened = watch.store.check("site")!.updatedAt;
    // A rescan, another tab or an agent changes the check while the form is open.
    watch.store.upsertCheck({ ...watch.store.check("site")!, config: { url: "https://shop.example/new" }, updatedAt: "2026-10-15T10:05:00.000Z" });
    expect(refusal(() => editAt(watch, "site", { intent: "Site answers", cadenceMinutes: 15, config: { url: "https://shop.example/" }, updatedAt: opened }))).toEqual({
      message: "This check changed after Edit opened. Close Edit and open it again to see it as it is now.",
      status: 409,
    });
    expect(refusal(() => editAt(watch, "site", { intent: "Site answers", cadenceMinutes: 15 })).status).toBe(409);
    expect(watch.store.check("site")!.config).toEqual({ url: "https://shop.example/new" });
  });

  it("keeps a cadence left as it was, even one that is not whole minutes", () => {
    const { watch } = setup();
    watch.defineCheck(
      { id: "fast", serviceId: "custom:shop", kind: "http", intent: "Answers fast", config: { url: "https://shop.example/" }, keyId: null, cadenceSeconds: 90, origin: "agent" },
      "on",
    );
    expect(editCheck(watch, "fast", { intent: "Shop answers fast", cadenceMinutes: 1.5 })).toMatchObject({ intent: "Shop answers fast", cadenceSeconds: 90 });
    expect(refusal(() => editCheck(watch, "fast", { intent: "Shop answers fast", cadenceMinutes: 2.5 })).message).toBe("Run it every 1 to 1440 minutes, in whole minutes");
    expect(editCheck(watch, "fast", { intent: "Shop answers fast", cadenceMinutes: 2 }).cadenceSeconds).toBe(120);
  });

  it("says plainly when it cannot check the settings of a kind it does not know", () => {
    const { watch } = setup();
    watch.defineCheck({ id: "dns", serviceId: "custom:shop", kind: "dns" as never, intent: "Resolves", config: { name: "shop.example" }, keyId: null, cadenceSeconds: 900, origin: "agent" }, "on");
    expect(refusal(() => editCheck(watch, "dns", { intent: "Resolves", cadenceMinutes: 15, config: { name: "shop.example" } }))).toEqual({
      message: "This version of Watch cannot change the settings of a dns check.",
      status: 409,
    });
    expect(editCheck(watch, "dns", { intent: "Shop resolves", cadenceMinutes: 15 }).intent).toBe("Shop resolves");
  });

  it("only edits checks that are on or paused", () => {
    const { watch } = setup();
    for (const [state, message] of [
      ["draft", "Turn the draft on or discard it on Home first."],
      ["proposed", "Turn the check on in the review first."],
      ["off", "Turn the check on in the review first."],
    ] as const) {
      watch.store.setCheckState("site", state, watch.now());
      expect(refusal(() => editCheck(watch, "site", { intent: "Site answers", cadenceMinutes: 15 }))).toEqual({ message, status: 409 });
    }
    expect(refusal(() => editCheck(watch, "nope", { intent: "Site answers", cadenceMinutes: 15 })).status).toBe(404);
  });
});

describe("deleting a check", () => {
  it("stops it and keeps its runs and changes, and Restore brings it back paused", async () => {
    const { watch, fake } = setup();
    await watch.runner.runNow(watch.store.check("site")!);
    watch.store.recordRun(watch.store.check("site")!, { outcome: "fail", summary: "Answered 500", evidence: {} }, watch.now(), 5, watch.now());
    expect(deleteCheck(watch, "site").state).toBe("deleted");
    // Twice is the same as once.
    expect(deleteCheck(watch, "site").state).toBe("deleted");
    expect(watch.store.runs("site")).toHaveLength(2);
    expect(watch.store.events().map((e) => e.checkId)).toEqual(["site"]);
    // It never runs, and every other action waits for Restore.
    fake.advance(3600);
    const requests = fake.requests.length;
    await watch.runner.tick();
    expect(fake.requests).toHaveLength(requests);
    await expect(watch.setCheck("site", "run")).rejects.toMatchObject({ status: 409, message: "This check was deleted. Restore it in Details first." });
    await expect(watch.setCheck("site", "on")).rejects.toMatchObject({ status: 409 });
    expect(refusal(() => editCheck(watch, "site", { intent: "Site answers", cadenceMinutes: 15 })).status).toBe(409);
    expect(restoreCheck(watch, "site")).toMatchObject({ state: "paused", lastSummary: "Answered 500" });
    expect(watch.store.runs("site")).toHaveLength(2);
    // A second press, as from a double click, changes nothing.
    expect(restoreCheck(watch, "site").state).toBe("paused");
  });

  it("sends no alert for a change the deleted check had not sent yet, and never calls it sent", async () => {
    const posted: Array<string> = [];
    const fake = fakeDeps({
      fetch: (_url, init) => {
        posted.push(JSON.parse(String(init.body)).checkId);
        // The first send takes long enough for the person to delete the other check meanwhile.
        if (posted.length === 1) deleteCheck(watch, "site");
        return new Response("{}", { status: 200 });
      },
    });
    const watch = testWatch(fake.deps);
    setAlerts(watch, { url: "https://t3.example/hook" });
    for (const id of ["jobs", "site"]) {
      watch.defineCheck({ id, serviceId: "s", kind: "http", intent: id, config: { url: "https://x.test/" }, keyId: null, cadenceSeconds: 900, origin: "agent" }, "on");
      watch.store.recordRun(watch.store.check(id)!, { outcome: "fail", summary: "Answered 500", evidence: {} }, watch.now(), 5, watch.now());
    }
    expect(watch.store.pendingEvents().map((e) => e.checkId)).toEqual(["jobs", "site"]);
    expect(await deliverAlerts(watch, "https://watch.example")).toBe(1);
    expect(posted).toEqual(["jobs"]);
    // Its change waits, unmarked, so its history never says it was sent.
    expect(watch.store.pendingEvents()).toEqual([]);
    expect(watch.store.events().find((e) => e.checkId === "site")!.deliveredAt).toBeNull();
    restoreCheck(watch, "site");
    expect(watch.store.pendingEvents().map((e) => e.checkId)).toEqual(["site"]);
  });

  it("restores a vendor check onto the vendor's key when its own was removed meanwhile", () => {
    const { watch } = setup();
    const key = (id: string) => ({ id, vendor: "stripe", label: "Stripe key", source: "Added on the page", sourceKey: null, last4: "1234", account: null, createdAt: watch.now(), removedAt: null });
    watch.store.insertKey(key("k1"), "x");
    watch.defineCheck(
      { id: "vendor:stripe:key", serviceId: "vendor:stripe", kind: "vendor", intent: "The key works", config: { vendor: "stripe", check: "key" }, keyId: "k1", cadenceSeconds: 3600, origin: "scan" },
      "on",
    );
    deleteCheck(watch, "vendor:stripe:key");
    watch.store.removeKey("k1", watch.now());
    watch.store.insertKey(key("k2"), "y");
    expect(restoreCheck(watch, "vendor:stripe:key")).toMatchObject({ keyId: "k2", state: "paused", intent: "The key works" });
  });

  it("lets go of a check the login choice paused, and takes no note on it", () => {
    const { watch } = setup();
    watch.store.setKv(PAUSED_BY_CHOICE, ["site", "other"]);
    deleteCheck(watch, "site");
    // Restored, it waits for the person rather than for the login to come back.
    expect(watch.store.getKv<Array<string>>(PAUSED_BY_CHOICE, [])).toEqual(["other"]);
    expect(refusal(() => addNote(watch, "site", "Found the cause"))).toEqual({
      message: "The check site was deleted on the page, so a note on it would show nowhere. Tell the person instead; they can restore it in Details.",
      status: 409,
    });
    expect(refusal(() => addNote(watch, "nope", "x")).status).toBe(404);
  });

  it("leaves drafts to Discard", () => {
    const { watch } = setup();
    watch.store.setCheckState("site", "draft", watch.now());
    expect(refusal(() => deleteCheck(watch, "site"))).toEqual({ message: "Discard a draft on Home instead.", status: 409 });
  });

  it("leaves the review and apply, and a new draft takes the next free id", async () => {
    const { watch } = setup();
    watch.defineCheck(
      { id: "github:acme/shop:ci", serviceId: "github:acme/shop", kind: "github", intent: "CI on main is passing", config: { repo: "acme/shop" }, keyId: null, cadenceSeconds: 900, origin: "scan" },
      "proposed",
    );
    const suggestion = { serviceId: "s", title: "S", outcome: "pass", summary: "", state: "proposed", suggested: true } as const;
    watch.store.setKv("scan", {
      scannedAt: watch.now(),
      roots: [],
      repositories: 1,
      services: [],
      appliedAt: watch.now(),
      suggestions: [{ ...suggestion, checkId: "github:acme/shop:ci", intent: "CI" }, { ...suggestion, checkId: "site", intent: "Site answers" }],
    } satisfies Scan);
    deleteCheck(watch, "github:acme/shop:ci");
    expect(readState(watch).setup.scan!.suggestions.map((s) => s.checkId)).toEqual(["site"]);
    await watch.applyScan({ turnOn: ["github:acme/shop:ci", "site"], removeKeys: [] });
    expect(watch.store.check("github:acme/shop:ci")!.state).toBe("deleted");
    // The review shows each check's name as it stands, after an edit too.
    editCheck(watch, "site", { intent: "Shop answers", cadenceMinutes: 15 });
    expect(readState(watch).setup.scan!.suggestions[0]!.intent).toBe("Shop answers");
    // A deleted check keeps its id with its history, so a draft of the same name takes the next one.
    const draft = () => draftCheck(watch, { service: "Shop", kind: "http", intent: "Site answers", config: { url: "https://shop.example/" } });
    const { check } = await draft();
    expect(check.id).toBe("custom:shop:site-answers");
    await watch.setCheck(check.id, "on");
    deleteCheck(watch, check.id);
    expect((await draft()).check.id).toBe("custom:shop:site-answers-2");
  });
});
