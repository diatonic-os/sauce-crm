# SauceBot — Copilot & Sauce System Audit + Gap Analysis

> CON-SAUCEBOT. Current-state audit of the Sauce CRM Copilot (backend + frontend)
> across messaging, providers/harnesses, model loading/switching, skills→tasks,
> scheduling/cron, AI inbox / audit log / skill-run-log, vector/LanceDB memory,
> vault read/write, transcription, file upload, and the Copilot→**SauceBot**
> rebrand. Grounded in a 5-track source trace (file:line cited throughout).
> Companion docs: `01-SPEC.md`, `02-PATCHES.md`, `03-AGENT-PROMPT.md`.

## 0. Executive summary

The system is **substantially built but under-wired**: clean abstractions exist
(`ICopilotProvider` + normalized `CompletionEvent` stream, a unified
`ModelCatalog`, `ToolUseAdapter` agentic tool-loop, a full LanceDB store layer,
a `SlashCommand` model + CRUD UI), but several capabilities are *defined and
dormant* rather than missing. The highest-leverage work is **wiring + unifying**,
not greenfield.

LanceDB is now **verified working locally** (require-resolution + absolute data
dir fixes, commit `5976315`; 11 tables, `lance: "ready"`). So the memory/vector
layer's gaps are about **coverage and integration**, not existence.

### Status matrix

| Subsystem | State | Biggest gap |
|---|---|---|
| Provider/harness layer | 🟡 4 providers work; clean interface | No registry; OpenAI harness copy-pasted; 3 providers half-wired (nim/gemini/lmstudio-sdk) |
| Model load/switch | 🟡 works via settings | Providers re-`new`ed per call (no caching/JIT); two parallel model-listing paths |
| Tool-use / read-write | 🟡 skill tools + approval gate | **No generic read/write/edit tools; no diff path** |
| Skills | 🟡 18 skills, registry, run-log | 6 skills stubbed; settings UI is an empty stub; no persistence |
| Slash commands | 🔴 built but inert | **No runtime consumer anywhere** (no chat `/`, no editor-menu) |
| Tasks | 🟡 markdown-checkbox tasks exist | No link to skills; no execution; no schedule binding |
| Scheduling/cron | 🟡 interval scheduler (sync only) | **No cron; no persistence; skills not schedulable** |
| Memory / vector / RAG | 🟢 live (LanceDB) | **Only `type:`-typed notes mirrored** → whole vault invisible; RAG injects paths not content |
| Graphify (persistent) | 🔴 defined, dead | `graph_nodes`/`graph_edges` + `LanceGraphStore` never wired (`ensureGraphTables` uncalled) |
| Chat UI | 🟡 functional | Plain-text render (no markdown); no `/`; no file upload |
| AI inbox / audit / run-log | 🔴 "Real" stubs registered | Functional non-Real versions exist but **unregistered**; audit is a console stub |
| Transcription | 🔴 stub | `TranscribeSkill`→pending; no engine wired |
| File upload | 🔴 absent | No affordance in chat |
| Obsidian API enumeration | 🟢 generated (1194 symbols) | Generated artifact; not consumed at runtime *(track 5 pending)* |
| Rebrand → SauceBot | — | ~16 user-facing strings; must avoid internal IDs/keys/CSS/view-types |

Legend: 🟢 working · 🟡 partial · 🔴 missing/inert.

---

## 1. Provider / harness / routing layer  (`src/copilot/`)

**Current.** `ICopilotProvider` (`ICopilotProvider.ts:54-60`) = `{name, models[],
capabilities(), complete()→AsyncIterable<CompletionEvent>, embed()}` over a
`ProviderHost` transport (buffered `fetch` + optional `fetchStream`). Normalized
events: `text | tool_use | usage | done` (`ICopilotProvider.ts:44-52`). Five
provider classes implement it (Anthropic, OpenAI, LMStudio REST, Ollama, +
unrouted LMStudioSdk). `StreamParsers.ts` (`parseSse`/`parseNdjson`) is the one
shared primitive.

