// MOB-BRIDGE-001 · S9 — bridge-side RAG adapter.
//
// Wraps a MemoryBackend (desktop=LanceMemoryBackend, mobile=HybridMemoryBackend)
// and exposes the `semantic(query, topK)` shape that RagAssemblerHost requires.
// This is the bridge consumer piece for the mobile SauceBot → desktop LanceDB
// retrieval path: the mobile hybrid backend prefers the bridge (BridgeMemoryBackend
// → POST /v1/memory/search on the desktop) and falls back to lexical offline search.
//
// PURE / BRIDGE-SCOPED: imports only from ./contract and standard types.
// Does NOT import from src/copilot/* (to avoid circular deps and keep the bridge
// mobile-safe). The wiring site (main.ts / ObsidianRagHost) injects the backend
// and uses the output of `semantic()` wherever RagAssemblerHost.semantic is called.
//
// Design:
//   semanticSearch(q) → MemoryHit[] — the backend already does semantic or
//   lexical depending on its mode. We map MemoryHit → {path, score} to match
//   the shape RagAssemblerHost.semantic returns.
//
// Default-OFF: the adapter does nothing when the backend is null; the callee
// gets an empty array and falls through to lexical (consistent with all other
// gap-safe paths in the system).

import type { MemoryBackend, MemoryHit } from "./contract";

/** The minimal shape of the semantic() method on RagAssemblerHost.
 *  Defined here (not imported from copilot/) so this file stays bridge-scoped. */
export interface SemanticResult {
  path: string;
  score: number;
  snippet?: string;
  /** True when produced by the offline/lexical fallback rather than vectors. */
  degraded?: boolean;
}

/** Wraps a MemoryBackend and surfaces the semantic-search capability in the shape
 *  that RagAssemblerHost.semantic() expects. On mobile the backend is the
 *  HybridMemoryBackend which prefers the BridgeMemoryBackend (desktop LanceDB)
 *  and falls back to lexical. On desktop it is the LanceMemoryBackend directly.
 *
 *  Usage (wiring site, stays in main.ts / ObsidianRagHost):
 *  ```ts
 *  const adapter = new MemoryBackendRagAdapter(this.memory);
 *  // pass adapter.semantic.bind(adapter) wherever semantic(query, topK) is needed
 *  ```
 */
export class MemoryBackendRagAdapter {
  constructor(private readonly backend: MemoryBackend | null) {}

  /** Returns the current backend (may be null). */
  get currentBackend(): MemoryBackend | null {
    return this.backend;
  }

  /** Whether the underlying backend is ready to serve (async probe). */
  async ready(): Promise<boolean> {
    if (!this.backend) return false;
    try {
      return await this.backend.ready();
    } catch {
      return false;
    }
  }

  /** Semantic search via the injected MemoryBackend.
   *
   *  On mobile: the HybridMemoryBackend routes the call to the desktop bridge
   *  (BridgeMemoryBackend → POST /v1/memory/search on the desktop LanceMemoryBackend)
   *  when the desktop is reachable, and falls back to the local lexical backend.
   *
   *  On desktop: the LanceMemoryBackend queries the LanceDB vector index directly.
   *
   *  Returns [] when the backend is null or throws (gap-safe — callee falls
   *  through to its own lexical path). */
  async semantic(query: string, topK: number): Promise<SemanticResult[]> {
    if (!this.backend) return [];
    try {
      const hits = await this.backend.semanticSearch({ query, k: topK });
      return hits.map(toSemanticResult);
    } catch {
      return [];
    }
  }

  /** Memory recall (free-text cue → relevant notes). Same routing logic as
   *  semantic(). Exposed for callers that want the recall surface explicitly. */
  async recall(cue: string, k?: number): Promise<SemanticResult[]> {
    if (!this.backend) return [];
    try {
      const hits = await this.backend.recall(cue, k);
      return hits.map(toSemanticResult);
    } catch {
      return [];
    }
  }
}

// ───────────────────────── helpers ─────────────────────────

/** Map a MemoryHit (bridge contract) → SemanticResult (RagAssemblerHost shape). */
function toSemanticResult(h: MemoryHit): SemanticResult {
  return {
    path: h.path,
    score: h.score,
    ...(h.snippet !== undefined ? { snippet: h.snippet } : {}),
    ...(h.degraded !== undefined ? { degraded: h.degraded } : {}),
  };
}
