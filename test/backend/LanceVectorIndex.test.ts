// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { tmpLance, type TmpLance } from "./_lance-tmp";
import { TABLES } from "../../src/backend/lance/LanceSchema";
import { LanceVectorIndex } from "../../src/backend/lance/LanceVectorIndex";

const DIM = 4;
const vec = (...n: number[]) => n;

describe("LanceVectorIndex", () => {
  let h: TmpLance;
  afterEach(() => h?.cleanup());

  it("returns [] when empty", async () => {
    h = await tmpLance();
    const idx = new LanceVectorIndex(await h.table(TABLES.embeddings, DIM), DIM);
    expect(await idx.query(vec(1, 0, 0, 0), 5)).toEqual([]);
  });

  it("finds nearest neighbours ascending by distance", async () => {
    h = await tmpLance();
    const idx = new LanceVectorIndex(await h.table(TABLES.embeddings, DIM), DIM);
    await idx.store("a", vec(1, 0, 0, 0), "m", "ha");
    await idx.store("b", vec(0, 1, 0, 0), "m", "hb");
    await idx.store("c", vec(0.9, 0.1, 0, 0), "m", "hc");

    const hits = await idx.query(vec(1, 0, 0, 0), 2);
    expect(hits.map((x) => x.id)).toEqual(["a", "c"]);
    expect(hits[0].distance).toBeLessThanOrEqual(hits[1].distance);
  });

  it("upserts by entity_id (no duplicate rows)", async () => {
    h = await tmpLance();
    const t = await h.table(TABLES.embeddings, DIM);
    const idx = new LanceVectorIndex(t, DIM);
    await idx.store("a", vec(1, 0, 0, 0), "m", "h1");
    await idx.store("a", vec(0, 0, 0, 1), "m", "h2");
    expect(await t.countRows()).toBe(1);
    const hits = await idx.query(vec(0, 0, 0, 1), 1);
    expect(hits[0].id).toBe("a");
  });

  it("deletes by entity_id", async () => {
    h = await tmpLance();
    const idx = new LanceVectorIndex(await h.table(TABLES.embeddings, DIM), DIM);
    await idx.store("a", vec(1, 0, 0, 0), "m", "h");
    await idx.delete("a");
    expect(await idx.query(vec(1, 0, 0, 0), 5)).toEqual([]);
  });

  it("rejects dimension mismatch", async () => {
    h = await tmpLance();
    const idx = new LanceVectorIndex(await h.table(TABLES.embeddings, DIM), DIM);
    await expect(idx.store("a", vec(1, 2, 3), "m", "h")).rejects.toThrow(/dim/);
  });
});
