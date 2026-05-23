import { describe, expect, it } from "vitest";
import { GraphService } from "../../src/services/GraphService";
import type {
  GraphStore,
  GraphNodeRow,
  GraphEdgeRow,
} from "../../src/backend/lance/graph";
import type { PipelineGraphSink } from "../../src/integrations/obsidian/KanbanAdapter";

function seed(g: GraphService) {
  for (const id of ["a", "b", "c", "d"])
    g.upsertNode({ id, type: "note", fields: {} });
  g.upsertEdge("a", "b", "links");
  g.upsertEdge("b", "c", "links");
  g.upsertEdge("c", "d", "mentions");
}

describe("GraphService — traversal", () => {
  it("BFS traverse respects depth and edge kind", () => {
    const g = new GraphService();
    seed(g);
    expect(g.traverse("a").sort()).toEqual(["b", "c", "d"]); // full reach (bidirectional)
    expect(g.traverse("a", { maxDepth: 1 })).toEqual(["b"]);
    expect(g.traverse("a", { kind: "links" }).sort()).toEqual(["b", "c"]); // stops at the 'mentions' edge
  });

  it("query filters nodes; subgraph returns reachable nodes+edges within depth", () => {
    const g = new GraphService();
    seed(g);
    g.upsertNode({ id: "x", type: "pipeline", fields: {} });
    expect(g.query((n) => n.type === "pipeline").map((n) => n.id)).toEqual([
      "x",
    ]);
    const sg = g.subgraph("a", 1);
    expect(sg.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });
});

describe("GraphService — satisfies PipelineGraphSink (SH-B3 seam)", () => {
  it("is assignable to PipelineGraphSink and projects boards", () => {
    const g = new GraphService();
    const sink: PipelineGraphSink = g; // compile-time proof
    expect(sink.hasPipelineFor("Projects/Sales.md")).toBe(false);
    const id = sink.upsertPipelineNode({
      path: "Projects/Sales.md",
      name: "Sales",
    });
    expect(id).toMatch(/^pl-/);
    sink.upsertEdge("Projects/Sales.md", id, "kanbanBoard");
    expect(sink.hasPipelineFor("Projects/Sales.md")).toBe(true);
  });
});

describe("GraphService — hydrate/persist bridge", () => {
  it("hydrates from a store then persists back losslessly", async () => {
    const nodes: GraphNodeRow[] = [
      { id: "a", type: "note", fields_json: '{"title":"A"}', ts: 1, hash: "h" },
      { id: "b", type: "note", fields_json: "{}", ts: 2, hash: "" },
    ];
    const edges: GraphEdgeRow[] = [
      { src: "a", dst: "b", kind: "links", ts: 1, weight: 1, props_json: "{}" },
    ];
    const written: { nodes: string[]; edges: string[] } = {
      nodes: [],
      edges: [],
    };
    const store: GraphStore = {
      allNodes: async () => nodes,
      allEdges: async () => edges,
      upsertNode: async (n) => {
        written.nodes.push(n.id ?? "");
        return n.id ?? "";
      },
      upsertEdge: async (s, d, k) => void written.edges.push(`${s}->${d}:${k}`),
      getNode: async () => null,
      neighbors: async () => [],
      hasEdge: async () => false,
    };

    const g = new GraphService();
    await g.hydrate(store);
    expect(g.node("a")?.fields).toEqual({ title: "A" });
    expect(g.traverse("a")).toEqual(["b"]);

    await g.persist(store);
    expect(written.nodes.sort()).toEqual(["a", "b"]);
    expect(written.edges).toContain("a->b:links");
  });
});
