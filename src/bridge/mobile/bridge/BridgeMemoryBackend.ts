// MOB-BRIDGE-001 · T-D — mobile-side MemoryBackend that talks to the desktop
// MemoryHttpServer over HTTP, signs every request, and caches results by fp so
// an unchanged note costs zero network.
//
// MOBILE-SAFE: no top-level Node-builtin imports, no global `fetch` /
// `XMLHttpRequest`. The only transport is the injected `request` fn (prod binds
// it to Obsidian's `requestUrl`). Web Crypto is used for nonces, guarded for
// absence. Imports ONLY from the keystone contract.

import type { ProvenanceRecord } from "../../../services/Provenance";
import {
  BridgeError,
  BRIDGE_PROTOCOL_VERSION,
  NONCE_HEADER,
  ROUTES,
  SIG_HEADER,
  TS_HEADER,
  cacheKey,
  type AuthSigner,
  type BackendMode,
  type ContentHasher,
  type EmbedResult,
  type HealthResponse,
  type MemoryBackend,
  type MemoryHit,
  type MemoryQuery,
  type ProvenanceResponse,
  type ResultCache,
  type SearchResponse,
  type SignedRequestParts,
} from "../../contract";

/** Minimal injected HTTP response. Production adapter maps Obsidian's
 *  `requestUrl` response onto this shape. */
export interface HttpResponse {
  status: number;
  json: any;
  text: string;
}

/** Injected transport. Never the global fetch — keeps the bundle mobile-safe
 *  and the backend unit-testable. */
