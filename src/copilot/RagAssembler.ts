// SPEC §19.3 — Pinned → focus → 1-hop → semantic top-k → recent touches → addenda tail.
export interface RagAssemblerHost {
  pinned(): Promise<string[]>;
  oneHop(path: string): Promise<string[]>;
  semantic(query: string, topK: number): Promise<{ path: string; score: number }[]>;
  recentTouches(days: number): Promise<{ id: string; date: string; contactId: string }[]>;
  addendaTail(path: string, n: number): Promise<{ id: string; date: string; body: string }[]>;
  readFile(path: string): Promise<{ frontmatter: Record<string, unknown>; body: string }>;
  estimateTokens(text: string): number;
}

export interface RagContext {
  pinned: string[];
  focus: string | null;
  graph: string[];
  semantic: string[];
  recentTouches: { id: string; date: string; contactId: string }[];
  addenda: Record<string, { id: string; date: string; body: string }[]>;
  estimatedTokens: number;
  trimmed: boolean;
  /** Top-N centered paths (after pin/focus/recency boosting). */
  centered: string[];
  /** Centered score per path (only populated for paths considered in centering). */
  scores?: Map<string, number>;
}

export interface RagAssemblerOpts {
  topK: number;
  touchDays: number;
  addendaTail: number;
  tokenCeiling: number;
  centerTop?: number;
}

const DEFAULT_OPTS: RagAssemblerOpts = { topK: 8, touchDays: 30, addendaTail: 5, tokenCeiling: 80_000, centerTop: 12 };

export class RagAssembler {
  private readonly opts: RagAssemblerOpts;
  constructor(private readonly host: RagAssemblerHost, opts: Partial<RagAssemblerOpts> = {}) {
    this.opts = { ...DEFAULT_OPTS, ...opts };
  }

  async assemble(query: string, focus?: string): Promise<RagContext> {
    const pinned = await this.host.pinned();
    const graph = focus ? await this.host.oneHop(focus) : [];
    const semanticHits = await this.host.semantic(query, this.opts.topK);
    const semantic = semanticHits.map((r) => r.path);
    const semanticScore = new Map<string, number>(semanticHits.map((h) => [h.path, h.score]));
    const recentTouches = await this.host.recentTouches(this.opts.touchDays);

    // Centering: score each candidate path by semantic × pin-boost × recency-boost.
    const pinnedSet = new Set(pinned);
    const now = Date.now();
    // Build recency map: contactId -> latest touch timestamp (ms).
    const latestByContact = new Map<string, number>();
    for (const t of recentTouches) {
      const ts = Date.parse(t.date);
      if (Number.isNaN(ts)) continue;
      const prev = latestByContact.get(t.contactId);
      if (prev === undefined || ts > prev) latestByContact.set(t.contactId, ts);
    }
    const recencyBoost = (path: string): number => {
      let bestTs: number | null = null;
      for (const [cid, ts] of latestByContact) {
        if (path.includes(cid)) {
          if (bestTs === null || ts > bestTs) bestTs = ts;
        }
      }
      if (bestTs === null) return 1.0;
      const days = Math.max(0, (now - bestTs) / 86_400_000);
      return 1.0 + Math.exp(-days / 30);
    };
    const pinBoost = (path: string): number => {
      if (pinnedSet.has(path)) return 2.0;
      if (focus && path === focus) return 1.5;
      return 1.0;
    };

    const allPaths = new Set<string>([...pinned, ...(focus ? [focus] : []), ...graph, ...semantic]);
    const scores = new Map<string, number>();
    for (const p of allPaths) {
      const sem = semanticScore.get(p) ?? 0.1; // small floor so pinned/graph paths aren't zeroed
      const score = sem * pinBoost(p) * recencyBoost(p);
      scores.set(p, score);
    }
    const centered = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.opts.centerTop ?? 12)
      .map(([p]) => p);

    const addenda: Record<string, { id: string; date: string; body: string }[]> = {};
    let estimatedTokens = 0;
    let trimmed = false;
    for (const p of centered) {
      const tail = await this.host.addendaTail(p, this.opts.addendaTail);
      addenda[p] = tail;
      estimatedTokens += tail.reduce((s, a) => s + this.host.estimateTokens(a.body), 0);
      if (estimatedTokens > this.opts.tokenCeiling) { trimmed = true; break; }
    }
    return { pinned, focus: focus ?? null, graph, semantic, recentTouches, addenda, estimatedTokens, trimmed, centered, scores };
  }
}
