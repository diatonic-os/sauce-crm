# Plan: v2 Parity & Integration

Bring every v2 namespace in the sauce-graph Obsidian plugin to full parity with the
inline ("v1") implementation: integrate components end-to-end, complete stubs, land
structured logging + telemetry, fix a silent crypto-bypass, add a real test harness,
and wire auto model indexing/selection across every GUI surface that takes a model
name.

Ground truth: filesystem under `/home/daclab-ai/Desktop/sauce-graph/plugin/src/`.
No git history. MAX-WIP=3. All tasks must emit structured logs via the A1 logger;
raw `console.*` in plugin/src is forbidden after A1 lands.

## Phase A — Foundation

### Task A1: Telemetry & structured logging service

Create the structured logger + JSONL telemetry sink that every other task in this
plan emits through. Singleton attached to the plugin on load. Degrades to in-memory
buffer when the Obsidian vault adapter is unavailable.

**Phase:** A
**Depends on:** none
**Touches:** plugin/src/telemetry/SauceLogger.ts, plugin/src/telemetry/TelemetrySink.ts, plugin/src/telemetry/index.ts, plugin/src/telemetry/types.ts, plugin/src/main.ts

Steps:

- [ ] **A1.1** Create `plugin/src/telemetry/types.ts` with `LogLevel`, `LogEvent`, `TelemetryEvent` types.
- [ ] **A1.2** Create `plugin/src/telemetry/SauceLogger.ts` exporting `createLogger(name)` returning `{trace, debug, info, warn, error}` with level filter from `plugin.settings.telemetry.level`.
- [ ] **A1.3** Create `plugin/src/telemetry/TelemetrySink.ts` writing JSONL events to `.sauce/memory/TRACE-LOG.jsonl` via Obsidian vault adapter; in-memory ring buffer fallback.
- [ ] **A1.4** Create `plugin/src/telemetry/index.ts` re-exporting both.
- [ ] **A1.5** Edit `plugin/src/main.ts` to instantiate a singleton on `plugin.logger` during `onload()` before any other v2 subsystem.
- [ ] **A1.6** Verify: `npm run typecheck` exits 0; `grep -rn "plugin.logger" plugin/src/main.ts` shows the wire-up.

### Task A2: Fix v2-init crypto silent-failure

`plugin/src/v2-init.ts:50-55` has `secretboxSeal` returning a zero-filled buffer
and `secretboxOpen` returning `null` unconditionally. Any encrypted value written
through KeyVault today is silently empty. Migration is acceptable — no real
ciphertexts exist on disk.

**Phase:** A
**Depends on:** A1
**Touches:** plugin/src/v2-init.ts, plugin/src/security/KeyVault.ts, plugin/test/v2-crypto-roundtrip.ts

Steps:

- [ ] **A2.1** Change `CryptoBackend.secretboxSeal` / `secretboxOpen` to return `Promise<Uint8Array>` / `Promise<Uint8Array | null>`. Update all call sites.
- [ ] **A2.2** Replace the stub bodies with real AES-256-GCM via `crypto.subtle.encrypt`/`decrypt` (the existing `sealAesGcm` / `openAesGcm` helpers below the stub already work — wire them through).
- [ ] **A2.3** Add envelope header `SGV2\x01` + 12-byte nonce prefix; reader rejects unrecognized magic.
- [ ] **A2.4** Every KeyVault op calls `plugin.logger.info('crypto.op', {op, ok, ms})` via the A1 telemetry sink.
- [ ] **A2.5** Add `plugin/test/v2-crypto-roundtrip.ts`: seal→open recovers plaintext; tampered ciphertext fails open; unknown magic rejected.
- [ ] **A2.6** Verify (the bash/verify block MUST include these greps so a stub impl fails the gate): `npm run typecheck && grep -qE "subtle\\.encrypt|sealAesGcm" src/v2-init.ts && grep -qE "SGV2|envelope" src/v2-init.ts && ! grep -qE "return out;\\s*$" src/v2-init.ts && grep -qE "logger\\.|telemetrySink" src/security/KeyVault.ts && echo OK_A2`. A passing run prints "OK_A2"; the four greps prove (a) real WebCrypto is wired, (b) versioned envelope header exists, (c) the zero-buffer stub is gone, (d) KeyVault ops emit via the A1 logger.

### Task A3: Vitest test harness + lint gate

Add a real test runner. Every other task's acceptance gate depends on this.

**Phase:** A
**Depends on:** A1
**Touches:** plugin/package.json, plugin/vitest.config.ts, plugin/test/_stubs/obsidian.ts, plugin/.eslintrc

