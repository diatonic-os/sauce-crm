// LanceDB connection + table-ensure helpers.
//
// The `@lancedb/lancedb` module is a native N-API binding declared as an
// esbuild external. We must NOT import it at module top-level: in the bundled
// main.js a top-level import of an external compiles to a top-level require()
// that THROWS when LanceDB is not yet installed (require-install mode) —
// crashing the plugin before the install modal can surface. So the type is
// imported type-only (erased at build) and the value is loaded lazily via a
// runtime require() that callers wrap in try/catch.

import type * as Lance from "@lancedb/lancedb";
import { seedRows, seedDeletePredicate, type TableName } from "./LanceSchema";

export type LanceModule = typeof Lance;
export type LanceConnection = Lance.Connection;
export type LanceTable = Lance.Table;

/** Lazily resolve the native LanceDB module. Throws if unavailable — callers
 *  in require-install mode catch this and surface the install prompt.
 *
 *  Resolution: try the bare specifier first (works in dev/tests and any host
 *  whose require() searches the plugin dir). Obsidian's RENDERER require, however,
 *  resolves from Electron internals (require stack `electron/js2c/renderer_init`)
 *  and never walks the plugin folder — so a require-install at
 *  `<pluginDir>/node_modules` is invisible to it. When `pluginDir` is supplied we
 *  fall back to an ABSOLUTE require into the plugin's own node_modules; the
 *  package's transitive deps (apache-arrow, the platform .node) resolve as
 *  siblings there. */
/** Module cache: once resolved (by bare OR absolute path) we keep the instance
 *  so later bare callers (e.g. LanceFtsIndex) don't re-resolve and fail — the
 *  absolute-path require uses a different module-cache key than the bare one. */
let cachedLance: LanceModule | null = null;

export function loadLance(pluginDir?: string): LanceModule {
  if (cachedLance) return cachedLance;
  const req =
    (globalThis as unknown as { require?: NodeRequire }).require ??
    (typeof require !== "undefined" ? require : undefined);
  if (typeof req !== "function") {
    throw new Error("require() unavailable; LanceDB needs Electron/Node host");
  }
  try {
    cachedLance = req("@lancedb/lancedb") as LanceModule;
  } catch (bareErr) {
    if (!pluginDir) throw bareErr;
    cachedLance = req(
      `${pluginDir}/node_modules/@lancedb/lancedb`,
    ) as LanceModule;
  }
  return cachedLance;
}

export async function openLance(
  dataDir: string,
  pluginDir?: string,
): Promise<LanceConnection> {
  const lancedb = loadLance(pluginDir);
  return lancedb.connect(dataDir);
}

/** Open a table, creating it (with a typed sentinel row that is then deleted)
 *  if it does not yet exist. The sentinel fixes the inferred Arrow schema so
 *  the table is well-typed even while empty. Idempotent. */
export async function ensureTable(
  db: LanceConnection,
  name: TableName,
  embeddingDim: number,
): Promise<LanceTable> {
  const names = await db.tableNames();
  if (names.includes(name)) return db.openTable(name);
  const seed = seedRows(embeddingDim)[name];
  const tbl = await db.createTable(name, seed);
  await tbl.delete(seedDeletePredicate(name));
  return tbl;
}

/** SQL-string literal escaping for `where`/`delete` predicates. LanceDB uses
 *  DataFusion SQL; single quotes are escaped by doubling. */
export function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
