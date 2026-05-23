# SH-B — Community Plugin Adapters

**Deps:** SH-A · **Owner:** TBD · **Status:** `TODO`
**Goal:** 6 adapters, full parallel. Each implements IObsidianPluginIntegration; facades wrap (never leak — R-003/G-010) the underlying plugin API.
**Children:** SH-B1..B6. SH-B1 merging releases SH-F.

| Task | Shard | Out | Acc | Status |
|------|-------|-----|-----|--------|
| T-B1-01 | SH-B1-tasks | `src/integrations/obsidian/TasksAdapter.ts` | facade wraps apiV1 + Quick-Reference; optimize patches data.json deterministically | TODO |
| T-B2-01 | SH-B2-dataview | `src/integrations/obsidian/DataviewAdapter.ts` | wraps dv.api.pages/pagePaths/query; optimize enables dataviewjs + sauce resolvers | TODO |
| T-B3-01 | SH-B3-kanban | `src/integrations/obsidian/KanbanAdapter.ts` | enumerates boards; projects pl-<ulid> nodes + bidirectional edges | TODO |
| T-B4-01 | SH-B4-metabind | `src/integrations/obsidian/MetaBindAdapter.ts` | registers sauce:* bind targets; read-only entity form binds | TODO |
| T-B5-01 | SH-B5-quickadd | `src/integrations/obsidian/QuickAddAdapter.ts` | wraps quickadd.api; optimize patches data.json w/ 4 sauce choices; idempotent | TODO |
| T-B6-01 | SH-B6-brat | `src/integrations/obsidian/BratAdapter.ts` | exposes registerBetaRepo; optimize gated by saucecrm.beta.enabled | TODO |

**Notes:** detect()/optimize() live-vault behavior re-verify after A-005/A-006 CLI unblocks. Tested via vitest mocks meanwhile.
