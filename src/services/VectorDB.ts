import { App } from 'obsidian';

interface VectorDB {
  store(id: string, vector: number[]): Promise<void>;
  query(vector: number[], limit: number): Promise<{ id: string; distance: number }[]>;
  delete(id: string): Promise<void>;
  upsert(id: string, vector: number[]): Promise<void>;
}

class LanceDBVectorDB implements VectorDB {
  private db: any;

  constructor(dbPath: string) {
    try {
      const lancedb = require('@lancedb/lancedb');
      this.db = lancedb.lancedb(dbPath);
    } catch (e) {
      throw new Error(`Failed to initialize LanceDB: ${e}`);
    }
  }

  async store(id: string, vector: number[]): Promise<void> {
    const table = await this.getOrCreateTable('vectors');
    await table.add({ id, vector });
  }

  async query(vector: number[], limit: number): Promise<{ id: string; distance: number }[]> {
    const table = await this.getTable('vectors');
    if (!table) throw new Error('Table not found');
    const results = await table.search(vector).limit(limit).execute();
    return results.map((result: any) => ({ id: result.id, distance: result.distance }));
  }

  async delete(id: string): Promise<void> {
    const table = await this.getTable('vectors');
    if (!table) throw new Error('Table not found');
    await table.delete(`id = '${id}'`);
  }

  async upsert(id: string, vector: number[]): Promise<void> {
    await this.delete(id);
    await this.store(id, vector);
  }

  private async getOrCreateTable(tableName: string) {
    try {
      return await this.db.createTable(tableName, [{ name: 'id', type: 'string' }, { name: 'vector', type: 'vector', dimension: 384 }]);
    } catch (e) {
      return this.getTable(tableName);
    }
  }

  private async getTable(tableName: string) {
    try {
      return await this.db.openTable(tableName);
    } catch (e) {
      throw new Error(`Table ${tableName} not found`);
    }
  }
}

class SqliteVecVectorDB implements VectorDB {
  private db: any;

  constructor(dbPath: string) {
    this.init(dbPath);
  }

  async init(dbPath: string) {
    try {
      const sqlite3 = require('sqlite3').verbose();
      const { open } = require('sqlite');
      this.db = await open({
        filename: dbPath,
        driver: sqlite3.Database,
      });
      const { vectorInit } = require('sqlite-vec');
      await vectorInit(this.db);
      await this.createTableIfNotExists();
    } catch (e) {
      throw new Error(`Failed to initialize sqlite-vec: ${e}`);
    }
  }

  async store(id: string, vector: number[]): Promise<void> {
    await this.db.run(`INSERT INTO vectors (id, vector) VALUES (?, ?)`, [id, JSON.stringify(vector)]);
    await this.db.run(`INSERT INTO vectors_vec (id, vector) VALUES (?, ?)`, [id, JSON.stringify(vector)]);
  }

  async query(vector: number[], limit: number): Promise<{ id: string; distance: number }[]> {
    const results = await this.db.all(`SELECT id, distance FROM vectors_vec WHERE vector MATCH ? ORDER BY distance LIMIT ?`, [JSON.stringify(vector), limit]);
    return results.map((row: any) => ({ id: row.id, distance: row.distance }));
  }

  async delete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM vectors WHERE id = ?`, [id]);
    await this.db.run(`DELETE FROM vectors_vec WHERE id = ?`, [id]);
  }

  async upsert(id: string, vector: number[]): Promise<void> {
    await this.delete(id);
    await this.store(id, vector);
  }

  private async createTableIfNotExists() {
    await this.db.run(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        vector TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS vectors_vec USING vector(384, 'f32');
    `);
  }
}

class VectorDBFactory {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async createVectorDB(): Promise<VectorDB> {
    const dbPath = this.resolveDBPath();
    try {
      require('@lancedb/lancedb');
      return new LanceDBVectorDB(dbPath);
    } catch (e) {
      console.error('Failed to load LanceDB:', e);
      return new SqliteVecVectorDB(dbPath);
    }
  }

  private resolveDBPath(): string {
    // FileSystemAdapter (desktop) exposes getBasePath(); mobile adapters
    // do not. Plugin manifest declares isDesktopOnly: true, so the cast
    // is safe at runtime — the narrow keeps tsc happy.
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    const base = adapter.getBasePath ? adapter.getBasePath() : "";
    return `${base}/.obsidian/plugins/sauce-crm/data/vectors`;
  }
}

export { VectorDBFactory };
