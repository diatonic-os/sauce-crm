// LanceDB vector store for entity embeddings. Replaces the dead
// services/VectorDB.ts (which used the obsolete `vectordb` API). Vectors live
// in the `embeddings` table; the vector column dimension is fixed at table
// creation (see DEFAULT_EMBEDDING_DIM).

import { sqlStr, type LanceTable } from "./LanceConnection";
import type { EmbeddingRow } from "./LanceSchema";

export interface VectorHit {
  id: string;
  distance: number;
}

export class LanceVectorIndex {
  constructor(
    private readonly table: LanceTable,
    readonly dim: number,
  ) {}

  /** Insert-or-replace the embedding for an entity (keyed by entity_id). */
  async store(
    entityId: string,
    vector: number[],
    model: string,
    hash: string,
  ): Promise<void> {
    if (vector.length !== this.dim) {
      throw new Error(
        `embedding dim ${vector.length} != table dim ${this.dim}`,
      );
    }
    const row: EmbeddingRow = {
      entity_id: entityId,
      model,
      dim: this.dim,
      vector,
      hash,
    };
    await this.table
      .mergeInsert("entity_id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([row] as unknown as Record<string, unknown>[]);
  }

  /** mergeInsert already upserts; kept for API parity with the old VectorDB. */
  async upsert(
    entityId: string,
    vector: number[],
    model: string,
    hash: string,
  ): Promise<void> {
    await this.store(entityId, vector, model, hash);
  }

  async delete(entityId: string): Promise<void> {
    await this.table.delete(`entity_id = ${sqlStr(entityId)}`);
  }

  /** k nearest entities to `vector`, ascending by distance. */
  async query(vector: number[], limit: number): Promise<VectorHit[]> {
    if (await this.isEmpty()) return [];
    const rows = (await this.table
      .search(vector)
      .limit(limit)
      .toArray()) as { entity_id: string; _distance: number }[];
    return rows.map((r) => ({ id: r.entity_id, distance: r._distance }));
  }

  async isEmpty(): Promise<boolean> {
    return (await this.table.countRows()) === 0;
  }
}
