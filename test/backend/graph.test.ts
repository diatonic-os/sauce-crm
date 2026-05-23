// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { tmpLance, type TmpLance } from "./_lance-tmp";
import {
  ensureGraphTables,
  LanceGraphStore,
  nodeId,
} from "../../src/backend/lance/graph";

describe("graph.ts — LanceDB relationship graph (DEC-004)", () => {
  let h: TmpLance;
  afterEach(() => h?.cleanup());

  async function store() {
    h = await tmpLance();
    const { nodes, edges } = await ensureGraphTables(h.db);
    return new LanceGraphStore(nodes, edges);
  }

  it("nodeId mints <typePrefix>-<ulid>", () => {
    const id = nodeId("pl");
    expect(id).toMatch(/^pl-[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("upsertNode inserts then round-trips via getNode; re-upsert replaces (no dup)", async () => {
    const g = await store();
    const id = await g.upsertNode({
      id: "person-1",
      type: "warm-contact",
      fields: { name: "Alice" },
      hash: "h1",
    });
    expect(id).toBe("person-1");
    const n = await g.getNode("person-1");
    expect(n?.type).toBe("warm-contact");
    expect(JSON.parse(n!.fields_json)).toEqual({ name: "Alice" });

    await g.upsertNode({
      id: "person-1",
      type: "warm-contact",
      fields: { name: "Alice B" },
    });
    expect(await g.allNodes()).toHaveLength(1);
    expect(JSON.parse((await g.getNode("person-1"))!.fields_json)).toEqual({
      name: "Alice B",
    });
  });

  it("upsertEdge materializes BOTH directions and is idempotent", async () => {
    const g = await store();
    await g.upsertNode({ id: "a", type: "note" });
    await g.upsertNode({ id: "b", type: "note" });
    await g.upsertEdge("a", "b", "links");
    await g.upsertEdge("a", "b", "links"); // idempotent

    const all = await g.allEdges();
    expect(all).toHaveLength(2); // a→b and b→a, deduped
    expect(await g.hasEdge("a", "b", "links")).toBe(true);
    expect(await g.hasEdge("b", "a", "links")).toBe(true);
    const fromA = await g.neighbors("a");
    expect(fromA.map((e) => e.dst)).toEqual(["b"]);
  });
});
