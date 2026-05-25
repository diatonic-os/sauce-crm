# SauceBot — Target Architecture Spec

> CON-SAUCEBOT. Target design for the Copilot→**SauceBot** upgrade. Reads against
> `00-AUDIT.md` (current state). Every item names the existing abstraction it
> builds on so the work is *wiring/unifying*, not greenfield. Implementation
> sequencing + parallelization is in `02-PATCHES.md` / `03-AGENT-PROMPT.md`.

## Design principles
1. **One source of truth per concern.** Collapse the duplicate model-listing
   paths, the two `skillRunRing`s, and the Real/non-Real view pairs.
2. **Registry over switch.** Adding a provider (or a task, or a slash command)
   = adding one entry; all downstream derives.
3. **Propose → approve → apply.** Every vault write the model makes is a diff
   gated by the existing `ApprovalGate`; canon files keep their `CanonGuard`.
4. **Reuse the proven plumbing.** `ICopilotProvider`/`CompletionEvent`,
   `ModelCatalog`, `ToolUseAdapter` + `MAX_TOOL_TURNS` loop, LanceDB stores,
   `FilesService.updateViaContract`, `ApprovalGate` — keep all of it.
5. **No silent failure.** Surface unreachable endpoints / locked vault / dim
   mismatch (consistent with `CredentialSource` ethos).

---

## S1 — Provider Registry + harness model  (keystone)

**Goal:** one entry per provider; shared OpenAI-compatible harness; Anthropic
standalone; all major providers; trivial future additions.

- **`ProviderSpec`** (`src/copilot/ProviderRegistry.ts`, new):
  ```ts
  interface ProviderSpec {
    id: ProviderId;
    label: string;                 // UI
    harness: "anthropic" | "openai-compat" | "ollama" | "lmstudio-sdk";
    kind: "cloud" | "local";
    baseUrl?: string;              // cloud default; local from settings
    authHeader?: "bearer" | "x-api-key" | "none";
    capabilities: { toolUse: boolean; embeddings: boolean; streaming: boolean };
    credentialKey?: string;        // `copilot:<id>:api-key`
    catalog: "dynamic" | "static"; // dynamic = list endpoint; static = curated
    staticModels?: CatalogModel[];
    endpointSettingPath?: string;  // local providers
  }
  export const PROVIDER_REGISTRY: Record<ProviderId, ProviderSpec>;
  export function buildProvider(id, host, creds, cfg): ICopilotProvider; // harness factory
  ```
- **`OpenAICompatibleProvider`** (`src/copilot/OpenAICompatibleProvider.ts`, new):
  encapsulates the body builder, SSE tool-call streaming loop (index-keyed
  `toolBuf`), batch fallback, `/embeddings`, and finish-reason map — parameterized
  by `{baseUrl, authHeader, modelsPath, supportsToolUse, supportsEmbeddings}`.
  `OpenAIProvider`/`LMStudioProvider` collapse to ~config. Keep `AnthropicProvider`
  as the `"anthropic"` harness; `OllamaProvider` as `"ollama"`; wire
  `LMStudioSdkProvider` as `"lmstudio-sdk"` (unlocks JIT load/unload via
  `LMStudioModelManager`).
- **Registry-derived everywhere:** `CopilotRuntime.provider()`/`embedProvider()`
  (replace both switches with `buildProvider(registry.get(id)…)`),
  `ModelCatalog.list()` branches, `CopilotChatView.CHAT_PROVIDERS`,
  `ProviderPicker.PROVIDERS`, `VAULT_BOUND_KEYS` — all map over the registry.
- **Providers shipped:** anthropic, openai, ollama, lmstudio(REST), lmstudio-sdk,
  **+ nim, openrouter, groq (all openai-compat configs), + gemini** (OpenAI-compat
  shim `/v1beta/openai` or native). nim/gemini stop being half-wired.
- **Provider instance cache:** memoize the constructed provider by
  `(id, endpoint)` on the runtime so it isn't re-`new`ed every `ask()`; invalidate
  on `updateSettings`. Enables warm `refreshModels` + JIT model state.
- **Optional `ProviderRouter`** (`src/copilot/ProviderRouter.ts`): pick provider by
  capability (e.g. "needs tool-use") or policy; default = active settings.

## S2 — Agentic vault read/write via diffs  (biggest capability gap)

**Goal:** the model can read, semantically search, and **edit the vault via
previewed unified diffs**, gated by approval, canon-safe.

- **`DiffEditor`** (`src/copilot/tools/DiffEditor.ts`, new): atomic edits via
  **`Vault.process(file, data => newData)`** (replaces the lost-update
  `cachedRead`→`modify` pattern). Produces/applies unified diffs (add `diff` dep,
  or a minimal Myers diff in `sdk/groups/helpers/`). Body writes route through
  `FilesService.updateViaContract` (`core/FilesService.ts:65`) to honor
  `CanonGuard` (G-003).
