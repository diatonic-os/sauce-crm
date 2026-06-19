// CON-SAUCEBOT · B-patch — unit tests for SearchService semantic path.
// Tests: vector hits returned, fallback to lexical on empty index, dim mismatch.
import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import { SearchService } from "../../src/services/SearchService";
import type { EntityService } from "../../src/services/EntityService";
import type { LanceVectorIndex } from "../../src/backend/lance";

/** Minimal App stub with the surface SearchService.fuzzy() uses. */
function fakeApp(paths: string[]): App {
  const files = paths.map(
    (p) =>
      ({
        path: p,
        basename: p.split("/").pop()?.replace(/\.md$/, "") ?? p,
        extension: "md",
      }) as unknown as TFile,
  );
  return {
    vault: { getMarkdownFiles: () => files },
    metadataCache: { getFileCache: () => null },
  } as unknown as App;
}

/** Minimal EntityService stub (none of the semantic tests need real entities). */
const fakeEntities = {} as unknown as EntityService;

/** Build a fake LanceVectorIndex with deterministic query results. */
function fakeIndex(opts: {
  dim: number;
  empty?: boolean;
  hits?: Array<{ id: string; distance: number }>;
}): LanceVectorIndex {
  return {
    dim: opts.dim,
    isEmpty: async () => opts.empty ?? false,
    query: async (_vec: number[], _limit: number) => opts.hits ?? [],
  } as unknown as LanceVectorIndex;
}

describe("SearchService — semantic path", () => {
  it("returns vector hits when the index is populated and embed succeeds", async () => {
    const svc = new SearchService(fakeApp(["notes/alice.md"]), fakeEntities);
    const index = fakeIndex({
      dim: 4,
      hits: [{ id: "notes/alice.md", distance: 0.1 }],
    });
    const embedFn = async (_text: string) => [1, 0, 0, 0];
    svc.setSemanticBackend(index, embedFn);

    const hits = await svc.semantic("alice");
    expect(hits.length).toBe(1);
    expect(hits[0].path).toBe("notes/alice.md");
    expect(hits[0].score).toBeCloseTo(1 / 1.1);
  });

  it("falls back to lexical when the index is empty", async () => {
    // App has a file whose basename matches the query so fuzzy() returns it.
    const svc = new SearchService(fakeApp(["notes/alice.md"]), fakeEntities);
    const index = fakeIndex({ dim: 4, empty: true });
    const embedFn = async (_text: string) => [1, 0, 0, 0];
    svc.setSemanticBackend(index, embedFn);

    const hits = await svc.semantic("alice");
    // fuzzy fallback — alice.md should score > 0 on the basename match
    expect(hits.some((h) => h.path === "notes/alice.md")).toBe(true);
  });

  it("falls back to lexical when no backend is set", async () => {
    const svc = new SearchService(fakeApp(["notes/alice.md"]), fakeEntities);
    // No setSemanticBackend call
    const hits = await svc.semantic("alice");
    expect(hits.some((h) => h.path === "notes/alice.md")).toBe(true);
  });

  it("falls back to lexical on embedding dimension mismatch", async () => {
    const svc = new SearchService(fakeApp(["notes/alice.md"]), fakeEntities);
    const index = fakeIndex({ dim: 768 }); // expects 768-dim
    const embedFn = async (_text: string) => [1, 0, 0, 0]; // returns 4-dim (mismatch)
    svc.setSemanticBackend(index, embedFn);

    // Should not throw; falls through to lexical
    const hits = await svc.semantic("alice");
    expect(Array.isArray(hits)).toBe(true);
  });

  it("falls back to lexical when embed returns null", async () => {
    const svc = new SearchService(fakeApp(["notes/alice.md"]), fakeEntities);
    const index = fakeIndex({ dim: 4 });
    const embedFn = async (_text: string): Promise<number[] | null> => null;
    svc.setSemanticBackend(index, embedFn);

    const hits = await svc.semantic("alice");
    expect(Array.isArray(hits)).toBe(true);
  });

  it("setSemanticBackend(null, null) clears the backend and falls back to lexical", async () => {
    const svc = new SearchService(fakeApp(["notes/alice.md"]), fakeEntities);
    const index = fakeIndex({
      dim: 4,
      hits: [{ id: "notes/alice.md", distance: 0 }],
    });
    svc.setSemanticBackend(index, async () => [1, 0, 0, 0]);
    // Clear
    svc.setSemanticBackend(null, null);

    const hits = await svc.semantic("alice");
    // Must not throw; fuzzy fallback runs
    expect(Array.isArray(hits)).toBe(true);
  });

  it("honors limit parameter for lexical fallback", async () => {
    const paths = Array.from({ length: 20 }, (_, i) => `notes/alice${i}.md`);
    const svc = new SearchService(fakeApp(paths), fakeEntities);
    const hits = await svc.semantic("alice", 5);
    expect(hits.length).toBeLessThanOrEqual(5);
  });
});
