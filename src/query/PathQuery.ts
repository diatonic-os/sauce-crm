import { Semiring } from "../semiring/Semiring";
import { MaxPlus } from "../semiring/MaxPlus";
import { MinPlus } from "../semiring/MinPlus";
import { Matrix, closure, bestPath } from "../semiring/MatrixClosure";

export interface AdjacencyRow {
  src: string;
  dst: string;
  edge: string;
  weight: number;
}

export interface PathResult {
  nodes: string[];     // ordered list of basenames
  metric: number;
}

export function buildIndex(nodes: string[]): Map<string, number> {
  const m = new Map<string, number>();
  nodes.forEach((n, i) => m.set(n, i));
  return m;
}

/**
 * Build adjacency matrix from edge rows. For path queries:
 *  - MaxPlus: weight = closeness (or 6 - closeness for warmth)
 *  - MinPlus: weight = 1 (shortest hops)
 *  - WidthSR: weight = bottleneck
 */
export function buildMatrix(
  sr: Semiring<number>,
  nodes: string[],
  edges: AdjacencyRow[],
  edgeFilter?: string[],
): Matrix<number> {
  const n = nodes.length;
  const idx = buildIndex(nodes);
  const m: Matrix<number> = Array.from({ length: n }, () => Array.from({ length: n }, () => sr.zero));
  for (const e of edges) {
    if (edgeFilter && !edgeFilter.includes(e.edge)) continue;
    const i = idx.get(e.src), j = idx.get(e.dst);
    if (i == null || j == null) continue;
    m[i][j] = sr.add(m[i][j], e.weight);
  }
  return m;
}

export function runPath(
  nodes: string[],
  edges: AdjacencyRow[],
  from: string,
  to: string,
  over: string[] | undefined,
  objective: { mode: "MAXIMIZE" | "MINIMIZE"; metric: string } | undefined,
): PathResult | null {
  const sr: Semiring<number> = objective?.mode === "MAXIMIZE" ? MaxPlus : MinPlus;
  const m = buildMatrix(sr, nodes, edges, over);
  const star = closure(sr, m);
  const idx = buildIndex(nodes);
  const i = idx.get(from), j = idx.get(to);
  if (i == null || j == null) return null;
  if (sr.eq(star[i][j], sr.zero)) return null;
  const pathIdx = bestPath(sr, m, i, j);
  if (!pathIdx) return null;
  return { nodes: pathIdx.map((k) => nodes[k]), metric: star[i][j] };
}
