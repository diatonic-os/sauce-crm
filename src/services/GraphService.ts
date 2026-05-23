// CON-OBS-INTEG-001 · T-E-03 — in-memory graph index over the LanceDB store.
//
// Holds nodes + a materialized adjacency list so traverse/query/subgraph are
// synchronous, index-backed BFS. It satisfies the (synchronous) PipelineGraphSink
// seam that KanbanAdapter (SH-B3) consumes — mutations are in-memory and sync;
// async hydrate()/persist() bridge to the LanceGraphStore (SH-E T-E-02), keeping
// the LanceDB async I/O out of the hot traversal path.

import type { GraphStore } from "../backend/lance/graph";
import { nodeId } from "../backend/lance/graph";
import type {
  PipelineGraphSink,
  KanbanBoard,
} from "../integrations/obsidian/KanbanAdapter";

export interface GraphNode {
  id: string;
  type: string;
  fields: Record<string, unknown>;
  hash?: string;
  ts?: number;
}
export interface GraphEdge {
  src: string;
  dst: string;
  kind: string;
  weight?: number;
  props?: Record<string, unknown>;
}

export interface TraverseOpts {
  maxDepth?: number;
  /** Restrict traversal to a single edge kind. */
  kind?: string;
}

export class GraphService implements PipelineGraphSink {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly adj = new Map<string, GraphEdge[]>();

  // ── mutation (in-memory, synchronous) ──────────────────────────────
  upsertNode(node: GraphNode): string {
    this.nodes.set(node.id, node);
    if (!this.adj.has(node.id)) this.adj.set(node.id, []);
    return node.id;
  }

  /** Add a bidirectional edge (DEC-004), deduped. Synchronous (PipelineGraphSink). */
  upsertEdge(
    src: string,
    dst: string,
    kind: string,
    props?: Record<string, unknown>,
  ): void {
    this.addDirected(src, dst, kind, props);
    this.addDirected(dst, src, kind, props);
  }

  private addDirected(
    src: string,
    dst: string,
    kind: string,
    props?: Record<string, unknown>,
  ): void {
    const list = this.adj.get(src) ?? [];
    if (list.some((e) => e.dst === dst && e.kind === kind)) return;
    list.push({ src, dst, kind, weight: 1, props });
    this.adj.set(src, list);
  }

  // ── queries (synchronous, index-backed) ────────────────────────────
  node(id: string): GraphNode | null {
    return this.nodes.get(id) ?? null;
  }

  neighbors(id: string): GraphEdge[] {
    return this.adj.get(id) ?? [];
  }

  query(predicate: (node: GraphNode) => boolean): GraphNode[] {
    return [...this.nodes.values()].filter(predicate);
  }

  /** BFS from `startId`; returns visited node ids (excluding the start). */
  traverse(startId: string, opts: TraverseOpts = {}): string[] {
    const maxDepth = opts.maxDepth ?? Infinity;
    const seen = new Set<string>([startId]);
    const out: string[] = [];
    let frontier: string[] = [startId];
    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of this.neighbors(id)) {
          if (opts.kind && e.kind !== opts.kind) continue;
          if (seen.has(e.dst)) continue;
          seen.add(e.dst);
          out.push(e.dst);
          next.push(e.dst);
        }
      }
      frontier = next;
    }
    return out;
  }

  /** The subgraph reachable from `rootId` within `depth` hops. */
  subgraph(
    rootId: string,
    depth = 1,
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const ids = new Set<string>([
      rootId,
      ...this.traverse(rootId, { maxDepth: depth }),
    ]);
    const nodes = [...ids]
      .map((id) => this.nodes.get(id))
      .filter((n): n is GraphNode => !!n);
    const edges: GraphEdge[] = [];
    for (const id of ids)
      for (const e of this.neighbors(id)) if (ids.has(e.dst)) edges.push(e);
    return { nodes, edges };
  }

  // ── PipelineGraphSink (SH-B3 KanbanAdapter consumes this) ──────────
  hasPipelineFor(boardPath: string): boolean {
    return this.neighbors(boardPath).some((e) => e.kind === "kanbanBoard");
  }

  upsertPipelineNode(board: KanbanBoard): string {
    const id = nodeId("pl");
    this.upsertNode({
      id,
      type: "pipeline",
      fields: { name: board.name, boardPath: board.path },
    });
    return id;
  }

  // ── persistence bridge to the LanceGraphStore ──────────────────────
  async hydrate(store: GraphStore): Promise<void> {
    this.nodes.clear();
    this.adj.clear();
    for (const n of await store.allNodes()) {
      this.upsertNode({
        id: n.id,
        type: n.type,
        fields: safeParse(n.fields_json),
        hash: n.hash,
        ts: n.ts,
      });
    }
    for (const e of await store.allEdges()) {
      const list = this.adj.get(e.src) ?? [];
      list.push({
        src: e.src,
        dst: e.dst,
        kind: e.kind,
        weight: e.weight,
        props: safeParse(e.props_json),
      });
      this.adj.set(e.src, list);
    }
  }

  async persist(store: GraphStore): Promise<void> {
    for (const n of this.nodes.values()) {
      await store.upsertNode({
        id: n.id,
        type: n.type,
        fields: n.fields,
        hash: n.hash,
        ts: n.ts,
      });
    }
    for (const list of this.adj.values()) {
      for (const e of list)
        await store.upsertEdge(e.src, e.dst, e.kind, e.props);
    }
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
