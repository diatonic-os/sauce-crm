// SDK tool — source: sdk/groups/tools/data/IVectorStore.md | api_version: 1.8.0 | gen_hash: hand-t007
//
// Vector-store seam (MOBILE-FORK.md) + deterministic in-memory reference.
// No native imports → mobile-safe by construction.

import { stableSort } from '../../helpers/stable-sort';

export interface VectorHit {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface IVectorStore {
  upsert(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void>;
  query(vector: number[], k: number): Promise<VectorHit[]>;
  remove(id: string): Promise<void>;
  size(): Promise<number>;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i]!; // safe: i < Math.min(a.length, b.length) ≤ a.length
    const bi = b[i]!; // safe: i < Math.min(a.length, b.length) ≤ b.length
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

interface Entry {
  vector: number[];
  metadata?: Record<string, unknown>;
}

/** Deterministic in-memory vector store: mobile-fallback baseline + test double. */
export class InMemoryVectorStore implements IVectorStore {
  private entries = new Map<string, Entry>();

  async upsert(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void> {
    this.entries.set(id, { vector: [...vector], ...(metadata !== undefined ? { metadata } : {}) });
  }

  async query(vector: number[], k: number): Promise<VectorHit[]> {
    const hits: VectorHit[] = [];
    for (const [id, entry] of this.entries) {
      hits.push({ id, score: cosine(vector, entry.vector), ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}) });
    }
    // sort by score desc, ties by id asc → deterministic
    const byId = stableSort(hits, (h) => h.id);
    const byScore = stableSort(byId, (h) => -h.score);
    return byScore.slice(0, Math.max(0, k));
  }

  async remove(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async size(): Promise<number> {
    return this.entries.size;
  }
}
