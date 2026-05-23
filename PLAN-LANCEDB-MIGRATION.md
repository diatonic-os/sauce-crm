# LanceDB Single-Backend Migration

**Decision (operator, 2026-05-23):** Full single-backend on **LanceDB 0.29.0** +
**require-install** (no SQL fallback path). LanceDB uses its own **Lance columnar
core** (Arrow/Rust) — *not* sqlite3. SQLite (`better-sqlite3` / `sql.js` /
`sqlite-vec`) is removed entirely.

## Why this is low-risk
- Vault markdown `.md` files are the **source of truth**; the DB is a derived
  mirror/index. Re-deriving from the vault is always possible.
- `SqliteSync` / `Seeder` / `applyMigrations` were **never wired into `main.ts`**
  (only the dead manual script `test/v2-verify.ts`). The live SQL consumers are
  only `KeyVault` (via `ISecretStore`) and `AuditLog`.
- `@lancedb/lancedb` is added as a **devDependency** so the test suite runs
  against a real LanceDB in Node; production still loads it via the existing
  autoinstall (`LanceDBInstaller`) into the plugin dir as an esbuild external.

## LanceDB primitive → SQLite feature map
| SQLite feature        | LanceDB 0.29.0 primitive                                   |
|-----------------------|------------------------------------------------------------|
| relational tables     | Lance tables (`createTable` / `openTable`)                 |
| `INSERT … ON CONFLICT`| `mergeInsert(key).whenMatchedUpdateAll().whenNotMatchedInsertAll()` |
| `WHERE` / `SELECT`    | `query().where(sql).select([…])` (DataFusion)              |
| `DELETE … WHERE`      | `delete(predicate)`                                        |
| vector search (vss)   | `search(vec).limit(k)` → `_distance`                       |
| FTS5                  | `createIndex(col, {config: Index.fts()})` + `MatchQuery`   |
| WAL + checkpoint      | per-commit versions + `tags.create(name, version)`         |
| rollback              | `checkout(version)` → `restore()`                          |
| BLOB (bytes)          | base64 `string` column (avoids Arrow binary friction)      |

## New module: `src/backend/lance/`
1. `LanceConnection.ts` — `openLance(dataDir)`, `ensureTable(db, name, sample)`.
2. `LanceSchema.ts` — table names + canonical row shapes + sample rows.
3. `LanceSecretStore.ts` — `implements ISecretStore` on `api_keys_enc` (bytes→b64).
4. `LanceAuditStore.ts` — append-only `audit_log`; `append/all/lastSignature`.
5. `LanceEntityMirror.ts` — replaces `SqliteSync`: create/modify/delete/rename + queries.
6. `LanceVectorIndex.ts` — `embeddings` table: store/query/upsert/delete (replaces dead `services/VectorDB.ts`).
7. `LanceFtsIndex.ts` — full-text index over entities.
8. `LanceCheckpoints.ts` — `checkpoint/list/restore` via tags + checkout.
9. `index.ts` — `initLanceBackend(dataDir)` facade bundling the repositories.

## Refactors
- `security/AuditLog.ts` — depend on new `IAuditStore`, not `ISqliteBackend`. HMAC chain unchanged.
- `security/KeyVault.ts` — drop `SqliteSecretStore`; keep `JsonSecretStore` only for tests/dev harnesses and runtime storage on `LanceSecretStore`.
- `v2-init.ts` — require LanceDB: detect → `initLanceBackend` → wire KeyVault(Lance)+AuditLog(Lance)+vector/fts. Unavailable ⇒ degraded/awaiting-install (backend null), install modal gates.
- `main.ts` — wire `LanceEntityMirror` to vault create/modify/delete/rename (best-effort, gated on backend).
- `copilot/CopilotHostAdapters.ts` + `CopilotRuntime.ts` — add semantic path via `LanceVectorIndex` + active embedding provider; fuzzy stays as lexical fallback.

## Deletions
- `backend/{ISqliteBackend,BetterSqliteBackend,SqlJsBackend,FileOnlyBackend,SqliteSync,Migrations,Seeder}.ts`
- `services/VectorDB.ts` (dead, old `vectordb` API)
- `test/v2-verify.{ts,cjs}` (generated SQLite/FileOnly verifier; replaced by focused Vitest suites)
- esbuild externals `better-sqlite3`, `sql.js` (keep `@lancedb/lancedb`)
- replace `test/v2-verify.ts` with focused Vitest Lance integration suites under `test/backend/`

## Tests (TDD, `@vitest-environment node`, temp dirs)
SecretStore round-trip · AuditStore + chain · VectorIndex nearest/upsert/delete ·
EntityMirror CRUD+rename · Checkpoints time-travel · FTS index+search.
Gate: `npm run typecheck` 0 errors, `npm test` all green (115 existing + new).

---

## STATUS — storage migration COMPLETE (2026-05-23)
- ✅ `src/backend/lance/` shipped: SecretStore, AuditStore, EntityMirror, VectorIndex, FtsIndex, Checkpoints, facade `initLanceBackend`.
- ✅ SQLite layer deleted (−829 lines); `services/VectorDB.ts` (dead) deleted; esbuild externals dropped `better-sqlite3`/`sql.js`.
- ✅ `AuditLog` → `IAuditStore`; `KeyVault` → `LanceSecretStore`; `v2-init` require-install (lazy require, gated init, install modal already wired).
- ✅ `tsc` 0 errors · real LanceDB 0.29.0 Vitest suites pass · production build OK · bundle uses deferred `require("@lancedb/lancedb")` (no top-level crash pre-install).

### Operational gotchas
- **Embeddings vector dim is fixed at table creation** (`DEFAULT_EMBEDDING_DIM = 768`). Changing embed model dim ⇒ recreate the `embeddings` table. Override via `initLanceBackend({ embeddingDim })` / `settings.lancedb.embeddingDim`.
- **Cross-handle staleness:** a `restore()` committed via one Table handle is invisible to others until `checkoutLatest()`. `LanceEntityMirror` refreshes before reads; any new consumer of shared handles must do the same after a checkpoint restore.
- Byte fields (ciphertext/nonce/salt) are base64 strings, not Arrow binary.

### Live data-flow wiring — DONE (2026-05-23)
1. ✅ `src/services/MirrorSync.ts` builds a `MirrorFile` from each `TFile` (type gate, tags, wikilink-resolved edges) and drives `LanceEntityMirror` + `LanceVectorIndex`. Wired in `main.ts` to `metadataCache.on("changed")` (create/modify) + `vault.on("delete"|"rename")`, gated on `v2.lance`. Embeddings are best-effort (skip on no-model / dim-mismatch). New command **"Rebuild LanceDB Index (full resync + embed)"**.
2. ✅ `ObsidianRagHost.semantic` now uses `LanceVectorIndex` + an `embedFn` (→ `CopilotRuntime.embed` → active provider's `/embeddings`; Anthropic returns null). Falls back to fuzzy on any gap (no index/model, dim mismatch, empty index). `CopilotRuntime` gained an optional `embedModel` setting + `ragVectorIndex` ctor arg.

Gate after wiring: `tsc` 0 errors · **155 tests pass** (single-fork Vitest because LanceDB native teardown can assert under worker concurrency) · build OK · deferred require intact.

### Still optional / future
- Surface `embedModel` in the settings UI (currently config-only).
- Auto full-resync on first LanceDB install (today it's a manual command to avoid surprise embed load).
