/**
 * One-time sign-in codes. A link with a code signs a browser in once, within 10 minutes, so a
 * link left in a terminal, a log or a chat is useless after it is used. Only a hash is stored, and
 * the CLI can make a code while the service runs because both share the database.
 */
import { createHash, randomBytes } from "node:crypto";

import type { Store } from "./store.ts";

export const SIGN_IN_MINUTES = 10;
/** How long a browser stays signed in. Signing in again takes a fresh link. */
export const SESSION_DAYS = 90;

const sessionCutoff = (now: Date) => new Date(now.getTime() - SESSION_DAYS * 86_400_000).toISOString();

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

export const makeSignInCode = (store: Store, now: Date) => {
  const code = randomBytes(24).toString("base64url");
  store.addSignInCode(hash(code), new Date(now.getTime() + SIGN_IN_MINUTES * 60_000).toISOString(), now.toISOString());
  return code;
};

/** Whether a string could be a code, checked before it touches the database or a page. */
export const isSignInCodeShape = (code: string) => /^[A-Za-z0-9_-]{32}$/.test(code);

/** True once for a code that exists and has not expired. */
export const useSignInCode = (store: Store, code: string, now: Date) =>
  isSignInCodeShape(code) && store.takeSignInCode(hash(code), now.toISOString());

/** Whether a code would still sign a browser in, checked without using it up. */
export const isLiveSignInCode = (store: Store, code: string, now: Date) =>
  isSignInCodeShape(code) && store.hasSignInCode(hash(code), now.toISOString());

export const signInLink = (pageUrl: string, code: string) => `${pageUrl}/signin?code=${code}`;

/**
 * A browser's session after sign-in: random, stored as a hash and separate from the access
 * token, so a sign-in never hands the browser the token agents use, and signout ends sessions
 * without touching it.
 */
export const startSession = (store: Store, now: Date) => {
  const id = randomBytes(32).toString("base64url");
  store.addSession(hash(id), now.toISOString(), sessionCutoff(now));
  return id;
};

export const isSession = (store: Store, id: string, now: Date) =>
  /^[A-Za-z0-9_-]{43}$/.test(id) && store.hasSession(hash(id), sessionCutoff(now));
