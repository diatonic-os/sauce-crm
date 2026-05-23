# SH-F — Tasks API Auto-Enumeration

**Deps:** SH-B1-tasks · **Owner:** orchestrator · **Status:** `DONE` (CLI enabled 2026-05-23; A-006 PASS; 455 tests green)
**Goal:** runtime introspect → schemas/obsidian-tasks.json → sdk/generated/tasks.ts → CI gate.

| Task | Out | Acc | Status |
|------|-----|-----|--------|
| T-F-01 | `sdk/generator/introspect-tasks.ts` | runs via `obsidian eval` against live vault; dumps apiV1 shapes + filter/sort/group/display; writes `schemas/obsidian-tasks.json` sorted-deterministic | **DONE** |
| T-F-02 | `sdk/generated/tasks.ts` | typed wrappers + Filter/Sort/Group/Display unions from schema; sdk:check passes clean | **DONE** |
| T-F-03 | `.github/workflows/ci.yml` | adds `npm run sdk:check` step; fails PR on stale tasks.ts | **DONE** |

**Notes:** A-006 confirmed (apiV1 = exactly createTaskLineModal/editTaskLineModal/executeToggleTaskDoneCommand) — schema locked, no STOP-104 drift. Design: live `introspect()` writes `schemas/obsidian-tasks.json` (committed source); pure `emitTasksModule(schema)` codegen wired into `sdk:gen` (generate.ts) so `sdk:check` regenerates+diffs `tasks.ts` (G-006). **Scope note:** T-F-02 touched `sdk/generator/generate.ts` (2-line emitter wire-in) beyond its literal `out` — necessary so the sdk:check gate actually catches `tasks.ts` staleness; documented here per output-discipline transparency. Parity test asserts committed `tasks.ts` === `emitTasksModule(schema)`.
