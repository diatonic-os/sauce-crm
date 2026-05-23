// Canonical table names + row shapes for the LanceDB single-backend.
//
// LanceDB infers a table's Arrow schema from the first row it is created with.
// We therefore seed each table with one fully-typed sentinel row (id ===
// SEED_ID) and immediately delete it — the schema persists in the manifest
// even when the table holds zero rows. Nullable SQLite columns map to a typed
// non-null sentinel value here so the inferred column type is stable.
//
// Bytes (ciphertext/nonce/salt) are stored as base64 `string` columns rather
// than Arrow binary to avoid binary-type friction across the N-API boundary.

export const SEED_ID = "__sauce_seed__";

export const TABLES = {
  entities: "entities",
  edges: "edges",
  tags: "tags",
  touches: "touches",
  addenda: "addenda",
  embeddings: "embeddings",
  auditLog: "audit_log",
  apiKeysEnc: "api_keys_enc",
  syncState: "sync_state",
  provenance: "provenance",
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];

export interface EntityRow {
  id: string;
  type: string;
  primary_type: string;
  frontmatter: string; // JSON
  body_md: string;
  body_hash: string;
  mtime: number;
  ctime: number;
  lat: number;
  lon: number;
  geo_acc_m: number;
}

export interface EdgeRow {
  from_id: string;
  to_id: string;
  edge_type: string;
  directed: number;
  weight: number;
  source: string;
  inferred_conf: number;
  ts: number;
}

export interface TagRow {
  entity_id: string;
  tag: string;
}

export interface TouchRow {
  id: string;
  contact_id: string;
  date: string;
  channel: string;
  playbook: string;
  outcome_tags: string;
  attendees: string;
  source: string;
  author_id: string;
}

export interface EmbeddingRow {
  entity_id: string;
  model: string;
  dim: number;
  vector: number[];
  hash: string;
}

export interface AuditRowStored {
  ts: number;
  op: string;
  entity_id: string;
  agent_id: string;
  integration: string;
  before_hash: string;
  after_hash: string;
  details: string; // JSON
  signature: string;
}

/** Content-addressed provenance/fingerprint record. Append-only, HMAC-signed,
 *  lineage-linked via parent_fp. The app's "true backend metadata" layer. */
export interface ProvenanceRow {
  fp: string; // sha256 hex of the content
  op: string; // ingest|index|query|embed|enrich|harvest|transfer|export|...
  subject: string; // artifact id (entity path, chunk id, query hash, …)
  kind: string; // entity|embedding|chunk|query|edge|document|…
  ts: number;
  parent_fp: string; // prior fingerprint in the lineage ("" if root)
  meta: string; // small JSON sidecar
  signature: string; // HMAC over fp|op|subject|kind|ts|parent_fp
}

export interface ApiKeyEncRow {
  service: string;
  ciphertext: string; // base64
  nonce: string; // base64
  kdf_salt: string; // base64
  kdf_iters: number;
  created_ts: number;
  rotated_ts: number; // -1 ⇒ null
}

/** Default embedding dimension. The embeddings table's vector column type is
 *  fixed at table-creation time; changing the embed model to a different dim
 *  requires recreating the table. 768 matches nomic-embed-text / many local
 *  models; override via `initLanceBackend({ embeddingDim })`. */
export const DEFAULT_EMBEDDING_DIM = 768;

/** Typed sentinel rows used to fix each table's inferred schema. */
export function seedRows(embeddingDim: number): Record<TableName, Record<string, unknown>[]> {
  return {
    [TABLES.entities]: [{
      id: SEED_ID, type: "", primary_type: "", frontmatter: "{}", body_md: "",
      body_hash: "", mtime: 0, ctime: 0, lat: 0, lon: 0, geo_acc_m: 0,
    }],
    [TABLES.edges]: [{
      from_id: SEED_ID, to_id: "", edge_type: "", directed: 0, weight: 0,
      source: "", inferred_conf: 0, ts: 0,
    }],
    [TABLES.tags]: [{ entity_id: SEED_ID, tag: "" }],
    [TABLES.touches]: [{
      id: SEED_ID, contact_id: "", date: "", channel: "", playbook: "",
      outcome_tags: "", attendees: "", source: "", author_id: "",
    }],
    [TABLES.addenda]: [{
      id: SEED_ID, target_id: "", date: "", kind: "", author_id: "",
      body_md: "", signature: "",
    }],
    [TABLES.embeddings]: [{
      entity_id: SEED_ID, model: "", dim: embeddingDim,
      vector: new Array(embeddingDim).fill(0), hash: "",
    }],
    [TABLES.auditLog]: [{
      ts: 0, op: SEED_ID, entity_id: "", agent_id: "", integration: "",
      before_hash: "", after_hash: "", details: "null", signature: "",
    }],
    [TABLES.apiKeysEnc]: [{
      service: SEED_ID, ciphertext: "", nonce: "", kdf_salt: "",
      kdf_iters: 0, created_ts: 0, rotated_ts: -1,
    }],
    [TABLES.syncState]: [{
      integration: SEED_ID, resource: "", cursor: "",
      last_pull_ts: 0, last_push_ts: 0,
    }],
    [TABLES.provenance]: [{
      fp: SEED_ID, op: "", subject: "", kind: "", ts: 0,
      parent_fp: "", meta: "null", signature: "",
    }],
  };
}

/** Per-table predicate that deletes the sentinel seed row. audit_log keys on
 *  `op` (no id column); everything else keys on its natural id column. */
export function seedDeletePredicate(table: TableName): string {
  switch (table) {
    case TABLES.entities:
    case TABLES.touches:
    case TABLES.addenda:
      return `id = '${SEED_ID}'`;
    case TABLES.edges:
    case TABLES.tags:
    case TABLES.embeddings:
      return `${table === TABLES.embeddings ? "entity_id" : table === TABLES.tags ? "entity_id" : "from_id"} = '${SEED_ID}'`;
    case TABLES.auditLog:
      return `op = '${SEED_ID}'`;
    case TABLES.apiKeysEnc:
      return `service = '${SEED_ID}'`;
    case TABLES.syncState:
      return `integration = '${SEED_ID}'`;
    case TABLES.provenance:
      return `fp = '${SEED_ID}'`;
  }
}
