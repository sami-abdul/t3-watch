/**
 * Why a request got no answer. Node's fetch says only "fetch failed" and keeps the reason, such as
 * ECONNRESET, in its error's cause; this names it, and marks the reasons a slow or failing link of
 * Watch's own could explain, so the runner can hold them while that link is slow.
 */

/** How long a check waits for an answer, and how long after a held run, when the link may still be slow. */
export const ANSWER_MS = 15_000;
export const PATIENT_ANSWER_MS = 45_000;

export const answerMs = (patient: boolean | undefined) => (patient === true ? PATIENT_ANSWER_MS : ANSWER_MS);

/**
 * Reasons in words, by the code Node gives them, and whether a slow or failing link of Watch's own
 * could explain each; the others are the site's.
 */
const CODES: Readonly<Record<string, { readonly words: string; readonly link: boolean }>> = {
  UND_ERR_CONNECT_TIMEOUT: { words: "the connection timed out", link: true },
  ETIMEDOUT: { words: "the connection timed out", link: true },
  UND_ERR_HEADERS_TIMEOUT: { words: "no answer came", link: true },
  UND_ERR_BODY_TIMEOUT: { words: "the answer stopped partway", link: true },
  UND_ERR_SOCKET: { words: "the connection closed early", link: true },
  ECONNRESET: { words: "the connection was reset", link: true },
  ECONNABORTED: { words: "the connection was dropped", link: true },
  EPIPE: { words: "the connection was dropped", link: true },
  EAI_AGAIN: { words: "the name lookup did not finish", link: true },
  // macOS and Windows report a lookup that failed for want of a connection as a missing name.
  ENOTFOUND: { words: "the name could not be found", link: true },
  ENETUNREACH: { words: "the network was unreachable", link: true },
  EHOSTUNREACH: { words: "the host was unreachable", link: true },
  ENETDOWN: { words: "the network was down", link: true },
  ECONNREFUSED: { words: "the server refused the connection", link: false },
};

const isLinkCode = (code: string) => CODES[code]?.link === true;

export interface NoAnswer {
  /** What happened, in words, such as "the connection timed out". */
  readonly reason: string;
  /** Node's code for it, "timeout" for the check's own deadline, or null when there was none. */
  readonly code: string | null;
  /** Whether a slow or failing link of Watch's own could explain it. */
  readonly link: boolean;
}

/**
 * Every code on the error: each address's own when every address failed, then the error's, then
 * its cause's. An aggregate's own code is only its first address's.
 */
const codesOf = (error: unknown, depth = 0): Array<string> => {
  if (!(error instanceof Error) || depth > 4) return [];
  const inner = error instanceof AggregateError ? error.errors.flatMap((e: unknown) => codesOf(e, depth + 1)) : [];
  const own = (error as { code?: unknown }).code;
  return [...inner, ...(typeof own === "string" && own !== "" ? [own] : []), ...codesOf(error.cause, depth + 1)];
};

/**
 * The code that says most: an answer from the site, such as a refusal from one of its addresses,
 * outranks a timeout, which on a slow link every address but the last can hit.
 */
const codeOf = (error: unknown): string | null => {
  const codes = codesOf(error);
  return codes.find((code) => !isLinkCode(code)) ?? codes[0] ?? null;
};

/**
 * The network's own words, from the cause fetch attaches to a failed connection, such as a
 * certificate's. An error without one is about the request itself, and its message may quote a
 * header, so a key, which is never shown.
 */
const causeOf = (error: unknown) => {
  const cause = error instanceof Error ? error.cause : undefined;
  return cause instanceof Error && cause.message !== "" ? cause.message.slice(0, 120) : null;
};

/** Why fetch threw, for a request given `timeoutMs` to answer. */
export const noAnswer = (error: unknown, timeoutMs: number): NoAnswer => {
  if (error instanceof Error && error.name === "TimeoutError") return { reason: `no answer within ${timeoutMs / 1000} seconds`, code: "timeout", link: true };
  const code = codeOf(error);
  const reason = (code === null ? undefined : CODES[code]?.words) ?? causeOf(error) ?? "the request could not be made";
  return { reason, code, link: code !== null && isLinkCode(code) };
};

/** What a run keeps of it: the code and the mark, which the runner reads. */
export const noAnswerEvidence = (failure: NoAnswer) => ({ connection: failure.code, link: failure.link });

/** Whether a result is a failure a slow or failing link of Watch's own could explain. */
export const linkExplains = (result: { readonly evidence: Readonly<Record<string, unknown>> }) => result.evidence.link === true;
