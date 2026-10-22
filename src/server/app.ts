/**
 * The Watch service in one object. The HTTP API, the page and the MCP tools all call these
 * methods, so every change a person or an agent makes goes through the same rules.
 */
import { randomBytes } from "node:crypto";

import type { CheckContext } from "./checks/index.ts";
import type { Reads } from "./config.ts";
import { makeConnectivity } from "./connectivity.ts";
import { openKeyring } from "./keys.ts";
import type { Deps } from "./proc.ts";
import { productKey } from "./product-key.ts";
import { makeRunner } from "./runner.ts";
import { applyScan, makeScanner } from "./scan.ts";
import { type ChangeEvent, type Check, type KeyRecord, openStore, type Service, type Store } from "./store.ts";
import { loadCatalog, runKeyCheck, type Vendor } from "./vendors.ts";

export class WatchError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type CheckAction = "on" | "pause" | "resume" | "snooze" | "run";

/** What a demo Watch refuses, so nothing real comes into it: it shows sample data only. */
export const SAMPLE_ONLY = {
  reads: "The demo shows sample data only, so it neither scans nor changes what it may read. Your own Watch asks what it may read, then scans.",
  keys: "The demo takes no keys and keeps its sample one: its answers are made up, so any key would seem to work. Keys go in your own Watch.",
  secret: "The demo makes no signing secret: its alerts go nowhere, and a secret made here could end up with your own Watch thread. Make one in your own Watch.",
} as const;

export interface PublicKey extends Omit<KeyRecord, "removedAt"> {}

interface WatchOptions {
  readonly home: string | null;
  readonly dbFile: string;
  readonly deps: Deps;
  readonly catalogDir?: string;
  /** Folders whose repositories setup scans. */
  readonly roots?: () => ReadonlyArray<string>;
  /** The probeUrls setting, read on each probe; missing means the default addresses. */
  readonly probeUrls?: () => unknown;
  /** What setup may read besides the folders, as the person chose it. */
  readonly reads?: () => Reads;
  /** Whether the person has chosen what setup may read; a new install scans only after. */
  readonly chosen?: () => boolean;
  /** A demo: it takes no key, makes no signing secret and does not scan, so nothing real comes in. */
  readonly sample?: boolean;
}

