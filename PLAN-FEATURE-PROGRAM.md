# sauce-crm Feature Program (post-LanceDB migration)

**Decisions (operator, 2026-05-23):** enrichment = 3-stage classify→tag→graph,
writes vault frontmatter **and** LanceDB, per-stage toggles · fingerprint/crypto
= SHA-256 + HMAC-signed provenance in LanceDB + AuditLog trace (no extra
encryption-at-rest) · doc harvest = txt/md/pdf/docx → LanceDB chunks (autoinstall
parsers), not vault notes · execution = **direct TDD** (not orc swarm).

Built on the LanceDB single-backend (`src/backend/lance/`). Source of truth is
still the vault markdown; LanceDB holds derived/index/provenance state.

## Tasks + dependency waves

| ID | Task | Depends on |
|----|------|-----------|
| **T1** | Settings spine: typed model + reusable on/off (left↔right) toggle component for every new switch | — |
| **T2** | **Fingerprint + provenance + crypto trace layer** — SHA-256 content fingerprints; LanceDB `provenance` table (backend metadata, not frontmatter); HMAC-sign via KeyVault; append to HMAC-chained AuditLog; lineage walk; `trace(op, subject, content, parentFp)` API for all data movement | — |
| **T3** | Embedding-endpoint config parity + RAG on/off — per-provider `{endpoint, embedModel, enabled}` for LM Studio / OpenAI / Ollama; `CopilotRuntime.embed` uses the configured embed provider (decoupled from chat provider) | T1 |
| **T4** | Realtime-embeddings toggle + service — gates whether MirrorSync embeds on every change vs manual rebuild; auto-start | T1, T3 |
| **T5** | Auto-enrichment service — 3 stages (classify / tag / graph edges), per-stage toggle + master toggle + autostart; writes vault frontmatter + LanceDB; every op fingerprinted via T2 | T1, T2 |
| **T6** | Prompt + session management — global system prompt + per-session prompt override; session **autonaming** toggle (on/off) | T1 |
| **T7** | Context filesystem + document upload/harvest — accept txt/md/pdf/docx; extract→chunk→embed into LanceDB; each chunk fingerprinted (T2); surfaced as RAG context | T1, T2, T3 |
| **T8** | App-wide state tracking — thread T2.trace() through every ingest/index/query/embed/enrich/harvest/transfer site | T2 + all |

**Waves:** W1 = T1 + T2 · W2 = T3 · W3 = T4 + T6 · W4 = T5 + T7 · W5 = T8.

## Gate per task
`tsc` 0 errors · `npm test` green (141 baseline + new) · production build OK ·
fingerprint/trace ops covered by tests against real LanceDB.

---

## STATUS
- ✅ **T1 DONE** (2026-05-23) — `src/settings/FeatureSettings.ts` owns the typed settings spine and conservative defaults; `src/ui/components/v2/ToggleRow.ts` is the reusable left-label/right-toggle primitive used by new switches.
- ✅ **T2 DONE** (2026-05-23) — `provenance` LanceDB table; `src/services/Provenance.ts` (`ProvenanceService`: fingerprint/record/verify/lineage/bySubject) + `src/backend/lance/LanceProvenanceStore.ts`; SHA-256 fingerprints, HMAC-signed via KeyVault master key (bootstrap-key fallback pre-unlock), mirrored to AuditLog. Exposed on `V2Runtime.provenance` + `plugin.provenance`. `MirrorSync` now fingerprints every entity index + embedding (embedding links to entity via `parentFp` lineage). 6 tests, real LanceDB. `tsc` 0 · tests green · build OK.
- ✅ **T3 DONE** (2026-05-23) — RAG master toggle plus LM Studio / Ollama / OpenAI embedding provider config; `CopilotRuntime.embed` uses the selected embedding provider independently of the chat provider.
- ✅ **T4 DONE** (2026-05-23) — realtime embedding toggle now gates vault-event embeddings; manual "Rebuild LanceDB Index" still embeds by default.
- ⬜ T5 enrichment · ⬜ T6 prompts/session · ⬜ T7 doc harvest · ⬜ T8 remaining trace sites.