- **Generic tools** registered to `ToolUseAdapter` via `SkillRuntime`/`main.ts:622`:
  `read_note(path)`, `search_vault(query)` (wraps `ObsidianRagHost.semantic` +
  `SearchService.fuzzy`), `propose_edit(path, instructions)→unified diff`,
  `apply_edit(path, diff)` (`risk:"high"` → `ApprovalGate` shows the diff before
  write), `create_note`, `web_research` (wraps `requestUrl`). The model now does
  agentic retrieval/editing inside the existing 8-turn loop.
- **Fix the dangling instruction:** `CopilotRuntime.ts:355` tells the model to
  "read these via tool" — ship `read_note` so that's true (or remove until it is).
- **`VaultContextProvider`** (`src/copilot/VaultContextProvider.ts`, new): build a
  links/backlinks index from `MetadataCache.resolvedLinks` (invert for backlinks;
  `getBacklinksForFile` is semi-private/absent). Replace the hand-rolled CRM-edge
  walk in `RagAssembler.oneHop` (`CopilotHostAdapters.ts:110-133`) with real link
  traversal; expose a `get_links(path)` tool.

## S3 — Skills → Tasks (manual + scheduled), remove "run skill"

**Goal:** a Task is the unit of work; it can carry a skill binding + schedule and
run manually or on cron. The standalone "run skill" picker goes away.

- **Extend `TaskFrontmatter`** (`domain/schemas/index.ts:255`):
  `+ skill_id?, skill_args?(JSON), schedule?("manual"|"interval:<freq>"|"cron:<expr>"),
  last_run?, next_run?, autonomy?`. Round-trip new fields through `TasksEmitter`/
  `TasksService` (keep checkbox compatibility).
- **`Cron` util** (`src/sync/Cron.ts`, new): `nextAfter(expr, fromDate)` (5-field
  cron; no exec, no dynamic regex — ReDoS-safe parser).
- **`SkillTaskScheduler`** (`src/services/SkillTaskScheduler.ts`, new): reads
  skill-bound tasks, computes `next_run` (via Cron or interval), and on due calls
  `SkillRuntime.run(skill_id, skill_args, {trigger:"scheduled", taskId})`. Persist
  schedule state (in `TaskFrontmatter` `last_run`/`next_run`, durable across
  reload). Build on `Scheduler`'s tick/backoff but add **cron + persistence**.
- **Manual run:** "Run task now" action on a task (Tasks view / inbox).
- **Remove run-skill surfaces:** command `run-skill` (`main.ts:1291`,
  `V2Commands.ts:39`), ribbon menu (`main.ts:891`), `SkillPickerModal`/
  `SkillArgsModal`. Skill execution remains reachable via (a) chat `/` (S4) and
  (b) tasks.
- **Skill settings UI:** make `SkillsPage.ts` real (enable/disable/autonomy via
  `SkillRegistry.setSettings`) and **persist** registry settings to
  `plugin.settings` (today in-memory only).
- **Implement the 6 stubbed skills** or mark them clearly "not yet wired"
  (`SkillRuntime.ts:184`): `transcribe` lands in S8; `geocode`/`verify-email`/
  `import-contacts`/`capture-call`/`schedule-touch` per integration availability.

## S4 — Skills as chat slash commands

**Goal:** typing `/` in the SauceBot chat shows a scrollable, selectable list of
skills/commands; pick one, type a message, the agent executes that task.

- **`SlashSuggest`** (`src/ui/widgets/SlashSuggest.ts`, new): a custom popover for
  the chat `<textarea>` (Obsidian has no inline-suggest for plain textareas).
  Triggers on leading `/`; filters as the user types; scrollable; keyboard
  (↑/↓/Enter/Esc) + click select. Source = `plugin.skills.list()` (enabled) merged
  with `slashCommands` (the existing prompt macros) into one list.
- **Wire into `CopilotChatView.buildInput`** (`:369`): add the keydown/input
  listener; on select, either (a) **force the chosen skill's tool call** —
  `CopilotRuntime.ask(message, …, {forceSkill: id})` pre-binds that tool so the
  agent reliably runs it with the message as args — or (b) for a prompt-macro
  slash command, substitute `{}` and send. Replace the "Suggested Skills" cards'
  insert-text behavior (`:357`) with this real execution path.
