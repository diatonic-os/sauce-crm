// MOB-BRIDGE-001 · W2 composition glue. Obsidian-FREE on purpose: it takes
// structural deps (a sha256 fn, a requestUrl-like fn, already-built stores) and
// composes the platform-appropriate MemoryBackend. The Obsidian-specific
// binding (App→VaultReader, requestUrl, KeyVault→PairingStore, SearchService→
// LexicalHost) is done at the call site in v2-init/main during final wiring, so
// this module stays pure and unit-testable and the mobile bundle never pulls in
// Obsidian here.
//
// Mobile-safety: importing the desktop adapter/server is safe — LanceMemoryBackend
// references @lancedb/lancedb only via types/lazy-require (esbuild marks it
// external), and MemoryHttpServer lazy-requires node:http and throws if
// constructed without `process`. We only ever CONSTRUCT the desktop pieces when
// the platform is desktop.

import {
  type MemoryBackend,
  type ContentHasher,
  type ResultCache,
  type AuthSigner,
  type ReachabilityProbe,
  type HttpRequestFn,
  type HttpResponse,
} from "./contract";
import { LanceMemoryBackend } from "./desktop";
import { BridgeMemoryBackend } from "./mobile/bridge";
import { LexicalMemoryBackend, type LocalHashIndex } from "./mobile/local";
import { HybridMemoryBackend } from "./mobile/orchestration";

// ───────────────────────── thin adapters ─────────────────────────

/** Wrap the plugin's Web-Crypto `sha256Hex` helper as a ContentHasher. */
export function makeContentHasher(
  sha256Hex: (s: string) => Promise<string>,
): ContentHasher {
  return { sha256Hex };
}

/** Structural shape of Obsidian's `requestUrl` result we depend on. */
export interface RequestUrlLike {
  (req: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    throw?: boolean;
  }): Promise<{ status: number; json?: unknown; text: string }>;
}

/** Adapt Obsidian `requestUrl` to the bridge client's HttpRequestFn. Always
 *  passes `throw:false` so transport errors surface as status, and the bridge
 *  client maps them to BridgeError codes. */
export function makeHttpRequestFn(requestUrl: RequestUrlLike): HttpRequestFn {
  return async (req: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<HttpResponse> => {
    const r = await requestUrl({ ...req, throw: false });
    let json: unknown = r.json;
    if (json === undefined) {
      try {
        json = r.text ? JSON.parse(r.text) : null;
      } catch {
        json = null;
      }
    }
    return { status: r.status, json, text: r.text };
  };
}

/** Session-scoped fp-keyed cache. Fine as a default; a persistent impl (vault
 *  JSON / IndexedDB) can be injected later without touching the bridge client. */
export class InMemoryResultCache implements ResultCache {
  private readonly m = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return this.m.has(key) ? (this.m.get(key) as T) : null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.m.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.m.delete(key);
  }
}

// ───────────────────────── platform factories ─────────────────────────

/** Desktop: the authoritative LanceDB-backed memory. `embedFn` is the plugin's
 *  app-scope embed (e.g. `(t) => copilot?.embed(t) ?? null`). */
export function createDesktopMemory(deps: {
  vectors: ConstructorParameters<typeof LanceMemoryBackend>[0]["vectorIndex"];
  provenanceStore: ConstructorParameters<
    typeof LanceMemoryBackend
  >[0]["provenanceStore"];
  embedFn: (text: string) => Promise<number[] | null>;
  resolveHit?: ConstructorParameters<
    typeof LanceMemoryBackend
  >[0]["resolveHit"];
}): MemoryBackend {
  return new LanceMemoryBackend({
    vectorIndex: deps.vectors,
    provenanceStore: deps.provenanceStore,
    embedFn: deps.embedFn,
    ...(deps.resolveHit !== undefined ? { resolveHit: deps.resolveHit } : {}),
  });
}

/** Mobile: bridge-when-reachable composed over a lexical offline fallback. */
export function createMobileMemory(deps: {
  baseUrl: string;
  request: ReturnType<typeof makeHttpRequestFn>;
  signer: AuthSigner;
  hasher: ContentHasher;
  cache: ResultCache;
  probe: ReachabilityProbe;
  lexicalHost: ConstructorParameters<typeof LexicalMemoryBackend>[0]["host"];
  localIndex: LocalHashIndex;
}): MemoryBackend {
  const bridge = new BridgeMemoryBackend({
    baseUrl: deps.baseUrl,
    request: deps.request,
    signer: deps.signer,
    hasher: deps.hasher,
    cache: deps.cache,
  });
  const local = new LexicalMemoryBackend({
    host: deps.lexicalHost,
    index: deps.localIndex,
  });
  return new HybridMemoryBackend({ bridge, local, probe: deps.probe });
}
