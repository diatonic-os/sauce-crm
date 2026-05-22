// SPEC §17.1 — Detection + factory. Tries native, then WASM, then file-only.
import type { ISqliteBackend, BackendKind, BackendInfo } from './ISqliteBackend';
import { BetterSqliteBackend } from './BetterSqliteBackend';
import { SqlJsBackend, type SqlJsBackendOpts } from './SqlJsBackend';
import { FileOnlyBackend } from './FileOnlyBackend';

export * from './ISqliteBackend';
export { BetterSqliteBackend, SqlJsBackend, FileOnlyBackend };
export { applyMigrations, MIGRATIONS } from './Migrations';
export { Seeder } from './Seeder';
export { SqliteSync } from './SqliteSync';

export interface SelectBackendOpts {
  dbPath: string;
  preferNative?: boolean;
  sqlJs?: SqlJsBackendOpts;
}

export async function selectBackend(opts: SelectBackendOpts): Promise<{ kind: BackendKind; backend: ISqliteBackend }> {
  const preferNative = opts.preferNative ?? true;
  if (preferNative) {
    try {
      const req = (typeof require !== 'undefined' ? require : null) as null | ((m: string) => unknown);
      if (req) {
        req.call(null, 'better-sqlite3');
        const b = new BetterSqliteBackend();
        await b.init(opts.dbPath);
        return { kind: 'better-sqlite', backend: b };
      }
    } catch { /* fall through */ }
  }
  try {
    const b = new SqlJsBackend(opts.sqlJs);
    await b.init(opts.dbPath);
    return { kind: 'sql-js', backend: b };
  } catch {
    const b = new FileOnlyBackend();
    await b.init(opts.dbPath);
    return { kind: 'file-only', backend: b };
  }
}

export async function describeBackend(b: ISqliteBackend, kind: BackendKind): Promise<BackendInfo> {
  const caps = b.capabilities();
  const tables = ['entities', 'edges', 'tags', 'touches', 'addenda', 'embeddings', 'audit_log'];
  const rowCounts: Record<string, number> = {};
  for (const t of tables) {
    try {
      const r = await b.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
      rowCounts[t] = r[0]?.n ?? 0;
    } catch { rowCounts[t] = 0; }
  }
  return { kind, version: '1', capabilities: caps, dbSizeBytes: 0, rowCounts };
}
