# SH-A — Foundation

**Deps:** none (t=0, critical path) · **Owner:** orchestrator · **Status:** `DONE` (all 5 tasks green; 408 tests) — unblocks Phase 2 SH-B/C/D/E
**Goal:** types, ObsidianPluginRegistry, state machine, settings scaffold, dual-ship cards
**Blocks:** SH-B, SH-C, SH-D, SH-E

| Task | Out | Acc | Status |
|------|-----|-----|--------|
| T-A-01 | `src/integrations/obsidian/IObsidianPluginIntegration.ts` | extends IIntegration; adds detect(), optimize(), getServiceFacade<T>(), getOptimizationDiff(), supportsBeta() | **DONE** |
| T-A-02 | `src/integrations/obsidian/ObsidianPluginRegistry.ts` | NEW Map-backed register/get/list/dispose (per A-001 amendment); subscribes app.plugins on('change') + onLayoutReady; emits to EventBus | **DONE** |
| T-A-03 | `src/integrations/obsidian/PluginStateMachine.ts` | implements S-button; pure reducer; persists last state in data.json `saucecrm.pluginStates` | **DONE** |
| T-A-04 | `src/ui/settings/integrations/CommunityPluginsPage.ts`, `CorePluginsPage.ts` | cards keyed off registry; labels from S-button-labels; tokenized CSS (G-001); **TS/Svelte only — React dropped per CONFLICT-1 decision** | **DONE** |
| T-A-05 | `src/ui/settings/sections/IntegrationsSection.ts` | Services\|Community\|Core tabs; TS `sections/*.ts` pattern (per A-002 amendment), not md renderer | **DONE** |

**Wiring note (deferred, not in any T-A `out` set):** `IntegrationsSection`/registry are not yet mounted into `src/main.ts` or `SauceGraphSettingTab` TABS — that integration wiring is intentionally out of SH-A's declared file scope. Render fns + registry are testable standalone; mount in a later integration pass.

**Notes:** A-001/A-002/A-003 amended in `00-validate.md`. T-A-04 ships TS + Svelte (React dropped — CONFLICT-1 resolved "match codebase").