Steps:

- [ ] **A3.1** Add devDeps to `plugin/package.json`: `vitest@^1`, `@vitest/ui`, `jsdom@^24`.
- [ ] **A3.2** Add npm scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.
- [ ] **A3.3** Create `plugin/vitest.config.ts` with `environment: 'jsdom'`, alias `obsidian` → `./test/_stubs/obsidian.ts`, include `test/**/*.test.ts` and `src/**/*.test.ts`.
- [ ] **A3.4** Create `plugin/test/_stubs/obsidian.ts` shimming `App`, `Plugin`, `Setting`, `Modal`, `ItemView`, `Notice`, `normalizePath` for unit-test scope.
- [ ] **A3.5** Edit `plugin/.eslintrc` to add `no-restricted-syntax` rule blocking `CallExpression[callee.object.name='console']` under `plugin/src/`; allow under `plugin/test/`.
- [ ] **A3.6** Verify (the bash/verify block MUST include these so a stub fails): `test -f vitest.config.ts && grep -q "\"test\":" package.json && grep -q "\"vitest\":" package.json && grep -q "no-restricted-syntax" .eslintrc && grep -q "App\\|Plugin\\|Setting" test/_stubs/obsidian.ts && npm run typecheck && npm test 2>&1 | tail -5 && echo OK_A3`. A passing run prints "OK_A3" and proves: config exists, scripts wired, eslint rule present, obsidian stub shims the v2 surface, typecheck green, vitest exits 0.

## Phase B — Parallel cleanup

### Task B1: Dedup loose v2_* modal files

Two duplicate modal implementations ship into the bundle today:
- `plugin/src/ui/modals/v2_ImportMappingModal.ts` and `…/v2/ImportMappingModal.ts`
- `plugin/src/ui/modals/v2_QuickCaptureModal.ts` and `…/v2/QuickCaptureModal.ts`

Whichever import path is last-wins. Consolidate to the `v2/` folder.

**Phase:** B
**Depends on:** A3
**Touches:** plugin/src/ui/modals/v2_ImportMappingModal.ts, plugin/src/ui/modals/v2_QuickCaptureModal.ts, plugin/src/ui/modals/v2/ImportMappingModal.ts, plugin/src/ui/modals/v2/QuickCaptureModal.ts

Steps:

- [ ] **B1.1** Diff the loose vs folder file for each pair. If divergent, merge superset into the `v2/*.ts` canonical version.
- [ ] **B1.2** Delete `modals/v2_ImportMappingModal.ts` and `modals/v2_QuickCaptureModal.ts`.
- [ ] **B1.3** Grep for any import referencing the loose path; rewrite to `modals/v2/...`.
- [ ] **B1.4** Verify: `npm run typecheck` green; bundle size diff ≤ 0; modal-open vitest unit (created here) succeeds for both modals.

### Task B2: Collapse stub vs Real v2 view pairs

Five pairs of `*View.ts` (stub) vs `*ViewReal.ts` (real). Pick Real, rename to
canonical, delete stub, wire each through `V2Registry.register`.

Pairs:
- AIInboxView ↔ AIInboxViewReal
- AuditLogView ↔ AuditLogViewReal
- MapView ↔ MapViewReal
- SkillRunLogView ↔ SkillRunLogViewReal
- SyncStatusView ↔ SyncStatusViewReal

**Phase:** B
**Depends on:** A3
**Touches:** plugin/src/ui/views/v2/AIInboxView.ts, plugin/src/ui/views/v2/AIInboxViewReal.ts, plugin/src/ui/views/v2/AuditLogView.ts, plugin/src/ui/views/v2/AuditLogViewReal.ts, plugin/src/ui/views/v2/MapView.ts, plugin/src/ui/views/v2/MapViewReal.ts, plugin/src/ui/views/v2/SkillRunLogView.ts, plugin/src/ui/views/v2/SkillRunLogViewReal.ts, plugin/src/ui/views/v2/SyncStatusView.ts, plugin/src/ui/views/v2/SyncStatusViewReal.ts, plugin/src/ui/views/v2/index.ts, plugin/src/v2/Registry.ts, plugin/src/main.ts

Steps:

