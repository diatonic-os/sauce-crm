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
  /** Set once we've logged an ensure failure, so we warn at most once per
   *  session instead of on every write (LANCE-005). */
  private warnedFailure = false;

  constructor(private readonly entities: LanceTable) {}

  /** Create the FTS index if absent. No-op once present and once ensured —
   *  we do NOT reset `ensured` on every call (that forced a listIndices +
   *  per-write optimize() churn). LanceDB rejects index creation on an empty
   *  table; on failure we leave `ensured` false to retry later, but warn at
   *  most once per session. The optimize() after createIndex (and only then)
   *  flushes the freshly built index — writes themselves don't optimize. */
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
        // Flush the just-created index once; not on every write.
        try {
          await this.entities.optimize();
        } catch {
          /* best effort */
        }
      }
      this.ensured = true;
    } catch (e) {
      // table empty or index in flight — retry on a later call. Warn once.
      if (!this.warnedFailure) {
        this.warnedFailure = true;
        // eslint-disable-next-line no-restricted-syntax -- no logger threads into this index hook (constructed by the lance factory with no plugin/logger handle); deferral is a best-effort warn
        console.warn("Sauce V2 FTS index ensure deferred", String(e));
      }
    }
  }

  /** A vault write changed an entity body; fold new rows into the FTS index.
   *  No per-write optimize() — LanceDB's FTS picks up new rows on the next
   *  search; createIndex's one-time optimize covers the initial build. */
  async index(_entityId: string, _title: string, _body: string): Promise<void> {
    await this.ensureIndex();
  }

  async remove(_entityId: string): Promise<void> {
    // Row deletion is handled by the mirror; the index reflects it on the next
    // search/optimize cycle. No per-call optimize() (LANCE-005 churn fix).
  }

  async search(query: string, limit = 25): Promise<FtsHit[]> {
    await this.ensureIndex();
    if (!this.ensured) return [];
    const rows = (await this.entities
      .query()
      .fullTextSearch(query, { columns: [FTS_COLUMN] })
      .limit(limit)
      .toArray()) as { id: string; _score?: number }[];
    return rows.map((r) => ({ entityId: r.id, score: r._score ?? 0 }));
  }
}
