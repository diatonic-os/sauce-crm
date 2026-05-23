// Checkpoints + rollback via LanceDB versioning — the WAL/checkpoint analog.
//
// Every LanceDB commit produces an immutable version. A named checkpoint is a
// tag pointing at the current version of each table; restoring rewinds each
// table to its tagged version (checkout → restore promotes it to latest).

import type { LanceConnection, LanceTable } from "./LanceConnection";
import { TABLES, type TableName } from "./LanceSchema";

const ALL_TABLES = Object.values(TABLES) as TableName[];

export interface CheckpointInfo {
  label: string;
  versions: Record<string, number>;
  createdTs: number;
}

/** Tag name carrying the per-table version map is impractical (tags are
 *  per-table), so each table gets its own tag named `<label>`; the manifest
 *  ties them together by shared label. */
export class LanceCheckpoints {
  constructor(private readonly db: LanceConnection) {}

  private async openAll(): Promise<Record<string, LanceTable>> {
    const names = await this.db.tableNames();
    const out: Record<string, LanceTable> = {};
    for (const t of ALL_TABLES) {
      if (names.includes(t)) out[t] = await this.db.openTable(t);
    }
    return out;
  }

  /** Tag the current version of every table with `label`. */
  async checkpoint(label: string): Promise<CheckpointInfo> {
    const tables = await this.openAll();
    const versions: Record<string, number> = {};
    for (const [name, tbl] of Object.entries(tables)) {
      const v = await tbl.version();
      const tags = await tbl.tags();
      const existing = await tags.list();
      if (existing[label]) await tags.update(label, v);
      else await tags.create(label, v);
      versions[name] = v;
    }
    return { label, versions, createdTs: Date.now() };
  }

  /** List checkpoint labels present across tables, with per-table versions. */
  async list(): Promise<CheckpointInfo[]> {
    const tables = await this.openAll();
    const byLabel = new Map<string, Record<string, number>>();
    for (const [name, tbl] of Object.entries(tables)) {
      const tags = await tbl.tags();
      const list = await tags.list();
      for (const [label, info] of Object.entries(list)) {
        const m = byLabel.get(label) ?? {};
        m[name] = (info as { version?: number }).version ?? 0;
        byLabel.set(label, m);
      }
    }
    return [...byLabel.entries()].map(([label, versions]) => ({
      label,
      versions,
      createdTs: 0,
    }));
  }

  /** Rewind every tagged table to its `label` version and promote it to latest. */
  async restore(label: string): Promise<void> {
    const tables = await this.openAll();
    for (const tbl of Object.values(tables)) {
      const tags = await tbl.tags();
      const list = await tags.list();
      if (!list[label]) continue;
      await tbl.checkout(label);
      await tbl.restore();
    }
  }
}
