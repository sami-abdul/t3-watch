import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { openStore } from "./store.ts";

describe("store", () => {
  it("adds the pending column to a database made before it existed", () => {
    const dir = mkdtempSync(join(tmpdir(), "t3w-store-"));
    try {
      const file = join(dir, "watch.sqlite");
      const old = new DatabaseSync(file);
      old.exec(`CREATE TABLE checks (
        id TEXT PRIMARY KEY, service_id TEXT NOT NULL, kind TEXT NOT NULL, intent TEXT NOT NULL,
        config TEXT NOT NULL, key_id TEXT, cadence_seconds INTEGER NOT NULL, state TEXT NOT NULL,
        snoozed_until TEXT, next_run_at TEXT, origin TEXT NOT NULL, last_outcome TEXT,
        last_summary TEXT, last_run_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT INTO checks VALUES ('c', 's', 'http', 'Site is up', '{"url":"https://x.test"}', NULL, 60, 'on',
          NULL, NULL, 'user', 'pass', 'Answered 200', NULL, '2026-10-15T10:00:00Z', '2026-10-15T10:00:00Z');`);
      old.close();
      const store = openStore(file);
      expect(store.check("c")).toMatchObject({ lastOutcome: "pass", pending: null });
      store.recordPending("c", { outcome: "fail", summary: "Answered 500", evidence: {} }, "2026-10-15T10:01:00Z", 1, "2026-10-15T10:02:00Z");
      expect(store.check("c")!.pending).toMatchObject({ outcome: "fail" });
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clears a pending run when a removed key pauses its check, and reads only well-formed ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "t3w-store-"));
    try {
      const file = join(dir, "watch.sqlite");
      const store = openStore(file);
      const at = "2026-10-15T10:00:00.000Z";
      store.upsertCheck({
        id: "c", serviceId: "s", kind: "vendor", intent: "The key works", config: {}, keyId: "k1", cadenceSeconds: 60, state: "on",
        snoozedUntil: null, nextRunAt: null, origin: "user", lastOutcome: "pass", lastSummary: null, lastRunAt: null, createdAt: at, updatedAt: at,
      });
      store.recordPending("c", { outcome: "fail", summary: "x".repeat(400), evidence: {} }, at, 1, at);
      expect(store.check("c")!.pending!.summary).toHaveLength(300);
      store.removeKey("k1", at);
      expect(store.check("c")).toMatchObject({ state: "paused", pending: null });
      // A stored pending run missing a field reads as none.
      const raw = new DatabaseSync(file);
      raw.exec(`UPDATE checks SET pending = '{"outcome":"fail"}' WHERE id = 'c'`);
      raw.close();
      expect(store.check("c")!.pending).toBeNull();
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