- **Unify** `SlashCommand` + skill exposure so the inert slash registry finally
  has a runtime consumer (the audit's "biggest looks-done-isn't-wired" gap).

## S5 — Scheduling / cron (generalized)

Covered by S3's `Cron` + `SkillTaskScheduler` + persistence. Generalize
`Scheduler` to accept a `nextRun` strategy (`interval | cron`) and a pluggable job
source (integration sync **and** skill-tasks). Surface scheduled tasks + next-run
in the Sync/Tasks status view (`SyncStatusView.ts:102`).

## S6 — Memory · Vector · RAG · Graphify (whole-vault)

**Goal:** the entire vault (not just CRM entities) is mirrored, embedded,
graphified, and semantically available to SauceBot.

- **Whole-vault coverage:** `MirrorSync.build()` (`MirrorSync.ts:111-115`) must
  mirror untyped notes with a fallback `type:"note"` instead of returning null.
  Add an exclude-glob setting. (LanceDB is live — `5976315`; this is the gate to
  "understands the whole vault".)
- **Inline content, not just paths:** in `CopilotRuntime.ask()` (`:353-361`),
  fetch top-N centered entities via `RagAssemblerHost.readFile` and inline trimmed
  bodies (mirror the doc-chunk block), budgeted by `RagAssembler.tokenCeiling`.
- **Activate graphify:** call `ensureGraphTables(db)` in `initLanceBackend`; bind
  `LanceGraphStore` into `GraphService` (`wireSvcV1.ts:403`); new
  **`VaultGraphIndexer`** (`src/services/VaultGraphIndexer.ts`) walks all notes +
  wikilinks (`resolvedLinks`) → `upsertNode`/`upsertEdge`, run from the rebuild
  command + change handler. Optional `/graphify`-skill / GraphRAG hook.
- **Shared memory surface:** add a semantic path to `SearchService`
  (`SearchService.ts`) so vault search UI uses the same Lance vectors; expose a
  `search_vault` tool (S2) and optionally a DQL/command query verb.
- **Embedding-dim safety:** detect dim mismatch in `syncEmbeddingConfig`/`rag.ts`,
  warn + offer table rebuild; parameterize `embeddingDim` from the selected model
  (today fixed 768, silent skip on mismatch — `MirrorSync.ts:101`).

## S7 — Chat UI upgrades + inbox/audit/run-log

- **Markdown rendering:** replace `assistantEl.setText` (`CopilotChatView.ts:685`)
  with `MarkdownRenderer.render(...)` so SauceBot replies render properly.
- **File upload:** add a `paperclip` `iconButton` in `buildInput` (`:369`),
  pattern from `ImportMappingModal.ts:52-70`; route audio→transcription (S8),
  docs→RAG harvest (`main.ts:573`), images→(future vision/base64).
- **Register the FUNCTIONAL views** in place of the Real stubs: wire `AIInboxView`
  (InferenceEngine proposals + accept/reject) — add task-run proposals as a second
  source; `AuditLogView`; `SkillRunLogView`. **Unify the two `skillRunRing`
  instances** to one, with `taskId`/`trigger` columns.
- **Wire `ctx.audit`** (`SkillRuntime.ts:95`, console stub) → real `LanceAuditStore`
  so manual/scheduled task runs are durably recorded and visible in the audit view.

## S8 — Baked-in transcription

**Goal:** built-in, best-in-class STT.
- **Engine:** bundle **whisper.cpp** (no Python) with `large-v3-turbo` (or `medium`
  fallback), invoked via the existing native-spawn host pattern
  (`LanceDBInstaller.ts:131`); OR, on dev hosts with `~/.venv/bin/whisper`
  (`mrc-voicenote-transcribe`), shell to local whisper. Provide a
  `TranscriptionProvider` abstraction so cloud STT (OpenAI/Deepgram) can be added
  like a model provider. Desktop-first; mobile via the bridge or cloud STT.
- **Wire** `SkillRuntime.dispatch` `transcribe` branch (`:184`) to the engine;
  give `sauce:transcribe-file` (`main.ts:1447`) a real file picker; feed chat
  audio uploads (S7) and `CaptureCallSkill` through it. Un-exclude transcription
  models from the catalog where relevant.

## S9 — Mobile SauceBot ↔ memory consumer  (converge with bridge work)

The desktop bridge + LanceDB memory are live (other session). Route the **mobile
copilot's RAG/search through `this.memory`** (the bridge memory backend,
`bridge/desktop/LanceMemoryBackend.ts`, `wiring.ts:87-102`) so phone SauceBot
queries desktop LanceDB. This closes "SauceBot across mobile + desktop" and reuses
S2's `search_vault`/`read_note` tools over the bridge transport.

## S10 — Rebrand Copilot → SauceBot

Change **only** the ~16 user-facing strings (`00-AUDIT.md` §5 list): ribbon
tooltip, menu/command names, view title (`getDisplayText`), assistant label
(`"copilot"`→`"saucebot"`), settings tab/page labels, section hints, "Copilot
Feed". **Do NOT change** class names, `VIEW_*` type IDs, `settings.copilot`/
`COPILOT_DEFAULTS`, KeyVault key `copilot:<provider>:api-key`, command id
`open-copilot`, CSS `sauce-copilot*`/`sauce-cp-*`, storage `_addenda/_copilot`
(breaks layouts/hotkeys/saved data). Optionally add a migration alias if any ID
must change.

## Non-negotiables (carry into the build)
- G-001 tokenized CSS only (no inline styles); G-003 canon guard on writes.
- 4-gate + build green per change (`lint`/`typecheck`/`test`/`sdk:check` + `build`);
  baseline **660 tests / 130 files**.
- No new lint errors; sdk:check stays green (don't perturb `sdk/generated`).
- ReDoS-safe (no dynamic regex), no `exec` (use `execFileNoThrow`), secrets via
  KeyVault only.
- Push to `origin/main`, no PR (per operator convention).
