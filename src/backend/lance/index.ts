// LanceDB single-backend facade. `initLanceBackend` opens the connection,
// ensures every table exists with a stable schema, and bundles the repository
// objects the rest of the plugin consumes. All persistence — secrets, audit,
// entity mirror, vectors, FTS, checkpoints — flows through here.

import {
  openLance,
  ensureTable,
  type LanceConnection,
} from "./LanceConnection";
import { TABLES, DEFAULT_EMBEDDING_DIM } from "./LanceSchema";
import { LanceSecretStore } from "./LanceSecretStore";
import { LanceAuditStore } from "./LanceAuditStore";
import { LanceEntityMirror, type MirrorTables } from "./LanceEntityMirror";
import { LanceVectorIndex } from "./LanceVectorIndex";
import { LanceFtsIndex } from "./LanceFtsIndex";
import { LanceCheckpoints } from "./LanceCheckpoints";
import { LanceProvenanceStore } from "./LanceProvenanceStore";
import { LanceDocChunkStore } from "./LanceDocChunkStore";

export * from "./LanceSchema";
export * from "./LanceConnection";
export { LanceSecretStore } from "./LanceSecretStore";
export { LanceAuditStore } from "./LanceAuditStore";
export {
  LanceEntityMirror,
  type MirrorFile,
  type MirrorTables,
  type MirrorFtsHook,
} from "./LanceEntityMirror";
export { LanceVectorIndex, type VectorHit } from "./LanceVectorIndex";
export { LanceFtsIndex, type FtsHit } from "./LanceFtsIndex";
export { LanceCheckpoints, type CheckpointInfo } from "./LanceCheckpoints";
export { LanceProvenanceStore } from "./LanceProvenanceStore";
export { LanceDocChunkStore, type ChunkHit } from "./LanceDocChunkStore";

export interface InitLanceOpts {
  /** ABSOLUTE filesystem path for the Lance store. Native connect() resolves
   *  relative paths against process.cwd() (not the vault), so callers MUST pass
   *  an absolute dir. */
  dataDir: string;
  embeddingDim?: number;
  /** Absolute plugin dir, used to resolve the native module from the plugin's
   *  own node_modules when the host require() can't (Obsidian renderer). */
  requireBase?: string;
}

export interface LanceBackend {
  db: LanceConnection;
  embeddingDim: number;
  secrets: LanceSecretStore;
  audit: LanceAuditStore;
  mirror: LanceEntityMirror;
  vectors: LanceVectorIndex;
  fts: LanceFtsIndex;
  checkpoints: LanceCheckpoints;
  /** Append-only provenance store. Wrap in a ProvenanceService (crypto +
   *  master key) in v2-init for the full fingerprint/sign/trace API. */
  provenanceStore: LanceProvenanceStore;
  /** Harvested document chunks (vector-indexed) for RAG document context. */
  docChunks: LanceDocChunkStore;
  close(): Promise<void>;
}

export async function initLanceBackend(
  opts: InitLanceOpts,
): Promise<LanceBackend> {
  const embeddingDim = opts.embeddingDim ?? DEFAULT_EMBEDDING_DIM;
  const db = await openLance(opts.dataDir, opts.requireBase);

  const [
    entities,
    edges,
    tags,
    touches,
    embeddings,
    auditLog,
    apiKeysEnc,
    provenance,
  ] = await Promise.all([
    ensureTable(db, TABLES.entities, embeddingDim),
    ensureTable(db, TABLES.edges, embeddingDim),
    ensureTable(db, TABLES.tags, embeddingDim),
    ensureTable(db, TABLES.touches, embeddingDim),
    ensureTable(db, TABLES.embeddings, embeddingDim),
    ensureTable(db, TABLES.auditLog, embeddingDim),
    ensureTable(db, TABLES.apiKeysEnc, embeddingDim),
    ensureTable(db, TABLES.provenance, embeddingDim),
  ]);
  await ensureTable(db, TABLES.syncState, embeddingDim);
  const docChunks = await ensureTable(db, TABLES.docChunks, embeddingDim);

  const fts = new LanceFtsIndex(entities);
  const mirrorTables: MirrorTables = {
    entities,
    edges,
    tags,
    touches,
    embeddings,
  };

  return {
    db,
    embeddingDim,
    secrets: new LanceSecretStore(apiKeysEnc),
    audit: new LanceAuditStore(auditLog),
    mirror: new LanceEntityMirror(mirrorTables, fts),
    vectors: new LanceVectorIndex(embeddings, embeddingDim),
    fts,
    checkpoints: new LanceCheckpoints(db),
    provenanceStore: new LanceProvenanceStore(provenance),
    docChunks: new LanceDocChunkStore(docChunks, embeddingDim),
    async close() {
      // Release the native connection handle (prevents Rust-side handle leaks).
      if (db.isOpen()) db.close();
    },
  };
}
