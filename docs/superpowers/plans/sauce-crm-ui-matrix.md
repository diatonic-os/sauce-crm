# Plan: Sauce CRM UI Matrix v0.1

Expand the Sauce CRM Obsidian plugin into a fully canonized UI/UX matrix:
1:1 command-to-modal coverage, configurable 3-group ribbon, multi-segment
status bar, multi-view linked workspace, Fibonacci sizing tokens, complete
settings input matrix, autodetected local LLM endpoints (Ollama + LM Studio),
embedded vector DB (LanceDB or sqlite-vec), unified model registry with cards,
embeddings pipeline, RTL layer, and 1:1 backend↔frontend service bus.

Constraints:

- Preserve all 14 `VIEW_*` constants and 25 `addCommand` IDs in `src/main.ts` verbatim.
- Obsidian public API only; Lucide icons ≤ v0.446.0.
- Settings must use every `Setting()` variant (text, textArea, search, toggle, dropdown, slider, progressBar, colorPicker, momentFormat, button, extraButton).
- Endpoint autodetect: probe `http://localhost:11434` (Ollama) and `http://localhost:1234` (LM Studio); fallback to user URL with regex `^https?://[^\s]+$`.
- Cross-scope decisions emit DEC-### entries per `.sauce/CLAUDE.md`.
- MAX-WIP = 3. Default fleet: lmswarm-agents via `lmstudio-swarm`.

## Phase Z — Bootstrap (no-op root)

### Task T0: Plan bootstrap

Sentinel root task. Exists only so every wave-1 task in Phase A can declare
an explicit `**Depends on:** T0`, defeating the parser's positional
sequential-defaulting and unlocking true parallel dispatch. Marked done
immediately after plan ingest; no work.

**Phase:** Z
**Depends on:** T0
**Touches:** (none)

Steps:

- [ ] **T0.1** No-op. Mark done.

## Phase A — Foundations (parallel wave 1)

### Task T1: Icon contract

Build the icon registry: catalog all built-in Lucide names used by the plugin
and register custom `addIcon()` SVGs for CRM-specific glyphs (person, org,
touch, addendum, intro, promote, compat-matrix, heatmap, hierarchy, overdue,
parent-vault, copilot, skill, audit, ai-inbox, map, sync). Each custom SVG
fits a `0 0 100 100` viewBox per Obsidian icon guidelines.

**Phase:** A
**Depends on:** T0
**Touches:** plugin/src/ui/icons/IconRegistry.ts, plugin/src/ui/icons/svg/

Steps:

- [ ] **T1.1** Grep existing `setIcon`/`addRibbonIcon`/`setIcon(` callsites; record all built-in Lucide names.
- [ ] **T1.2** Author SVG source files under `src/ui/icons/svg/` (Lucide-style: 24×24, 2px stroke, round joins/caps).
- [ ] **T1.3** Implement `IconRegistry.register(plugin)` that calls `addIcon()` for every custom SVG and exports a typed `IconName` union.
- [ ] **T1.4** Verify: `tsc -noEmit -skipLibCheck` passes.

### Task T2: Fibonacci CSS tokens

Author Fibonacci sizing tokens and base layout classes in `styles.css`:
`--sg-w-1..89`, `--sg-h-1..89`, `--sg-gap-1..21`. Component classes for
`.sg-modal`, `.sg-view`, `.sg-status-segment`, `.sg-ribbon-menu`, `.sg-card`,
`.sg-table`, `.sg-form-row`. Use Obsidian theme variables (`--background-modifier-border`, `--text-muted`) so themes work.

**Phase:** A
**Depends on:** T0
**Touches:** plugin/styles.css

Steps:

- [ ] **T2.1** Append `:root` block with Fibonacci tokens.
- [ ] **T2.2** Add `.sg-*` component classes using logical properties (padding-inline-start/end) to ease RTL later.
- [ ] **T2.3** Verify: plugin builds, demo-vault loads styles without conflicts.

### Task T9: Endpoint autodetect

Probe `http://localhost:11434` (Ollama `/api/tags`) and `http://localhost:1234`
(LM Studio `/v1/models`) on plugin load and on settings open. If a probe
succeeds, store the endpoint in `settings.endpoints[]`. If not, surface a URL
input with regex shape validation. Emits a typed `EndpointDiscoveryEvent` on
the service bus (T15).

