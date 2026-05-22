// SPEC §17.2 — Schema migrations.
import type { ISqliteBackend } from './ISqliteBackend';

export interface Migration {
  version: number;
  name: string;
  up(db: ISqliteBackend): Promise<void>;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    async up(db) {
      await db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_ts INTEGER NOT NULL)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, primary_type TEXT,
        frontmatter TEXT NOT NULL, body_md TEXT NOT NULL, body_hash TEXT NOT NULL,
        mtime INTEGER NOT NULL, ctime INTEGER NOT NULL,
        lat REAL, lon REAL, geo_acc_m INTEGER)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_mtime ON entities(mtime)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_geo ON entities(lat, lon)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS edges (
        from_id TEXT NOT NULL, to_id TEXT NOT NULL, edge_type TEXT NOT NULL,
        directed INTEGER NOT NULL, weight REAL DEFAULT 1.0,
        source TEXT, inferred_conf REAL, ts INTEGER NOT NULL,
        PRIMARY KEY (from_id, to_id, edge_type))`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS tags (entity_id TEXT, tag TEXT, PRIMARY KEY (entity_id, tag))`);
      await db.exec(`CREATE TABLE IF NOT EXISTS touches (
        id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, date TEXT NOT NULL,
        channel TEXT, playbook TEXT, outcome_tags TEXT, attendees TEXT,
        source TEXT, author_id TEXT)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_touches_contact ON touches(contact_id, date)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS addenda (
        id TEXT PRIMARY KEY, target_id TEXT NOT NULL, date TEXT NOT NULL,
        kind TEXT NOT NULL, author_id TEXT NOT NULL, body_md TEXT NOT NULL,
        signature TEXT NOT NULL)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS embeddings (
        entity_id TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL,
        vector BLOB NOT NULL, hash TEXT NOT NULL)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
        ts INTEGER PRIMARY KEY, op TEXT NOT NULL, entity_id TEXT, agent_id TEXT,
        integration TEXT, before_hash TEXT, after_hash TEXT, details TEXT,
        signature TEXT NOT NULL)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS sync_state (
        integration TEXT, resource TEXT, cursor TEXT,
        last_pull_ts INTEGER, last_push_ts INTEGER,
        PRIMARY KEY (integration, resource))`);
      await db.exec(`CREATE TABLE IF NOT EXISTS api_keys_enc (
        service TEXT PRIMARY KEY, ciphertext BLOB NOT NULL, nonce BLOB NOT NULL,
        kdf_salt BLOB NOT NULL, kdf_iters INTEGER NOT NULL,
        created_ts INTEGER NOT NULL, rotated_ts INTEGER)`);
    },
  },
  {
    version: 2,
    name: 'fts5-virtual-table',
    async up(db) {
      const caps = db.capabilities();
      if (!caps.fts5) return;
      await db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
        entity_id UNINDEXED, title, body,
        content='entities', tokenize='unicode61 remove_diacritics 2')`);
    },
  },
];

export async function applyMigrations(db: ISqliteBackend): Promise<number> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_ts INTEGER NOT NULL)`);
  const rows = await db.query<{ version: number | null }>(`SELECT MAX(version) AS version FROM schema_version`);
  const current = rows[0]?.version ?? 0;
  let applied = 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.transaction(async () => {
      await m.up(db);
      await db.exec(`INSERT INTO schema_version (version, applied_ts) VALUES (?, ?)`, [m.version, Date.now()]);
    });
    applied += 1;
  }
  return applied;
}
