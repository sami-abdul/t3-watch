import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { makeSignInCode, signInLink, useSignInCode } from "./signin.ts";
import { openStore } from "./store.ts";

const at = (iso: string) => new Date(iso);

describe("sign-in codes", () => {
  it("work once, before they expire, and are stored only as a hash", () => {
    const store = openStore(":memory:");
    const code = makeSignInCode(store, at("2026-10-20T10:00:00Z"));
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(useSignInCode(store, code, at("2026-10-20T10:09:00Z"))).toBe(true);
    expect(useSignInCode(store, code, at("2026-10-20T10:09:01Z"))).toBe(false);

    const late = makeSignInCode(store, at("2026-10-20T10:00:00Z"));
    expect(useSignInCode(store, late, at("2026-10-20T10:11:00Z"))).toBe(false);
    expect(useSignInCode(store, "not-a-code", at("2026-10-20T10:00:00Z"))).toBe(false);
    expect(useSignInCode(store, "", at("2026-10-20T10:00:00Z"))).toBe(false);
    store.close();
  });

  it("stores only a hash of the code", () => {
    const dir = mkdtempSync(join(tmpdir(), "t3w-signin-"));
    try {
      const store = openStore(join(dir, "watch.sqlite"));
      const code = makeSignInCode(store, at("2026-10-20T10:00:00Z"));
      store.close();
      const db = new DatabaseSync(join(dir, "watch.sqlite"));
      const rows = db.prepare("SELECT hash FROM signin_codes").all() as Array<{ hash: string }>;
      db.close();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0]!.hash).not.toContain(code);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("puts the code on the page's sign-in path", () => {
    expect(signInLink("https://watch.example", "abc")).toBe("https://watch.example/signin?code=abc");
  });
});