**Phase:** A
**Depends on:** T0
**Touches:** plugin/src/inference/EndpointProbe.ts, plugin/src/inference/EndpointRegistry.ts

Steps:

- [ ] **T9.1** Implement `EndpointProbe.probe(url, timeout=1500ms)` using `requestUrl` from obsidian API (not raw fetch — avoids CORS).
- [ ] **T9.2** Implement `EndpointRegistry` (in-memory + persisted to settings).
- [ ] **T9.3** Wire into plugin `onload()` as a non-blocking background probe.
- [ ] **T9.4** Verify: unit test with mocked `requestUrl` for present/absent endpoints.

### Task T12: Vector DB

Embed a vector DB. Prefer LanceDB Node binding bundled under `plugin/vendor/`;
fallback to `sqlite-vec` if LanceDB native binding fails to load on the
platform. Expose typed `VectorDB.store/query/delete/upsert`. Persistent store
under plugin data dir (resolve via `plugin.app.vault.adapter`).

**Phase:** A
**Depends on:** T0
**Touches:** plugin/src/services/VectorDB.ts, plugin/vendor/

Steps:

- [ ] **T12.1** Evaluate LanceDB Node binding bundle size; if > 80 MB, switch default to sqlite-vec.
- [ ] **T12.2** Implement `VectorDB` interface with both backends behind a feature detect.
- [ ] **T12.3** Persistent path resolves to `<vault>/.obsidian/plugins/sauce-crm/data/vectors/`.
- [ ] **T12.4** Verify: round-trip a 384-dim embedding through both backends.

### Task T15: Service bus

Unified typed service bus. Every UI surface (modal, view, ribbon, status,
command) calls into typed backend services: `PersonService`, `OrgService`,
`TouchService`, `RelationService`, `IntroService`, `AddendumService`,
`TagService`, `SyncService`, `InferenceService`, `EmbeddingService`,
`VectorService`. Single `ServiceBus` exposes them; no UI imports services directly.

**Phase:** A
**Depends on:** T0
**Touches:** plugin/src/services/ServiceBus.ts, plugin/src/services/index.ts

Steps:

- [ ] **T15.1** Inventory existing service-like code under `src/services/`, `src/copilot/`, `src/sync/`, `src/inference/`.
- [ ] **T15.2** Define service interfaces (read-only `ports/` directory).
- [ ] **T15.3** Implement `ServiceBus` as a typed registry; expose `plugin.services` getter.
- [ ] **T15.4** Verify: tsc passes, no UI file imports a concrete service class.

### Task T18: NVIDIA Maverick provider

Register NVIDIA NIM Llama Maverick (`meta/llama-3.3-70b-instruct`) as the
cloud escalation tier. Auth via `NGC_API_KEY` resolved from (in order):
plugin settings → `~/.config/orc-py/env-nim` → `process.env`. Endpoint:
`https://integrate.api.nvidia.com/v1`. Probe `/v1/models` to verify auth +
hydrate ModelRegistry. Used as the heavy voter in T19's QuorumCouncil and
as a model option in Copilot picker.

**Phase:** A
**Depends on:** T0
**Touches:** plugin/src/inference/providers/NvidiaMaverickProvider.ts, plugin/src/inference/ProviderRegistry.ts

Steps:

- [ ] **T18.1** Load API key with precedence ladder.
- [ ] **T18.2** Implement OpenAI-compatible chat-completions client via `requestUrl`.
- [ ] **T18.3** Implement Voter interface so the provider plugs into QuorumCouncil.
- [ ] **T18.4** Verify: live probe of `/v1/models` returns 200 + model list.

### Task T19a: Contract types

Define every type the LSP gate + quorum council depends on: `ContractId`,
`LockState` (OPEN | LOCKED | FROZEN), `Vote` (aye | nay | abstain),
`Voter`, `VoteCast`, `RoundtableSession`, `RoundtableProposal`,
`LSPContract<I>`, `MethodContract`, `SubtypeReport`, `LSPViolation`,
`LSPViolationKind`. Types only — no implementations, no side effects.

**Phase:** A
**Depends on:** T0
**Touches:** plugin/src/contract/types.ts

Steps:

- [ ] **T19a.1** Type-only file; no runtime imports.
- [ ] **T19a.2** `Vote` is the literal union `"aye" | "nay" | "abstain"` — NEVER boolean.
- [ ] **T19a.3** `LockState` includes the FROZEN recovery state.

