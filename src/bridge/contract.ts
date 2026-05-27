// MOB-BRIDGE-001 · W0 keystone — the shared contract every bridge task codes
// against. PURE: types, interfaces, constants, errors, and side-effect-free
// helpers only. No Obsidian, no Node, no LanceDB imports — so it is safe to
// load on desktop AND mobile, and safe for every parallel task to depend on.
//
// Decomposition rule: parallel tasks (T-A..T-F) import FROM this file and never
// edit it. Contract changes are centrally owned (see MOBILE-BRIDGE-SPEC.md §4).

import type { ProvenanceRecord } from "../services/Provenance";

/** Semver of the bridge wire protocol. Desktop /v1/health echoes it; mobile
 *  refuses to talk to a server whose major differs. */
export const BRIDGE_PROTOCOL_VERSION = "1.0.0";

/** URL path prefix for every RPC route. */
export const BRIDGE_ROUTE_PREFIX = "/v1";

// ───────────────────────── Transport contract ─────────────────────────

/** Minimal injected HTTP response. The production adapter maps Obsidian's
 *  `requestUrl` response onto this shape. `json` is `unknown` — callers MUST
 *  narrow before use (no `any` leaks across the transport boundary). */
export interface HttpResponse {
  status: number;
  json: unknown;
  text: string;
}

/** Injected transport. Never the global `fetch` — keeps the bundle mobile-safe
 *  and every consumer unit-testable. `headers` is optional so probe-style GETs
 *  may omit it; the adapter forwards whatever is supplied to `requestUrl`.
 *
 *  Canonical home (AX-002): the bridge backend and the reachability probe
 *  re-export this single definition rather than declaring parallel shapes. */
export type HttpRequestFn = (req: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<HttpResponse>;

// ───────────────────────── Core memory contract ─────────────────────────

export interface MemoryQuery {
  query: string;
  /** max hits; backend may return fewer. */
  k?: number;
}

export interface MemoryHit {
  /** vault-relative note path. */
  path: string;
  /** higher = more relevant; semantic = cosine-ish, lexical = normalized rank. */
  score: number;
  /** content fingerprint of the hit (the universal join key). */
  fp: string;
  /** short context excerpt, if the backend can produce one. */
  snippet?: string;
  /** true when produced by the offline/lexical fallback rather than vectors. */
  degraded?: boolean;
}

export interface EmbedResult {
  fp: string;
  /** embedding dimensionality the desktop stored (e.g. 768). */
  dim: number;
  /** true when the desktop already had this fp and did no new work. */
  cached: boolean;
}

/** The capability surface mobile cannot satisfy locally. Desktop implements it
 *  over LanceDB (T-A); mobile implements it via the bridge (T-D) and a lexical
 *  fallback (T-E); the hybrid (T-F) composes them. */
export interface MemoryBackend {
  readonly mode: BackendMode;
  /** vector/semantic search; lexical fallback sets hit.degraded=true. */
  semanticSearch(q: MemoryQuery): Promise<MemoryHit[]>;
  /** memory recall (notes/touches/addenda relevant to a free-text cue). */
  recall(q: string, k?: number): Promise<MemoryHit[]>;
  /** embed text addressed by fp; idempotent — re-embedding a known fp is a
   *  cache hit. Returns null when the backend cannot embed (offline/no model). */
  embed(text: string, fp: string): Promise<EmbedResult | null>;
  /** provenance lineage for a fingerprint; [] when unknown. */
  provenance(fp: string): Promise<ProvenanceRecord[]>;
  /** is this backend currently able to serve (store ready / desktop reachable). */
  ready(): Promise<boolean>;
}

export type BackendMode = "lance-desktop" | "bridge" | "local" | "hybrid";

// ───────────────────────── Content addressing ─────────────────────────

/** Portable hashing surface. Prod binds this to Web Crypto on both platforms
 *  (matches ProvenanceCrypto). Used to compute fp on mobile and to hash request
 *  bodies for HMAC. */
export interface ContentHasher {
  sha256Hex(data: string): Promise<string>;
}

/** Normalize note content before hashing so desktop and mobile mint identical
 *  fingerprints. MUST match the desktop ProvenanceService normalization:
 *  strip CR, trim trailing whitespace per line, collapse trailing blank lines,
 *  ensure single trailing newline. Pure & deterministic. */
export function normalizeForFingerprint(content: string): string {
  const lines = content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""));
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}