const makeCore = (options: WatchOptions) => {
  const store: Store = openStore(options.dbFile);
  const keyring = openKeyring(options.home, store);
  const now = () => options.deps.now().toISOString();
  let catalog = new Map<string, Vendor>();
  const reloadCatalog = () => {
    const local = store.vendorDrafts().filter((d) => d.state === "approved").map((d) => d.description);
    catalog = loadCatalog(local, options.catalogDir);
  };
  reloadCatalog();
  const listeners = new Set<(event: ChangeEvent) => void>();
  const context: CheckContext = { deps: options.deps, store, keyring, vendors: () => catalog };
  const connectivity = makeConnectivity(options.deps, options.probeUrls);
  const runner = makeRunner(
    context,
    (event) => {
      for (const listener of listeners) listener(event);
    },
    connectivity,
  );

  const requireCheck = (id: string) => {
    const check = store.check(id);
    if (check === null) throw new WatchError(`No check ${id}`, 404);
    return check;
  };
  /** A check that is not deleted: a deleted one takes no action until the person restores it. */
  const requireLiveCheck = (id: string) => {
    const check = requireCheck(id);
    if (check.state === "deleted") throw new WatchError("This check was deleted. Restore it in Details first.", 409);
    return check;
  };

  const setCheck = async (id: string, action: CheckAction, until?: string) => {
    const check = requireLiveCheck(id);
    const at = now();
    switch (action) {
      case "on":
      case "resume": {
        if (check.kind === "vendor" && (check.keyId === null || keyring.reveal(check.keyId) === null))
          throw new WatchError("This check needs a key first");
        // A login the person turned off in What Watch may read stays unused until they turn it on.
        const login = check.kind === "github" ? "github" : check.kind === "aws_metric" ? "aws" : null;
        if (login !== null && options.reads?.()[login] === false)
          throw new WatchError(
            `This check uses ${login === "github" ? "the GitHub CLI" : "AWS CLI profiles"}, which ${login === "github" ? "is" : "are"} turned off in What Watch may read. Turn ${login === "github" ? "it" : "them"} on there first.`,
            409,
          );
        store.setCheckState(id, "on", at, { nextRunAt: null });
        break;
      }
      case "pause":
        store.setCheckState(id, "paused", at, { nextRunAt: null });
        break;
      case "snooze": {
        const time = until === undefined ? Number.NaN : Date.parse(until);
        if (Number.isNaN(time) || time <= Date.parse(at))
          throw new WatchError("Snooze needs a time in the future");
        store.setCheckState(id, "on", at, {
          snoozedUntil: new Date(time).toISOString(),
          nextRunAt: new Date(time).toISOString(),
        });
        break;
      }
      case "run":
        await runner.runNow(check);
        break;
    }
    return store.check(id)!;
  };

  const publicKey = ({ removedAt: _, ...key }: KeyRecord): PublicKey => key;

  /** Stores a key only after the vendor's key check accepts it. */
  const addKey = async (input: {
    vendor: string;
    value: string;
    label?: string;
    source?: string;
    sourceKey?: string | null;
  }) => {
    if (options.sample === true) throw new WatchError(SAMPLE_ONLY.keys, 403);
    const vendor = catalog.get(input.vendor);
    if (vendor?.key === undefined) throw new WatchError(`Watch cannot use a key for ${input.vendor}`);
    const value = input.value.trim();
    if (value.length < 8 || value.length > 4096 || /\s/.test(value))
      throw new WatchError("That does not look like a key");
    const result = await runKeyCheck(vendor, value, options.deps.fetch);
    if (result.outcome !== "pass")
      return { ok: false as const, summary: result.summary, outcome: result.outcome };
    const key = keyring.add(
      {
        id: `key-${randomBytes(6).toString("hex")}`,
        vendor: vendor.id,
        label: input.label ?? `${vendor.label} key`,
        source: input.source ?? "Added on the page",
        sourceKey: input.sourceKey ?? null,
        account: result.account,
        createdAt: now(),
      },
      value,
    );
    return { ok: true as const, summary: result.summary, key: publicKey(key) };
  };

  const removeKey = (id: string) => {
    if (options.sample === true) throw new WatchError(SAMPLE_ONLY.keys, 403);
    if (!store.keys().some((k) => k.id === id)) throw new WatchError(`No key ${id}`, 404);
    store.removeKey(id, now());
  };

  return {
    store,
    keyring,
    runner,
    link: connectivity.link,
    deps: options.deps,
    sample: options.sample === true,
    now,
    vendors: () => catalog,
    reloadCatalog,
    onEvent: (listener: (event: ChangeEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requireCheck,
    requireLiveCheck,
    setCheck,
    addKey,
    removeKey,
    keys: () => store.keys().map(publicKey),
    upsertService: (service: Omit<Service, "updatedAt" | "product">) =>
      store.upsertService({ ...service, updatedAt: now() }),
    /**
     * Names the product a service belongs to on Home, or with an empty name goes back to the guess
     * from names. Only how Home groups checks changes. A product has one spelling: naming it in a
     * new one respells it for its other services too, which are returned.
     */
    setServiceProduct: (serviceId: string, product: string) => {
      if (store.service(serviceId) === null) throw new WatchError(`No service ${serviceId}. watch_check shows a check's service, with its id.`, 404);
      const name = product.trim().replace(/\s+/g, " ");
      if ([...name].length > 60) throw new WatchError("A product name has at most 60 characters");
      // Control characters, and invisible ones that turn text around or hide in it, which could make
      // a name read as another; the joiners some scripts and emoji need stay allowed.
      if (/[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/u.test(name))
        throw new WatchError("A product name is plain text, with no control characters");
      const key = productKey(name);
      if (name !== "" && key === "") throw new WatchError("A product name needs a letter or a digit");
      const at = now();
      store.setServiceProduct(serviceId, name === "" ? null : name, at);
      const respelt = name === "" ? [] : store.services().filter((s) => s.id !== serviceId && s.product !== null && s.product !== name && productKey(s.product) === key);
      for (const other of respelt) store.setServiceProduct(other.id, name, at);
      return { service: store.service(serviceId)!, respelt: respelt.map((s) => s.label) };
    },
    /** Adds or updates a check definition, keeping state for a check that already exists. */
    defineCheck: (
      definition: Pick<Check, "id" | "serviceId" | "kind" | "intent" | "config" | "keyId" | "cadenceSeconds" | "origin">,
      state: Check["state"],
    ) => {
      const prior = store.check(definition.id);
      const at = now();
      store.upsertCheck({
        ...definition,
        state: prior?.state ?? state,
        snoozedUntil: prior?.snoozedUntil ?? null,
        nextRunAt: prior?.nextRunAt ?? null,
        lastOutcome: prior?.lastOutcome ?? null,
        lastSummary: prior?.lastSummary ?? null,
        lastRunAt: prior?.lastRunAt ?? null,
        createdAt: prior?.createdAt ?? at,
        updatedAt: at,
      });
      return store.check(definition.id)!;
    },
    close: () => {
      runner.stop();
      store.close();
    },
  };
};
/** The service without setup, which setup itself builds on. */
export type WatchCore = ReturnType<typeof makeCore>;

export const makeWatch = (options: WatchOptions) => {
  const core = makeCore(options);
  const scanner = makeScanner(core, options.roots ?? (() => []), options.reads, options.chosen);
  return {
    ...core,
    scanner,
    applyScan: (input: { turnOn: ReadonlyArray<string>; removeKeys: ReadonlyArray<string> }) =>
      applyScan(core, input),
  };
};
export type Watch = ReturnType<typeof makeWatch>;
