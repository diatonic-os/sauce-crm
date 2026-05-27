// ObsidianRagHost.semantic — S9 remote fallback. With no local vector index,
// a wired semantic fallback (the bridge memory adapter) is tried before the
// lexical fuzzy fallback; when it yields nothing, lexical wins.

import { describe, expect, it } from "vitest";
import { ObsidianRagHost } from "../../src/saucebot/SauceBotHostAdapters";

function makeHost() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = {} as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entities = {} as any;
  const search = {
    fuzzy: (_q: string, _k: number) => [
      { file: { path: "lexical.md" }, score: 0.1, context: "" },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return new ObsidianRagHost(app, entities, search);
}

describe("ObsidianRagHost.semantic — S9 remote fallback", () => {
  it("falls back to lexical fuzzy when no vector index and no remote fallback", async () => {
    const host = makeHost();
    const hits = await host.semantic("q", 3);
    expect(hits).toEqual([{ path: "lexical.md", score: 0.1 }]);
  });

  it("uses the wired remote fallback before lexical when it returns hits", async () => {
    const host = makeHost();
    host.setSemanticFallback(() => async (_q, _k) => [
      { path: "remote.md", score: 0.9 },
    ]);
    const hits = await host.semantic("q", 3);
    expect(hits).toEqual([{ path: "remote.md", score: 0.9 }]);
  });

  it("falls through to lexical when the remote fallback getter returns null", async () => {
    const host = makeHost();
    host.setSemanticFallback(() => null);
    expect(await host.semantic("q", 3)).toEqual([
      { path: "lexical.md", score: 0.1 },
    ]);
  });

  it("falls through to lexical when the remote fallback yields no hits", async () => {
    const host = makeHost();
    host.setSemanticFallback(() => async () => []);
    expect(await host.semantic("q", 3)).toEqual([
      { path: "lexical.md", score: 0.1 },
    ]);
  });
});
