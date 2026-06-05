// LanceDB maintenance: compaction, version pruning, and the load-time health
// guards that prevent an oversized/slow store from freezing vault load.
//
// Root-cause context: LanceDB is append-/version-structured — every write (and
// every reseed/rebuild) creates a new version, and old versions are retained
// until compaction. Repeated rebuilds without compaction let the store balloon
// (observed: a 774-note vault grew a 4.1 GB lancedb dir), and opening a store
// with thousands of version manifests can take a very long time. These helpers
// (a) bound init time so a bad store degrades gracefully instead of hanging,
// and (b) compact + prune so size stays proportional to the data.

import type { LanceConnection } from "./LanceConnection";

/** Reject a promise if it does not settle within `ms`. Used to bound LanceDB
 *  operations so a pathological store can never block vault load indefinitely.
 *  Note: LanceDB's N-API calls run on a threadpool, so the timer fires even
 *  while an op is in flight. */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`lance ${label}: timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Sum the byte size of every file under `dir`, but STOP as soon as the running
 *  total reaches `capBytes`. This makes "is this store bloated?" cheap to answer
 *  on a huge tree — it short-circuits instead of walking the whole 4 GB. Returns
 *  the partial total; a return value >= capBytes means "at least this large".
 *  Renderer-safe: `fs`/`path` are lazily required (never top-level imported). */
export function dirSizeBounded(dir: string, capBytes: number): number {
  const req =
    (globalThis as unknown as { require?: NodeRequire }).require ??
    (typeof require !== "undefined" ? require : undefined);
  if (typeof req !== "function") return 0;
  let fs: typeof import("fs");
  let path: typeof import("path");
  try {
    fs = req("fs") as typeof import("fs");
    path = req("path") as typeof import("path");
  } catch {
    return 0;
  }
  let total = 0;
  const stack: string[] = [dir];
  for (let cur = stack.pop(); cur !== undefined; cur = stack.pop()) {
    let entries: string[];
    try {
      entries = fs.readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of entries) {
      const p = path.join(cur, name);
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) stack.push(p);
        else total += st.size;
      } catch {
        continue;
      }
      if (total >= capBytes) return total; // short-circuit: known-bloated
    }
  }
  return total;
}

/** Count files under `dir`, stopping once `cap` is reached. LanceDB writes a
 *  new fragment + version manifest per transaction; without compaction the file
 *  count (not just bytes) explodes — and a vault watcher choking on tens of
 *  thousands of files is what manifests as Obsidian's "watcher" error. This is
 *  the cheap signal that triggers compaction. Renderer-safe (lazy fs require). */
export function dirFileCountBounded(dir: string, cap: number): number {
  const req =
    (globalThis as unknown as { require?: NodeRequire }).require ??
    (typeof require !== "undefined" ? require : undefined);
  if (typeof req !== "function") return 0;
  let fs: typeof import("fs");
  let path: typeof import("path");
  try {
    fs = req("fs") as typeof import("fs");
    path = req("path") as typeof import("path");
  } catch {
    return 0;
  }
  let count = 0;
  const stack: string[] = [dir];
  for (let cur = stack.pop(); cur !== undefined; cur = stack.pop()) {
    let entries: import("fs").Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) stack.push(path.join(cur, e.name));
      else count++;
      if (count >= cap) return count; // short-circuit: known-bloated
    }
  }
  return count;
}

/** Fragment-count above which a lancedb dir is considered bloated and triggers
 *  compaction at load. A healthy compacted store is well under this. */
export const LANCE_BLOAT_WARN_FILES = 2000;

export interface CompactResult {
  optimized: number;
  failed: number;
  tables: number;
}

/** Compact every table on the connection and prune versions older than
 *  `olderThanMs` (default 1h — safely past any in-flight transaction). Each
 *  table is optimized independently and time-bounded, so one slow/failed table
 *  never aborts the rest. Safe to call after heavy writes (reseed/rebuild) and
 *  opportunistically at load when the store is detected oversized. */
export async function compactConnection(
  db: LanceConnection,
  opts: { olderThanMs?: number; perTableTimeoutMs?: number } = {},
): Promise<CompactResult> {
  const olderThanMs = opts.olderThanMs ?? 3_600_000;
  const perTableTimeoutMs = opts.perTableTimeoutMs ?? 120_000;
  const cleanupOlderThan = new Date(Date.now() - olderThanMs);
  let names: string[] = [];
  try {
    names = await withTimeout(db.tableNames(), 30_000, "tableNames");
  } catch {
    return { optimized: 0, failed: 0, tables: 0 };
  }
  let optimized = 0;
  let failed = 0;
  for (const name of names) {
    try {
      const t = await withTimeout(
        db.openTable(name),
        perTableTimeoutMs,
        `open ${name}`,
      );
      await withTimeout(
        t.optimize({ cleanupOlderThan }),
        perTableTimeoutMs,
        `optimize ${name}`,
      );
      optimized++;
    } catch {
      failed++;
    }
  }
  return { optimized, failed, tables: names.length };
}

/** Size above which a lancedb dir is considered abnormally large for a CRM
 *  vault and triggers an opportunistic background compaction at load. */
export const LANCE_BLOAT_WARN_BYTES = 512 * 1024 * 1024; // 512 MB

/** Max time the backend init may take before we give up and let the vault load
 *  in a degraded (no-backend) state rather than freeze. */
export const LANCE_INIT_BUDGET_MS = 60_000;
