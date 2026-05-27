// CON-OBS-INTEG-001 · T-E-02 · DEC-004 — LanceDB relationship-graph tables.
//
// Dedicated `graph_nodes` + `graph_edges` tables, kept SEPARATE from the
// existing `entities`/`edges` mirror tables in LanceSchema (which back the live
// vault mirror — not disturbed here). Node ids are `<typePrefix>-<ulid>`
// (ulid() reused from MutationContract). Edges are materialized bidirectionally
// at write time. Follows the LanceConnection seed-row convention (a typed
// sentinel row fixes the Arrow schema, then is deleted).

import {
  sqlStr,
  type LanceConnection,
  type LanceTable,
} from "./LanceConnection";
import { ulid } from "../../services/MutationContract";

export const GRAPH_NODES = "graph_nodes";
export const GRAPH_EDGES = "graph_edges";
const SEED = "__sauce_graph_seed__";

export interface GraphNodeRow {
  id: string;
  type: string;
  fields_json: string;
  ts: number;
  hash: string;
}

export interface GraphEdgeRow {
  src: string;
  dst: string;
  kind: string;
  ts: number;
  weight: number;
  props_json: string;
}

/** `<typePrefix>-<ulid>` node id (DEC-004). */
export function nodeId(typePrefix: string): string {
  return `${typePrefix}-${ulid()}`;
}

const NODE_SEED: GraphNodeRow = {
  id: SEED,
  type: "",
  fields_json: "{}",
  ts: 0,
  hash: "",
};
const EDGE_SEED: GraphEdgeRow = {
  src: SEED,
  dst: SEED,
  kind: "",
  ts: 0,
  weight: 0,
  props_json: "{}",
};

async function ensureTable(
  db: LanceConnection,
  name: string,
  seed: Record<string, unknown>,
  keyCol: string,
): Promise<LanceTable> {
  const names = await db.tableNames();
  if (names.includes(name)) return db.openTable(name);
  const tbl = await db.createTable(name, [seed]);
  await tbl.delete(`${keyCol} = ${sqlStr(SEED)}`);
  return tbl;
}

/** Create/open both graph tables (idempotent). */
export async function ensureGraphTables(
  db: LanceConnection,
): Promise<{ nodes: LanceTable; edges: LanceTable }> {
  const nodes = await ensureTable(
    db,
    GRAPH_NODES,
    NODE_SEED as unknown as Record<string, unknown>, // GraphNodeRow → Record; unknown hop required
    "id",
  );
  const edges = await ensureTable(
    db,
    GRAPH_EDGES,
    EDGE_SEED as unknown as Record<string, unknown>, // GraphEdgeRow → Record; unknown hop required
    "src",
  );
  return { nodes, edges };
}

export interface UpsertNodeInput {
  /** Provide an explicit id, or a typePrefix to mint `<prefix>-<ulid>`. */
  id?: string;
  typePrefix?: string;
  type: string;
  fields?: Record<string, unknown>;
  hash?: string;
  ts?: number;
}

/** Low-level graph persistence. SH-E GraphService wraps this for traversal. */
export interface GraphStore {
  upsertNode(input: UpsertNodeInput): Promise<string>;
  /** Materializes BOTH directions (src→dst and dst→src) — DEC-004. Idempotent. */
  upsertEdge(
    src: string,
    dst: string,
    kind: string,
    props?: Record<string, unknown>,
  ): Promise<void>;
  getNode(id: string): Promise<GraphNodeRow | null>;
  /** Edges whose src is `id` (both directions exist, so this yields all incident edges). */
  neighbors(id: string): Promise<GraphEdgeRow[]>;
  allNodes(): Promise<GraphNodeRow[]>;
  allEdges(): Promise<GraphEdgeRow[]>;
  hasEdge(src: string, dst: string, kind: string): Promise<boolean>;
}

export class LanceGraphStore implements GraphStore {
  constructor(
    private readonly nodes: LanceTable,
    private readonly edges: LanceTable,
  ) {}

  async upsertNode(input: UpsertNodeInput): Promise<string> {
    const id = input.id ?? nodeId(input.typePrefix ?? input.type);
    const row: GraphNodeRow = {
      id,
      type: input.type,
      fields_json: JSON.stringify(input.fields ?? {}),
      ts: input.ts ?? Date.now(),
      hash: input.hash ?? "",
    };
    await this.nodes.delete(`id = ${sqlStr(id)}`); // upsert = delete + add
    await this.nodes.add([row] as unknown as Record<string, unknown>[]);
    return id;
  }

  private async addDirected(
    src: string,
    dst: string,
    kind: string,
    props?: Record<string, unknown>,
  ): Promise<void> {
    if (await this.hasEdge(src, dst, kind)) return;
    const row: GraphEdgeRow = {
      src,
      dst,
      kind,
      ts: Date.now(),
      weight: 1,
      props_json: JSON.stringify(props ?? {}),
    };
    await this.edges.add([row] as unknown as Record<string, unknown>[]);
  }

  async upsertEdge(
    src: string,
    dst: string,
    kind: string,
    props?: Record<string, unknown>,
  ): Promise<void> {
    await this.addDirected(src, dst, kind, props);
    await this.addDirected(dst, src, kind, props); // bidirectional materialization
  }

  async hasEdge(src: string, dst: string, kind: string): Promise<boolean> {
    const rows = (await this.edges
      .query()
      .where(
        `src = ${sqlStr(src)} AND dst = ${sqlStr(dst)} AND kind = ${sqlStr(kind)}`,
      )
      .toArray()) as GraphEdgeRow[];
    return rows.length > 0;
  }

  async getNode(id: string): Promise<GraphNodeRow | null> {
    const rows = (await this.nodes
      .query()
      .where(`id = ${sqlStr(id)}`)
      .toArray()) as GraphNodeRow[];
    return rows[0] ?? null;
  }

  async neighbors(id: string): Promise<GraphEdgeRow[]> {
    return (await this.edges
      .query()
      .where(`src = ${sqlStr(id)}`)
      .toArray()) as GraphEdgeRow[];
  }

  async allNodes(): Promise<GraphNodeRow[]> {
    return (await this.nodes.query().toArray()) as GraphNodeRow[];
  }

  async allEdges(): Promise<GraphEdgeRow[]> {
    return (await this.edges.query().toArray()) as GraphEdgeRow[];
  }
}
