# SauceBot — Patch Blueprint (sequenced, parallelizable)

> CON-SAUCEBOT. Concrete change-sets mapping `01-SPEC.md` → files. Each patch-set
> (PS) lists create/modify targets with anchors from the audit, the key API, a
> test obligation (R-002), and dependencies. **Foundation PS are committed first
> (they unblock the rest); the Parallel PS then fan out on non-overlapping
> surfaces.** Per-PS gate: `lint && typecheck && test && sdk:check && build`
> green; baseline 660 tests/130 files.

## Dependency graph (build order)
```
F1 ProviderRegistry ─┐
F2 DiffEditor+Tools ──┼─► A Chat-slash   B Memory/Graphify   C ChatUI/Views
F3 Task model+Cron ───┘     D Transcription   E Rebrand   F Mobile-memory
                            (A–F consume F1–F3; A–F mutually non-overlapping)
```
Shared-file note: `CopilotRuntime.ts`, `CopilotChatView.ts`, `main.ts`, and
`SkillRuntime.ts` are touched by multiple PS — **foundation PS land their edits
first**; parallel PS edit *disjoint regions/methods* (use clearly-scoped helpers,
not interleaved hunks) to keep merges clean.

---

## FOUNDATION (commit before fan-out)

### F1 — Provider Registry + OpenAI-compat harness
- **Create:** `src/copilot/ProviderRegistry.ts` (`ProviderSpec`, `PROVIDER_REGISTRY`,
  `buildProvider()`); `src/copilot/OpenAICompatibleProvider.ts` (shared harness);
  optional `src/copilot/ProviderRouter.ts`.
- **Modify:** `OpenAIProvider.ts`/`LMStudioProvider.ts` → thin configs over the
  base; `CopilotRuntime.ts:245-263,299-327` (both switches → registry);
  `ModelCatalog.ts:23,157-173,294-300` (derive branches/union/static);
  `CopilotChatView.ts:32-38` + `ProviderPicker.ts:43-49` (derive lists);
  `LocalLLMPage.ts:8-14`/`integrations.ts` (derive `VAULT_BOUND_KEYS`);
  add provider instance cache in `CopilotRuntime`; wire `LMStudioSdkProvider`.
- **Add providers:** nim, openrouter, groq (openai-compat configs), gemini.
- **Tests:** `test/copilot/ProviderRegistry.test.ts` — every registry id builds a
  provider; capabilities/credentialKey correct; openai & lmstudio produce
  equivalent request shapes from the shared base.
- **Deps:** none. **Unblocks:** all provider work, S1 UI.

### F2 — DiffEditor + agentic vault tools
- **Create:** `src/copilot/tools/DiffEditor.ts` (`Vault.process`-based atomic edit
  + unified-diff apply; minimal Myers in `sdk/groups/helpers/diff.ts` or `diff`
  dep); `src/copilot/tools/{ReadNote,EditNote,SearchVault,CreateNote,WebResearch}Tool.ts`;
  `src/copilot/VaultContextProvider.ts` (`resolvedLinks` link/backlink index).
- **Modify:** `SkillRuntime.ts:55-76` / `main.ts:622` (register the new tools to
  `ToolUseAdapter` with `risk` tiers → `ApprovalGate` diff preview); route writes
  via `FilesService.updateViaContract` (`core/FilesService.ts:65`);
  `CopilotRuntime.ts:355` (content vs paths wording); `RagAssembler`/
  `CopilotHostAdapters.ts:110-133` (link traversal via VaultContextProvider).
- **Tests:** `test/copilot/DiffEditor.test.ts` (apply unified diff via a fake
  `process`; canon-guard path; idempotency); tool-schema tests.
- **Deps:** none (parallel to F1). **Unblocks:** S2, B, F.

### F3 — Task model + Cron + SkillTaskScheduler; retire run-skill
- **Create:** `src/sync/Cron.ts` (`nextAfter`, ReDoS-safe 5-field parser);
  `src/services/SkillTaskScheduler.ts`.
- **Modify:** `domain/schemas/index.ts:255` (`TaskFrontmatter` + skill/schedule
  fields); `services/TasksEmitter.ts`/`TasksService.ts` (round-trip);
  `sync/Scheduler.ts` (cron strategy + persistence + skill-task source);
  `SkillRegistry`/`SkillsPage.ts` (persist settings + real enable/disable UI);
  **remove** run-skill: `main.ts:1291,891`, `V2Commands.ts:39`, delete
  `SkillPickerModal.ts`/`SkillArgsModal`.
- **Tests:** `test/sync/Cron.test.ts` (next-fire cases); `test/services/
  SkillTaskScheduler.test.ts` (due → runs skill with trigger/taskId).
- **Deps:** none. **Unblocks:** S3, S5, C (run-log/inbox task linkage).

---

## PARALLEL WAVE (each consumes F1–F3; non-overlapping)

