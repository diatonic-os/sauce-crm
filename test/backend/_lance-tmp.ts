// Shared helpers for LanceDB-backed tests: a throwaway connection in a temp
// dir, plus per-test cleanup. Real LanceDB (devDependency) — no mocks.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openLance,
  ensureTable,
  type LanceConnection,
} from "../../src/backend/lance/LanceConnection";
import {
  DEFAULT_EMBEDDING_DIM,
  type TableName,
} from "../../src/backend/lance/LanceSchema";

export interface TmpLance {
  db: LanceConnection;
  dir: string;
  table(name: TableName, dim?: number): ReturnType<typeof ensureTable>;
  cleanup(): void;
}

export async function tmpLance(): Promise<TmpLance> {
  const dir = mkdtempSync(join(tmpdir(), "sauce-lance-"));
  const db = await openLance(dir);
  return {
    db,
    dir,
    table: (name: TableName, dim = DEFAULT_EMBEDDING_DIM) =>
      ensureTable(db, name, dim),
    // Close the native connection before removing the dir — leaked LanceDB
    // handles across parallel vitest workers can trigger a Rust panic.
    cleanup: () => {
      if (db.isOpen()) db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