**Gaps.**
- **No provider registry.** Construction is a hardcoded `switch` in
  `CopilotRuntime.provider()` (`CopilotRuntime.ts:299-327`) *and* a parallel one
  in `embedProvider()` (`:245-263`). Adding one provider touches **~7 files / 5+
  switch-or-union sites** (runtime switches, `CopilotSettings.provider` union
  `:31`, `EmbeddingRuntimeConfig.provider` `:58`, `CopilotChatView` `CHAT_PROVIDERS`
  `:32-38`, `ProviderPicker.PROVIDERS` `:43-49`, `ModelCatalog` union+branch+static
  `:23,157-173,294-300`, `VAULT_BOUND_KEYS` `LocalLLMPage.ts:8-14`). Desync is
  already live: `nim`/`gemini` exist in catalog/credentials but **have no provider
  class** → model listing works, chat fails.
- **OpenAI-compatible harness is copy-pasted**, not shared: `OpenAIProvider` and
  `LMStudioProvider` are ~90% identical (tool schema, SSE loop, `toolBuf` by
  index, batch fallback, finish-reason map). No `OpenAICompatibleProvider` base.
  Anthropic legitimately differs (event taxonomy, `x-api-key`).
- **Providers re-`new`ed every call** (`CopilotRuntime.provider()` invoked in
  `ask()`/`completeOnce()`/`embed()`), so no instance caching, no warm
  connections, and dynamic `refreshModels()` state is discarded each turn. JIT
  model load/unload exists only in `LMStudioModelManager` (`:46-59`) but is
  unreachable because `LMStudioSdkProvider` isn't in the switch.
- **No pattern-based harness/routing** abstraction; "routing" = read settings at
  call time. No capability/cost selector.

**Key files:** `CopilotRuntime.ts`, `ICopilotProvider.ts`, `*Provider.ts`,
`ModelCatalog.ts`, `ToolUseAdapter.ts`, `StreamParsers.ts`.

## 2. Tool-use & vault read/write/diff

**Current.** `ToolUseAdapter` (`ToolUseAdapter.ts:24`) turns registered skills'
`contract.inputs` into JSON-schema tools (`asTools()` `:46-63`); `CopilotRuntime.
ask()` runs an agentic loop capped at `MAX_TOOL_TURNS=8` (`:387-474`) with an
optional `ApprovalGate` (risk-tiered, deny→`{error}`, `:89-104`). Tools = the 18
CRM skills bound by `SkillRuntime.bindToCopilot()` (`SkillRuntime.ts:55-76`).

**Gaps.**
- **No generic vault tools** (`read_file`/`propose_edit`/`apply_edit`). The system
  prompt says "read these via tool if needed" (`CopilotRuntime.ts:355`) but **no
  read-file tool is registered.**
- **No diff path anywhere** — `grep diff/applyDiff` across copilot+skills = 0.
  `ReviewChangesSkill` is described "diff vault vs snapshot" but just delegates to
  `ctx.call()` (`ReviewChangesSkill.ts:28`). Writes are direct mutations via
  `EntityService`, not preview-then-apply.

## 3. Skills · Tasks · Slash commands · Scheduling

**Skills (current).** `Skill` base (`Skill.ts:61`) + `SkillContract`
(`:33`, inputs/level/mutable/autonomy). 16 hard-instantiated in
`SkillRegistry` ctor (`SkillRegistry.ts:32-49`); settings in-memory only (**not
persisted**). `SkillRuntime.run()` (`:78`) is the single execution entry (pushes
to `skillRunRing`). `dispatch()` (`:155`) routes LLM skills to `copilot.ask()`,
runs structural skills locally, and **returns `pending` stubs for 6 external
skills** (`geocode/transcribe/capture-call/schedule-touch/import-contacts/
verify-email`, `:184-188`). `SkillsPage.ts` settings tab is an **empty stub**.

**"Run skill" surfaces (to remove):** command `run-skill` (`main.ts:1291`,
`V2Commands.ts:39`, hotkey Mod+K), `SkillPickerModal`+`SkillArgsModal`, ribbon
menu (`main.ts:891`), and chat "Suggested Skills" cards that only insert
boilerplate text (`CopilotChatView.ts:357`).

