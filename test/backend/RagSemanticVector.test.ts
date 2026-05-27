// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { tmpLance, type TmpLance } from "./_lance-tmp";
import { TABLES } from "../../src/backend/lance/LanceSchema";
import { LanceVectorIndex } from "../../src/backend/lance/LanceVectorIndex";
import { ObsidianRagHost } from "../../src/saucebot/SauceBotHostAdapters";
import type { SearchService } from "../../src/services/SearchService";
import type { EntityService } from "../../src/services/EntityService";

const DIM = 4;
const app = {} as unknown as App;
const entities = {} as unknown as EntityService;

// Fuzzy fallback returns a recognizable sentinel hit.
const fuzzySearch = {
  fuzzy: (_q: string, _k: number) => [{ file: { path: "FUZZY/fallback.md" }, score: 1, context: "" }],
} as unknown as SearchService;

describe("ObsidianRagHost.semantic — LanceDB vector path", () => {
  let h: TmpLance;
  afterEach(() => h?.cleanup());

  it("uses vector search when an embed model is reachable", async () => {
    h = await tmpLance();
    const idx = new LanceVectorIndex(await h.table(TABLES.embeddings, DIM), DIM);
    await idx.store("people/A.md", [1, 0, 0, 0], "m", "h");
    await idx.store("people/B.md", [0, 1, 0, 0], "m", "h");

    const embedFn = async () => [1, 0, 0, 0];
    const host = new ObsidianRagHost(app, entities, fuzzySearch, () => [], idx, embedFn);

    const hits = await host.semantic("anything", 1);
    expect(hits[0].path).toBe("people/A.md");
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("falls back to fuzzy when no embed model is reachable", async () => {
    h = await tmpLance();
    const idx = new LanceVectorIndex(await h.table(TABLES.embeddings, DIM), DIM);
    await idx.store("people/A.md", [1, 0, 0, 0], "m", "h");

    const embedFn = async () => null; // provider has no embeddings
    const host = new ObsidianRagHost(app, entities, fuzzySearch, () => [], idx, embedFn);

    const hits = await host.semantic("anything", 5);
    expect(hits[0].path).toBe("FUZZY/fallback.md");
  });

  it("falls back to fuzzy when the index is empty", async () => {
    h = await tmpLance();
    const idx = new LanceVectorIndex(await h.table(TABLES.embeddings, DIM), DIM);
    const host = new ObsidianRagHost(app, entities, fuzzySearch, () => [], idx, async () => [1, 0, 0, 0]);
    const hits = await host.semantic("anything", 5);
    expect(hits[0].path).toBe("FUZZY/fallback.md");
  });
});
