# SH-E — Relationship Graph

**Deps:** SH-A · **Owner:** orchestrator · **Status:** `DONE` (4 tasks; 489 tests green) — completes Phase 2 (B/C/D/E)
**Goal:** reconcile DEC-003's 14 entities onto the existing schema union + LanceDB graph DDL + GraphService.

| Task | Out | Acc | Status |
|------|-----|-----|--------|
| T-E-01 | 7 new `src/domain/schemas/*.ts` + index re-export | predicate `EntitySchema<T>`, NO Zod; 14 reconciled (7 existing mapped + 7 new) | **DONE** |
| T-E-02 | `src/backend/lance/graph.ts` | dedicated graph_nodes + graph_edges tables (separate from existing entities/edges); `<typePrefix>-<ulid>` id; bidirectional edges materialized (DEC-004) | **DONE** |
| T-E-03 | `src/services/GraphService.ts` | node()/neighbors()/traverse()/query()/subgraph() in-memory index-backed BFS; satisfies PipelineGraphSink; hydrate/persist bridge | **DONE** |
| T-E-04 | `src/services/LinkResolver.ts` | resolves frontmatter linkedIds → entity refs; warns+logs broken edges; never throws (incl. throwing resolver) | **DONE** |

**Notes:** CONFLICT-3 honored — idea/task/ledger-entry already existed; mapped not duplicated (T-E-01 added the 7 genuine new entities). T-E-02 adds **dedicated** graph_nodes/graph_edges tables (the existing LanceSchema entities/edges mirror is untouched — no STOP-105 trigger; PLAN-LANCEDB-MIGRATION DDL stable). GraphService is an in-memory index (sync) satisfying the sync `PipelineGraphSink` seam from KanbanAdapter (compile-time proof); async hydrate()/persist() bridge to LanceGraphStore — resolves the sync/async mismatch cleanly. `ulid()` reused from MutationContract for node ids. **Output-discipline note:** SH-E has landed; future entity-write ledger may move to a graph-adjacent lance table — for now the append-only `deliverables/CON-OBS-INTEG-001/ledger.jsonl` remains the orchestration ledger.
