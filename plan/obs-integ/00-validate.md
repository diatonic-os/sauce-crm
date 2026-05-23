# CON-OBS-INTEG-001 — Phase 0 Validation

**Shard:** Phase-0 gate · **Deps:** none · **Owner:** orchestrator · **Status:** `RESOLVED` (operator decisions recorded 2026-05-23 — see bottom)
**Date:** 2026-05-23 · **Repo:** `Diatonic-OS/sauce-crm` (confirmed via `git remote`) · **manifest.json:** id=`sauce-crm` v`0.2.0` minAppVersion=`1.5.0`

This is the Phase-0 product. It resolves assumptions A-001..A-007 against the **actual tree**, records DEC amendments, and lists the blockers that gate the t=0 fanout. No production code has been written.

---

## A-005 / A-006 — plugin + tasks-api enumeration  → **BLOCKED (tool unavailable)**

The mandated first command:

```bash
obsidian eval code="JSON.stringify({community:Object.keys(app.plugins.plugins).sort(),core:Object.keys(app.internalPlugins.plugins).sort(),tasksApi:Object.keys(app.plugins.plugins['obsidian-tasks-plugin']?.apiV1||{}).sort()})"
```

**Result (CLI enabled by operator 2026-05-23 — A-005/A-006 now empirically PASS):**

```json
{"community":["copilot","dataview","hot-reload","obsidian-tasks-plugin","sauce-crm","templater-obsidian"],
 "core":["audio-recorder","backlink","bases","bookmarks","canvas","command-palette","daily-notes","editor-status","file-explorer","file-recovery","footnotes","global-search","graph","markdown-importer","note-composer","outgoing-link","outline","page-preview","properties","publish","random-note","slash-command","slides","switcher","sync","tag-pane","templates","webviewer","word-count","workspaces","zk-prefixer"],
 "tasksApi":["createTaskLineModal","editTaskLineModal","executeToggleTaskDoneCommand"]}
```

- **A-005 → PASS.** `app.plugins.plugins` (community) and `app.internalPlugins.plugins` (core) are both enumerable. Confirmed.
- **A-006 → PASS as written.** `obsidian-tasks-plugin.apiV1` has **exactly** the 3 documented methods — no extras. `TasksAdapter`'s `TasksApiV1` interface is complete; SH-F introspector output is deterministic. **SH-F is UNBLOCKED.**

**Findings carried forward:**
- Installed community plugins here: copilot, dataview, hot-reload, obsidian-tasks-plugin, sauce-crm, templater-obsidian. **NOT installed:** obsidian-kanban, obsidian-meta-bind-plugin, quickadd, obsidian42-brat → B3–B6 adapters correctly `detect()` not-installed; their canonical IDs stand.
- **Canonical core plugin IDs** differ from some CW-* labels (no code impact — core services use injected hosts, not literal ID lookups). Correct IDs for any future internalPlugins wiring: search→`global-search`, backlinks→`backlink`, outgoing-links→`outgoing-link`, quick-switcher→`switcher`, tags-view→`tag-pane`, unique-note-creator→`zk-prefixer`, format-converter→`markdown-importer`, properties-view→`properties`, web-viewer→`webviewer`, slash-commands→`slash-command`.

---

## A-001 — IntegrationRegistry is Map-backed register/get/list/dispose  → **FALSE**

`src/integrations/IntegrationRegistry.ts` is **not** a generic registry. It is a hardcoded aggregate over 5 concrete providers (`google`, `microsoft`, `apple`, `notion`, `twilio`) exposing `list()`, `byId(id)`, `resourcesFor(id)`, `syncAll()`, `setToken()`. There is **no `register()` and no `dispose()`**; it holds a `private resources = new Map(...)` internally only.

**Amendment (DEC-005 unchanged; ObsidianPluginRegistry contract clarified):**
> `ObsidianPluginRegistry` is a **new** class, Map-backed (`register(adapter)` / `get(id)` / `list()` / `dispose()`), modeled on the *conceptual* registry role of `IntegrationRegistry` (the `list()`/`byId()` surface) — **not a literal structural mirror**. It does not extend or modify `IntegrationRegistry`. DEC-005's adapter contract (`detect/optimize/getServiceFacade/getOptimizationDiff/supportsBeta`) stands.

## A-002 — settings/home.md drives a markdown-rendered settings index  → **FALSE**