**Slash commands (current).** `SlashCommand {id,name,prompt,inMenu,slashCmd}`
(`SlashCommands.ts:5`); 13 generic text-rewrite defaults (`:19`); full CRUD editor
(`command.ts`). **CRITICAL: no runtime consumer** — `prompt`/`inMenu`/`slashCmd`
are read *only* by the settings editor. No chat `/` handler, no editor-menu
injection, no send path. Slash commands are **defined, persisted, editable, and
completely inert**, and are disjoint from skills.

**Tasks (current).** A real but separate concept: `TaskFrontmatter`
(`domain/schemas/index.ts:255`, `{type:"task",title,status,contact?,due?,
priority?,blocked_by?}`), `TasksEmitter` (round-trips Tasks-plugin checkbox
lines), `TasksService` (list/add/setStatus). **No skill binding, no execution, no
schedule.** A task = a to-do checkbox, not a runnable unit.

**Scheduling (current).** `Scheduler` (`sync/Scheduler.ts`): `ScheduledJob`
with a fixed `SyncFrequency` enum (realtime…daily…manual) → ms. **No cron, no
persistence** (in-memory Maps, lost on reload). Only integration-sync resources
are scheduled (`SyncEngine.wireResources` `:18`); **skills are not schedulable**.

**Gaps (the desired merge).**
- Remove "run skill" surfaces; make **skills runnable as Tasks** — manually AND on
  a schedule. Needs: cron parser + persistence in the scheduler; `TaskFrontmatter`
  extended with `skill_id`/`skill_args`/`schedule`(cron|interval)/`last_run`/
  `next_run`; a `SkillTaskScheduler` binding tasks→`SkillRuntime.run`.
- **Skills become slash commands in chat:** a `/` popup in `CopilotChatView`
  (none today) sourced from `plugin.skills.list()`, scrollable + selectable; pick
  skill + free-text → force that skill's tool call with the message as args
  (execution path already exists via the tool loop).
- Wire run-log/audit/inbox to tasks: `skillRunRing` is ephemeral + skill-only
  (add `taskId`/`trigger`); `ctx.audit` is a **console stub** (`SkillRuntime.ts:95`)
  → write to real AuditLog; AI inbox is inference-only (add task-run proposals).

## 4. Memory · Vector · RAG · Graphify  (`src/backend/lance/`, `src/copilot/RagAssembler.ts`)

**Current (LIVE).** Single LanceDB backend (`backend/lance/index.ts:65-118`), 11
tables (`LanceSchema.ts:14-26`): `entities`, `edges`, `tags`, `touches`,
`addenda`, `embeddings` (entity vectors), `doc_chunks` (uploaded-doc RAG vectors),
`audit_log`, `provenance`, `api_keys_enc`, `sync_state`. FTS via Tantivy on
`entities.body_md` (`LanceFtsIndex.ts:17`). Embedding dim fixed at 768
(`LanceSchema.ts:127`). RAG via `RagAssembler.assemble()` (`:62-147`):
pinned→focus→1-hop→semantic top-k→touches→addenda, vector-first w/ lexical
fallback (`CopilotHostAdapters.ts:135-164`).

**Gaps.**
- **Whole-vault coverage gap (biggest).** `MirrorSync.build()` returns null for any
  note lacking `type:` frontmatter (`MirrorSync.ts:111-115`) — plain notes (the
  bulk of a real vault) are never mirrored/embedded/searchable. "Entire vault" is
  iterated then silently filtered to Sauce-typed entities.
