// MOB-BRIDGE-001 · T-E · mobile offline tier — LexicalMemoryBackend.
//
// A MemoryBackend (mode="local") that serves search/recall via lexical search over
// the vault — no vectors, no desktop. Every hit is flagged degraded:true and carries
// the universal `fp` join key, resolved from the LocalHashIndex by path. Cannot embed
// or resolve provenance offline.
//
// Mobile-safe: NO node builtins, no global fetch. The lexical host (production: the
// existing SearchService over Obsidian metadata) is injected via a minimal interface;
// SearchService itself is NOT imported. Imports ONLY from the keystone contract.

import type { MemoryBackend, MemoryHit, MemoryQuery, EmbedResult, BackendMode } from "../../contract";
import type { ProvenanceRecord } from "../../../services/Provenance";
import type { LocalHashIndex } from "./LocalHashIndex";

/** Minimal lexical search surface. Production binds this to SearchService /
 *  Obsidian metadata search; do NOT import SearchService — inject this shape. */
export interface LexicalHost {
  search(query: string, limit: number): { path: string; score: number; snippet?: string }[];
}

export interface LexicalMemoryBackendDeps {
  host: LexicalHost;
  index: LocalHashIndex;
}

/** Default number of lexical hits to request when the caller omits k. */
const DEFAULT_K = 25;

export class LexicalMemoryBackend implements MemoryBackend {
  readonly mode: BackendMode = "local";

  private readonly host: LexicalHost;
  private readonly index: LocalHashIndex;

  constructor(deps: LexicalMemoryBackendDeps) {
    this.host = deps.host;
    this.index = deps.index;
  }

  async semanticSearch(q: MemoryQuery): Promise<MemoryHit[]> {
    return this.lexical(q.query, q.k);
  }

  async recall(q: string, k?: number): Promise<MemoryHit[]> {
    return this.lexical(q, k);
  }

  /** Offline backends cannot embed — no model available. */
  async embed(_text: string, _fp: string): Promise<EmbedResult | null> {
    return null;
  }

  /** Provenance lineage requires the desktop store; unknown offline. */
  async provenance(_fp: string): Promise<ProvenanceRecord[]> {
    return [];
  }

  /** The lexical tier is always ready — it serves from the local vault. */
  async ready(): Promise<boolean> {
    return true;
  }

  // ───────────────────────── internals ─────────────────────────

  /** Run a lexical query and map results → degraded MemoryHits with fp from index. */
  private lexical(query: string, k?: number): MemoryHit[] {
    const limit = k ?? DEFAULT_K;
    const results = this.host.search(query, limit);
    return results.map((r) => ({
      path: r.path,
      score: r.score,
      fp: this.index.fpFor(r.path) ?? "",
      ...(r.snippet !== undefined ? { snippet: r.snippet } : {}),
      degraded: true,
    }));
  }
}
