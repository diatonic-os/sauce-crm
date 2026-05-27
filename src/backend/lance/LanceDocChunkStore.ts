// LanceDB store for harvested document chunks (PLAN T7). Chunks carry their own
// vector so RAG can retrieve document context alongside vault entities. Keyed by
// chunk_id (`${doc_id}#${ord}`); re-harvesting a doc replaces its chunks.

import { sqlStr, type LanceTable } from "./LanceConnection";
import type { DocChunkRow } from "./LanceSchema";

export interface ChunkHit {
  chunkId: string;
  docId: string;
  docName: string;
  ord: number;
  text: string;
  distance: number;
}

export class LanceDocChunkStore {
  constructor(
    private readonly table: LanceTable,
    readonly dim: number,
  ) {}

  async addChunks(rows: DocChunkRow[]): Promise<void> {
    if (!rows.length) return;
    await this.table.add(rows as unknown as Record<string, unknown>[]); // DocChunkRow[] → Data boundary; interface needs unknown hop
  }

  /** Remove all chunks for a document (used before re-harvesting). */
  async deleteByDoc(docId: string): Promise<void> {
    await this.table.delete(`doc_id = ${sqlStr(docId)}`);
  }

  async search(vector: number[], limit: number): Promise<ChunkHit[]> {
    if ((await this.table.countRows()) === 0) return [];
    const rows = (await this.table
      .search(vector)
      .limit(limit)
      .toArray()) as (DocChunkRow & { _distance: number })[];
    return rows.map((r) => ({
      chunkId: r.chunk_id,
      docId: r.doc_id,
      docName: r.doc_name,
      ord: r.ord,
      text: r.text,
      distance: r._distance,
    }));
  }

  /** Distinct harvested documents (id + name + chunk count). */
  async listDocs(): Promise<
    { docId: string; docName: string; chunks: number }[]
  > {
    const rows = (await this.table
      .query()
      .select(["doc_id", "doc_name"])
      .toArray()) as { doc_id: string; doc_name: string }[];
    const byDoc = new Map<string, { docName: string; chunks: number }>();
    for (const r of rows) {
      const cur = byDoc.get(r.doc_id) ?? { docName: r.doc_name, chunks: 0 };
      cur.chunks += 1;
      byDoc.set(r.doc_id, cur);
    }
    return [...byDoc.entries()].map(([docId, v]) => ({
      docId,
      docName: v.docName,
      chunks: v.chunks,
    }));
  }
}