// ───────────────────────── RPC wire DTOs ─────────────────────────

export interface HealthResponse {
  ok: boolean;
  version: string;
  lance: "ready" | "installing" | "missing" | "error";
}

export interface ByFpResponse {
  fp: string;
  known: boolean;
  dim?: number;
  meta?: Record<string, unknown> | null;
}

export interface EmbedRequest {
  fp: string;
  text: string;
  model?: string;
}

export interface SearchRequest {
  query: string;
  k?: number;
}

export interface SearchResponse {
  hits: MemoryHit[];
}

export interface RecallRequest {
  q: string;
  k?: number;
}

export interface ProvenanceResponse {
  fp: string;
  records: ProvenanceRecord[];
}

/** Canonical route table — single source of truth shared by server (T-B) and
 *  bridge client (T-D) so paths never drift. */
export const ROUTES = {
  health: `${BRIDGE_ROUTE_PREFIX}/health`,
  byFp: (fp: string) =>
    `${BRIDGE_ROUTE_PREFIX}/memory/by-fp/${encodeURIComponent(fp)}`,
  embed: `${BRIDGE_ROUTE_PREFIX}/memory/embed`,
  search: `${BRIDGE_ROUTE_PREFIX}/memory/search`,
  recall: `${BRIDGE_ROUTE_PREFIX}/memory/recall`,
  provenance: (fp: string) =>
    `${BRIDGE_ROUTE_PREFIX}/provenance/${encodeURIComponent(fp)}`,
} as const;

// ───────────────────────── Auth (HMAC) ─────────────────────────

/** Header carrying the request signature. */
export const SIG_HEADER = "x-sauce-sig";
/** Header carrying the per-request nonce. */
export const NONCE_HEADER = "x-sauce-nonce";
/** Header carrying the unix-ms timestamp. */
export const TS_HEADER = "x-sauce-ts";
/** Max clock skew (ms) the desktop verifier tolerates. */
export const TS_WINDOW_MS = 300_000;

/** Inputs the signer/verifier agree to hash. `bodyHash` = sha256Hex(rawBody). */
export interface SignedRequestParts {
  method: string;
  path: string;
  bodyHash: string;
  nonce: string;
  ts: number;
}

/** Build the exact string that gets HMAC'd. Pure & shared so both sides agree
 *  byte-for-byte. Newline-delimited, method upper-cased. */
export function canonicalRequestString(p: SignedRequestParts): string {
  return [
    p.method.toUpperCase(),
    p.path,
    p.bodyHash,
    p.nonce,
    String(p.ts),
  ].join("\n");
}

/** Mobile side: produce signature headers for an outbound request. */
export interface AuthSigner {
  sign(parts: SignedRequestParts): Promise<string>;
}

/** Desktop side: verify an inbound request. Implementations MUST enforce the
 *  TS window and reject replayed nonces, and use constant-time comparison. */
export interface AuthVerifier {
  verify(parts: SignedRequestParts, signature: string): Promise<AuthResult>;
}

export type AuthResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "bad-signature"
        | "stale-timestamp"
        | "replayed-nonce"
        | "not-paired";
    };

// ───────────────────────── Reachability ─────────────────────────

export interface ReachabilityProbe {
  /** resolve true if the desktop server answers /health within timeout. */
  isReachable(timeoutMs?: number): Promise<boolean>;
  /** last known result without probing (for synchronous UI hints). */
  lastKnown(): boolean | null;
}

// ───────────────────────── fp-keyed result cache ─────────────────────────

/** Mobile caches RPC results under fp so an unchanged note costs no network.
 *  Backed on mobile by IndexedDB/localStorage or a synced JSON; injected so the
 *  bridge client (T-D) stays storage-agnostic and unit-testable. */
export interface ResultCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Compose a stable cache key from an operation + fp (+ optional discriminator). */
export function cacheKey(op: string, fp: string, extra?: string): string {
  return extra ? `${op}:${fp}:${extra}` : `${op}:${fp}`;
}

// ───────────────────────── Errors ─────────────────────────

export type BridgeErrorCode =
  | "unreachable"
  | "unauthorized"
  | "protocol-mismatch"
  | "bad-response"
  | "not-paired"
  | "timeout"
  | "server-error";

export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}
