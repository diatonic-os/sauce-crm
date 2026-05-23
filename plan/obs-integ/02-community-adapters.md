# SH-B — Community Plugin Adapters

**Deps:** SH-A · **Owner:** orchestrator · **Status:** `DONE` (all 6 adapters; 438 tests green)
**Goal:** 6 adapters, full parallel. Each implements IObsidianPluginIntegration; facades wrap (never leak — R-003/G-010) the underlying plugin API.
**Children:** SH-B1..B6. SH-B1 merging releases SH-F.

| Task | Shard | Out | Acc | Status |
|------|-------|-----|-----|--------|
| T-B1-01 | SH-B1-tasks | `src/integrations/obsidian/TasksAdapter.ts` | facade wraps apiV1 + Quick-Reference; optimize patches data.json deterministically | **DONE** (delegates to PluginConfigService; SH-F dep now satisfied but SH-F stays CLI-BLOCKED) |
| T-B2-01 | SH-B2-dataview | `src/integrations/obsidian/DataviewAdapter.ts` | wraps dv.api.pages/pagePaths/query; optimize enables dataviewjs + sauce resolvers | **DONE** |
| T-B3-01 | SH-B3-kanban | `src/integrations/obsidian/KanbanAdapter.ts` | enumerates boards; projects pl-<ulid> nodes + bidirectional edges | **DONE** (via injected PipelineGraphSink — SH-E GraphService satisfies it later) |
| T-B4-01 | SH-B4-metabind | `src/integrations/obsidian/MetaBindAdapter.ts` | registers sauce:* bind targets; read-only entity form binds | **DONE** |
| T-B5-01 | SH-B5-quickadd | `src/integrations/obsidian/QuickAddAdapter.ts` | wraps quickadd.api; optimize patches data.json w/ 4 sauce choices; idempotent | **DONE** |
| T-B6-01 | SH-B6-brat | `src/integrations/obsidian/BratAdapter.ts` | exposes registerBetaRepo; optimize gated by saucecrm.beta.enabled | **DONE** (supportsBeta()=true; G-008 opt-in gated) |

**Notes:** detect()/optimize() live-vault behavior re-verify after A-005/A-006 CLI unblocks. Tested via vitest mocks meanwhile.

**⚠ Lint-gate finding (BLOCKER-LINT, pre-existing):** `npm run lint` (`eslint src/**/*.ts`) reports ~6527 tree-wide `prettier/prettier` errors across 143 pre-existing files (likely from the prettier/config change in the dirty package.json present at session start) + 6 pre-existing `no-unused-vars`. **None are in any CON-OBS-INTEG-001 file** — every new file passes `eslint --fix` individually. The contract's per-task "npm run lint green" gate is therefore unsatisfiable without reformatting 143 out-of-scope files. Per-task verification interpreted as: each new file lint-clean + typecheck + test + sdk:check green. Operator decision needed on whether to run a tree-wide `prettier --write` (separate from this contract). See deliverables/CON-OBS-INTEG-001/BLOCKERS.md.