### Task T19b: LSPGate

`LSPGate` class: `registerContract`, `verify` (structural LSP — checks
every method exists with declared arity), `respect` (await OPEN; waits
behind LOCKED with timeout; rejects on FROZEN), `lock`, `unlock` (drains
waiter queue FIFO), `freeze`, `state`, `snapshot`.

**Phase:** A
**Depends on:** T19a
**Touches:** plugin/src/contract/LSPGate.ts

Steps:

- [ ] **T19b.1** Waiter queue with per-waiter timeout.
- [ ] **T19b.2** Audit invariants pre and post each gated call (opt-in).
- [ ] **T19b.3** FROZEN is a terminal state; only an operator decision can move out of it.

### Task T19c: QuorumCouncil

`QuorumCouncil` class: `propose(proposal)` locks the contract, fans out
votes to every Voter in parallel with per-voter timeout, tallies weighted
ayes against quorum, unlocks the contract on PASSED, leaves it LOCKED on
REJECTED or NO_QUORUM. A voter that times out or throws counts as
`abstain` with the error in `rationale`.

**Phase:** A
**Depends on:** T19a, T19b
**Touches:** plugin/src/contract/QuorumCouncil.ts

Steps:

- [ ] **T19c.1** Per-voter timeout enforced via `Promise.race`.
- [ ] **T19c.2** Outcome: PASSED if aye-weight ≥ quorum; NO_QUORUM if remaining undecided weight could never lift it to quorum; REJECTED otherwise.
- [ ] **T19c.3** Session id derived from `crypto.randomUUID` (NOT Date+Math.random).

### Task T19d: Local voters (qwen3-coder + qwen3.5-27b)

Two `Voter` implementations that call local Ollama: `LocalFastVoter`
(qwen3-coder-30b) and `LocalDeepVoter` (qwen3.5-27b). Each posts a
structured prompt and parses the model's JSON response into a Vote.

**Phase:** A
**Depends on:** T19a
**Touches:** plugin/src/contract/voters/LocalFastVoter.ts, plugin/src/contract/voters/LocalDeepVoter.ts

Steps:

- [ ] **T19d.1** OpenAI-compat fetch via Obsidian `requestUrl`.
- [ ] **T19d.2** Strict JSON parse with abstain-on-failure fallback.
- [ ] **T19d.3** No `any`; every typed Ollama response surface.

### Task T19e: Cloud + operator + code-reviewer voters

Three more `Voter` impls: `CloudMaverickVoter` (NIM Maverick — re-uses
T18's NvidiaMaverickProvider client), `OperatorVoter` (interactive Notice
+ modal prompt), `CodeReviewerVoter` (deterministic heuristic — checks
diff for `any`, missing null guards, missing test coverage).

**Phase:** A
**Depends on:** T19a, T18
**Touches:** plugin/src/contract/voters/CloudMaverickVoter.ts, plugin/src/contract/voters/OperatorVoter.ts, plugin/src/contract/voters/CodeReviewerVoter.ts

Steps:

- [ ] **T19e.1** CloudMaverickVoter weight defaults to 2.
- [ ] **T19e.2** OperatorVoter blocks on a modal; timeout → abstain.
- [ ] **T19e.3** CodeReviewerVoter is pure-function over the diff text — no LLM call.

## Phase B — Contracts & audits (wave 2)

### Task T3: Command-modal matrix

Audit every `addCommand()` in `src/main.ts`. Produce `CANON-MATRIX.md`
enumerating each command's id, name, icon, hotkey, the modal class that
opens it, and the ribbon group it belongs to. Identify gaps where a command
opens nothing or duplicates a modal.

**Phase:** B
**Depends on:** T1
**Touches:** plugin/docs/CANON-MATRIX.md

Steps:

- [ ] **T3.1** Parse `src/main.ts` `addCommand` calls into a structured list.
- [ ] **T3.2** Cross-reference modal classes under `src/ui/modals/` (or wherever they live).
- [ ] **T3.3** Emit `docs/CANON-MATRIX.md` with one row per command.
- [ ] **T3.4** Flag gaps with a `TODO(T4)` marker in the matrix.

### Task T8: Settings matrix rewrite

Rewrite `src/settings/SettingsTab.ts` (or create if absent) as a sectioned
`PluginSettingTab` with: General, Ribbon Groups, Hotkeys, Models, Endpoints,
Embeddings, Vector DB, Sync, Telemetry, RTL, Theme. Uses every `Setting()`
input variant. Search input uses `AbstractInputSuggest` for icon picker.