`settings/home.md` exists, but `plan/00-audit.md` line 13 states **"No settings Markdown renderer exists."** Settings render from **TypeScript** via Obsidian `Setting` in `src/ui/settings/sections/*.ts` (14 sections incl. existing `integrations.ts`). A reusable `ToggleRow` primitive and a typed settings spine (`src/settings/FeatureSettings.ts`) already exist (PLAN-FEATURE-PROGRAM T1).

**Amendment (T-A-05):**
> `IntegrationsSection` follows the **existing TS `sections/*.ts` pattern** (extend/replace `sections/integrations.ts`), wiring controls through `FeatureSettings` + `ToggleRow`. It is **not** registered through a markdown renderer (none exists). The "3-tab Services|Community|Core" grouping is realized in TS.

## A-003 — src/v2 is canonical, src/* is dual-shipped  → **FALSE**

No `packages/`. **Zero React** in the tree (`grep -rl 'from "react"' src/` → empty). Svelte exists only under `src/ui/svelte/` (5 files). `src/v2/` is a feature surface, not a React/Svelte parity mirror. CON-UI-CANON-001's `packages/ui-react/` (plan/03-react-adapter.md) was **never built**.

**Consequence — CONFLICT-1 (see below):** R-005 / DEC-011 ("dual-ship React + Svelte") is **currently unsatisfiable** — there is no React adapter to ship into. New code lands in `src/*` only (TS, optionally Svelte where the existing Svelte surface applies).

## A-004 — LanceDB nodes+edges DDL not yet finalized  → **TRUE (proceed, with coordination)**

`PLAN-LANCEDB-MIGRATION.md` is **storage-complete** but defines no graph `nodes`/`edges` tables. Existing tables: `api_keys_enc`, `audit_log`, entity mirror, `embeddings`, `fts`, `provenance` (`LanceProvenanceStore.ts`), `doc_chunks` (`LanceDocChunkStore.ts`). SH-E (`src/backend/lance/graph.ts`) defines **new** nodes+edges DDL conforming to the `LanceConnection.ts` / `LanceSchema.ts` conventions (`createTable`/`mergeInsert`/`query().where()`).
> **Note:** `LanceProvenanceStore` already models a lineage chain — SH-E must coordinate so the graph `edges` table does not duplicate provenance lineage. STOP-105 applies if the migration DDL shifts mid-shard.

## A-007 — esbuild supports adding sdk generator entrypoint  → **PASS (adapted)**

`esbuild.config.mjs` has a single entrypoint (`src/main.ts`), but the SDK generator is **already** built independently: `package.json` `sdk:gen` = `esbuild sdk/generator/generate.ts --bundle --platform=node --format=esm | node`. `sdk:check` = `sdk:gen && git diff --exit-code -- sdk/generated`.
> **Amendment (DEC-006 / T-F-01):** `introspect-tasks.ts` follows the **existing `sdk:gen` separate-CLI pattern** (its own esbuild→node invocation), **not** a second target in `esbuild.config.mjs`. `sdk:check` already exists and gates `sdk/generated` — T-F-03 adds the `obsidian eval` introspection step ahead of it (blocked by A-005/A-006 CLI).

---

## Assumption summary

