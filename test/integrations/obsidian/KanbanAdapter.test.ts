import { describe, expect, it } from "vitest";
import {
  KanbanAdapter,
  KANBAN_PLUGIN_ID,
  type KanbanBoard,
  type KanbanRuntimeHost,
  type PipelineGraphSink,
  type SauceKanbanFacade,
} from "../../../src/integrations/obsidian/KanbanAdapter";

function sink(): PipelineGraphSink & {
  nodes: Map<string, string>;
  edges: string[];
} {
  const nodes = new Map<string, string>(); // boardPath → pl-id
  const edges: string[] = [];
  return {
    nodes,
    edges,
    hasPipelineFor: (p) => nodes.has(p),
    upsertPipelineNode: (b) => {
      const id = `pl-${b.path.replace(/\W/g, "")}`;
      nodes.set(b.path, id);
      return id;
    },
    upsertEdge: (src, dst, kind) => edges.push(`${src}|${dst}|${kind}`),
  };
}

function runtime(
  boards: KanbanBoard[],
  over: Partial<KanbanRuntimeHost> = {},
): KanbanRuntimeHost {
  return {
    isInstalled: () => true,
    isEnabled: () => true,
    getVersion: () => "1.5.0",
    listBoards: () => boards,
    ...over,
  };
}

const BOARDS: KanbanBoard[] = [
  { path: "Projects/Sales.md", name: "Sales" },
  { path: "Projects/Hiring.md", name: "Hiring" },
];

describe("KanbanAdapter", () => {
  it("identifies as the kanban community plugin", () => {
    const a = new KanbanAdapter(runtime(BOARDS), sink());
    expect(a.pluginId).toBe(KANBAN_PLUGIN_ID);
    expect(a.pluginClass).toBe("community");
  });

  it("detect() is unoptimized while boards are not yet projected, optimized once they are", async () => {
    const s = sink();
    const a = new KanbanAdapter(runtime(BOARDS), s);
    expect((await a.detect()).optimized).toBe(false);
    await a.optimize();
    expect((await a.detect()).optimized).toBe(true);
  });

  it("optimize() projects each board to a pl-<id> node with a bidirectional edge", async () => {
    const s = sink();
    const a = new KanbanAdapter(runtime(BOARDS), s);
    const res = await a.optimize();
    expect(res.ok).toBe(true);
    expect(s.nodes.size).toBe(2);
    // bidirectional: two edges per board (board→pl and pl→board)
    expect(s.edges).toContain(
      `Projects/Sales.md|pl-ProjectsSalesmd|kanbanBoard`,
    );
    expect(s.edges).toContain(
      `pl-ProjectsSalesmd|Projects/Sales.md|kanbanBoard`,
    );
    expect(s.edges).toHaveLength(4);
  });

  it("optimize() is idempotent — re-running projects nothing new", async () => {
    const s = sink();
    const a = new KanbanAdapter(runtime(BOARDS), s);
    await a.optimize();
    const second = await a.optimize();
    expect(second.applied).toHaveLength(0);
    expect(s.nodes.size).toBe(2);
  });

  it("facade enumerates boards + builds a projection (no raw plugin handle)", () => {
    const a = new KanbanAdapter(runtime(BOARDS), sink());
    const f = a.getServiceFacade<SauceKanbanFacade>();
    expect(f.enumerateBoards()).toEqual(BOARDS);
    const proj = f.projectionFor(BOARDS[0]);
    expect(proj.board).toEqual(BOARDS[0]);
    expect(proj.edges.length).toBe(2);
  });
});
