// LanceSecretStore unit tests. Collaborators are in-memory fakes mirroring the
// LanceTable / LanceConnection surface the store actually touches — no native
// LanceDB module, no filesystem.
import { describe, it, expect } from "vitest";
import { LanceSecretStore } from "./LanceSecretStore";
import { TABLES, type ApiKeyEncRow } from "./LanceSchema";
import type { EncryptedSecret } from "../../security/KeyVault";
import type { LanceConnection, LanceTable } from "./LanceConnection";

// ── fakes ──────────────────────────────────────────────────────────────────

/** Minimal LanceTable fake: mergeInsert upsert keyed on `service`, query/where
 *  on equality, select projection, and delete by predicate. Implements just the
 *  chained surface LanceSecretStore exercises. */
function makeTable(): LanceTable & { rows: ApiKeyEncRow[] } {
  const rows: ApiKeyEncRow[] = [];

  const matchWhere = (pred: string): ((r: ApiKeyEncRow) => boolean) => {
    // store only emits `service = '<escaped>'`
    const m = /service = '(.*)'/.exec(pred);
    if (!m) return () => false;
    const want = m[1]!.replace(/''/g, "'");
    return (r) => r.service === want;
  };

  const tbl = {
    rows,
    mergeInsert(_on: string) {
      return {
        whenMatchedUpdateAll() {
          return this;
        },
        whenNotMatchedInsertAll() {
          return this;
        },
        async execute(data: Record<string, unknown>[]) {
          for (const d of data) {
            const row = d as unknown as ApiKeyEncRow;
            const i = rows.findIndex((r) => r.service === row.service);
            if (i >= 0) rows[i] = row;
            else rows.push(row);
          }
        },
      };
    },
    query() {
      let filter: (r: ApiKeyEncRow) => boolean = () => true;
      let cols: string[] | null = null;
      let cap = Infinity;
      const q = {
        where(pred: string) {
          filter = matchWhere(pred);
          return q;
        },
        select(c: string[]) {
          cols = c;
          return q;
        },
        limit(n: number) {
          cap = n;
          return q;
        },
        async toArray() {
          let out = rows.filter(filter).slice(0, cap);
          if (cols) {
            out = out.map((r) => {
              const o: Record<string, unknown> = {};
              for (const c of cols!)
                o[c] = (r as unknown as Record<string, unknown>)[c];
              return o as unknown as ApiKeyEncRow;
            });
          }
          return out;
        },
      };
      return q;
    },
    async delete(pred: string) {
      const keep = matchWhere(pred);
      for (let i = rows.length - 1; i >= 0; i--) {
        if (keep(rows[i]!)) rows.splice(i, 1);
      }
    },
  };
  return tbl as unknown as LanceTable & { rows: ApiKeyEncRow[] };
}

/** Connection fake: tableNames()/openTable()/createTable() backed by a name map,
 *  enough for ensureTable() (which LanceSecretStore.open delegates to). */
function makeConn(): LanceConnection & { tables: Map<string, LanceTable> } {
  const tables = new Map<string, LanceTable>();
  const conn = {
    tables,
    async tableNames() {
      return [...tables.keys()];
    },
    async openTable(name: string) {
      return tables.get(name)!;
    },
    async createTable(name: string, _seed: Record<string, unknown>[]) {
      const t = makeTable();
      tables.set(name, t);
      return t;
    },
  };
  return conn as unknown as LanceConnection & {
    tables: Map<string, LanceTable>;
  };
}

function secret(overrides: Partial<EncryptedSecret> = {}): EncryptedSecret {
  return {
    service: "openai",
    ciphertext: new Uint8Array([1, 2, 3]),
    nonce: new Uint8Array([4, 5]),
    kdfSalt: new Uint8Array([6, 7, 8, 9]),
    kdfIters: 100_000,
    createdTs: 1234,
    rotatedTs: null,
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("LanceSecretStore", () => {
  it("binds to the canonical api_keys_enc table", () => {
    expect(LanceSecretStore.TABLE).toBe("api_keys_enc");
    expect(LanceSecretStore.TABLE).toBe(TABLES.apiKeysEnc);
  });

  it("open() creates the table and round-trips a secret put/get", async () => {
    const db = makeConn();
    const store = await LanceSecretStore.open(db);

    // open() must have materialized exactly the bound table.
    expect(db.tables.has(LanceSecretStore.TABLE)).toBe(true);

    const s = secret({ rotatedTs: 5678 });
    await store.put(s.service, s);

    const got = await store.get("openai");
    expect(got).not.toBeNull();
    expect(got!.service).toBe("openai");
    expect([...got!.ciphertext]).toEqual([1, 2, 3]);
    expect([...got!.nonce]).toEqual([4, 5]);
    expect([...got!.kdfSalt]).toEqual([6, 7, 8, 9]);
    expect(got!.kdfIters).toBe(100_000);
    expect(got!.createdTs).toBe(1234);
    expect(got!.rotatedTs).toBe(5678);
  });

  it("open() reuses an existing table on a second call (idempotent)", async () => {
    const db = makeConn();
    const a = await LanceSecretStore.open(db);
    await a.put("svc", secret({ service: "svc" }));
    const b = await LanceSecretStore.open(db);
    // Same underlying table ⇒ the row written via `a` is visible via `b`.
    expect(await b.get("svc")).not.toBeNull();
    expect(db.tables.size).toBe(1);
  });

  it("get() returns null for a missing service and rotatedTs<0 maps to null", async () => {
    const db = makeConn();
    const store = await LanceSecretStore.open(db);
    expect(await store.get("nope")).toBeNull();

    await store.put("svc", secret({ service: "svc", rotatedTs: null }));
    const got = await store.get("svc");
    expect(got!.rotatedTs).toBeNull();
  });

  it("list() returns sorted services and remove() deletes one", async () => {
    const db = makeConn();
    const store = await LanceSecretStore.open(db);
    await store.put("zeta", secret({ service: "zeta" }));
    await store.put("alpha", secret({ service: "alpha" }));

    expect(await store.list()).toEqual(["alpha", "zeta"]);

    await store.remove("alpha");
    expect(await store.list()).toEqual(["zeta"]);
  });
});
