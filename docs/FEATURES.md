# SauceOM — Feature Reference

**SauceOM** (Sauce Operating Memory) is an Obsidian plugin (id: `sauce-crm`, version 0.5.0, desktop-only, minAppVersion 1.5.0) that layers four integrated sub-features on top of a markdown vault: **Sauce CRM**, **Sauce RG**, **SauceBot**, and **Sauce Brain**. This document describes each feature, what it does, and where to find it.

---

## Table of Contents

1. [Sauce CRM — People, Orgs, and Touch Logs](#1-sauce-crm--people-orgs-and-touch-logs)
2. [Sauce RG — Relationship Graph](#2-sauce-rg--relationship-graph)
3. [Sauce Brain — Indexed Vault Memory](#3-sauce-brain--indexed-vault-memory)
4. [RAG / Embeddings](#4-rag--embeddings)
5. [Distillation and TOON Compression](#5-distillation-and-toon-compression)
6. [SauceBot — AI Copilot Chat](#6-saucebot--ai-copilot-chat)
7. [Model Registry and Rich Model Cards](#7-model-registry-and-rich-model-cards)
8. [Local Model Tuning](#8-local-model-tuning)
9. [Chat Trace and Stable IDs](#9-chat-trace-and-stable-ids)
10. [Audit Log](#10-audit-log)
11. [KeyVault — Credential Storage](#11-keyvault--credential-storage)
12. [SauceDB — Paid Hosted Tier](#12-saucedb--paid-hosted-tier)
13. [Branded Views and the Help System](#13-branded-views-and-the-help-system)

---

## 1. Sauce CRM — People, Orgs, and Touch Logs

**What it is.** Sauce CRM turns vault markdown files into a contract-validated property graph of people, organizations, interactions (touch logs), and addenda. Every relevant `.md` file carries a `type` field (`warm-contact`, `org`, `subsidiary`, `touch`, `addendum`) and a contract level (`simple`, `core`, `extended`, `full`). Edge fields (`knows`, `worked_with`, `intro_via`, `referral_to`, `company`, …) are typed, auto-reconciled, and bidirectional where the edge rule requires it.

**Why it matters.** All canonical state lives in plain `.md` frontmatter — no proprietary binary format, no vendor lock-in. The graph is queryable from any tool that reads YAML frontmatter and remains fully usable even if the plugin is removed.

**Where to find it.**
- Commands: `SauceOM: New Person` (Ctrl/Cmd-Shift-P), `SauceOM: New Org` (Ctrl/Cmd-Shift-O), `SauceOM: Open Dashboard`, `SauceOM: Open Pipeline Kanban`.
- Settings: Settings → SauceOM → General for edge rules, contract strictness, and folder scaffold.
- Full command list: [commands.md](commands.md).

---

## 2. Sauce RG — Relationship Graph

**What it is.** Sauce RG renders the property graph as interactive views: a typed-edge force graph and a geographic map view. Nodes are people and orgs; edges carry their typed labels (`knows`, `worked_with`, etc.). Filtering, clustering, and edge-type toggling are available in the graph toolbar.

**Why it matters.** The graph makes relationship density, warm-path distances, and org clusters visible at a glance — the same data that lives in flat markdown, rendered spatially.

**Where to find it.**
- Command: `SauceOM: Open Typed-Edge Graph`.
- The map view opens via the map icon in the Sauce RG toolbar.

---

## 3. Sauce Brain — Indexed Vault Memory

**What it is.** Sauce Brain builds a deterministic, hash-validated in-memory index of the entire vault — called the **snowflake matrix** — consisting of:

- **Lexicon** — vocabulary extracted across all files.
- **Taxonomy** — entity-type hierarchy derived from frontmatter.
- **Fractal folder lattice** — the vault's structural skeleton.
- **Symmetric path/relationship matrix** — every entity-to-entity path, bidirectional.
- **Per-entity crystal digests** — compact SHA-256-validated summaries of each entity, yielding roughly a 10× token reduction versus raw file inlining.

The brain auto-builds in the background on Obsidian startup (`onLayoutReady`). It rebuilds automatically if indexes are wiped or the vault drifted while Obsidian was closed, and updates incrementally on each edit. All brain artifacts persist under the vault's `_brain/` folder.

**Why it matters.** The brain is what makes SauceBot vault-aware without forcing every prompt to inline entire files. Context sent to the AI is assembled from pre-computed crystal digests rather than raw markdown, keeping token usage low and responses accurate.

**Where to find it.**
- Automatically active — no manual step required after plugin installation.
- Brain artifacts: `<vault>/_brain/` (do not edit manually).
- Status: visible in the SauceBot chat header (model-load indicator reflects brain readiness).

---

## 4. RAG / Embeddings

**What it is.** SauceOM uses retrieval-augmented generation (RAG) to inject relevant vault context into each AI prompt. Embedding models convert vault content into vector representations stored in a local index; at query time, the most semantically relevant notes are retrieved and included in the prompt alongside the crystal digest.

**Supported embedding providers:** LM Studio, Ollama, OpenAI.

**Why it matters.** RAG grounds SauceBot answers in your actual vault content rather than the AI's training data. It enables accurate answers about specific people, organizations, and touch history without requiring the user to manually paste context.

**Where to find it.**
- Settings → Copilot → RAG / Embeddings section.
- Embedding provider picker: available in the SauceBot chat header (icon control panel → embeddings icon → floating dropdown).

---

## 5. Distillation and TOON Compression

**What it is.** Before sending context to the AI, SauceOM runs a **distillation** pass that compacts the assembled context into **TOON** (Token-Oriented Object Notation) — a structured, minimal representation of vault entities and relationships. Distillation is gated by a configurable token budget and the result is cached so repeated queries over unchanged content do not re-incur the cost.

**Why it matters.** LLMs have finite context windows. TOON compression lets SauceBot include significantly more vault context per prompt than raw markdown would allow, while reducing API costs for cloud providers.

**Where to find it.**
- Distillation runs automatically — no user action required.
- Token budget is configurable under Settings → Copilot → Local model tuning.

---

## 6. SauceBot — AI Copilot Chat

**What it is.** SauceBot is a vault-aware AI chat assistant rendered as a branded Obsidian panel view. It connects to local or cloud AI providers and answers questions using context assembled from Sauce Brain and RAG.

**Layout and controls:**

| Area | Contents |
|---|---|
| Header (icon control panel) | Provider picker icon, model picker icon, embedding picker icon — each opens a floating dropdown. New chat, Settings, History, and overflow icons. |
| Body | Chat transcript. When empty, shows **Relevant Notes** and **Suggested Skills** (contextual prompt suggestions). |
| Footer (message bar) | Textarea with attachment button and microphone (voice input via Web Speech API) embedded inline. The send button doubles as a stop button during streaming. |

**Additional chat behaviors:**
- **Live reasoning streaming** — assistant tokens appear as they arrive.
- **Copy buttons** — each assistant response has a one-click copy control.
- **Realtime model-load indicator** — reflects `loading → ready / failed` as you switch models.
- **Per-field help** — toggle the `?` icon to reveal inline help text; the icon turns purple when active.
- **Slash commands** — type `/` in the message bar for a contextual command menu.

**AI providers supported:**
- **Local (default):** LM Studio, Ollama — runs entirely on localhost; zero network calls to external services.
- **Cloud (opt-in):** Anthropic, OpenAI, NVIDIA NIM — activated only after you add a key in Settings.

**Where to find it.**
- Command: `SauceOM: Open SauceBot Chat` (or click the SauceBot ribbon icon).
- Settings: Settings → Copilot.

> **Network disclosure:** SauceBot makes network calls only to the provider you configure. The local default (LM Studio / Ollama) makes no external network calls. Cloud providers are contacted only if you explicitly add a key. No telemetry is sent.

---

## 7. Model Registry and Rich Model Cards

**What it is.** The model picker queries the live provider catalog rather than presenting a static list. For LM Studio, it calls the `/api/v0` models endpoint and renders a rich card per model showing:

- **Context size** (token window)
- **Quantization** label
- **Loaded indicator** (● when the model is currently loaded in LM Studio)
- **"tools"** badge — when the model declares tool-use capability
- **Vision** badge — when the model supports image input

Anthropic and OpenAI models use a curated list. Hitting **Refresh** re-queries the provider after pulling a new model.

**Why it matters.** Choosing the right model for a task (context length, tool use, vision) is visible at a glance without switching to the LM Studio UI.

**Where to find it.**
- SauceBot chat header → model icon → floating dropdown.
- Settings → Copilot → Model → provider picker.

---

## 8. Local Model Tuning

**What it is.** A set of reliability and quality settings tuned for the quirks of locally-run open-weight models. These are auto-enabled for local providers (LM Studio, Ollama) and have no effect on cloud providers:

| Setting | What it does |
|---|---|
| Prose tool prompting | Converts structured tool calls into natural-language instructions for models that do not parse JSON tool schemas reliably. |
| History compaction budget | Caps how much conversation history is included per turn, preventing context overflow on small models. |
| Malformed tool-call repair | Detects and corrects partial or ill-formed JSON in assistant tool calls before the runtime tries to execute them. |
| Empty-answer self-correction | Re-prompts the model automatically when it returns a blank or near-empty response. |

**Where to find it.**
- Settings → Copilot → "Local model tuning" section.
- Quick-settings modal: accessible from the SauceBot chat header overflow menu.

---

## 9. Chat Trace and Stable IDs

**What it is.** Every layer of a SauceBot chat is assigned a stable, non-repeatable ULID-based identifier with a type prefix that makes it self-describing in logs:

| ID kind | Prefix | Scope |
|---|---|---|
| Install / tenant | `inst_` | One per plugin installation |
| Conversation | `cnv_` | One per logical conversation |
| Chat session | `cht_` | One per view load |
| Turn | `trn_` | One per user → assistant exchange |
| Response | `rsp_` | One per assistant response |
| Message | `msg_` | One per individual message |

Each turn also records model usage stats and SHA-256 input/output fingerprints. The full trace is persisted to `_addenda/_copilot/` in the vault, enabling replay and support debugging.

**Why it matters.** Stable, typed IDs make it possible to trace a specific response back through conversation → turn → response → model in logs, and to verify that a given input produced a given output (via fingerprint).

**Where to find it.**
- Trace files: `<vault>/_addenda/_copilot/` (JSON, append-only).
- IDs appear in exported chat records and in any support diagnostics.

---

## 10. Audit Log

**What it is.** Every mutation to a Sauce CRM entity (person, org, touch, addendum) is recorded in a tamper-evident audit log. Records are HMAC-SHA256 chained — each entry's hash incorporates the previous entry's hash — and include who or what (agent id) made the change and when.

**Why it matters.** The chain makes retroactive tampering detectable: a single altered record breaks every subsequent hash. This is useful for compliance, multi-user deployments, and diagnosing unexpected data changes.

**Where to find it.**
- Audit log lives under the plugin's data folder.
- Verifiable via `SauceOM: Verify Audit Chain` in the command palette.

---

## 11. KeyVault — Credential Storage

**What it is.** All API keys and provider credentials are stored in an encrypted KeyVault backed by the OS keychain (Electron `safeStorage`), never written to `data.json` or any plaintext vault file.

**Why it matters.** Keys are never exposed in your vault's plaintext frontmatter, version history, or sync output. Even if someone clones your vault, they cannot recover a key from the plugin data.

**Where to find it.**
- Settings → Copilot → provider credential fields. Keys are written to the KeyVault on save; the field shows a masked placeholder on re-open.

---

## 12. SauceDB — Paid Hosted Tier

**What it is.** SauceDB is an optional paid upgrade that mirrors the Sauce Brain (crystal digests, path/relationship matrix, embeddings) to a hosted LanceDB cluster running on Sauce's k8s/k3s edge. The hosted index offers faster vector search and higher-quality retrieval than a local-only setup.

**Free tier** is fully local: brain artifacts in `_brain/`, local vector index if LanceDB is installed. No SauceDB account required.

**Paid tier** requires:
- A license key in `SAUCE-XXXX-XXXX-CC` format (format is validated locally; entitlement is verified server-side).
- A hosted SauceDB endpoint URL (e.g. `https://brain.saucetech.io` or a self-hosted endpoint).
- A tenant id (isolates your brain data in the hosted store).

The hard entitlement check is server-side: the hosted endpoint rejects syncs whose license has not been provisioned in the billing system, so a locally-modified license flag does not grant access.

**Where to find it.**
- Settings → Copilot → SauceDB section (appears when the license key field is populated with a format-valid key).

---

## 13. Branded Views and the Help System

**What it is.** SauceOM renders its own panel views (SauceBot chat, dashboard, graph, kanban) with a consistent visual system: icon toolbars, floating dropdowns for pickers, pill badges for model metadata, and a help overlay system.

**Help system (`?` toggle):** Every SauceBot control panel field has an associated help entry. Click the `?` icon next to any field to reveal an inline explanation; the icon turns purple while help is active. Click again to dismiss.

**Floating dropdowns:** Provider, model, and embedding pickers render as floating panels anchored to their trigger icons rather than native `<select>` elements, giving richer content (badges, status dots, metadata) without leaving the chat view.

**Empty-state content:** When the chat transcript is empty, the body shows **Relevant Notes** (vault notes relevant to your current context) and **Suggested Skills** (contextual slash-command suggestions to get started).

**Where to find it.**
- All views: accessible via ribbon icons or the command palette (`SauceOM: Open …`).
- Help toggle: the `?` icon present in the SauceBot chat header icon row and in individual settings fields under Settings → Copilot.

---

## Installation

Copy `manifest.json`, `main.js`, and `styles.css` into `<vault>/.obsidian/plugins/sauce-crm/` and enable the plugin under Settings → Community Plugins.

To build from source:

```bash
npm install
npm run build
```

See [INSTALL.md](../INSTALL.md) for full instructions.

---

## Network and Privacy Disclosure

> The SauceBot AI copilot makes network calls **only** to the provider you configure. The default local configuration (LM Studio / Ollama on localhost) makes **no external network calls**. Cloud providers (Anthropic, OpenAI, NVIDIA NIM) are contacted only if you explicitly add a key in Settings → Copilot. The optional paid SauceDB tier syncs brain data to the hosted endpoint you configure. No telemetry or usage data is sent by this plugin.