**Phase:** B
**Depends on:** T1, T2
**Touches:** plugin/src/settings/SettingsTab.ts, plugin/src/settings/sections/

Steps:

- [ ] **T8.1** Define `SauceSettings` interface v2 with `Partial<>` defaults.
- [ ] **T8.2** Implement `setName().setHeading()` sections; one file per section under `settings/sections/`.
- [ ] **T8.3** Use every Setting variant at least once.
- [ ] **T8.4** Verify: round-trip a settings change through `loadSettings/saveSettings`.

### Task T10: Model registry

Pull `/api/tags` (Ollama) and `/v1/models` (LM Studio) into a unified
`ModelRegistry`. Cards expose: name, params, context window, quantization,
temperature defaults, capability tags. Render as a styled `.sg-table` in
settings and as Copilot picker.

**Phase:** B
**Depends on:** T9, T2
**Touches:** plugin/src/inference/ModelRegistry.ts, plugin/src/ui/components/ModelCard.ts

Steps:

- [ ] **T10.1** Define `ModelCard` type + capability tag taxonomy.
- [ ] **T10.2** Implement registry fetch with per-endpoint adapter.
- [ ] **T10.3** Render `.sg-table` of cards under Settings → Models section.
- [ ] **T10.4** Expose a Copilot picker dropdown that reads from registry.

## Phase C — UI surfaces (wave 3)

### Task T4: Modal completion

For every command in T3's matrix missing a modal, scaffold a `Modal` subclass
under `src/ui/modals/`. Each modal: Fibonacci width via `.sg-modal--w<n>` class,
header with icon, body with proper `Setting()` inputs, footer with primary +
secondary buttons. Dispatch onSubmit through ServiceBus (T15).

**Phase:** C
**Depends on:** T3, T2
**Touches:** plugin/src/ui/modals/

Steps:

- [ ] **T4.1** Generate one modal file per gap row in CANON-MATRIX.md.
- [ ] **T4.2** Common `BaseModal` superclass that enforces Fibonacci width + a11y attrs.
- [ ] **T4.3** Wire each modal to its corresponding service method.
- [ ] **T4.4** Verify: every command in `main.ts` opens a modal in demo-vault.

### Task T5: Ribbon groups

Implement 3 configurable ribbon icons (defaults: `users` → People group,
`network` → Graph group, `bot` → AI/Copilot group). Each opens a `Menu` of
grouped commands defined in `settings.ribbonGroups`. Groups + membership +
on/off toggles live in the Settings → Ribbon Groups section (T8).

**Phase:** C
**Depends on:** T1, T3, T8
**Touches:** plugin/src/ui/ribbon/RibbonController.ts

Steps:

- [ ] **T5.1** Read group config from settings on plugin load.
- [ ] **T5.2** Register one `addRibbonIcon` per active group with a `Menu` opener.
- [ ] **T5.3** Re-render on settings change (no plugin reload required).
- [ ] **T5.4** Verify: toggle group off → ribbon icon disappears.

### Task T6: Multi-segment status bar

Status bar segments: `SyncStatus`, `ModelStatus`, `QueueDepth`, `LastTouch`,
`ErrorCount`, `EmbedIndexStatus`. Each segment is one `addStatusBarItem()`
with `setIcon`, click handler opens the corresponding view or modal.

**Phase:** C
**Depends on:** T1
**Touches:** plugin/src/ui/statusbar/StatusBarController.ts

Steps:

- [ ] **T6.1** One controller class; one `Segment` interface per segment type.
- [ ] **T6.2** Segments subscribe to service-bus events (sync.state, model.state, queue.depth, touch.last, error.count, embed.progress).
- [ ] **T6.3** Click handler dispatches `openView()` or modal open.
- [ ] **T6.4** Verify: triggering a sync mutates the SyncStatus segment.

### Task T7: Workspace multi-view & linked groups

Layout presets ("Daily CRM", "Research", "Pipeline Review") that arrange the
14 existing views into split + tabs structures using `getLeaf(true)`,
`getLeftLeaf()`, `getRightLeaf()`, `createLeafInParent()`. Linked views via
`leaf.setGroup('sauce-crm-primary')` for cross-view navigation.

