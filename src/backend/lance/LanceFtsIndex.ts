// Full-text search over entity bodies — replaces the SQLite FTS5 virtual table
// and the JS FtsFallback. Uses LanceDB's native Tantivy-backed FTS index on the
// `entities.body_md` column, queried via `fullTextSearch`.
//
// The entity rows themselves are owned by LanceEntityMirror; this class only
// manages the FTS index over them. Implements MirrorFtsHook so the mirror can
// keep the index fresh after writes.

import type { LanceTable } from "./LanceConnection";
import type { MirrorFtsHook } from "./LanceEntityMirror";

export interface FtsHit {
  entityId: string;
  score: number;
}

const FTS_COLUMN = "body_md";

export class LanceFtsIndex implements MirrorFtsHook {
  private ensured = false;

  constructor(private readonly entities: LanceTable) {}

  /** Create the FTS index if absent. No-op once present. LanceDB rejects index
   *  creation on an empty table, so callers should ensure rows exist first;
   *  failures are swallowed and retried on the next call. */
  private async ensureIndex(): Promise<void> {
    if (this.ensured) return;
    try {
      const indices = await this.entities.listIndices();
      const has = indices.some((i) => i.columns?.includes(FTS_COLUMN));
      if (!has) {
        const { loadLance } = await import("./LanceConnection");
        await this.entities.createIndex(FTS_COLUMN, {
          config: loadLance().Index.fts(),
        });
      }
      this.ensured = true;
    } catch {
      /* table empty or index in flight — retry next call */
    }
  }

  /** A vault write changed an entity body; fold new rows into the FTS index. */
  async index(_entityId: string, _title: string, _body: string): Promise<void> {
    this.ensured = false;
    await this.ensureIndex();
    try {
      await this.entities.optimize();
    } catch {
      /* best effort */
    }
  }

  async remove(_entityId: string): Promise<void> {
    // Row deletion is handled by the mirror; the index reflects it after the
    // next optimize. Force a refresh.
    try {
      await this.entities.optimize();
    } catch {
      /* best effort */
    }
  }

  async search(query: string, limit = 25): Promise<FtsHit[]> {
    await this.ensureIndex();
    if (!this.ensured) return [];
    const rows = (await this.entities
      .query()
      .fullTextSearch(query, { columns: [FTS_COLUMN] })
      .limit(limit)
      .toArray()) as unknown as { id: string; _score?: number }[];
    return rows.map((r) => ({ entityId: r.id, score: r._score ?? 0 }));
  }
}
