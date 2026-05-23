# CON-OBS-INTEG-001 — Acceptance Matrix

**Date:** 2026-05-23 · **Branch:** `feat/con-obs-integ-001-foundation` (+ `feat/con-obs-integ-001-sh-h` for SH-H)
**Result:** ✅ all shards DONE · **501 tests passing** · typecheck + sdk:check green · lint green for all contract code (see gate note)

## Gate status

| Gate | Result | Note |
|------|--------|------|
| `npm run typecheck` | ✅ GREEN | 0 errors |
| `npm run test` | ✅ GREEN | **501 tests** (baseline 355 → +146) |
| `npm run sdk:check` | ✅ GREEN | generated SDK (incl. `tasks.ts`) up to date |
| `npm run lint` | ⚠️ 1 error — **not contract code** | the only error is in `src/ui/MobileStyles.ts`, an **untracked operator WIP file** (not part of any CON-OBS-INTEG-001 task). Every contract file passes `eslint` individually. Left untouched per "don't modify files you didn't create." Clears when the operator commits/fixes that file (`npx eslint --fix src/ui/MobileStyles.ts`). |

## Shard acceptance

| Shard | Tasks | Acc | Status |
|-------|-------|-----|--------|
| Phase 0 | validate | A-001..A-007 resolved (3 FALSE, A-004 TRUE, A-005/A-006 PASS post-CLI, A-007 PASS); 11 skeletons; dev branch | ✅ |
| SH-A | T-A-01..05 | IObsidianPluginIntegration + ObsidianPluginRegistry + PluginStateMachine + Community/Core pages + 3-tab IntegrationsSection | ✅ |
| SH-B | T-B1..B6-01 | 6 adapters (Tasks/Dataview/Kanban/MetaBind/QuickAdd/BRAT) over PluginConfigService; facades never leak raw handles (G-010) | ✅ |
| SH-C | T-C1..C4-01 | 4 core wrappers (Files/Search/Content/Meta); canon-aware (G-003); privacy-gated web (G-008-adjacent) | ✅ |
| SH-D | T-D-01..04 | CanonService + CanonReadOnlyExtension (G-005) + CanonViewRenderer (G-001) + MutationContract (R-007 chain, G-004 redactor, ev-`ulid`) | ✅ |
| SH-E | T-E-01..04 | 14-entity reconciliation (7 new predicate schemas, no Zod) + LanceDB graph tables (DEC-004) + GraphService BFS + LinkResolver | ✅ |
| SH-F | T-F-01..03 | tasks introspector (`obsidian eval`) → schema → codegen `tasks.ts` → CI `sdk:check` gate (G-006) | ✅ |
| SH-G | T-G-01..03 | frozen `svcV1` 0.3.0 (DEC-012, G-010) + EventBus + DownstreamRegistry + docs/services-api.md (R-004) | ✅ |
| SH-H | T-H-01..07 | FUNDING/SPONSORS/CONTRIBUTING/CoC/branching/release-beta/issue+PR templates/README sponsors (G-008) | ✅ (branch `feat/con-obs-integ-001-sh-h`) |
| SH-I | T-I-01/02 | community-plugins-entry.json synced + PR-BODY.md — **authored only, external PR deferred (BLOCKER-3)** | ✅ |
| SH-V | T-V-01/02 | this matrix + FINAL.md; manifest 0.2.0→0.3.0 | ✅ |

## Guardrail verification

| Guard | Where enforced + tested |
|-------|-------------------------|
| G-001 (tokenized CSS) | settings pages, CanonViewRenderer, IntegrationsSection — tests assert no `[style]` attrs |
| G-002 (settings quintuple) | no new free settings controls added; buttons are state-machine actions, not persisted controls |
| G-003 (no Vault.modify on canonized) | FilesService.updateViaContract + MetaService.setProperty route through CanonGuard — tested |
| G-004 (redactor) | MutationContract.defaultRedactor scrubs secrets before ledger write — tested |
| G-005 (canon read-only editor) | CanonReadOnlyExtension blocks paste/drop/keydown + toast — tested |
| G-006 (sdk:check gates tasks.ts) | CI step added; parity test asserts committed === generated |
| G-007 (branch protection) | documented in docs/branching.md |
| G-008 (no in-UI donation prompts) | sponsor info only in README/SPONSORS.md; BRAT opt-in gated |
| G-009 (no secrets) | redactor + no secrets in any tracked file |
| G-010 (no raw handles in svcV1) | svcV1 facades return plain data; test asserts no `.app`/`.vault` |

## DEC amendments (operator-approved, see plan/obs-integ/00-validate.md)

- **A-001/A-002/A-003 FALSE** → ObsidianPluginRegistry is a new Map registry; IntegrationsSection uses TS sections; **React dropped** (no React layer) — R-005/DEC-011 amended.
- **T-E-01 no Zod** → predicate `EntitySchema<T>` style (CONFLICT-2, match codebase).
- **CONFLICT-3** → 7 of 14 entities pre-existed; mapped not duplicated.
- **BLOCKER-3** → external marketplace PR authored but not opened.
- **Lint housekeeping** → operator-approved tree-wide `prettier --write` on dev (commit `06ce82a`).