**Phase:** C
**Depends on:** T2
**Touches:** plugin/src/ui/workspace/LayoutPresets.ts, plugin/src/ui/workspace/LinkedGroupManager.ts

Steps:

- [ ] **T7.1** Define preset schema (which views, which split, which leaves linked).
- [ ] **T7.2** Implement `applyPreset(name)` that tears down + rebuilds layout.
- [ ] **T7.3** Add commands `open-layout-daily-crm`, `open-layout-research`, `open-layout-pipeline`.
- [ ] **T7.4** Verify: switching presets in demo-vault produces correct layout.

## Phase D — Inference + RAG (wave 4)

### Task T11: Embedding pipeline

`EmbeddingService`: token-aware chunker, embedder (uses local model from T10
or remote provider), batched ingest, incremental re-embed on Obsidian
`vault.on('modify' | 'create' | 'delete')` events. Writes through to VectorDB (T12).

**Phase:** D
**Depends on:** T10, T12
**Touches:** plugin/src/services/EmbeddingService.ts

Steps:

- [ ] **T11.1** Token chunker (window=512, overlap=64, configurable in settings).
- [ ] **T11.2** Batch embedder; backpressure when registry endpoint is slow.
- [ ] **T11.3** Vault event subscription with debounce.
- [ ] **T11.4** Verify: edit a note → vector store updates within 2s.

### Task T13: Copilot wire

Wire existing `CopilotChatView` to ModelRegistry (T10), EmbeddingService (T11),
and VectorDB (T12) for RAG over the vault. Streaming responses. Tool-use
surface exposes CRM commands (new-person, log-touch, promote-prospect,
new-intro, new-relation) so the model can invoke them.

**Phase:** D
**Depends on:** T3, T10, T11, T12
**Touches:** plugin/src/copilot/CopilotController.ts, plugin/src/copilot/CopilotChatView.ts

Steps:

- [ ] **T13.1** Build retrieval prompt: top-k from VectorDB + last touches + active note.
- [ ] **T13.2** Streaming response renderer in `CopilotChatView`.
- [ ] **T13.3** Tool-use schema for the 5 commands; route invocations through ServiceBus.
- [ ] **T13.4** Verify: ask "summarize recent touches with X" → model retrieves + answers.

## Phase E — i18n + addendum (wave 5)

### Task T14: RTL layer

`styles-rtl.css` + `RTLController.ts`. When `settings.rtl=true`, set
`dir="rtl"` on root containers and load mirrored class variants. Already use
logical properties in T2 so most mirroring is automatic.

**Phase:** E
**Depends on:** T2, T8
**Touches:** plugin/styles-rtl.css, plugin/src/ui/RTLController.ts

Steps:

- [ ] **T14.1** Audit T2 classes for any physical (left/right) properties; convert to logical.
- [ ] **T14.2** Controller toggles `dir` attr and stylesheet href on settings change.
- [ ] **T14.3** Verify with Hebrew + Arabic sample notes in demo-vault.

### Task T17: Contract addendum

Emit a contract addendum capturing: ribbon-group schema, settings shape v2,
vector-db on-disk format, model-registry JSON schema, embedding chunk format.
Update `plugin/manifest.json` description if surfaces materially changed.

**Phase:** E
**Depends on:** T8, T10, T12
**Touches:** plugin/docs/ADDENDUM-UI-MATRIX-v0.1.md, plugin/manifest.json

Steps:

- [ ] **T17.1** Draft addendum from final shapes in T8/T10/T12.
- [ ] **T17.2** Update manifest description.
- [ ] **T17.3** Append DEC-### entries to `.sauce/ops/DECISIONS.md`.

## Phase F — Integration smoke (final wave)

### Task T16: End-to-end smoke

vitest + Obsidian-mock harness exercising: every command opens its modal,
every view renders, every ribbon group opens its menu, every status segment
clickable, every settings input round-trips, endpoint autodetect runs,
embedding pipeline ingests, Copilot RAG returns a result.

**Phase:** F
**Depends on:** T4, T5, T6, T7, T8, T13, T14, T15
**Touches:** plugin/test/e2e/

Steps:

- [ ] **T16.1** Stand up Obsidian-mock harness (jsdom + workspace stubs).
- [ ] **T16.2** Spec one file per surface (commands, views, ribbon, statusbar, settings, copilot).
- [ ] **T16.3** CI green; failure budget = 0.
