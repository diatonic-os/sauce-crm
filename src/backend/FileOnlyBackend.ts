// SPEC §17.1 — No-SQLite fallback. Maintains an in-memory mirror so callers
// using the ISqliteBackend surface still work; queries served from JS Maps.
// FTS via V1 FuzzyIndex (wired by SqliteSync when this backend is active).
import type { BackendCapabilities, IPreparedStatement, ISqliteBackend } from './ISqliteBackend';

type Row = Record<string, unknown>;

export class FileOnlyBackend implements ISqliteBackend {
  private tables = new Map<string, Row[]>();

  async init(_dbPath: string): Promise<void> { /* no-op */ }

  async exec(sql: string, _params: unknown[] = []): Promise<void> {
    // Recognise CREATE TABLE statements to allocate buckets; ignore everything else.
    const m = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i.exec(sql);
    if (m && !this.tables.has(m[1])) this.tables.set(m[1], []);
  }

  async query<T>(_sql: string, _params: unknown[] = []): Promise<T[]> {
    // Generic queries are not supported in file-only mode; SqliteSync provides
    // table-specific lookups via getTable(). Return empty to keep callers safe.
    return [] as T[];
  }

  async prepare(_sql: string): Promise<IPreparedStatement> {
    return {
      async run() {},
      async get<R>() { return undefined as R | undefined; },
      async all<R>() { return [] as R[]; },
      async finalize() {},
    };
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return await fn();
  }

  capabilities(): BackendCapabilities {
    return { fts5: false, vss: false, wal: false, native: false, persistent: false };
  }

  async close(): Promise<void> { this.tables.clear(); }

  getTable(name: string): Row[] { return this.tables.get(name) ?? []; }
  insert(table: string, row: Row): void {
    if (!this.tables.has(table)) this.tables.set(table, []);
    this.tables.get(table)!.push(row);
  }
  upsert(table: string, pk: string, row: Row): void {
    const rows = this.tables.get(table) ?? [];
    const i = rows.findIndex((r) => r[pk] === row[pk]);
    if (i >= 0) rows[i] = row; else rows.push(row);
    this.tables.set(table, rows);
  }
  remove(table: string, pk: string, val: unknown): void {
    const rows = this.tables.get(table) ?? [];
    this.tables.set(table, rows.filter((r) => r[pk] !== val));
  }
}
