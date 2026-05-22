// SPEC §17.1 — Liskov-substitutable backend interface.
// All three backends (BetterSqlite, SqlJs, FileOnly) implement this.

export interface BackendCapabilities {
  fts5: boolean;
  vss: boolean;
  wal: boolean;
  native: boolean;
  persistent: boolean;
}

export interface IPreparedStatement {
  run(params?: unknown[]): Promise<void>;
  get<T>(params?: unknown[]): Promise<T | undefined>;
  all<T>(params?: unknown[]): Promise<T[]>;
  finalize(): Promise<void>;
}

export interface ISqliteBackend {
  init(dbPath: string): Promise<void>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  prepare(sql: string): Promise<IPreparedStatement>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  capabilities(): BackendCapabilities;
  close(): Promise<void>;
}

export type BackendKind = 'better-sqlite' | 'sql-js' | 'file-only';

export interface BackendInfo {
  kind: BackendKind;
  version: string;
  capabilities: BackendCapabilities;
  dbSizeBytes: number;
  rowCounts: Record<string, number>;
}
