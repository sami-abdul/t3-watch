/**
 * The Watch service in one object. The HTTP API, the page and the MCP tools all call these
 * methods, so every change a person or an agent makes goes through the same rules.
 */
import { randomBytes } from "node:crypto";

import type { CheckContext } from "./checks/index.ts";
import { makeConnectivity } from "./connectivity.ts";
import { openKeyring } from "./keys.ts";
import type { Deps } from "./proc.ts";
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
  const connectivity = makeConnectivity(options.deps, store, options.probeUrls);
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

  const setCheck = async (id: string, action: CheckAction, until?: string) => {
    const check = requireCheck(id);
    const at = now();
    switch (action) {
      case "on":
      case "resume":
        if (check.kind === "vendor" && (check.keyId === null || keyring.reveal(check.keyId) === null))
          throw new WatchError("This check needs a key first");
        store.setCheckState(id, "on", at, { nextRunAt: null });
        break;
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
    if (!store.keys().some((k) => k.id === id)) throw new WatchError(`No key ${id}`, 404);
    store.removeKey(id, now());
  };

  return {
    store,
    keyring,
    runner,
    link: connectivity.link,
    deps: options.deps,
    now,
    vendors: () => catalog,
    reloadCatalog,
    onEvent: (listener: (event: ChangeEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setCheck,
    addKey,
    removeKey,
    keys: () => store.keys().map(publicKey),
    upsertService: (service: Omit<Service, "updatedAt">) =>
      store.upsertService({ ...service, updatedAt: now() }),
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
  const scanner = makeScanner(core, options.roots ?? (() => []));
  return {
    ...core,
    scanner,
    applyScan: (input: { turnOn: ReadonlyArray<string>; removeKeys: ReadonlyArray<string> }) =>
      applyScan(core, input),
  };
};
export type Watch = ReturnType<typeof makeWatch>;
