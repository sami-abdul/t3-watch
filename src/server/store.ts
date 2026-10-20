import { DatabaseSync } from "node:sqlite";

export type Outcome = "pass" | "fail" | "unknown";

/** Whether recording an outcome changes a check's state and so makes an event: a first run only when it fails. */
export const changesState = (previous: Outcome | null, outcome: Outcome) =>
  previous === null ? outcome === "fail" : previous !== outcome;
/**
 * proposed: found by setup, waiting for review. on: runs on its cadence. paused: stopped by a
 * person or agent. draft: written by an agent, waiting for a person. off: left off in review.
 */
export type CheckState = "proposed" | "on" | "paused" | "draft" | "off";
export type CheckKind = "http" | "github" | "aws_metric" | "heartbeat" | "vendor";

export interface Service {
  readonly id: string;
  readonly vendor: string;
  readonly label: string;
  readonly target: string | null;
  readonly reachable: boolean;
  readonly note: string | null;
  readonly foundIn: ReadonlyArray<string>;
  readonly updatedAt: string;
}
export interface Check {
  readonly id: string;
  readonly serviceId: string;
  readonly kind: CheckKind;
  readonly intent: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly keyId: string | null;
  readonly cadenceSeconds: number;
  readonly state: CheckState;
  readonly snoozedUntil: string | null;
  readonly nextRunAt: string | null;
  readonly origin: "scan" | "agent" | "user";
  readonly lastOutcome: Outcome | null;
  readonly lastSummary: string | null;
  readonly lastRunAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface Run {
  readonly id: number;
  readonly checkId: string;
  readonly at: string;
  readonly outcome: Outcome;
  readonly summary: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly durationMs: number;
}
export interface ChangeEvent {
  readonly id: number;
  readonly checkId: string;
  readonly at: string;
  readonly from: Outcome | null;
  readonly to: Outcome;
  readonly summary: string;
  readonly deliveredAt: string | null;
  readonly attempts: number;
}
export interface KeyRecord {
  readonly id: string;
  readonly vendor: string;
  readonly label: string;
  /** Where the key came from, such as "STRIPE_KEY in api/.env". Never the value. */
  readonly source: string;
  /** Stable id of a scan-found source, so a rescan recognises it. */
  readonly sourceKey: string | null;
  readonly last4: string;
  readonly account: string | null;
  readonly createdAt: string;
  readonly removedAt: string | null;
}
export interface Note {
  readonly id: number;
  readonly checkId: string | null;
  readonly at: string;
  readonly text: string;
}
export interface VendorDraft {
  readonly id: string;
  readonly description: Readonly<Record<string, unknown>>;
  readonly state: "draft" | "approved" | "discarded";
  readonly testSummary: string | null;
  readonly createdAt: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY, vendor TEXT NOT NULL, label TEXT NOT NULL, target TEXT,
  reachable INTEGER NOT NULL, note TEXT, found_in TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checks (
  id TEXT PRIMARY KEY, service_id TEXT NOT NULL, kind TEXT NOT NULL, intent TEXT NOT NULL,
  config TEXT NOT NULL, key_id TEXT, cadence_seconds INTEGER NOT NULL, state TEXT NOT NULL,
  snoozed_until TEXT, next_run_at TEXT, origin TEXT NOT NULL, last_outcome TEXT,
  last_summary TEXT, last_run_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, check_id TEXT NOT NULL, at TEXT NOT NULL,
  outcome TEXT NOT NULL, summary TEXT NOT NULL, evidence TEXT NOT NULL, duration_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS runs_by_check ON runs(check_id, id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, check_id TEXT NOT NULL, at TEXT NOT NULL,
  from_outcome TEXT, to_outcome TEXT NOT NULL, summary TEXT NOT NULL, delivered_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS keys (
  id TEXT PRIMARY KEY, vendor TEXT NOT NULL, label TEXT NOT NULL, source TEXT NOT NULL,
  source_key TEXT, last4 TEXT NOT NULL, account TEXT, ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL, removed_at TEXT);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, check_id TEXT, at TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vendor_drafts (
  id TEXT PRIMARY KEY, description TEXT NOT NULL, state TEXT NOT NULL, test_summary TEXT,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS heartbeats (
  check_id TEXT NOT NULL, at TEXT NOT NULL, status TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS heartbeats_by_check ON heartbeats(check_id, at);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS signin_codes (hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, created_at TEXT NOT NULL);
`;

type Row = Record<string, unknown>;
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : fallback;
const str = (value: unknown) => (value === null || value === undefined ? null : String(value));

const toService = (r: Row): Service => ({
  id: String(r.id),
  vendor: String(r.vendor),
  label: String(r.label),
  target: str(r.target),
  reachable: r.reachable === 1,
  note: str(r.note),
  foundIn: parse(r.found_in, []),
  updatedAt: String(r.updated_at),
});
const toCheck = (r: Row): Check => ({
  id: String(r.id),
  serviceId: String(r.service_id),
  kind: r.kind as CheckKind,
  intent: String(r.intent),
  config: parse(r.config, {}),
  keyId: str(r.key_id),
  cadenceSeconds: Number(r.cadence_seconds),
  state: r.state as CheckState,
  snoozedUntil: str(r.snoozed_until),
  nextRunAt: str(r.next_run_at),
  origin: r.origin as Check["origin"],
  lastOutcome: str(r.last_outcome) as Outcome | null,
  lastSummary: str(r.last_summary),
  lastRunAt: str(r.last_run_at),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
const toRun = (r: Row): Run => ({
  id: Number(r.id),
  checkId: String(r.check_id),
  at: String(r.at),
  outcome: r.outcome as Outcome,
  summary: String(r.summary),
  evidence: parse(r.evidence, {}),
  durationMs: Number(r.duration_ms),
});
const toEvent = (r: Row): ChangeEvent => ({
  id: Number(r.id),
  checkId: String(r.check_id),
  at: String(r.at),
  from: str(r.from_outcome) as Outcome | null,
  to: r.to_outcome as Outcome,
  summary: String(r.summary),
  deliveredAt: str(r.delivered_at),
  attempts: Number(r.attempts),
});
const toKey = (r: Row): KeyRecord => ({
  id: String(r.id),
  vendor: String(r.vendor),
  label: String(r.label),
  source: String(r.source),
  sourceKey: str(r.source_key),
  last4: String(r.last4),
  account: str(r.account),
  createdAt: String(r.created_at),
  removedAt: str(r.removed_at),
});

export type Store = ReturnType<typeof openStore>;

/** All persistent state, in one SQLite file. Pass ":memory:" in tests. */
export const openStore = (file: string) => {
  const db = new DatabaseSync(file);
  // The timeout first, so a CLI opening the file while the service writes waits instead of failing.
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  const all = (sql: string, ...params: Array<string | number | null>) =>
    db.prepare(sql).all(...params) as Array<Row>;
  const one = (sql: string, ...params: Array<string | number | null>) =>
    db.prepare(sql).get(...params) as Row | undefined;
  const exec = (sql: string, ...params: Array<string | number | null>) =>
    db.prepare(sql).run(...params);
  /** Keeps a run in a check's history, which holds its newest 200. */
  const addRun = (checkId: string, at: string, outcome: Outcome, summary: string, evidence: Record<string, unknown>, durationMs: number) => {
    exec(
      "INSERT INTO runs (check_id, at, outcome, summary, evidence, duration_ms) VALUES (?, ?, ?, ?, ?, ?)",
      checkId,
      at,
      outcome,
      summary,
      json(evidence),
      durationMs,
    );
    exec(
      `DELETE FROM runs WHERE check_id = ? AND id NOT IN
         (SELECT id FROM runs WHERE check_id = ? ORDER BY id DESC LIMIT 200)`,
      checkId,
      checkId,
    );
  };

  return {
    close: () => db.close(),
    transaction: <A>(work: () => A): A => {
      db.exec("BEGIN");
      try {
        const result = work();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    services: () => all("SELECT * FROM services ORDER BY label").map(toService),
    service: (id: string) => {
      const row = one("SELECT * FROM services WHERE id = ?", id);
      return row === undefined ? null : toService(row);
    },
    upsertService: (s: Service) =>
      exec(
        `INSERT INTO services (id, vendor, label, target, reachable, note, found_in, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET vendor = excluded.vendor, label = excluded.label,
           target = excluded.target, reachable = excluded.reachable, note = excluded.note,
           found_in = excluded.found_in, updated_at = excluded.updated_at`,
        s.id,
        s.vendor,
        s.label,
        s.target,
        s.reachable ? 1 : 0,
        s.note,
        json(s.foundIn),
        s.updatedAt,
      ),

    checks: () => all("SELECT * FROM checks ORDER BY created_at, id").map(toCheck),
    check: (id: string) => {
      const row = one("SELECT * FROM checks WHERE id = ?", id);
      return row === undefined ? null : toCheck(row);
    },
    /** Inserts or replaces a check's definition, keeping its run state. */
    upsertCheck: (c: Check) =>
      exec(
        `INSERT INTO checks (id, service_id, kind, intent, config, key_id, cadence_seconds, state,
           snoozed_until, next_run_at, origin, last_outcome, last_summary, last_run_at, created_at,
           updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET service_id = excluded.service_id, kind = excluded.kind,
           intent = excluded.intent, config = excluded.config, key_id = excluded.key_id,
           cadence_seconds = excluded.cadence_seconds, state = excluded.state,
           snoozed_until = excluded.snoozed_until, next_run_at = excluded.next_run_at,
           updated_at = excluded.updated_at`,
        c.id,
        c.serviceId,
        c.kind,
        c.intent,
        json(c.config),
        c.keyId,
        c.cadenceSeconds,
        c.state,
        c.snoozedUntil,
        c.nextRunAt,
        c.origin,
        c.lastOutcome,
        c.lastSummary,
        c.lastRunAt,
        c.createdAt,
        c.updatedAt,
      ),
    setCheckState: (
      id: string,
      state: CheckState,
      at: string,
      extra: { snoozedUntil?: string | null; nextRunAt?: string | null } = {},
    ) =>
      exec(
        `UPDATE checks SET state = ?, snoozed_until = ?, next_run_at = ?, updated_at = ? WHERE id = ?`,
        state,
        extra.snoozedUntil ?? null,
        extra.nextRunAt ?? null,
        at,
        id,
      ),
    deleteCheck: (id: string) => {
      exec("DELETE FROM checks WHERE id = ?", id);
      exec("DELETE FROM runs WHERE check_id = ?", id);
      exec("DELETE FROM heartbeats WHERE check_id = ?", id);
    },
    dueChecks: (now: string) =>
      all(
        `SELECT * FROM checks WHERE state = 'on'
           AND (snoozed_until IS NULL OR snoozed_until <= ?)
           AND (next_run_at IS NULL OR next_run_at <= ?)
         ORDER BY next_run_at`,
        now,
        now,
      ).map(toCheck),

    /** Records a run and returns the change event it caused, if any. */
    recordRun: (
      check: Check,
      result: { outcome: Outcome; summary: string; evidence: Record<string, unknown> },
      at: string,
      durationMs: number,
      nextRunAt: string,
    ): ChangeEvent | null => {
      addRun(check.id, at, result.outcome, result.summary, result.evidence, durationMs);
      exec(
        `UPDATE checks SET last_outcome = ?, last_summary = ?, last_run_at = ?, next_run_at = ?,
           snoozed_until = CASE WHEN snoozed_until IS NOT NULL AND snoozed_until <= ? THEN NULL ELSE snoozed_until END
         WHERE id = ?`,
        result.outcome,
        result.summary,
        at,
        nextRunAt,
        at,
        check.id,
      );
      const previous = check.lastOutcome;
      if (!changesState(previous, result.outcome)) return null;
      const info = exec(
        "INSERT INTO events (check_id, at, from_outcome, to_outcome, summary) VALUES (?, ?, ?, ?, ?)",
        check.id,
        at,
        previous,
        result.outcome,
        result.summary,
      );
      return toEvent(one("SELECT * FROM events WHERE id = ?", Number(info.lastInsertRowid))!);
    },
    /**
     * Keeps a run Watch held while it could not reach the internet. The check keeps its last
     * result and no event is made; only its next run time moves.
     */
    recordHeld: (
      check: Check,
      result: { outcome: Outcome; summary: string; evidence: Record<string, unknown> },
      at: string,
      durationMs: number,
      nextRunAt: string,
    ) => {
      const summary = `Held while Watch could not reach the internet: ${result.summary}`.slice(0, 300);
      addRun(check.id, at, "unknown", summary, { ...result.evidence, held: true }, durationMs);
      exec("UPDATE checks SET next_run_at = ? WHERE id = ?", nextRunAt, check.id);
    },
    /** When a check's current streak of held runs began, or null when its latest run was not held. */
    heldSince: (checkId: string): string | null => {
      let since: string | null = null;
      for (const run of all("SELECT at, evidence FROM runs WHERE check_id = ? ORDER BY id DESC LIMIT 200", checkId)) {
        if (parse<{ held?: unknown }>(run.evidence, {}).held !== true) break;
        since = String(run.at);
      }
      return since;
    },
    /** Shows a trial's result on a draft or suggestion without recording a run or an event. */
    setTrialResult: (id: string, outcome: Outcome, summary: string, at: string) =>
      exec(
        "UPDATE checks SET last_outcome = ?, last_summary = ?, last_run_at = ? WHERE id = ?",
        outcome,
        summary,
        at,
        id,
      ),
    deleteVendorDraft: (id: string) => exec("DELETE FROM vendor_drafts WHERE id = ?", id),
    runs: (checkId: string, limit = 20) =>
      all("SELECT * FROM runs WHERE check_id = ? ORDER BY id DESC LIMIT ?", checkId, limit).map(
        toRun,
      ),
    events: (limit = 50) =>
      all("SELECT * FROM events ORDER BY id DESC LIMIT ?", limit).map(toEvent),
    pendingEvents: () =>
      all("SELECT * FROM events WHERE delivered_at IS NULL ORDER BY id LIMIT 50").map(toEvent),
    markEvent: (id: number, deliveredAt: string | null) =>
      exec(
        "UPDATE events SET delivered_at = ?, attempts = attempts + 1 WHERE id = ?",
        deliveredAt,
        id,
      ),
    /** Events that happened before alerts were set up are not sent later. */
    dropPendingEvents: (at: string) =>
      exec("UPDATE events SET delivered_at = ? WHERE delivered_at IS NULL", at),

    keys: () =>
      all("SELECT * FROM keys WHERE removed_at IS NULL ORDER BY created_at").map(toKey),
    allKeys: () => all("SELECT * FROM keys ORDER BY created_at").map(toKey),
    keyBySource: (sourceKey: string) => {
      const row = one("SELECT * FROM keys WHERE source_key = ? ORDER BY created_at DESC", sourceKey);
      return row === undefined ? null : toKey(row);
    },
    keyCiphertext: (id: string) => str(one("SELECT ciphertext FROM keys WHERE id = ?", id)?.ciphertext),
    insertKey: (k: KeyRecord, ciphertext: string) =>
      exec(
        `INSERT INTO keys (id, vendor, label, source, source_key, last4, account, ciphertext, created_at, removed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        k.id,
        k.vendor,
        k.label,
        k.source,
        k.sourceKey,
        k.last4,
        k.account,
        ciphertext,
        k.createdAt,
        k.removedAt,
      ),
    setKeyAccount: (id: string, account: string | null) =>
      exec("UPDATE keys SET account = ? WHERE id = ?", account, id),
    removeKey: (id: string, at: string) => {
      exec("UPDATE keys SET removed_at = ?, ciphertext = '' WHERE id = ?", at, id);
      // Checks that used the key cannot run without it.
      exec(
        "UPDATE checks SET state = 'paused', updated_at = ? WHERE key_id = ? AND state = 'on'",
        at,
        id,
      );
    },

    notes: (limit = 100) =>
      all("SELECT * FROM notes ORDER BY id DESC LIMIT ?", limit).map((r) => ({
        id: Number(r.id),
        checkId: str(r.check_id),
        at: String(r.at),
        text: String(r.text),
      })) as Array<Note>,
    addNote: (checkId: string | null, text: string, at: string) =>
      exec("INSERT INTO notes (check_id, at, text) VALUES (?, ?, ?)", checkId, at, text),

    vendorDrafts: () =>
      all("SELECT * FROM vendor_drafts ORDER BY created_at DESC").map((r) => ({
        id: String(r.id),
        description: parse(r.description, {}),
        state: r.state as VendorDraft["state"],
        testSummary: str(r.test_summary),
        createdAt: String(r.created_at),
      })) as Array<VendorDraft>,
    upsertVendorDraft: (d: VendorDraft) =>
      exec(
        `INSERT INTO vendor_drafts (id, description, state, test_summary, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET description = excluded.description, state = excluded.state,
           test_summary = excluded.test_summary`,
        d.id,
        json(d.description),
        d.state,
        d.testSummary,
        d.createdAt,
      ),

    addHeartbeat: (checkId: string, at: string, status: "success" | "fail") => {
      exec("INSERT INTO heartbeats (check_id, at, status) VALUES (?, ?, ?)", checkId, at, status);
      exec(
        `DELETE FROM heartbeats WHERE check_id = ? AND at NOT IN
           (SELECT at FROM heartbeats WHERE check_id = ? ORDER BY at DESC LIMIT 50)`,
        checkId,
        checkId,
      );
    },
    lastHeartbeat: (checkId: string, status: "success" | "fail") =>
      str(
        one(
          "SELECT at FROM heartbeats WHERE check_id = ? AND status = ? ORDER BY at DESC LIMIT 1",
          checkId,
          status,
        )?.at,
      ),

    /** Keeps the hash of a one-time sign-in code until it expires, clearing expired ones. */
    addSignInCode: (hash: string, expiresAt: string, now: string) => {
      exec("DELETE FROM signin_codes WHERE expires_at <= ?", now);
      exec("INSERT INTO signin_codes (hash, expires_at) VALUES (?, ?)", hash, expiresAt);
    },
    /** Uses up a sign-in code: true only the first time, and only before it expires. One write. */
    takeSignInCode: (hash: string, now: string) =>
      Number(exec("DELETE FROM signin_codes WHERE hash = ? AND expires_at > ?", hash, now).changes) === 1,
    /** Whether a sign-in code exists and has not expired, without using it up. */
    hasSignInCode: (hash: string, now: string) =>
      one("SELECT 1 AS found FROM signin_codes WHERE hash = ? AND expires_at > ?", hash, now) !== undefined,

    /** Keeps the hash of a browser session, clearing sessions that began before the cutoff. */
    addSession: (hash: string, at: string, cutoff: string) => {
      exec("DELETE FROM sessions WHERE created_at <= ?", cutoff);
      exec("INSERT INTO sessions (hash, created_at) VALUES (?, ?)", hash, at);
    },
    /** Whether a session exists and began after the cutoff. */
    hasSession: (hash: string, cutoff: string) =>
      one("SELECT 1 AS found FROM sessions WHERE hash = ? AND created_at > ?", hash, cutoff) !== undefined,
    /** Ends every browser session and says how many there were. */
    clearSessions: () => Number(exec("DELETE FROM sessions").changes),

    getKv: <T>(key: string, fallback: T): T =>
      parse(one("SELECT value FROM kv WHERE key = ?", key)?.value, fallback),
    setKv: (key: string, value: unknown) =>
      exec(
        "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        key,
        json(value),
      ),
  };
};
