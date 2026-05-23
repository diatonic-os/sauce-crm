// LanceDB mirror of the vault — replaces SqliteSync. The vault .md files remain
// the source of truth; this keeps a queryable derived copy of entities, edges,
// tags, and touches in LanceDB. Vault events (create/modify/delete/rename) drive
// the corresponding table mutations.

import { sqlStr, type LanceTable } from "./LanceConnection";
import type { EntityRow, EdgeRow, TagRow } from "./LanceSchema";

/** File shape the mirror consumes (formerly Seeder's SeederHostFile). */
export interface MirrorFile {
  path: string;
  type: string;
  primaryType?: string;
  frontmatter: Record<string, unknown>;
  body: string;
  bodyHash: string;
  mtime: number;
  ctime: number;
  tags: string[];
  edges: { to: string; edgeType: string; directed: boolean }[];
}

export interface MirrorTables {
  entities: LanceTable;
  edges: LanceTable;
  tags: LanceTable;
  touches: LanceTable;
  embeddings: LanceTable;
}

/** Optional FTS hook so the mirror can keep a full-text index in step with
 *  body changes without coupling to a specific index implementation. */
export interface MirrorFtsHook {
  index(entityId: string, title: string, body: string): Promise<void>;
  remove(entityId: string): Promise<void>;
}

const rec = (o: object) => o as unknown as Record<string, unknown>;

export class LanceEntityMirror {
  constructor(
    private readonly t: MirrorTables,
    private readonly fts: MirrorFtsHook | null = null,
  ) {}

  async onCreate(f: MirrorFile): Promise<void> { await this.upsert(f); }
  async onModify(f: MirrorFile): Promise<void> { await this.upsert(f); }

  async onDelete(path: string): Promise<void> {
    const id = sqlStr(path);
    await this.t.entities.delete(`id = ${id}`);
    await this.t.edges.delete(`from_id = ${id} OR to_id = ${id}`);
    await this.t.tags.delete(`entity_id = ${id}`);
    await this.t.touches.delete(`id = ${id} OR contact_id = ${id}`);
    await this.t.embeddings.delete(`entity_id = ${id}`);
    await this.fts?.remove(path);
  }

  async onRename(oldPath: string, newPath: string): Promise<void> {
    const oldId = sqlStr(oldPath);
    await this.t.entities.update({ where: `id = ${oldId}`, values: { id: newPath } });
    await this.t.edges.update({ where: `from_id = ${oldId}`, values: { from_id: newPath } });
    await this.t.edges.update({ where: `to_id = ${oldId}`, values: { to_id: newPath } });
    await this.t.tags.update({ where: `entity_id = ${oldId}`, values: { entity_id: newPath } });
    await this.t.touches.update({ where: `contact_id = ${oldId}`, values: { contact_id: newPath } });
    await this.t.embeddings.update({ where: `entity_id = ${oldId}`, values: { entity_id: newPath } });
  }

  /** True iff the entity's body hash differs from what's stored (or it's new). */
  async bodyChanged(f: MirrorFile): Promise<boolean> {
    await this.refresh(this.t.entities);
    const rows = (await this.t.entities
      .query()
      .where(`id = ${sqlStr(f.path)}`)
      .select(["body_hash"])
      .limit(1)
      .toArray()) as unknown as { body_hash: string }[];
    return rows[0]?.body_hash !== f.bodyHash;
  }

  private async upsert(f: MirrorFile): Promise<void> {
    const changed = await this.bodyChanged(f);

    const entity: EntityRow = {
      id: f.path,
      type: f.type,
      primary_type: f.primaryType ?? "",
      frontmatter: JSON.stringify(f.frontmatter),
      body_md: f.body,
      body_hash: f.bodyHash,
      mtime: f.mtime,
      ctime: f.ctime,
      lat: 0, lon: 0, geo_acc_m: 0,
    };
    await this.t.entities
      .mergeInsert("id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([rec(entity)]);

    // Re-derive tags + manual edges from frontmatter — simpler than diffing.
    await this.t.tags.delete(`entity_id = ${sqlStr(f.path)}`);
    if (f.tags.length) {
      const tagRows: TagRow[] = f.tags.map((tag) => ({ entity_id: f.path, tag }));
      await this.t.tags.add(tagRows.map(rec));
    }

    await this.t.edges.delete(`from_id = ${sqlStr(f.path)} AND source = 'manual'`);
    if (f.edges.length) {
      const now = Date.now();
      const edgeRows: EdgeRow[] = f.edges.map((e) => ({
        from_id: f.path, to_id: e.to, edge_type: e.edgeType,
        directed: e.directed ? 1 : 0, weight: 1.0, source: "manual",
        inferred_conf: 0, ts: now,
      }));
      await this.t.edges.add(edgeRows.map(rec));
    }

    if (changed && this.fts) {
      const title = String(f.frontmatter["name"] ?? f.frontmatter["title"] ?? f.path);
      await this.fts.index(f.path, title, f.body);
    }
  }

  // ---- read helpers ----

  // A table handle pins to the version it last wrote/checked out, so a restore
  // committed through a different handle (LanceCheckpoints) is invisible until
  // we re-point to latest. Refreshing before reads keeps the mirror coherent
  // with checkpoints; it's a cheap manifest read.
  private async refresh(tbl: LanceTable): Promise<void> {
    try { await tbl.checkoutLatest(); } catch { /* not checked out / already latest */ }
  }

  async getEntity(path: string): Promise<EntityRow | null> {
    await this.refresh(this.t.entities);
    const rows = (await this.t.entities
      .query()
      .where(`id = ${sqlStr(path)}`)
      .limit(1)
      .toArray()) as unknown as EntityRow[];
    return rows[0] ?? null;
  }

  async listByType(type: string): Promise<EntityRow[]> {
    await this.refresh(this.t.entities);
    return (await this.t.entities
      .query()
      .where(`type = ${sqlStr(type)}`)
      .toArray()) as unknown as EntityRow[];
  }

  /** Outgoing + incoming edges for an entity. */
  async neighbors(path: string): Promise<EdgeRow[]> {
    await this.refresh(this.t.edges);
    const id = sqlStr(path);
    return (await this.t.edges
      .query()
      .where(`from_id = ${id} OR to_id = ${id}`)
      .toArray()) as unknown as EdgeRow[];
  }
}
