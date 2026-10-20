/**
 * One-time sign-in codes. A link with a code signs a browser in once, within 10 minutes, so a
 * link left in a terminal, a log or a chat is useless after it is used. Only a hash is stored, and
 * the CLI can make a code while the service runs because both share the database.
 */
import { createHash, randomBytes } from "node:crypto";

import type { Store } from "./store.ts";

export const SIGN_IN_MINUTES = 10;

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

export const makeSignInCode = (store: Store, now: Date) => {
  const code = randomBytes(24).toString("base64url");
  store.addSignInCode(hash(code), new Date(now.getTime() + SIGN_IN_MINUTES * 60_000).toISOString());
  return code;
};

/** Whether a string could be a code, checked before it touches the database or a page. */
export const isSignInCodeShape = (code: string) => /^[A-Za-z0-9_-]{32}$/.test(code);

/** True once for a code that exists and has not expired. */
export const useSignInCode = (store: Store, code: string, now: Date) =>
  isSignInCodeShape(code) && store.takeSignInCode(hash(code), now.toISOString());

export const signInLink = (pageUrl: string, code: string) => `${pageUrl}/signin?code=${code}`;