- **RAG injects paths, not content** for vault entities — only a path list +
  recent touches go into the prompt (`CopilotRuntime.ts:353-361`); only harvested
  *doc-chunk* text is inlined. Model must tool-read to get entity content (and
  there's no read tool — §2).
- **Persistent graphify is dead.** `graph_nodes`/`graph_edges` + `LanceGraphStore`
  (`graph.ts`) exist but `ensureGraphTables` is never called and `GraphService` is
  constructed with no store (`wireSvcV1.ts:403`). No pipeline writes vault
  notes/wikilinks into the graph tables; no `/graphify` integration.
- **Memory not a shared queryable surface** beyond chat: `SearchService` is purely
  lexical/tag-cosine and never consults Lance vectors.
- **Single global embedding dim**; switching to a different-dim model silently
  skips writes (`MirrorSync.ts:101`) with no rebuild prompt. RAG defaults OFF
  (`FeatureSettings.ts:68-90`) — needs an embedding endpoint live (console showed
  LM Studio `model_catalog.miss` → confirm the embed model is served).

## 5. Chat UI · Inbox · Audit · Run-log · Transcription · Upload  (`src/ui/views/v2/`)

**Chat (current).** `CopilotChatView` (`VIEW_COPILOT_CHAT="sauce-copilot-chat"`,
registered `main.ts:714`): header model/provider/embeddings selects (catalog-fed),
icon toolbar (new/settings/history/more), transcript, footer textarea + optional
**Web-Speech mic** + send. **Assistant text rendered via `.setText` — no markdown
rendering** (`:685-687`). Assistant label literally `"copilot"` (`:707`). Sessions
persist to `_addenda/_copilot`.

**Inbox/Audit/Run-log (current).** For all three, the **"Real" stub is what's
registered** and the fuller non-Real version is **dormant/unregistered**:
- `AIInboxViewReal` = placeholder text (`:18-24`); `AIInboxView` is fully
  functional (InferenceEngine proposals + accept/reject writing frontmatter) but
  unregistered.
- `AuditLogViewReal` = "pending implementation"; `AuditLogView` reads
  `v2.auditLog` (but the class only exposes `append`+`verifyChain`, so empty).
- `SkillRunLogViewReal` renders its own `skillRunRing`; `SkillRunLogView` has a
  **second, different** ring instance — split-brain buffer.

**Transcription (current).** `TranscribeSkill` → `ctx.call("transcribe")` →
`SkillRuntime` **pending stub** (`:184-188`). No whisper/audio engine; whisper
models are *excluded* from the catalog (`ModelCatalog.ts:118`);
`ContentService.recordAudio()` rejects (`wireSvcV1.ts:266`). Host has a
`mrc-voicenote-transcribe` (local whisper large-v3-turbo, CUDA) skill but the
plugin has zero integration.

**File upload (current).** **None** in chat. Reference `<input type=file>` pattern
at `ImportMappingModal.ts:52-70`; RAG harvest path at `main.ts:573`.

**Rebrand → SauceBot.** ~16 user-facing "Copilot" strings to change (ribbon
tooltip `main.ts:872`, menu `:876`, commands `:1287`/`V2Commands.ts:26`, view title
`CopilotChatView.ts:96`, assistant label `:707`, settings `CopilotPage.ts:4`,
`SauceGraphSettingTab.ts:50-51`, section hints, `Views.ts:107` "Copilot Feed").
**Must NOT change:** class names, `VIEW_*` type IDs (workspace layout),
`settings.copilot`/`COPILOT_DEFAULTS`, KeyVault key `copilot:<provider>:api-key`,
command id `open-copilot` (hotkeys), CSS `sauce-copilot*`/`sauce-cp-*`, storage
folder `_addenda/_copilot`.

## 6. Obsidian API enumeration & vault context

**Current.** SDK generator emits `sdk/generated/api-catalog.ts` (~1194 symbols)
from the obsidian-developer-docs reference; it's a **build-time artifact**
(verified by `sdk:check`), not consumed at runtime. *(Track-5 deep-dive on
read/write primitives + diff API recommendations pending — will refine §2/§6 in
the SPEC.)*

---

## 7. Cross-cutting themes (drives the SPEC)

1. **"Built but not wired" dominates.** Slash commands, the functional inbox/audit
   views, the persistent graph layer, LMStudioSdk JIT loading, and 6 skills are
   all *implemented and dormant*. Prioritize wiring over rewriting.
2. **Two-of-everything.** Two model-listing paths (provider `models[]` vs
   `ModelCatalog`), two `skillRunRing` instances, Real vs non-Real view pairs.
   Unify to one source of truth each.
3. **Skills ≠ Tasks today; the end-state merges them** (task = skill binding +
   schedule; skill = chat `/` command + scheduled/manual task).
4. **No generic, diff-based vault read/write** — the single biggest capability gap
   for an agentic copilot.
5. **Memory exists but sees only CRM entities** — lifting the `type:` filter +
   inlining content + activating graphify is what delivers "understands the whole
   vault."
6. **A provider registry collapses ~7-file friction to one entry** and is the
   keystone for "easily add providers down the road."
