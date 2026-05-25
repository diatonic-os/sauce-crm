# CON-SAUCEBOT — Build Prompt (copy-paste to the next agent)

---

You are implementing **CON-SAUCEBOT**: upgrading the Sauce CRM "Copilot" into
**SauceBot** — a fully-wired, provider-agnostic, vault-aware agentic assistant.
Repo: `/home/daclab-ai/Desktop/sauce-graph/plugin` (github Diatonic-OS/sauce-crm,
branch `main`, push no PR). The plugin is desktop+mobile Obsidian (TS + Svelte,
no React), LanceDB-backed (now verified live, commit `5976315`).

## Read first (your spec is already written)
- `plan/saucebot/00-AUDIT.md` — current-state + gap analysis (file:line grounded).
- `plan/saucebot/01-SPEC.md` — target architecture (S1–S10).
- `plan/saucebot/02-PATCHES.md` — sequenced, parallelizable patch-sets (F1–F3, A–F)
  with exact files/anchors, tests, and the dependency graph. **Follow it.**
Do NOT re-audit — the decomposition is done; ingest it and execute.

## What you are building (from the spec)
1. **Provider registry + shared OpenAI-compat harness** (S1/F1): one `ProviderSpec`
   entry per provider auto-creates all downstream (runtime, catalog, UI lists,
   credential keys). Anthropic standalone; OpenAI/LMStudio/nim/openrouter/groq/
   gemini via the shared base; wire lmstudio-sdk (JIT load). Cache provider
   instances.
2. **Agentic vault read/write via diffs** (S2/F2): `DiffEditor` on `Vault.process`;
   `read_note`/`search_vault`/`propose_edit`/`apply_edit`/`create_note`/
   `web_research` tools registered to `ToolUseAdapter`, approval-gated (diff
   preview), canon-safe via `FilesService.updateViaContract`; `VaultContextProvider`
   link/backlink graph from `resolvedLinks`.
3. **Skills → Tasks** (S3/F3): tasks carry a skill binding + schedule; run manually
   or on **cron** (`Cron.ts` + `SkillTaskScheduler`, persistent). **Remove the
   "run skill" picker/commands.** Make `SkillsPage` real + persist skill settings.
4. **Skills as chat slash commands** (S4/A): `/` in the SauceBot chat opens a
   scrollable selectable list; pick a skill + type a message → the agent executes
   that task (`forceSkill`). Wire the currently-inert slash registry.
5. **Whole-vault memory + graphify** (S6/B): mirror untyped notes (lift the `type:`
   filter), inline entity content into prompts, activate `graph_nodes`/`graph_edges`
   (`ensureGraphTables` + `LanceGraphStore` + `VaultGraphIndexer`), semantic
   `SearchService`, embedding-dim safety.
6. **Chat UI + views** (S7/C): markdown rendering; **file-upload paperclip**
   (audio→transcribe, docs→RAG); register the **functional** AI-inbox/audit/
   skill-run-log views (retire the Real stubs); unify the two run-log rings; wire
   `ctx.audit`→`LanceAuditStore`.
7. **Baked-in transcription** (S8/D): bundle whisper.cpp (`large-v3-turbo`) via
   `execFileNoThrow`; wire the `transcribe` skill + file picker; `TranscriptionProvider`
   abstraction for future cloud STT.
8. **Mobile SauceBot ↔ memory** (S9/F): route mobile copilot RAG/search through the
   bridge `LanceMemoryBackend` (coordinate with the bridge session).
9. **Rebrand Copilot → SauceBot** (S10/E): user-facing strings ONLY; never touch
   class names, `VIEW_*` ids, `settings.copilot`, KeyVault key
   `copilot:<provider>:api-key`, command id `open-copilot`, CSS `sauce-copilot*`,
   or `_addenda/_copilot`.

## Execution model — MAXIMUM PARALLELISM
1. **Foundation first, committed, in this order-independent set but before fan-out:**
   **F1 (provider registry)**, **F2 (DiffEditor + tools)**, **F3 (task model + cron)**.
   These unblock everything; commit each green. They may be built concurrently in
   isolated worktrees (disjoint files) then integrated.
2. **Then dispatch the parallel wave** (`superpowers:dispatching-parallel-agents`),
   one agent per surface, **non-overlapping files**, each consuming F1–F3:
   - **Agent A** — chat `/` slash skill picker (`SlashSuggest` + chat input region
     + `ask({forceSkill})`).
   - **Agent B** — whole-vault memory + graphify (`MirrorSync`, `VaultGraphIndexer`,
     graph wiring, `SearchService`, rag settings).
   - **Agent C** — chat render + upload + register functional inbox/audit/run-log
     (chat render/header/upload regions; view registrations; audit wiring).
   - **Agent D** — transcription engine + wiring.
   - **Agent E** — rebrand strings (smallest; lands anytime).
   - **Agent F** — mobile memory consumer.
   `CopilotChatView.ts` and `SkillRuntime.ts` are shared by A/C and F2/F3 — split by
   **method/region ownership** per `02-PATCHES.md` to avoid merge thrash; the
   orchestrator integrates and resolves.

## Hard conventions (do not violate)
- **Per-change 4-gate + build green before each commit:**
  `npm run lint && npm run typecheck && npm run test && npm run sdk:check` then
  `npm run build`. Baseline = **660 tests / 130 files**, lint **0 errors**
  (6 pre-existing warnings ok), build exit 0, `sdk:check` exit 0 (don't perturb
  `sdk/generated`).
- **R-002:** add/adjust a vitest assertion wherever logic/structure changes
  (classes/structure, not pixel values). New units (DiffEditor, Cron, registry,
  scheduler, SlashSuggest) get unit tests.
- **G-001:** tokenized CSS only (`--sg-*`/`sauce-*`/`sg-*`), no inline styles for
  spacing. **G-003:** canon files only via `CanonGuard`/`updateViaContract`.
- **Safety:** ReDoS-safe (no dynamic regex — esp. `Cron.ts`); **no `exec`** (use
  `src/utils/execFileNoThrow.ts`); secrets via KeyVault only; every model-driven
  vault write is approval-gated and diff-previewed (never auto-apply high-risk).
- **No silent failure:** surface unreachable endpoints / locked vault / embedding
  dim mismatch.
- Match existing codebase style; small attributed commits; **push to `origin/main`,
  NO PR.** Don't modify operator-owned/untracked files unless they're the target.

## Per-area deliverable
For each PS: implement → unit tests → 4-gate + build green → small attributed
commit. When the wave is integrated, run the full gate, write
`deliverables/CON-SAUCEBOT/FINAL.md` (before/after per S1–S10 + new test count +
files touched), and **push to `origin/main` (no PR)**.

## Guardrails
- This is wiring/unifying, not greenfield — prefer activating dormant code
  (functional views, slash registry, graph tables, lmstudio-sdk) over rewriting.
- Collapse the duplicate model-listing paths and the two `skillRunRing`s to one
  source of truth each.
- The provider registry is the keystone — land it first so provider additions and
  UI lists derive from one place.
- Verify live where possible (LM Studio serving an embed model for RAG; transcribe
  on a sample clip); note any step you could not verify in `FINAL.md`.

---
*End of CON-SAUCEBOT build prompt.*
