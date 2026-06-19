# SauceOM — Repo Conventions & Fold-In Audit

> SauceOM (Sauce Operating Memory) is the umbrella Obsidian plugin (manifest id
> `sauce-crm`, kept stable for installs). **Sub-feature packaging names:**
> **Sauce CRM** (people/orgs/touches), **Sauce RG** (relationship graph),
> **SauceBot** (AI copilot), **Sauce Brain** (the indexed/crystallized memory).
> The umbrella name appears on the plugin manifest and the per-view brand mark;
> sub-feature names appear on their own ribbons/views.

## Conventions found (match these for any new work)

| Area | Convention | Evidence |
|---|---|---|
| **Views / leaves** | `ItemView` subclass exporting a `VIEW_*: ViewTypeId = asViewTypeId("…")`; registered in `main.ts` via `this.registerView(VIEW_*, l => new X(l, this))`; opened with `this.openView(type)` (right sidebar vs main tab by `_RIGHT_SIDEBAR_VIEWS`). Legacy views share a `BaseView` in `src/ui/views/Views.ts`. | `main.ts:registerViews`, `src/ui/views/v2/*` |
| **Settings** | One `SauceGraphSettings` interface + `DEFAULT_SETTINGS` in `main.ts`; tabbed `SauceGraphSettingTab` with per-section render fns in `src/ui/settings/sections/*` (e.g. `renderCopilot`); persisted via `saveSettings()` (redacts secrets). | `main.ts:227+`, `src/ui/settings/sections/copilot.ts` |
| **Services / adapters** | Logic services under `src/services/*` and `src/saucebot/*`; platform (Obsidian) seams injected (e.g. `ProviderHost`, `BrainPersistence`, `ConversationHost`) so core logic stays unit-testable without Obsidian. | `SauceBotHostAdapters.ts`, `BrainBuilder.ts` |
| **AI abstraction** | `ISauceBotProvider` + `ProviderRegistry.buildProvider` (one OpenAI-compatible harness shared across LM Studio / Ollama / OpenAI / NIM / …); `SauceBotRuntime` orchestrates RAG + tools + distillation. | `src/saucebot/` |
| **UI / tokens / branding** | Obsidian DOM helpers (`createDiv`/`createEl`/`setIcon`); CSS in `styles.css` using `--sg-*` scale + `--sauce-purple`; every view mounts `SauceViewHelp.mountHeader` (branded title + "SauceOM" mark + help toggle). `sauce-*` CSS classes are stable. | `SauceViewHelp.ts`, `styles.css` |
| **Background workers / "agents"** | Functional, goal-named workers — **no metaphorical/persona names**. `BrainBuilder`, `Distiller`, `crystallizeAll`, `MirrorSync`. Trace attribution uses a functional agent id `sauceom/<provider>:<model>`. | `BrainBuilder.ts`, `Distiller.ts`, `main.ts:currentAgentId` |
| **Startup** | Heavy work deferred to `app.workspace.onLayoutReady` so launch isn't blocked; incremental updates via `registerEvent(vault.on(...))`. | `main.ts:onLayoutReady`, brain hooks |
| **Ids / provenance** | ULID-based `Ids.ts` (`inst_/cnv_/cht_/trn_/rsp_/msg_`), SHA-256 fingerprints, HMAC-chained `AuditLog`. Nothing null; non-repeatable; replay-grade. | `Ids.ts`, `ChatTrace.ts`, `AuditLog.ts` |

## Fold-in audit (PRESENT / PARTIAL / MISSING)

| # | Feature | State | File / evidence |
|---|---|---|---|
| 1 | Reopenable brain panel (leaf + ribbon) | PRESENT | `BrainView.ts`, `main.ts:registerView(VIEW_BRAIN)` + `open-brain` cmd |
| 2 | Local inference default, no cloud unless configured | PRESENT | `COPILOT_DEFAULTS.provider = "lmstudio"`, empty model + picker auto-persist |
| 3 | Model-mode local / cloud / API-key | PRESENT | provider picker + KeyVault credential chain |
| 4 | CRM touchpoint lookup | PRESENT | `EntityService` touches + Brain Ask over `touches/` |
| 5 | Implicit cross-document retrieval | PRESENT | RAG + crystal + brain lattice |
| 6 | Playbooks sidebar | MISSING | net-new view — separate build |
| 7 | Voice layer | PARTIAL | Web-Speech mic dictation in composer; not a full assistant |
| 8 | Readiness panel | MISSING | net-new view — separate build |
| 9 | Knowledge ingestion + guardrails (Slack/email) | PARTIAL | `src/integrations/{slack,smtpimap,…}` exist; guardrails partial |
| 10 | Named persona agents (Magnus/Cicero/Socrates) | INTENTIONALLY ABSENT | per directive: background workers use functional names, not personas |
| 11 | Canonical naming | RESOLVED | SauceOM umbrella + Sauce CRM/RG/SauceBot/Sauce Brain sub-features |

## Judgment calls surfaced for review

- **Plugin id kept `sauce-crm`** (manifest `name` → "SauceOM"). Changing the id would break the on-disk plugin folder + `data.json` location for existing installs; renaming the display name achieves the brand without a migration.
- **Local default = LM Studio** (not Ollama). The repo's running environment + the `/api/v0` rich-metadata integration are LM Studio; switch the default if Ollama is preferred.
- **No new dependencies** were added.
- **MISSING features (Playbooks, Readiness, full voice)** are net-new builds, not fold-ins — flagged, not silently implemented.
