import { App, TFile } from "obsidian";
import { EntityService } from "./EntityService";
import type { LanceVectorIndex } from "../backend/lance";

/** Embed function for semantic queries. Returns null when no model is reachable. */
export type SemanticEmbedFn = (text: string) => Promise<number[] | null>;

export interface SearchHit {
  file: TFile;
  score: number;
  context: string;
}

export interface SemanticHit {
  /** Vault-relative path of the matching note. */
  path: string;
  /** Similarity score in (0, 1] (higher = more similar). */
  score: number;
}

export class SearchService {
  constructor(
    public app: App,
    public entities: EntityService,
    /** Optional LanceDB vector index for semantic search (injected after Lance
     *  init so the service can be constructed before Lance is ready). */
    private vectorIndex: LanceVectorIndex | null = null,
    /** Embed function that drives semantic queries. When null, `semantic()`
     *  falls back to fuzzy lexical search. */
    private embedFn: SemanticEmbedFn | null = null,
  ) {}

  /** Inject or replace the vector index + embed function at runtime (called by
   *  main.ts after LanceDB is initialised). */
  setSemanticBackend(
    index: LanceVectorIndex | null,
    embedFn: SemanticEmbedFn | null,
  ): void {
    this.vectorIndex = index;
    this.embedFn = embedFn;
  }

  /**
   * Semantic search using the LanceDB vector index. When the index is empty,
   * not available, or the embed call fails, falls back to `fuzzy()` lexical
   * search so callers never get a hard failure.
   */
  async semantic(query: string, limit = 10): Promise<SemanticHit[]> {
    if (this.vectorIndex && this.embedFn) {
      try {
        if (!(await this.vectorIndex.isEmpty())) {
          const vec = await this.embedFn(query);
          if (vec && vec.length === this.vectorIndex.dim) {
            const hits = await this.vectorIndex.query(vec, limit);
            if (hits.length > 0) {
              return hits.map((h) => ({
                path: h.id,
                score: 1 / (1 + h.distance), // distance → similarity
              }));
            }
          }
        }
      } catch {
        /* fall through to lexical */
      }
    }
    // Lexical fallback: map fuzzy hits to SemanticHit shape.
    return this.fuzzy(query, limit).map((h) => ({
      path: h.file.path,
      score: h.score,
    }));
  }

  fuzzy(query: string, limit = 25): SearchHit[] {
    const ql = query.toLowerCase();
    const hits: SearchHit[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const score = this.scoreFile(f, ql);
      if (score > 0) hits.push({ file: f, score, context: f.basename });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  private scoreFile(f: TFile, ql: string): number {
    let s = 0;
    const base = f.basename.toLowerCase();
    if (base === ql) s += 100;
    else if (base.startsWith(ql)) s += 50;
    else if (base.includes(ql)) s += 25;
    else s += this.fuzzyChars(base, ql);

    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    for (const v of Object.values(fm)) {
      if (typeof v === "string" && v.toLowerCase().includes(ql)) s += 5;
      if (Array.isArray(v))
        for (const x of v)
          if (typeof x === "string" && x.toLowerCase().includes(ql)) s += 3;
    }
    return s;
  }

  private fuzzyChars(hay: string, needle: string): number {
    let i = 0;
    let s = 0;
    for (const ch of needle) {
      const k = hay.indexOf(ch, i);
      if (k < 0) return 0;
      s += k === i ? 2 : 1;
      i = k + 1;
    }
    return s;
  }

  /**
   * Tag-cosine similarity: each entity → sparse vector over (tags ∪ roles ∪ outcome_tags).
   * Returns top-k related to `f`.
   */
  related(f: TFile, k = 10): SearchHit[] {
    const vec = this.vector(f);
    if (vec.size === 0) return [];
    const hits: SearchHit[] = [];
    for (const peer of this.app.vault.getMarkdownFiles()) {
      if (peer.path === f.path) continue;
      const pv = this.vector(peer);
      const cos = cosine(vec, pv);
      if (cos > 0)
        hits.push({ file: peer, score: cos, context: peer.basename });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  private vector(f: TFile): Map<string, number> {
    const m = new Map<string, number>();
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    for (const key of ["tags", "roles", "outcome_tags"]) {
      const arr = fm[key];
      const list = Array.isArray(arr) ? arr : arr ? [arr] : [];
      for (const t of list) {
        const tk = `${key}:${String(t).toLowerCase()}`;
        m.set(tk, (m.get(tk) ?? 0) + 1);
      }
    }
    return m;
  }
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const w = b.get(k);
    if (w) dot += v * w;
  }
  for (const v of b.values()) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
