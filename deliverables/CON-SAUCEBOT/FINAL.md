# CON-SAUCEBOT — FINAL

> Copilot → **SauceBot**: fully-wired, provider-agnostic, vault-aware agentic
> assistant for the Sauce CRM Obsidian plugin (desktop + mobile, TS + Svelte,
> LanceDB). Built from `plan/saucebot/{00-AUDIT,01-SPEC,02-PATCHES,03-AGENT-PROMPT}.md`.

## Outcome at a glance

- **Tests:** 660 → **866** (+206), 130 → 148 files. **All green.**
- **Gate (every commit):** lint **0 errors** (6 pre-existing warnings), typecheck **0**,
  `sdk:check` **0** (sdk/generated untouched), `build` **0**.
- **12 commits** on `main`, pushed to `origin/main` (no PR). 72 files changed (+6833/−922).
- **Execution:** foundation F1/F2/F3 + parallel wave A–F via isolated agents,
  integrated by the orchestrator; each landed green.
- **Live-verified:** RAG embeddings (LM Studio `/v1/embeddings`, nomic → 768-dim,
  matches the LanceDB table) and transcription (real `~/.venv/bin/whisper`, exact
  engine command → transcript at the engine's read path).

## Before → after, per spec area

### S1 — Provider Registry + shared OpenAI-compat harness  ✅ wired
- **Before:** two hardcoded `switch`es (`CopilotRuntime.provider()`/`embedProvider()`),
  OpenAI/LMStudio harness copy-pasted (~250 dup lines), nim/gemini half-wired
  (catalog entry, no provider class), providers re-`new`ed every call, lmstudio-sdk unreachable.
- **After:** `ProviderRegistry.ts` — `PROVIDER_REGISTRY` (anthropic, openai, ollama,
  lmstudio-REST, lmstudio-sdk, **nim, openrouter, groq, gemini**) + `buildProvider()`
  harness factory. `OpenAICompatibleProvider.ts` is the one shared harness;
  `OpenAIProvider`/`LMStudioProvider` collapse to thin subclasses. Runtime derives
  both provider paths from the registry; **provider instance cache** memoizes by
  (id, endpoint), invalidated on settings change. Unknown id → anthropic fallback (no crash).
- **Files:** `ProviderRegistry.ts`, `OpenAICompatibleProvider.ts`, `OpenAIProvider.ts`,
  `LMStudioProvider.ts`, `CopilotRuntime.ts`, `copilot/index.ts`. Tests: registry builds
  every id, capabilities/credentialKey, openai≡lmstudio request shape, runtime memoization.

### S2 — Agentic vault read/write via diffs  ✅ wired
- **Before:** no generic read/write/edit tools; system prompt told the model to
  "read via tool" but no read tool existed; writes were direct mutations, no diff path.
- **After:** `tools/DiffEditor.ts` (atomic `Vault.process` + unified diff, canon-safe via
  `FilesService.updateViaContract`), pure-TS `tools/diff.ts` (no dep, ReDoS-safe), and
  `read_note`/`search_vault`/`propose_edit`/`apply_edit`(risk:high → ApprovalGate diff
  preview)/`create_note`/`web_research`/`get_links` tools. `VaultContextProvider`
  (links/backlinks from `resolvedLinks`). `registerVaultTools()` wired in `main.ts`
  onload; `CopilotRuntime.rewrite()` powers `propose_edit`. RAG one-hop now uses real
  wikilink traversal.

### S3 — Skills → Tasks (manual + scheduled), run-skill removed  ✅ wired
- **Before:** skills ran only via a standalone picker; tasks were inert checkboxes; no
  skill binding, no schedule, no execution.
- **After:** `TaskFrontmatter` + `skill_id`/`skill_args`/`schedule`/`last_run`/`next_run`/
  `autonomy`; `SkillTaskScheduler` runs skill-bound task notes (manual + interval/cron),
  persisting run state; wired at onload + a "Rebuild" command. **run-skill surfaces
  removed** (command, ribbon item, `sauce:run-skill`, deleted `SkillPickerModal`).
  `SkillsPage` made real (enable/disable/autonomy, persisted).

### S4 — Skills as chat slash commands  ✅ wired
- **Before:** `SlashCommand` registry built, persisted, editable — and **completely inert**
  (no runtime consumer anywhere).
- **After:** `SlashSuggest` widget (filter/keyboard-nav/popover, tokenized CSS) mounted on
  the chat textarea; `/` opens a scrollable skill+command list. Selecting a skill arms
  `CopilotRuntime.ask({forceSkill})` (injects a "call this tool now" directive into the
  existing tool loop); a command macro substitutes its prompt. The inert registry finally
  has a consumer.

### S5 — Scheduling / cron (generalized)  ✅ wired
- **Before:** interval-only `Scheduler` (fixed enum), in-memory, sync-resources only.
- **After:** `Cron.ts` — `nextAfter()` 5-field cron (`*`, lists, ranges, `*/n`, `a-b/n`),
  **ReDoS-safe** (tokenized, no dynamic regex), invalid → `CronParseError`. `Scheduler`
  gained a `nextRunStrategy` (interval|cron); `SkillTaskScheduler` adds cron + persistence.

### S6 — Whole-vault memory + graphify  ✅ wired (live-verified embeds)
- **Before:** `MirrorSync` skipped any note lacking `type:` frontmatter → whole vault
  invisible; RAG injected paths not content; persistent graph (`graph_nodes/edges`,
  `LanceGraphStore`) defined but dead (`ensureGraphTables` uncalled); search purely lexical.
- **After:** `fullVaultIndex` mirrors untyped notes as `type:"note"` (+ exclude globs);
  `CopilotRuntime.inlineEntityContent()` inlines trimmed bodies (budgeted); graphify
  activated — `ensureGraphTables` called, `LanceGraphStore` hydrates `GraphService`,
  `VaultGraphIndexer` walks `resolvedLinks` → nodes/edges (+ rebuild command);
  `SearchService.semantic()` over Lance vectors with lexical fallback; embedding-dim
  mismatch surfaced (no silent drop).
- **Verified live:** LM Studio `/v1/embeddings` (`nomic-embed-text-v1.5`) → 768-dim vector,
  matching the LanceDB table dim → RAG works out-of-the-box; `bge-m3`/`mxbai` (1024) would
  trigger the dim-mismatch path.

### S7 — Chat UI + inbox/audit/run-log  🟡 mostly wired
- **Done:** markdown rendering (`MarkdownRenderer` on the done event); the **functional**
  `AIInboxView`/`AuditLogView`/`SkillRunLogView` registered in place of the "Real"
  placeholder stubs (deleted); the duplicate `SkillRunRing` removed (split-brain fixed —
  the runtime and the registered view now share one ring); `ctx.audit` → durable
  HMAC-chained `LanceAuditStore` via `v2.auditLog.append` (was a console stub).
- **Remaining (documented):** the **file-upload paperclip** (audio→transcribe, docs→RAG)
  is not yet added to the chat input — it needs a File→temp-path step for audio + a docs
  branch into `DocumentHarvest`. The `AuditLogView` read API (display of stored rows) is
  still the pre-existing stub; writes now land durably.

### S8 — Baked-in transcription  ✅ wired (live-verified command contract)
- **Before:** `TranscribeSkill` → pending stub; no engine; whisper excluded from catalog.
- **After:** `utils/execFileNoThrow.ts` (the one sanctioned spawn primitive — `execFile`,
  no shell, never throws), `TranscriptionProvider` abstraction (cloud STT drops in later),
  `WhisperEngine` (local whisper via `execFileNoThrow`, injected seams). `SkillRuntime`
  `transcribe` dispatch now runs the engine; `WhisperEngine` injected at onload on desktop.
- **Verified live:** the exact command the engine issues
  (`whisper <audio> --model … --output_format txt --output_dir …`) ran against the real
  `~/.venv/bin/whisper` and produced the transcript at exactly `<dir>/<stem>.txt` (the
  engine's read path). Full speech accuracy not asserted (synthesized tone clip).
- **Remaining (documented):** the `sauce:transcribe-file` command still needs a real file
  picker UI; catalog whisper-model un-exclusion is cosmetic and not done.

### S9 — Mobile SauceBot ↔ memory consumer  🟡 adapter built, injection pending
- **Done:** `bridge/MemoryBackendRagAdapter` wraps the bridge `MemoryBackend`
  (mobile: Hybrid → Bridge → desktop `LanceMemoryBackend` → LanceDB, lexical fallback) and
  exposes `semantic()`/`recall()` matching `RagAssemblerHost.semantic()`. Default-OFF safe.
- **Remaining (documented):** injecting the adapter into `ObsidianRagHost.semantic()` as the
  mobile fallback (when the local vector index is null) needs an optional param threaded
  through `CopilotRuntime`'s constructor + a lazy `() => this.memory` (bridge memory is
  built after the runtime in onload). Deferred to avoid a late ordering bug; the consumer
  piece is built + unit-tested. End-to-end needs a live phone + bridge.

### S10 — Rebrand Copilot → SauceBot  ✅ done
- ~18 user-facing strings → "SauceBot" (ribbon, menu, command names, view title, assistant
  label, settings tab/page, section hints, "Copilot Feed", install/credential copy, label
  allowlist, empty-state fixture). **Internal identifiers untouched** (verified by a guard
  test): `VIEW_COPILOT_CHAT="sauce-copilot-chat"`, `settings.copilot`/`COPILOT_DEFAULTS`,
  KeyVault key `copilot:<provider>:api-key`, command id `open-copilot`, CSS `sauce-copilot*`,
  storage `_addenda/_copilot`.

## Commits (oldest → newest)
```
3ac8505 F1 ProviderRegistry + shared OpenAI-compat harness (S1)
f84e2b4 F2 DiffEditor + agentic vault tools (S2)
9f97864 F3 Task model + Cron + SkillTaskScheduler (S3/S5)
8443a24 E  rebrand Copilot → SauceBot (S10)
1e6d7a2    wire F2 vault tools + F3 scheduler; retire run-skill
db7b23a B  whole-vault memory + graphify (S6)
df86418 F  mobile memory consumer adapter (S9)
06d29fc D  transcription engine + safe exec primitive (S8)
de9bd6f A  SlashSuggest '/' skill picker widget (S4)
8e7cb74 C  chat markdown render + functional inbox/audit/run-log views (S7)
06c352a    wire graphify + transcription + chat slash-picker (S4/S6/S8)
ff42e5b    wire ctx.audit → HMAC-chained audit log (S7)
```

## Conventions honored
- One source of truth per concern: collapsed the two model-listing/provider paths and the
  two `skillRunRing`s; activated dormant code (slash registry, functional views, graph
  tables, lmstudio-sdk) rather than rewriting.
- G-001 tokenized CSS; G-003 canon-safe writes via `updateViaContract`; ReDoS-safe (no
  dynamic regex, esp. `Cron`); **no shell exec** (`execFileNoThrow` only); secrets via
  KeyVault; every model-driven write approval-gated + diff-previewed; no silent failure.

## Could-not-verify / remaining (honest)
1. **S7 file-upload paperclip** — not implemented (needs File→temp-path for audio + docs→
   harvest branch).
2. **S7 AuditLogView read display** — writes are durable now; the view's row-read API was a
   pre-existing stub and is unchanged.
3. **S9 ObsidianRagHost injection** — adapter built + tested; the runtime-constructor
   threading (with lazy bridge-memory access) is the remaining one-hook wire; needs a live
   device for end-to-end.
4. **S8 `sauce:transcribe-file` picker UI** + catalog whisper un-exclusion — minor, not done.
5. **Full end-to-end runtime** (the assembled plugin inside Obsidian) was not exercised —
   `obsidian eval` is disabled on this host; verification was via the 4-gate, the build, and
   the two live external-dependency checks (embeddings + whisper command) above.
