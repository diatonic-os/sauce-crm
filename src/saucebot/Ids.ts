// Unified id + fingerprint layer for the SauceBot trace system.
//
// Every layer of a chat — install, conversation, turn, response, message, agent
// — gets a STABLE, AUTO-GENERATED, NON-REPEATABLE id so entire chat chains and
// model usage can be traced and replayed for support/debugging, and so audit
// records are enterprise-grade (multi-user, signed, fingerprinted).
//
// Ids are ULIDs: a 48-bit millisecond timestamp + 80 bits of crypto randomness,
// Crockford-base32, 26 chars. They are lexicographically sortable by creation
// time and collision-resistant across installs (the random half), so a
// multi-user/multi-install deployment never repeats an id. A short type prefix
// (cnv_/trn_/rsp_/msg_/cht_/agt_/trc_/inst_) makes ids self-describing in logs.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // no I L O U (ambiguity)

/** Crypto-strong random bytes; falls back to Math.random only if WebCrypto is
 *  absent (it is present in Obsidian/Electron and Node 20+). */
function randomBytes(n: number): Uint8Array {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  const out = new Uint8Array(n);
  if (c?.getRandomValues) {
    c.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** Encode a 48-bit timestamp (ms) into 10 Crockford-base32 chars (time-sortable). */
function encodeTime(ms: number): string {
  let n = Math.max(0, Math.floor(ms));
  let str = "";
  for (let i = 0; i < 10; i++) {
    str = CROCKFORD[n % 32] + str;
    n = Math.floor(n / 32);
  }
  return str;
}

/** Encode 16 chars (~80 bits) of crypto randomness. */
function encodeRandom(): string {
  const bytes = randomBytes(16);
  let str = "";
  for (let i = 0; i < 16; i++) str += CROCKFORD[bytes[i]! % 32];
  return str;
}

/** A bare ULID (26 chars), monotonic by time prefix. */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

export type IdKind =
  | "inst" // install / tenant
  | "cnv" // conversation
  | "cht" // chat session (a load of the view)
  | "trn" // turn (one user→assistant exchange)
  | "rsp" // assistant response
  | "msg" // a single message
  | "agt" // agent run
  | "trc"; // trace event

/** A prefixed, self-describing id, e.g. "cnv_01J9Z…". */
export function newId(kind: IdKind, now?: number): string {
  return `${kind}_${ulid(now)}`;
}

export const newInstallId = (): string => newId("inst");
export const newConversationId = (): string => newId("cnv");
export const newChatId = (): string => newId("cht");
export const newTurnId = (): string => newId("trn");
export const newResponseId = (): string => newId("rsp");
export const newMessageId = (): string => newId("msg");
export const newAgentRunId = (): string => newId("agt");
export const newTraceId = (): string => newId("trc");

/** True for a well-formed prefixed id of the given kind. */
export function isId(value: unknown, kind?: IdKind): value is string {
  if (typeof value !== "string") return false;
  const m = value.match(/^([a-z]+)_([0-9A-HJKMNP-TV-Z]{26})$/);
  if (!m) return false;
  return kind ? m[1] === kind : true;
}

/** SHA-256 content fingerprint (32 hex chars) for content-addressing / signing
 *  inputs and outputs. Falls back to a djb2 digest if WebCrypto subtle is
 *  unavailable, so it never throws in any environment. */
export async function fingerprint(text: string): Promise<string> {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.subtle) {
    try {
      const buf = await c.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
      );
      return [...new Uint8Array(buf)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);
    } catch {
      /* fall through to djb2 */
    }
  }
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, "0");
}
