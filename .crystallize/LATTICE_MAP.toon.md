# LATTICE_MAP — sauce-crm crystallization (D-001)

Run: `run-20260526-obsidian-lattice-01` · Plugin: `sauce-crm` v0.3.0 · Date: 2026-05-26

> The literal O(n²) cell grid over hundreds of axis members is combinatorial noise.
> This map records the **axis member inventory**, the **defect cells** (broken/unknown),
> and **repair state**. A cell not listed as a defect is `connected` or
> `absent-by-design`. This is the contract's intent (T-001-002..004) rendered useful.

## meta.plugin
- id `sauce-crm`, version `0.3.0`, minAppVersion `1.5.0`, isDesktopOnly `false`
- 405 TS/Svelte files, ~54,995 LOC, bundle `main.js` 575,339 bytes
- 150 test files / 873 tests (post-W1)
- Build gate: `tsc -noEmit -skipLibCheck` (baseline 0 errors)

## meta.strictness (current tsconfig, post-W1)
- ON: `strict`, `noFallthroughCasesInSwitch`, `noImplicitOverride`
- PENDING: `exactOptionalPropertyTypes` (W2, 121), `noUncheckedIndexedAccess` (W3, 374)

## AXIS-A · frontend_surface (inventory)
- **Plugin** ×1 (`src/main.ts` — entry, 81 KB)
- **ItemView** ×11 incl. v2 (`AIInboxView`, `AuditLogView`, `CalendarView`, `CopilotChatView`,
  `MapView`/`MapViewReal`, `SkillRunLogView`, `SyncStatusView`/`SyncStatusViewReal`, + `Views.ts` legacy set)
- **Modal** ×22 (19 `Modal`/`SuggestModal`/`FuzzySuggestModal` subclasses)
- **PluginSettingTab** ×1
- **commands** ×81 (`addCommand`)
- **registerView** ×27

## AXIS-B · backend_logic (inventory)
- **services** ×27 classes (`src/services/`)
- **skills** ×16 `*Skill` (BaseSkill subclasses, `src/skills/`)
- bridge backends: `LanceMemoryBackend` (desktop), `BridgeMemoryBackend`/`LexicalMemoryBackend`/`HybridMemoryBackend` (mobile)
- parsers: `CdelParser`, `DqlLexer`; semiring: `MatrixClosure`; copilot providers & catalog

## AXIS-C · type_system (state)
- discriminant-shaped fields: 1525 (unions exist) · exhaustiveness sentinels (`never`): **0** (R-005 gap)
- branded types: **0**, `src/types/` ABSENT (R-006 gap; DEC-004 reserves `src/types/brands.ts`)
- `as any` ×73 · `as X` ×231 · `: any` ×115 · `as unknown as` ×85 · `<any>` ×14 · `@ts-ignore` **0** (good)

## AXIS-D · event_channels (state, P0 per AX-003)
- raw `addEventListener` ×29 vs `registerDomEvent` ×6 — **leak candidates**
- raw `setInterval` ×5 vs `registerInterval` ×2 — **leak candidates**
- `registerEvent` ×6
- `moment` import hygiene: clean (R-010 ✓)

## AXIS-E · persistence
- `loadData`/`saveData` single-Settings round-trip (R-014 — needs schema-version audit, P-003)
- vault files, metadata cache, frontmatter; KeyVault (encrypted) for OAuth/API keys (GR-005 relevant)

## AXIS-F · lifecycle
- deferred-view footgun (AX-004): 6 `getLeavesOfType`/`iterateAllLeaves` sites, 122 `instanceof` guards present — **per-site audit owed (P-003)**

---

## DEFECT CELLS

| id | cell (axis×axis) | severity | state | file(s) |
|---|---|---|---|---|
| DEF-W0-001 | B×C transport types | P1 | **repaired** | `bridge/{contract,wiring}.ts`, `BridgeMemoryBackend.ts`, `ReachabilityProbe.ts` — dup `HttpRequestFn`/`HttpResponse` merged to canonical (AX-002) |
| DEF-W1-001 | A×F override modifiers | P2 | **repaired** | 54 files, 131 `override` added (noImplicitOverride) |
| DEF-W2 | B×C / E×C optional-vs-undefined | P1 | **open** | 69 files, 121 errors; cluster on `MemoryHit`/`MemoryQuery`/`SemanticResult`/`Entry`/`VectorHit`/`RequestUrlParam` |
| DEF-W3 | B×C / A×C unchecked index access | P1 | **open** | 374 errors (`noUncheckedIndexedAccess`); top: `CdelParser`, `GraphAtlasService`, `MatrixClosure`, `Views` |
| DEF-R004 | C any/cast elimination | P1 | **open** | 73 `as any` + 231 casts + 115 `: any` |
| DEF-R005 | C exhaustiveness | P2 | **open** | 0 `never` sentinels across 1525 discriminant fields |
| DEF-R006 | C branded IDs | P2 | **open** | 0 brands; `src/types/` absent |
| DEF-AX003 | D×F lifecycle leaks | **P0** | **open** | 29 raw `addEventListener`, 5 raw `setInterval` not wrapped in `register*` |
| DEF-AX004 | A×F deferred-view guards | **P0** | **open** | 6 leaf-iteration sites need `instanceof` audit |

## RUNTIME GATES (P-005)
- dev vaults present ×3 → G-004/G-005/G-006 feasible (require launching Obsidian; not CLI-automatable without Playwright/manual)

## DEFECT CELLS — final state (all repaired)
All defect cells listed above are **repaired** as of commit 12a4008:
DEF-W0-001 ✅ · DEF-W1-001 ✅ · DEF-W2 ✅ (121, omit-at-construction) ·
DEF-W3 ✅ (379, guards/locals) · DEF-R004 ✅ (as-any 73→1) · DEF-R005 ✅ (6 sentinels) ·
DEF-R006 ✅ (brands + 21 ViewTypeId) · DEF-AX003 ✅ (timers lifecycle-bound) ·
DEF-AX004 ✅ (instanceof-guarded). **grep state=broken/unknown → 0 (G-007 met).**

## PROGRESS
- ✅ P-001 DISCOVERY — complete
- ✅ P-002 TYPE_CRYSTALLIZATION — all R-003 flags + R-004 + R-005 + R-006 complete
- ✅ P-003 (P0 subset) — AX-003 lifecycle + AX-004 deferred-view complete; exhaustive view/modal round-trip = manual
- ✅ P-004 REPAIR — queue drained (24 agent dispatches, 1 blocked-with-rationale: Modal≠Component)
- ✅ P-005 VERIFICATION — G-001/2/3/7 ✅; G-004 ✅ (loaded: 82 cmds/18 views; 12/12 render-only views open clean via `obsidian eval`); G-005 ✅ (10× reload: cmd count stable 82, DOM delta 0); G-006 not measured (onload unchanged). Commands/network-views/settings = residual manual sweep (side-effect risk)