export type HttpRequestFn = (req: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => Promise<HttpResponse>;

export interface BridgeMemoryBackendDeps {
  /** http://<tailscale-name-or-ip>:<port> — no trailing slash expected. */
  baseUrl: string;
  /** Transport (prod: adapter over Obsidian requestUrl). */
  request: HttpRequestFn;
  /** HMAC request signer (T-C). */
  signer: AuthSigner;
  /** sha256Hex for body hashing (and fp minting elsewhere). */
  hasher: ContentHasher;
  /** fp-keyed result cache. */
  cache: ResultCache;
  /** Per-request nonce source. Default: random hex via Web Crypto. */
  nonceFn?: () => string;
}

/** How long a successful /health result is trusted without re-probing. */
const HEALTH_TTL_MS = 5_000;

/** Random hex nonce via Web Crypto, with a guarded fallback when crypto or
 *  getRandomValues is unavailable (older mobile webviews). */
function defaultNonce(): string {
  const c: Crypto | undefined =
    typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
  if (c && typeof c.getRandomValues === "function") {
    const buf = new Uint8Array(16);
    c.getRandomValues(buf);
    let out = "";
    for (let i = 0; i < buf.length; i++) out += buf[i].toString(16).padStart(2, "0");
    return out;
  }
  // Fallback: time + Math.random. Not crypto-grade, but nonces only need to be
  // unique within the desktop's replay window, and prod always has Web Crypto.
  return (
    Date.now().toString(16) +
    Math.floor(Math.random() * 0xffffffff).toString(16) +
    Math.floor(Math.random() * 0xffffffff).toString(16)
  );
}

export class BridgeMemoryBackend implements MemoryBackend {
  readonly mode: BackendMode = "bridge";

  private readonly baseUrl: string;
  private readonly request: HttpRequestFn;
  private readonly signer: AuthSigner;
  private readonly hasher: ContentHasher;
  private readonly cache: ResultCache;
  private readonly nonceFn: () => string;

  private healthCache: { at: number; ok: boolean } | null = null;

  constructor(deps: BridgeMemoryBackendDeps) {
    // Trim a single trailing slash so baseUrl + ROUTES.* (which start with "/")
    // never produce a double slash.
    this.baseUrl = deps.baseUrl.replace(/\/+$/, "");
    this.request = deps.request;
    this.signer = deps.signer;
    this.hasher = deps.hasher;
    this.cache = deps.cache;
    this.nonceFn = deps.nonceFn ?? defaultNonce;
  }

  /** Sign + send one request. Serializes the body, hashes it, builds the
   *  canonical signed parts, sets the three auth headers, and maps failures to
   *  BridgeError. Returns the parsed HttpResponse for 2xx. */
  private async call(method: string, path: string, bodyObj?: unknown): Promise<HttpResponse> {
    const body = bodyObj === undefined ? "" : JSON.stringify(bodyObj);
    const bodyHash = await this.hasher.sha256Hex(body);
    const parts: SignedRequestParts = {
      method,
      path,
      bodyHash,
      nonce: this.nonceFn(),
      ts: Date.now(),
    };
    const sig = await this.signer.sign(parts);

    const headers: Record<string, string> = {
      [SIG_HEADER]: sig,
      [NONCE_HEADER]: parts.nonce,
      [TS_HEADER]: String(parts.ts),
    };
    if (bodyObj !== undefined) headers["content-type"] = "application/json";

    let res: HttpResponse;
    try {
      res = await this.request({
        url: this.baseUrl + path,
        method,
        headers,
        body: bodyObj === undefined ? undefined : body,
      });
    } catch (err) {
      // Transport-level throw → desktop unreachable.
      throw new BridgeError(
        "unreachable",
        `bridge request to ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (res.status >= 200 && res.status < 300) return res;
    if (res.status === 401) {
      throw new BridgeError("unauthorized", `unauthorized on ${path}`, res.status);
    }
    throw new BridgeError("server-error", `bridge ${path} returned ${res.status}`, res.status);
  }

  /** Parse the response body. Obsidian requestUrl exposes `.json`; fall back to
   *  parsing `.text`. Throws BridgeError("bad-response") if neither yields an
   *  object. */
  private parse<T>(res: HttpResponse): T {
    if (res.json !== undefined && res.json !== null) return res.json as T;
    if (typeof res.text === "string" && res.text.length > 0) {
      try {
        return JSON.parse(res.text) as T;
      } catch {
        throw new BridgeError("bad-response", "bridge response was not valid JSON");
      }
    }
    throw new BridgeError("bad-response", "bridge response had no body");
  }

  async semanticSearch(q: MemoryQuery): Promise<MemoryHit[]> {
    // Query-addressed, not fp-addressed → no fp cache here (keep it simple).
    const res = await this.call("POST", ROUTES.search, { query: q.query, k: q.k });
    return this.parse<SearchResponse>(res).hits ?? [];
  }

  async recall(q: string, k?: number): Promise<MemoryHit[]> {
    const res = await this.call("POST", ROUTES.recall, { q, k });
    return this.parse<SearchResponse>(res).hits ?? [];
  }

  async embed(text: string, fp: string): Promise<EmbedResult | null> {
    // Zero-network-on-unchanged-fp path: a known fp is served from cache.
    const key = cacheKey("embed", fp);
    const hit = await this.cache.get<EmbedResult>(key);
    if (hit) return hit;

    const res = await this.call("POST", ROUTES.embed, { fp, text });
    const result = this.parse<EmbedResult>(res);
    await this.cache.set(key, result);
    return result;
  }

  async provenance(fp: string): Promise<ProvenanceRecord[]> {
    const key = cacheKey("prov", fp);
    const hit = await this.cache.get<ProvenanceRecord[]>(key);
    if (hit) return hit;

    const res = await this.call("GET", ROUTES.provenance(fp));
    const records = this.parse<ProvenanceResponse>(res).records ?? [];
    await this.cache.set(key, records);
    return records;
  }

  async ready(): Promise<boolean> {
    // Trust a recent successful probe to avoid hammering the desktop.
    const now = Date.now();
    if (this.healthCache && now - this.healthCache.at < HEALTH_TTL_MS) {
      return this.healthCache.ok;
    }
    try {
      const res = await this.call("GET", ROUTES.health);
      const health = this.parse<HealthResponse>(res);
      if (majorOf(health.version) !== majorOf(BRIDGE_PROTOCOL_VERSION)) {
        throw new BridgeError(
          "protocol-mismatch",
          `desktop protocol ${health.version} incompatible with ${BRIDGE_PROTOCOL_VERSION}`,
        );
      }
      const ok = health.ok === true;
      this.healthCache = { at: now, ok };
      return ok;
    } catch {
      // Any failure (unreachable, unauthorized, protocol-mismatch, bad-response)
      // means "not ready right now". Cache the negative result briefly too.
      this.healthCache = { at: now, ok: false };
      return false;
    }
  }
}

/** Major version component of a semver string ("1.2.3" → "1"). */
function majorOf(version: string): string {
  return String(version).split(".")[0] ?? "";
}