| ID | Claim | Result | Action |
|----|-------|--------|--------|
| A-001 | IntegrationRegistry = Map register/get/list/dispose | **FALSE** | ObsidianPluginRegistry is a new Map class, conceptual mirror only |
| A-002 | settings/home.md = md-rendered index | **FALSE** | IntegrationsSection uses existing TS `sections/*.ts` pattern |
| A-003 | src/v2 canonical, src/* dual-shipped | **FALSE** | No React exists → land in `src/*`; **R-005 conflict** |
| A-004 | graph DDL not finalized | **TRUE** | Define new `graph.ts`, coordinate w/ provenance |
| A-005 | app.plugins/internalPlugins enumerable | **BLOCKED** | obsidian CLI disabled — cannot verify |
| A-006 | tasks apiV1 = 3 methods | **BLOCKED** | obsidian CLI disabled — cannot verify |
| A-007 | esbuild adds sdk entrypoint | **PASS** | use existing `sdk:gen` separate-CLI pattern |

---

## HARD BLOCKERS (gate the fanout — operator decision required)

- **BLOCKER-1 — No `dev` branch.** Local branches: `main`, `feat/design-system`, `feat/getting-started`, `feat/modal-cards`. The per-task contract and DEC-008 root everything at `dev` (BRAT beta source). There is no `dev`. → Need: create `dev` from `main`, or redirect the branching base.
- **BLOCKER-2 — obsidian CLI disabled.** Blocks A-005/A-006 verification + SH-F introspection. → Need: enable CLI (Settings › General › Advanced), or run SH-F against documented shapes + re-verify later, or defer SH-F.
- **BLOCKER-3 — External / irreversible actions.** SH-I opens a PR against the real external repo `iamdrewfortini/obsidian-releases`; the per-task contract says push + open PRs on the real public `Diatonic-OS/sauce-crm`. → Need explicit authorization for any `git push` / PR; default is local commits only, SH-I drafted-not-opened.

## CONTRACT CONFLICTS (need a fidelity decision)

- **CONFLICT-1 — R-005/DEC-011 dual-ship React+Svelte is unsatisfiable.** No React layer exists (A-003). Options: (a) Svelte-only / TS-only to match the codebase; (b) scope-in building a React adapter (large, outside this contract).
- **CONFLICT-2 — Zod vs codebase convention.** `src/domain/schemas/index.ts` is explicitly **"no Zod dependency"** (lightweight typed predicates). T-E-01 mandates "Zod schemas". Options: (a) implement new entities in the existing predicate style (matches codebase); (b) add Zod (new dep, breaks convention).
- **CONFLICT-3 — Entity reconciliation.** Existing `EntityType` already defines `idea`, `task`, `ledger-entry` (+ `intro`, `relation`, `followup`, `interaction`, `conversation`, `inbox`, `thread`, `metric`, `rollup`) under shapes that differ from DEC-003's 14. "9 new" is really *fewer-new + reconcile-existing*. SH-E must map DEC-003 onto the existing union, not blindly add 9.

> Also noted: `PLAN-FEATURE-PROGRAM.md` records the operator's standing convention for this repo — **"execution = direct TDD (not orc swarm)"**. The phase-gated fanout can run as sequential TDD shards in this one session rather than as many pushed PRs.

---

## OPERATOR DECISIONS (2026-05-23)

| # | Question | Decision | Effect |
|---|----------|----------|--------|
| BLOCKER-1 | Branch base | **Create `dev` from main** | All `feat/<T-id>` branches root at `dev`; DEC-008 honored. |
| BLOCKER-2 | obsidian CLI | **Operator enables it now** | Once enabled, run the A-005/A-006 eval and lock; **SH-F unblocks**. SH-F stays BLOCKED only until the eval succeeds. |
| BLOCKER-3 | Push / PR auth | **Push branches, no external PR** | May push `feat/*` to `Diatonic-OS/sauce-crm` origin. **No** external PR to `iamdrewfortini/obsidian-releases`; SH-I authors artifacts only (T-I-01/02), does not open the PR. |
| CONFLICT-1 | React dual-ship | **Match the codebase** | **R-005 / DEC-011 amended:** drop the React requirement. New UI ships TS + Svelte (matching `src/ui/svelte/`). No `packages/ui-react/`. |
| CONFLICT-2 | Zod schemas | **Match the codebase** | **T-E-01 amended:** new entities use the existing lightweight predicate `EntitySchema<T>` style in `src/domain/schemas/`. **No Zod dependency added.** |
| CONFLICT-3 | Entity reconciliation | engineering judgment (no question) | SH-E maps DEC-003's 14 onto the existing `EntityType` union; existing `idea`/`task`/`ledger-entry` are reconciled, not duplicated. |

**DEC amendments locked by these decisions:**
- **DEC-011 (ui-dual-ship)** → amended: "every new settings card + modal ships TS + Svelte adapter (React dropped — no React layer exists in repo, A-003)."
- **R-005 (styling)** → amended: "new components ship TS/Svelte; tokens inherited from CON-UI-CANON-001 where present."
- **T-E-01 / DEC-003 schema style** → amended: "predicate `EntitySchema<T>` style, no Zod (matches `src/domain/schemas/index.ts`)."
- **DEC-008** → confirmed as-is; `dev` created from `main`.

**Phase-0 gate: PASSED for fanout** (SH-F deferred pending CLI; SH-I PR-open deferred per BLOCKER-3).
