import { App, TFile } from "obsidian";
import { EntityService } from "./EntityService";

export interface SearchHit {
  file: TFile;
  score: number;
  context: string;
}

export class SearchService {
  constructor(public app: App, public entities: EntityService) {}

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
      if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && x.toLowerCase().includes(ql)) s += 3;
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
      if (cos > 0) hits.push({ file: peer, score: cos, context: peer.basename });
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
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) { na += v * v; const w = b.get(k); if (w) dot += v * w; }
  for (const v of b.values()) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
