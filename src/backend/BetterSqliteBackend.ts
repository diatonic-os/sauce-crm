// SPEC §17.1 — Native better-sqlite3 backend.
import type { BackendCapabilities, IPreparedStatement, ISqliteBackend } from './ISqliteBackend';

type Stmt = {
  run: (...p: unknown[]) => unknown;
  get: (...p: unknown[]) => unknown;
  all: (...p: unknown[]) => unknown[];
};
type Db = {
  prepare: (sql: string) => Stmt;
  exec: (sql: string) => void;
  close: () => void;
  pragma: (s: string) => unknown;
  transaction: <T>(fn: () => T) => () => T;
};

export class BetterSqliteBackend implements ISqliteBackend {
  private db: Db | null = null;

  async init(dbPath: string): Promise<void> {
    const req = (typeof require !== 'undefined' ? require : null) as null | ((m: string) => unknown);
    if (!req) throw new Error('require not available; better-sqlite3 needs Node context');
    const mod = req('better-sqlite3') as (path: string, opts?: unknown) => Db;
    this.db = mod(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    if (!this.db) throw new Error('backend not initialised');
    if (params.length === 0) this.db.exec(sql);
    else this.db.prepare(sql).run(...params);
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.db) throw new Error('backend not initialised');
    return this.db.prepare(sql).all(...params) as T[];
  }

  async prepare(sql: string): Promise<IPreparedStatement> {
    if (!this.db) throw new Error('backend not initialised');
    const stmt = this.db.prepare(sql);
    return {
      async run(p: unknown[] = []) { stmt.run(...p); },
      async get<R>(p: unknown[] = []) { return stmt.get(...p) as R | undefined; },
      async all<R>(p: unknown[] = []) { return stmt.all(...p) as R[]; },
      async finalize() {},
    };
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.db) throw new Error('backend not initialised');
    this.db.exec('BEGIN');
    try {
      const r = await fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  capabilities(): BackendCapabilities {
    return { fts5: true, vss: false, wal: true, native: true, persistent: true };
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}
