// MOB-BRIDGE-001 · T-A — desktop LanceDB adapter.
//
// Thin adapter that implements the bridge MemoryBackend contract by wrapping the
// existing desktop LanceDB services (LanceVectorIndex, LanceProvenanceStore) and
// an injected embedding function. NO new intelligence: it only adapts shapes
// between the contract and the native store.
//
// Dependency injection: the constructor takes the minimal interfaces it needs
// (it news up nothing) so it stays unit-testable with plain fakes and never
// pulls a real LanceDB connection into tests. Production wiring injects the real
// LanceVectorIndex, the real LanceProvenanceStore, and CopilotRuntime.embed.

import type {
  BackendMode,
  EmbedResult,
  MemoryBackend,
  MemoryHit,
  MemoryQuery,
} from "../contract";
import type { VectorHit } from "../../backend/lance/LanceVectorIndex";
import type { IProvenanceStore, ProvenanceRecord } from "../../services/Provenance";

/** Minimal vector-index surface the adapter needs (subset of LanceVectorIndex). */
export interface VectorIndexLike {
  query(vector: number[], limit: number): Promise<VectorHit[]>;
  isEmpty(): Promise<boolean>;
}

/** Resolved presentation data for a vector hit's entity id. Production wiring
 *  maps an entity id back to the note path + fingerprint (+ optional snippet);
 *  when no resolver is supplied the adapter falls back to the raw hit id. */
export interface ResolvedHit {
  path: string;
  fp: string;
  snippet?: string;
}

export interface LanceMemoryBackendDeps {
  vectorIndex: VectorIndexLike;
  provenanceStore: Pick<IProvenanceStore, "byFingerprint">;
  /** Returns the embedding for `text`, or null when no model/runtime is available. */
  embedFn: (text: string) => Promise<number[] | null>;
  /** Optional: resolve a VectorHit's entityId → {path, fp, snippet}. */
  resolveHit?: (entityId: string) => ResolvedHit | null;
}

const DEFAULT_K = 10;

export class LanceMemoryBackend implements MemoryBackend {
  readonly mode: BackendMode = "lance-desktop";

  constructor(private readonly deps: LanceMemoryBackendDeps) {}

  async semanticSearch(q: MemoryQuery): Promise<MemoryHit[]> {
    const vec = await this.deps.embedFn(q.query);
    if (vec == null) return [];
    const limit = q.k ?? DEFAULT_K;
    const hits = await this.deps.vectorIndex.query(vec, limit);
    return hits.map((h) => this.toMemoryHit(h));
  }

  async recall(q: string, k?: number): Promise<MemoryHit[]> {
    return this.semanticSearch({ query: q, k });
  }

  async embed(text: string, fp: string): Promise<EmbedResult | null> {
    const vec = await this.deps.embedFn(text);
    if (vec == null) return null;
    // Storing into Lance is owned by the existing ingest paths; the adapter only
    // reports the embed result keyed by fp.
    return { fp, dim: vec.length, cached: false };
  }

  async provenance(fp: string): Promise<ProvenanceRecord[]> {
    return this.deps.provenanceStore.byFingerprint(fp);
  }

  async ready(): Promise<boolean> {
    try {
      return !(await this.deps.vectorIndex.isEmpty());
    } catch {
      // Be defensive: if the store can't even report emptiness, treat as ready
      // rather than crashing the caller — the query path will surface real errors.
      return true;
    }
  }

  /** Map a native VectorHit to the contract's MemoryHit. Uses the injected
   *  resolver when present; otherwise falls back to the hit's own id. */
  private toMemoryHit(h: VectorHit): MemoryHit {
    const resolved = this.deps.resolveHit?.(h.id) ?? null;
    return {
      path: resolved?.path ?? h.id,
      fp: resolved?.fp ?? h.id,
      score: h.distance,
      snippet: resolved?.snippet,
      degraded: false,
    };
  }
}
