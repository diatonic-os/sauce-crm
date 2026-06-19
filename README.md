# SauceOM — Sauce Operating Memory

**SauceOM** is an Obsidian plugin that turns your vault into an intelligent operating memory: a structured relationship graph, a crystallized knowledge index, and a local-first AI copilot — all in one.

[![CI](https://github.com/Diatonic-OS/sauce-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/Diatonic-OS/sauce-crm/actions/workflows/ci.yml)
[![Security](https://github.com/Diatonic-OS/sauce-crm/actions/workflows/security.yml/badge.svg)](https://github.com/Diatonic-OS/sauce-crm/actions/workflows/security.yml)
![Version](https://img.shields.io/badge/version-0.5.0-blue)
![Obsidian](https://img.shields.io/badge/Obsidian-%E2%89%A51.5.0-purple)
![Desktop only](https://img.shields.io/badge/platform-desktop--only-lightgrey)
![License](https://img.shields.io/github/license/Diatonic-OS/sauce-crm)

> **Plugin id:** `sauce-crm` · **Author:** Drew Fortini · **Desktop-only** · **Requires Obsidian ≥ 1.5.0**

---

<!-- SCREENSHOT PLACEHOLDER: add a screenshot or GIF of the SauceBot chat view and/or the Relationship Graph here -->

---

## What's Inside

SauceOM ships four tightly integrated sub-features:

| Sub-feature | What it does |
|---|---|
| **Sauce CRM** | People, organizations, touch logs, and addenda — form-driven, contract-validated, with symmetric edges and warm-intro path queries |
| **Sauce RG** | Relationship Graph — map and graph views of every entity and edge in your vault |
| **SauceBot** | The AI copilot: a branded chat view with live reasoning, local-first inference, and a rich model picker |
| **Sauce Brain** | The indexed vault memory — a deterministic "snowflake matrix" of lexicon, taxonomy, fractal lattice, and hash-validated crystal digests, built automatically from your vault |

---

## Feature Highlights

### Sauce CRM
- **Typed entity model** — Person, Organization, Touch, Addendum records with strict frontmatter contracts (`primary_type`, `roles[]`, `closeness 1–5`, `cadence`, `intro_via`, and more)
- **Form-only CRUD** — every write goes through a modal (PersonModal, OrgModal, TouchModal, AddendumModal); you never hand-edit field names
- **Symmetric edges** — tag A → knows → B and B automatically knows A; reciprocity enforced for `worked_with`, `intro_via`, `family`
- **Semiring path queries** — find the warmest intro chain between any two people
- **Tamper-evident audit log** — HMAC-chained record of every entity change (who/what agent id, when)
- **Encrypted KeyVault** — AES-256-GCM (`SGV2` envelope) stores OAuth tokens and API keys; master-password locked, auto-locks on idle; credentials never written to `data.json`

### Sauce RG
- Interactive map and graph views over CRM entities and vault links
- Live updates as vault files change

### SauceBot (AI Copilot)
- **Local-first by default** — connects to LM Studio (or Ollama) on localhost; zero cloud calls until you add a cloud provider key
- **Cloud providers** — Anthropic, OpenAI, NVIDIA NIM (all opt-in, key required)
- **Branded chat view** — icon control panel with floating dropdowns for provider, model, and embedding picker; content-aware message bar with attach and mic; send button doubles as stop during streaming
- **Rich LM Studio model cards** — shows context size, quantization, ● loaded indicator, tool-capable badge, and vision flag via the `/api/v0` endpoint
- **Live model-load indicator** — status transitions from loading → ready / failed when you switch models
- **Copy buttons on answers** — one-click copy of any AI response
- **Local model tuning** — prose tool prompting, history compaction budget, malformed-tool-call repair, and empty-answer self-correction; auto-enabled for local providers, cloud unaffected
- **Distillation** — context is compacted to TOON (Token-Oriented Object Notation) before sending, gated by a token budget, cached
- **Per-field help** — toggle the "?" icon in any settings panel; it turns purple when active
- **Replay-grade trace** — every conversation layer gets a stable non-repeatable id (`inst_/cnv_/cht_/trn_/rsp_/msg_` prefix), model usage, and input/output fingerprints; persisted to `_addenda/_copilot/`

### Sauce Brain
- **Auto-builds on startup** — runs on `onLayoutReady`; incremental updates fire on vault edits; rebuilds automatically if the vault drifted while closed
- **Snowflake matrix** — lexicon, taxonomy, fractal folder lattice, symmetric path/relationship matrix, and per-entity crystal digests (~10× token reduction vs raw inlining)
- **Hash-validated** — crystal digests are SHA-256 verified; stale entries self-invalidate
- **Persists under `_brain/`** in your vault (gitignore-able)
- **SauceDB (paid tier)** — optionally mirrors the brain to a hosted LanceDB edge for faster retrieval; gated by license; free tier is fully local

---

## 60-Second Quick Start (local-first, LM Studio)

**Prerequisites:** Obsidian ≥ 1.5.0, [LM Studio](https://lmstudio.ai) installed and running with at least one model loaded, desktop OS.

### 1 — Install the plugin

**Option A — Community Plugin Browser** (after marketplace acceptance)

`Settings → Community Plugins → Browse → search "SauceOM" → Install → Enable`

**Option B — Manual install**

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Diatonic-OS/sauce-crm/releases/latest).
2. Create the folder `<your-vault>/.obsidian/plugins/sauce-crm/` — the folder name **must** be exactly `sauce-crm`.
3. Drop the three files into that folder.
4. Enable in `Settings → Community Plugins → Installed Plugins → SauceOM`.

**Option C — Build from source**

```sh
git clone https://github.com/Diatonic-OS/sauce-crm.git
cd sauce-crm/plugin
npm install
npm run build        # produces main.js
# copy main.js + manifest.json + styles.css into <vault>/.obsidian/plugins/sauce-crm/
```

### 2 — Point SauceBot at LM Studio

`Settings → SauceOM → Copilot`

- **Provider:** LM Studio (selected by default)
- **Base URL:** `http://localhost:1234` (LM Studio default; change if yours differs)
- Click **Refresh models** — your loaded models appear automatically with context size, quantization, and tool-capability badges
- Select a model

### 3 — Open SauceBot

Click the SauceBot icon in the left ribbon, or run the command `SauceOM: Open SauceBot chat`. Sauce Brain builds automatically in the background on first load.

### 4 — Add your first person

Run the command `SauceOM: New Person` (or `Cmd/Ctrl+Shift+P`), fill out the form, and save. The entity lands in your vault as a frontmatter-structured Markdown file; Sauce Brain indexes it automatically.

---

## Settings Tour

Open `Settings → SauceOM`.

| Section | What you configure |
|---|---|
| **General** | Vault layout, entity folder paths, policy defaults |
| **Copilot** | Provider, model, embedding model, base URL; local model tuning (compaction budget, tool-call repair); KeyVault master password |
| **Integrations** | OAuth (Google, Microsoft 365, Notion) and API-key connectors; each shows Configure / Connect / Disconnect |
| **Brain** | Brain rebuild triggers, crystal cache settings, `_brain/` folder location |
| **SauceDB** | Hosted LanceDB endpoint (paid tier); license key entry |

Every settings panel has inline help — click the **?** icon (it turns purple when active).

---

## Network and Data Disclosure

> **Required by Obsidian's community plugin policy — please read.**

- **AI inference:** SauceBot makes network calls **only** to the provider you explicitly configure. The default is LM Studio on `localhost` — no data leaves your machine. Cloud providers (Anthropic, OpenAI, NVIDIA NIM) are contacted only if you add an API key in Settings.
- **Credentials:** API keys and OAuth tokens are stored in an AES-256-GCM encrypted KeyVault on your local disk. They are never written to `data.json` and never transmitted to any Sauce server.
- **SauceDB (optional paid tier):** If you configure a SauceDB endpoint, brain index data (not your raw vault text) is synced to that hosted endpoint. This is opt-in and off by default.
- **Telemetry:** None. SauceOM does not phone home, track usage, or send analytics anywhere.

---

## Hotkeys (defaults)

| Hotkey | Command |
|---|---|
| `Cmd/Ctrl+Shift+P` | New Person |
| `Cmd/Ctrl+Shift+O` | New Organization |
| `Cmd/Ctrl+Shift+T` | Log Touch |
| `Cmd/Ctrl+Shift+A` | New Addendum |
| `Cmd/Ctrl+Shift+I` | New Intro |
| `Cmd/Ctrl+E` | Edit Current Entity |

All hotkeys are reassignable in `Settings → Hotkeys`.

---

## Documentation

- [User Guide](docs/USER-GUIDE.md) — end-to-end workflows, entity model reference, SauceBot usage
- [Features](docs/FEATURES.md) — detailed feature reference for all four sub-features
- [UI System](docs/UI-SYSTEM.md) — views, modals, and the branded component system
- [Integrations](docs/integrations.md) — OAuth BYO client setup, API-key connectors
- [Security](docs/SECURITY.md) — KeyVault design, audit log, credential handling

---

## License

MIT — see [LICENSE](LICENSE).

**Author:** Drew Fortini · [github.com/Diatonic-OS](https://github.com/Diatonic-OS)
