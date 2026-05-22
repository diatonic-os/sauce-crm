// SPEC §17.3 — Read-through write-back mirror. Vault remains source of truth.
import type { ISqliteBackend } from './ISqliteBackend';
import type { SeederHostFile } from './Seeder';

export interface FtsFallback {
  index(entityId: string, title: string, body: string): void;
  remove(entityId: string): void;
  search(q: string, limit?: number): { entityId: string; score: number }[];
}

export class SqliteSync {
  constructor(
    private readonly db: ISqliteBackend,
    private readonly fts: FtsFallback | null = null,
  ) {}

  async onCreate(f: SeederHostFile): Promise<void> { await this.upsert(f); }
  async onModify(f: SeederHostFile): Promise<void> { await this.upsert(f); }

  async onDelete(path: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.exec(`DELETE FROM entities WHERE id = ?`, [path]);
      await this.db.exec(`DELETE FROM edges WHERE from_id = ? OR to_id = ?`, [path, path]);
      await this.db.exec(`DELETE FROM tags WHERE entity_id = ?`, [path]);
      await this.db.exec(`DELETE FROM touches WHERE id = ? OR contact_id = ?`, [path, path]);
      await this.db.exec(`DELETE FROM embeddings WHERE entity_id = ?`, [path]);
      if (this.db.capabilities().fts5) {
        await this.db.exec(`DELETE FROM fts WHERE entity_id = ?`, [path]);
      }
    });
    this.fts?.remove(path);
  }

  async onRename(oldPath: string, newPath: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.exec(`UPDATE entities SET id = ? WHERE id = ?`, [newPath, oldPath]);
      await this.db.exec(`UPDATE edges SET from_id = ? WHERE from_id = ?`, [newPath, oldPath]);
      await this.db.exec(`UPDATE edges SET to_id = ? WHERE to_id = ?`, [newPath, oldPath]);
      await this.db.exec(`UPDATE tags SET entity_id = ? WHERE entity_id = ?`, [newPath, oldPath]);
      await this.db.exec(`UPDATE touches SET contact_id = ? WHERE contact_id = ?`, [newPath, oldPath]);
      await this.db.exec(`UPDATE embeddings SET entity_id = ? WHERE entity_id = ?`, [newPath, oldPath]);
    });
  }

  private async upsert(f: SeederHostFile): Promise<void> {
    await this.db.transaction(async () => {
      const existing = await this.db.query<{ body_hash: string }>(
        `SELECT body_hash FROM entities WHERE id = ?`, [f.path],
      );
      const hashChanged = existing[0]?.body_hash !== f.bodyHash;

      await this.db.exec(
        `INSERT INTO entities (id,type,primary_type,frontmatter,body_md,body_hash,mtime,ctime,lat,lon,geo_acc_m)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           type=excluded.type, primary_type=excluded.primary_type, frontmatter=excluded.frontmatter,
           body_md=excluded.body_md, body_hash=excluded.body_hash, mtime=excluded.mtime`,
        [f.path, f.type, f.primaryType ?? null, JSON.stringify(f.frontmatter), f.body, f.bodyHash,
          f.mtime, f.ctime, null, null, null],
      );

      // Re-derive tags + edges from frontmatter — simpler than diffing.
      await this.db.exec(`DELETE FROM tags WHERE entity_id = ?`, [f.path]);
      for (const t of f.tags) await this.db.exec(`INSERT OR IGNORE INTO tags VALUES (?,?)`, [f.path, t]);
      await this.db.exec(`DELETE FROM edges WHERE from_id = ? AND source = 'manual'`, [f.path]);
      for (const e of f.edges) {
        await this.db.exec(
          `INSERT OR REPLACE INTO edges (from_id,to_id,edge_type,directed,weight,source,ts) VALUES (?,?,?,?,?,?,?)`,
          [f.path, e.to, e.edgeType, e.directed ? 1 : 0, 1.0, 'manual', Date.now()],
        );
      }

      if (hashChanged) {
        if (this.db.capabilities().fts5) {
          await this.db.exec(`DELETE FROM fts WHERE entity_id = ?`, [f.path]);
          const title = String(f.frontmatter['name'] ?? f.frontmatter['title'] ?? f.path);
          await this.db.exec(`INSERT INTO fts (entity_id,title,body) VALUES (?,?,?)`, [f.path, title, f.body]);
        } else if (this.fts) {
          const title = String(f.frontmatter['name'] ?? f.frontmatter['title'] ?? f.path);
          this.fts.index(f.path, title, f.body);
        }
        // Embeddings recompute is scheduled lazily by the InferenceEngine.
      }
    });
  }

  async search(q: string, limit = 25): Promise<{ entityId: string; score: number }[]> {
    if (this.db.capabilities().fts5) {
      const rows = await this.db.query<{ entity_id: string; rank: number }>(
        `SELECT entity_id, rank FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT ?`,
        [q, limit],
      );
      return rows.map((r) => ({ entityId: r.entity_id, score: r.rank }));
    }
    return this.fts?.search(q, limit) ?? [];
  }
}