### A — Skills as chat slash commands
- **Create:** `src/ui/widgets/SlashSuggest.ts` (scrollable `/` popover).
- **Modify:** `CopilotChatView.ts:369` (keydown `/` → popover; select → execute);
  `:330-362` (replace "Suggested Skills" insert-text with real run);
  `CopilotRuntime.ask()` (+`forceSkill?` option to pre-bind a tool);
  `SlashCommands.ts` (merge skills + macros into one `/` source).
- **Tests:** SlashSuggest filter/keyboard-select (jsdom); `forceSkill` binds the
  intended tool.
- **Owns:** `SlashSuggest.ts`, the chat input/suggestions region, `ask()` forceSkill.

### B — Whole-vault memory + graphify
- **Create:** `src/services/VaultGraphIndexer.ts`.
- **Modify:** `MirrorSync.ts:111-115` (mirror untyped notes); `CopilotRuntime.ask()`
  `:353-361` (inline entity content); `backend/lance/index.ts` (call
  `ensureGraphTables`); `wireSvcV1.ts:403` (bind `LanceGraphStore`);
  `SearchService.ts` (semantic path); `FeatureSettings.ts`/`rag.ts` (full-vault
  toggle + embedding-dim handling).
- **Tests:** untyped-note mirrors; VaultGraphIndexer node/edge build; semantic
  SearchService returns vector hits with a fake index.
- **Owns:** MirrorSync, VaultGraphIndexer, graph wiring, SearchService, rag settings.

### C — Chat UI render + upload + register functional views
- **Modify:** `CopilotChatView.ts:685` (`MarkdownRenderer`), `:369` (paperclip
  upload → transcribe/RAG), `:707` (label); `main.ts:714-725` (register
  `AIInboxView`/`AuditLogView`/`SkillRunLogView` functional versions, retire Real
  stubs); unify the two `skillRunRing`s → one; `SkillRuntime.ts:95` + audit view
  (wire `ctx.audit`→`LanceAuditStore`); `AIInboxView` (+task-run proposal source).
- **Tests:** run-log single-ring assertion; inbox renders proposals (existing
  logic); markdown render smoke.
- **Owns:** chat render/upload, the three view registrations, audit wiring.
- **Coord:** touches `CopilotChatView.ts` (with A) + `SkillRuntime.ts` (with F2/F3)
  — A owns input/suggestions; C owns render/upload/header; keep regions disjoint.

### D — Baked-in transcription
- **Create:** `src/services/transcribe/TranscriptionProvider.ts` + a
  `WhisperCppEngine` (native spawn via `execFileNoThrow`, model `large-v3-turbo`)
  and optional cloud STT.
- **Modify:** `SkillRuntime.ts:184` (real `transcribe` dispatch); `main.ts:1447`
  (file picker for `sauce:transcribe-file`); `wireSvcV1.ts:266` (recordAudio);
  un-exclude transcription models where relevant (`ModelCatalog.ts:118`).
- **Tests:** engine invocation contract (mock spawn → returns transcript);
  dispatch wiring.
- **Owns:** `src/services/transcribe/*`, transcribe dispatch + command.

### E — Rebrand → SauceBot
- **Modify (strings only, per `00-AUDIT.md` §5):** `main.ts:872,876,1287`,
  `V2Commands.ts:26`, `CopilotChatView.ts:96,670,707`, `CopilotPage.ts:4`,
  `SauceGraphSettingTab.ts:50-51`, `sections/{copilot,prompts,localllm,
  integrations,basic}.ts`, `LanceDBInstallModal.ts:58`, `Views.ts:107`.
- **MUST NOT touch:** class names, `VIEW_*` ids, `settings.copilot`, KeyVault key,
  command id `open-copilot`, CSS `sauce-copilot*`, `_addenda/_copilot`.
- **Tests:** a guard test asserting the view title / assistant label read
  "SauceBot" while `VIEW_COPILOT_CHAT`/`settings.copilot` are unchanged.
- **Owns:** user-facing strings only (smallest, lowest-risk; can land anytime).

### F — Mobile SauceBot ↔ memory consumer
- **Modify:** route mobile copilot RAG/search through `this.memory`
  (`bridge/desktop/LanceMemoryBackend.ts`, `wiring.ts:87-102`); reuse F2's
  `search_vault`/`read_note` over the bridge transport.
- **Tests:** mobile path resolves queries via the bridge memory backend (mock).
- **Owns:** bridge consumer wiring. **Coord:** with the parallel bridge session.

---

## Risk register
- **Embedding-dim change** requires a LanceDB table rebuild (768 fixed) — gate
  behind a user confirm; don't silently drop writes.
- **Rename safety** — E must not change persisted IDs/keys/CSS/view-types.
- **Shared-file merges** — F1/F2/F3 land first; A & C both touch
  `CopilotChatView.ts` (split by region) and `SkillRuntime.ts` (F2/F3 own
  registration; C owns audit) — assign disjoint methods.
- **Diff correctness** — F2's `apply_edit` must be atomic (`Vault.process`) and
  approval-gated; never auto-apply high-risk writes.
- **Transcription bundling** — whisper.cpp binary/model size + per-OS build; spawn
  via `execFileNoThrow` only (no shell).