- [ ] **B2.1** For each pair: rename `*Real.ts` → `*.ts` (overwriting the stub) and delete the now-empty Real file.
- [ ] **B2.2** Update `plugin/src/ui/views/v2/index.ts` exports and `plugin/src/main.ts` registrations.
- [ ] **B2.3** Each canonical view calls `plugin.v2Registry.register({id, ready, phase})` in `onOpen()` and `unregister(id)` in `onClose()`.
- [ ] **B2.4** Render `V2Registry.state(id)` (IMPLEMENTED / DEGRADED / COMING_SOON) in at least one place in the settings tab (a status strip).
- [ ] **B2.5** Verify: each view's `onOpen` mounts without throwing under jsdom stub; `npm run typecheck` green.

### Task B3: Auto model indexing & selection across GUI

Build `ModelCatalog` + `ProviderPicker` v2 component and wire it into every GUI
surface that currently takes a model name as free text.

**Phase:** B
**Depends on:** A1, A2, A3
**Touches:** plugin/src/copilot/ModelCatalog.ts, plugin/src/ui/components/v2/ProviderPicker.ts, plugin/src/ui/settings/sections/copilot.ts, plugin/src/ui/settings/LocalLLMPage.ts, plugin/src/ui/modals/v2/OnboardingWizardModal.ts, plugin/src/ui/views/v2/CopilotChatView.ts

Steps:

- [ ] **B3.1** Create `plugin/src/copilot/ModelCatalog.ts` exporting `list(provider, settings) → {id, label, sizeBytes?, loaded?}[]`. Ollama: GET `{endpoint}/api/tags`. LM Studio: `LMStudioModelManager.listDownloadedModels()`. Static fallback for `openai`/`anthropic`. 30s in-memory cache keyed by `(provider, endpoint)`.
- [ ] **B3.2** Every catalog fetch emits `telemetry.model_catalog.{fetch|hit|miss|error}` via A1 logger.
- [ ] **B3.3** Create `plugin/src/ui/components/v2/ProviderPicker.ts`: provider dropdown + model dropdown populated from `ModelCatalog`, plus a "Refresh" button that busts the cache.
- [ ] **B3.4** Replace the free-text Model input in `plugin/src/ui/settings/sections/copilot.ts` (the L41–43 `addText`) with `ProviderPicker`. Remove the `// TODO(addendum-a)` at line 1.
- [ ] **B3.5** Replace both "Default model" text fields in `plugin/src/ui/settings/LocalLLMPage.ts` (L29 Ollama, L35 LM Studio) with mini-pickers that share `ModelCatalog`.
- [ ] **B3.6** Replace `OnboardingWizardModal.ts:173-176` `addText` Model row with `ProviderPicker`.
- [ ] **B3.7** Make `CopilotChatView.ts:50-51` status row clickable — opens a quick `ProviderPicker` modal.
- [ ] **B3.8** Add `plugin/test/v2-model-catalog.test.ts`: mocks Ollama `/api/tags` + LMStudioModelManager; verifies cache, error fall-through, provider dispatch.
- [ ] **B3.9** Verify: `npm test` green; `grep -rn 'addText.*[Mm]odel' plugin/src/ui` returns no hits.

## Phase C — Stub sweep

### Task C1: Resolve remaining TODO/FIXME in settings sections

Sweep the remaining stubs in the v2 settings sections. Each must either be
implemented or converted to a `RISK-###` entry with explicit owner + ETA.

Baseline (`grep -cE 'TODO|FIXME' plugin/src`): basic:5, advanced:3, vault:1,
skills:1, integrations:1, data:1, contracts:1, SmtpImapPage.ts:1.

**Phase:** C
**Depends on:** A3, B3
**Touches:** plugin/src/ui/settings/sections/basic.ts, plugin/src/ui/settings/sections/advanced.ts, plugin/src/ui/settings/sections/vault.ts, plugin/src/ui/settings/sections/skills.ts, plugin/src/ui/settings/sections/integrations.ts, plugin/src/ui/settings/sections/data.ts, plugin/src/ui/settings/sections/contracts.ts, plugin/src/ui/settings/integrations/SmtpImapPage.ts, plugin/.sauce/ops/RISKS.md

Steps:

- [ ] **C1.1** For each TODO/FIXME, either implement the missing behavior or move to `plugin/.sauce/ops/RISKS.md` as a `RISK-###` with owner + ETA. No bare TODOs allowed at end of task.
- [ ] **C1.2** Each touched section calls `plugin.logger.debug('settings.section_render', {section})` on mount.
- [ ] **C1.3** Verify: `grep -rn 'TODO\|FIXME' plugin/src | wc -l` strictly less than baseline; every remaining TODO references a RISK id; `npm test` green; `npm run typecheck` green.
