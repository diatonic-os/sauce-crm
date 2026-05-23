# SH-E — Relationship Graph

**Deps:** SH-A · **Owner:** TBD · **Status:** `TODO`
**Goal:** reconcile DEC-003's 14 entities onto the existing schema union + LanceDB graph DDL + GraphService.

| Task | Out | Acc | Status |
|------|-----|-----|--------|
| T-E-01 | `src/domain/schemas/{ideas,playbooks,templates,vaults,pipelines,observations,notes,ledger,events}.ts` + index re-export | schema + TS types per entity; index re-exports all 14 — **predicate `EntitySchema<T>` style, NO Zod (CONFLICT-2 resolved "match codebase")** | TODO |
| T-E-02 | `src/backend/lance/graph.ts` | nodes + edges tables conforming to PLAN-LANCEDB-MIGRATION conventions; `<typePrefix>-<ulid>` id; bidirectional edges materialized (DEC-004) | TODO |
| T-E-03 | `src/services/GraphService.ts` | node()/edge()/traverse()/query()/subgraph() index-backed BFS; benched vs 10k-node fixture | TODO |
| T-E-04 | `src/services/LinkResolver.ts` | resolves frontmatter linkedIds → entity refs; warns+logs broken edges; never throws | TODO |

**Notes:** CONFLICT-3 — existing `EntityType` already has idea/task/ledger-entry under different shapes; map DEC-003 onto the union, don't blind-add. Coordinate `edges` vs existing `LanceProvenanceStore` lineage. STOP-105 on DDL drift.
