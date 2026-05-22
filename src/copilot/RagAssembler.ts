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
}

export class RagAssembler {
  constructor(private readonly host: RagAssemblerHost, private readonly opts: { topK: number; touchDays: number; addendaTail: number; tokenCeiling: number } = { topK: 8, touchDays: 30, addendaTail: 5, tokenCeiling: 80_000 }) {}

  async assemble(query: string, focus?: string): Promise<RagContext> {
    const pinned = await this.host.pinned();
    const graph = focus ? await this.host.oneHop(focus) : [];
    const semantic = (await this.host.semantic(query, this.opts.topK)).map((r) => r.path);
    const recentTouches = await this.host.recentTouches(this.opts.touchDays);
    const allPaths = new Set([...pinned, ...(focus ? [focus] : []), ...graph, ...semantic]);
    const addenda: Record<string, { id: string; date: string; body: string }[]> = {};
    let estimatedTokens = 0;
    let trimmed = false;
    for (const p of allPaths) {
      const tail = await this.host.addendaTail(p, this.opts.addendaTail);
      addenda[p] = tail;
      estimatedTokens += tail.reduce((s, a) => s + this.host.estimateTokens(a.body), 0);
      if (estimatedTokens > this.opts.tokenCeiling) { trimmed = true; break; }
    }
    return { pinned, focus: focus ?? null, graph, semantic, recentTouches, addenda, estimatedTokens, trimmed };
  }
}
