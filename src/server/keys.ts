import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { KeyRecord, Store } from "./store.ts";

/** Encrypts vendor keys with AES-256-GCM under a per-install key file. */
export const openKeyring = (home: string | null, store: Store) => {
  const master = loadMaster(home);
  const seal = (value: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", master, iv);
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
  };
  const open = (sealed: string) => {
    const [iv, tag, body] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", master, iv!);
    decipher.setAuthTag(tag!);
    return Buffer.concat([decipher.update(body!), decipher.final()]).toString("utf8");
  };
  return {
    add: (record: Omit<KeyRecord, "last4" | "removedAt">, value: string): KeyRecord => {
      const key: KeyRecord = { ...record, last4: value.slice(-4), removedAt: null };
      store.insertKey(key, seal(value));
      return key;
    },
    /** The key's value, for the vendor engine only. Null once removed. */
    reveal: (id: string): string | null => {
      const sealed = store.keyCiphertext(id);
      return sealed === null || sealed === "" ? null : open(sealed);
    },
  };
};
export type Keyring = ReturnType<typeof openKeyring>;

const loadMaster = (home: string | null) => {
  if (home === null) return randomBytes(32);
  const file = join(home, "master.key");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
  return Buffer.from(readFileSync(file, "utf8"), "base64");
};
