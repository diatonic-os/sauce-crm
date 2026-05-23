// RagAssembler centering pass — pinned + recent paths should score higher
// than unrelated semantic hits, and the result list should be capped at the
// configured centerTop.

import { describe, expect, it } from "vitest";
import { RagAssembler, type RagAssemblerHost } from "../../src/copilot/RagAssembler";

function makeHost(over: Partial<RagAssemblerHost> = {}): RagAssemblerHost {
  const base: RagAssemblerHost = {
    pinned: async () => [],
    oneHop: async () => [],
    semantic: async () => [],
    recentTouches: async () => [],
    addendaTail: async () => [],
    readFile: async () => ({ frontmatter: {}, body: "" }),
    estimateTokens: (t: string) => t.length,
  };
  return { ...base, ...over };
}

function isoDaysAgo(d: number): string {
  return new Date(Date.now() - d * 86_400_000).toISOString();
}

describe("RagAssembler centering", () => {
  it("ranks pinned + recently touched paths above plain semantic hits", async () => {
    const host = makeHost({
      pinned: async () => ["people/Alice.md"],
      semantic: async () => [
        { path: "people/Alice.md", score: 0.5 },
        { path: "people/Bob.md", score: 0.9 },
        { path: "people/Carol.md", score: 0.7 },
      ],
      recentTouches: async () => [
        { id: "t1", date: isoDaysAgo(1), contactId: "Carol" },
      ],
    });
    const rag = new RagAssembler(host);
    const ctx = await rag.assemble("q");

    expect(ctx.scores).toBeDefined();
    const s = ctx.scores!;
    // Alice: 0.5 * 2.0 (pinned) * 1.0 = 1.0
    // Bob:   0.9 * 1.0 * 1.0 = 0.9
    // Carol: 0.7 * 1.0 * ~2.0 (touched yesterday) ≈ 1.4
    expect(s.get("people/Carol.md")!).toBeGreaterThan(s.get("people/Alice.md")!);
    expect(s.get("people/Alice.md")!).toBeGreaterThan(s.get("people/Bob.md")!);
    // Centered order matches score order.
    expect(ctx.centered[0]).toBe("people/Carol.md");
    expect(ctx.centered[1]).toBe("people/Alice.md");
    expect(ctx.centered[2]).toBe("people/Bob.md");
  });

  it("caps centered output at 12 paths", async () => {
    const hits = Array.from({ length: 30 }, (_, i) => ({ path: `n/${i}.md`, score: 1 - i * 0.01 }));
    const host = makeHost({ semantic: async () => hits });
    const rag = new RagAssembler(host, { topK: 30 });
    const ctx = await rag.assemble("q");
    expect(ctx.centered.length).toBe(12);
  });

  it("focus path gets 1.5 pin-boost over plain semantic", async () => {
    const host = makeHost({
      semantic: async () => [
        { path: "people/A.md", score: 0.5 },
        { path: "people/B.md", score: 0.5 },
      ],
    });
    const rag = new RagAssembler(host);
    const ctx = await rag.assemble("q", "people/A.md");
    expect(ctx.scores!.get("people/A.md")!).toBeGreaterThan(ctx.scores!.get("people/B.md")!);
  });
});
