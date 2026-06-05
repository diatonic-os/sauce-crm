// LanceDB-backed ISecretStore — replaces SqliteSecretStore. Encrypted API-key
// material lives in the `api_keys_enc` table. Byte fields are base64-encoded
// (Arrow string columns) and decoded back to Uint8Array on read.

import type { ISecretStore, EncryptedSecret } from "../../security/KeyVault";
import {
  TABLES,
  DEFAULT_EMBEDDING_DIM,
  type ApiKeyEncRow,
} from "./LanceSchema";
import {
  ensureTable,
  sqlStr,
  type LanceConnection,
  type LanceTable,
} from "./LanceConnection";

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
function unb64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

export class LanceSecretStore implements ISecretStore {
  /** The physical Lance table this store binds to. Mirrors how
   *  `index.ts` pairs every sibling store with its `TABLES.<name>`, so the
   *  table identity is asserted here rather than being a magic string
   *  hand-threaded from the caller. */
  static readonly TABLE = TABLES.apiKeysEnc;

  constructor(private readonly table: LanceTable) {}

  /** Open (creating if absent) the `api_keys_enc` table on `db` and wrap it.
   *  Callers should prefer this over `new LanceSecretStore(rawTable)` so the
   *  table name is owned by the store, not the call site. */
  static async open(
    db: LanceConnection,
    embeddingDim: number = DEFAULT_EMBEDDING_DIM,
  ): Promise<LanceSecretStore> {
    const table = await ensureTable(db, LanceSecretStore.TABLE, embeddingDim);
    return new LanceSecretStore(table);
  }

  async put(service: string, row: EncryptedSecret): Promise<void> {
    const r: ApiKeyEncRow = {
      service,
      ciphertext: b64(row.ciphertext),
      nonce: b64(row.nonce),
      kdf_salt: b64(row.kdfSalt),
      kdf_iters: row.kdfIters,
      created_ts: row.createdTs,
      rotated_ts: row.rotatedTs ?? -1,
    };
    await this.table
      .mergeInsert("service")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([r] as unknown as Record<string, unknown>[]);
  }

  async get(service: string): Promise<EncryptedSecret | null> {
    const rows = (await this.table
      .query()
      .where(`service = ${sqlStr(service)}`)
      .limit(1)
      .toArray()) as ApiKeyEncRow[];
    const r = rows[0];
    if (!r) return null;
    return {
      service: r.service,
      ciphertext: unb64(r.ciphertext),
      nonce: unb64(r.nonce),
      kdfSalt: unb64(r.kdf_salt),
      kdfIters: r.kdf_iters,
      createdTs: r.created_ts,
      rotatedTs: r.rotated_ts < 0 ? null : r.rotated_ts,
    };
  }

  async list(): Promise<string[]> {
    const rows = (await this.table.query().select(["service"]).toArray()) as {
      service: string;
    }[];
    return rows.map((r) => r.service).sort();
  }

  async remove(service: string): Promise<void> {
    await this.table.delete(`service = ${sqlStr(service)}`);
  }
}
