// SPEC §17.1 — WASM sql.js fallback. No FTS5; mini inverted index handled by SqliteSync.
import type { BackendCapabilities, IPreparedStatement, ISqliteBackend } from './ISqliteBackend';

type SqlJsStatement = {
  bind: (p: unknown[]) => boolean;
  step: () => boolean;
  get: () => unknown[];
  getAsObject: () => Record<string, unknown>;
  free: () => boolean;
  run: (p?: unknown[]) => void;
};
type SqlJsDatabase = {
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
  prepare: (sql: string) => SqlJsStatement;
  run: (sql: string, p?: unknown[]) => void;
  export: () => Uint8Array;
  close: () => void;
};
type SqlJsModule = { Database: new (data?: Uint8Array) => SqlJsDatabase };

export interface SqlJsBackendOpts {
  loader?: () => Promise<SqlJsModule>;
  persist?: (data: Uint8Array) => Promise<void>;
  load?: () => Promise<Uint8Array | null>;
}

export class SqlJsBackend implements ISqliteBackend {
  private db: SqlJsDatabase | null = null;
  private persistFn: ((data: Uint8Array) => Promise<void>) | null;
  private loadFn: (() => Promise<Uint8Array | null>) | null;
  private loader: (() => Promise<SqlJsModule>) | null;

  constructor(opts?: SqlJsBackendOpts) {
    this.persistFn = opts?.persist ?? null;
    this.loadFn = opts?.load ?? null;
    this.loader = opts?.loader ?? null;
  }

  async init(_dbPath: string): Promise<void> {
    const SQL = this.loader
      ? await this.loader()
      : await (((typeof require !== 'undefined' ? require : null) as null | ((m: string) => unknown))?.('sql.js') as ((cfg?: unknown) => Promise<SqlJsModule>))({});
    const prior = this.loadFn ? await this.loadFn() : null;
    this.db = new SQL.Database(prior ?? undefined);
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    if (!this.db) throw new Error('backend not initialised');
    if (params.length === 0) this.db.exec(sql);
    else this.db.run(sql, params);
    await this.persist();
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.db) throw new Error('backend not initialised');
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    stmt.free();
    return rows;
  }

  async prepare(sql: string): Promise<IPreparedStatement> {
    if (!this.db) throw new Error('backend not initialised');
    const stmt = this.db.prepare(sql);
    return {
      run: async (p: unknown[] = []) => { stmt.run(p); await this.persist(); },
      get: async <R>(p: unknown[] = []) => {
        stmt.bind(p);
        return stmt.step() ? (stmt.getAsObject() as R) : undefined;
      },
      all: async <R>(p: unknown[] = []) => {
        stmt.bind(p);
        const out: R[] = [];
        while (stmt.step()) out.push(stmt.getAsObject() as R);
        return out;
      },
      finalize: async () => { stmt.free(); },
    };
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.db) throw new Error('backend not initialised');
    this.db.exec('BEGIN');
    try {
      const r = await fn();
      this.db.exec('COMMIT');
      await this.persist();
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  capabilities(): BackendCapabilities {
    return { fts5: false, vss: false, wal: false, native: false, persistent: true };
  }

  async close(): Promise<void> {
    await this.persist();
    this.db?.close();
    this.db = null;
  }

  private async persist(): Promise<void> {
    if (!this.db || !this.persistFn) return;
    await this.persistFn(this.db.export());
  }
}
