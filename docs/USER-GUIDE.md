# SauceOM User Guide

**SauceOM (Sauce Operating Memory)** is an Obsidian plugin that brings a relationship CRM, an AI copilot, and a crystallized vault memory together in one place — all local-first, with no required accounts and no data leaving your machine unless you choose a cloud AI provider.

- **Version:** 0.5.0
- **Requires:** Obsidian 1.5.0 or later, desktop only
- **Plugin id:** `sauce-crm`

---

## Sub-features at a glance

| Name | What it does |
|---|---|
| **Sauce CRM** | People, organizations, and touch logs — form-driven, contract-validated |
| **Sauce RG** | Relationship Graph — map and graph views of your network |
| **SauceBot** | The AI copilot chat — local or cloud models, RAG over your vault |
| **Sauce Brain** | The indexed, crystallized vault memory that SauceBot reasons over |

---

## Network disclosure

The AI copilot makes network calls **only to the provider you configure**. The default is a local LM Studio server running on your own machine — no internet traffic. Cloud providers (Anthropic, OpenAI, NVIDIA NIM) are used only if you add an API key. The optional paid SauceDB tier syncs brain data to a hosted endpoint you configure. No telemetry or analytics leave your machine in any other case.

---

## 1. Installation

### Option A — Obsidian Community Plugin Browser (recommended after marketplace acceptance)

1. Open **Settings → Community plugins**.
2. Click **Browse**, search for **SauceOM**, and click **Install**.
3. Click **Enable**.

### Option B — Manual install (release assets)

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Diatonic-OS/sauce-crm/releases/latest).
2. Create the folder `<your-vault>/.obsidian/plugins/sauce-crm/`.
3. Move the three downloaded files into that folder.
4. In Obsidian: **Settings → Community plugins** → turn off Restricted mode if prompted → **Reload plugins** → enable **SauceOM**.

> The plugin folder name must be exactly `sauce-crm` — Obsidian matches on the manifest `id`.

### Option C — Build from source

Prerequisites: Node.js 18 or later, git, Obsidian 1.5.0 or later.

```bash
git clone https://github.com/Diatonic-OS/sauce-crm.git
cd sauce-crm
npm install
npm run build
```

Copy the output into your vault:

```bash
mkdir -p "<your-vault>/.obsidian/plugins/sauce-crm"
cp main.js manifest.json styles.css "<your-vault>/.obsidian/plugins/sauce-crm/"
```

Then enable in **Settings → Community plugins**.

---

## 2. First-run setup

After enabling the plugin, run the onboarding wizard from the command palette:

1. Press `Cmd/Ctrl+P` to open the command palette.
2. Type **SauceOM: Onboarding Wizard** and press Enter.
3. The wizard walks you through:
   - Creating the vault folder structure (idempotent — safe to re-run).
   - Setting a **master password** for the encrypted KeyVault. This password protects all stored API keys and OAuth tokens; it is never written to `data.json`.
   - Choosing an AI provider (LM Studio by default — see Section 3).

If you prefer a bare scaffold without the AI setup, run **SauceOM: Initialize Vault** instead.

---

## 3. Configuring an AI provider

### 3a. Local provider — LM Studio (default, recommended)

LM Studio runs entirely on your machine. No API key is needed and no internet connection is made.

**Step 1 — Install and start LM Studio**

1. Download LM Studio from [lmstudio.ai](https://lmstudio.ai) and install it.
2. Open LM Studio, go to the **Discover** tab, and download a model (for example, a 7B or 8B instruction-tuned model works well on most machines).
3. Go to the **Local Server** tab (the `↔` icon), load your model, and click **Start Server**. The default address is `http://127.0.0.1:1234`.

**Step 2 — Connect SauceOM to LM Studio**

1. In Obsidian, open **Settings → SauceOM → Copilot**.
2. Under **Model**, the provider is already set to **LM Studio**. The endpoint defaults to `http://127.0.0.1:1234`.
3. Click **Refresh** next to the model list. SauceOM queries the LM Studio `/api/v0` catalog and populates the picker with your loaded models, including context size, quantization, and tool-use capability indicators.
4. Select your model from the dropdown.
5. Click **Test connection**. A green status indicator confirms the link is live.

### 3b. Local provider — Ollama

1. Install and start Ollama (`ollama serve`).
2. In **Settings → SauceOM → Copilot**, set the provider to **Ollama**. The default endpoint is `http://127.0.0.1:11434`.
3. Click **Refresh** — the picker enumerates models from `/api/tags`.

### 3c. Cloud provider — Anthropic

1. Obtain an API key from [console.anthropic.com](https://console.anthropic.com).
2. In **Settings → SauceOM → Copilot**, set the provider to **Anthropic**.
3. Paste your API key into the **API key** field. The key is saved immediately to the OS keychain (Electron `safeStorage`), not to `data.json`.
4. Click **Refresh** to populate the model list, then select a model.

### 3d. Cloud providers — OpenAI and NVIDIA NIM

Follow the same steps as Anthropic: select the provider, paste your API key, click Refresh, and select a model. NVIDIA NIM uses a curated model list at `integrate.api.nvidia.com`.

> All network calls to cloud providers are made only when you send a message in the SauceBot chat. Credentials are stored in the OS keychain or the encrypted KeyVault — never in plain config files.

---

## 4. Your first Sauce Brain build

Sauce Brain is the indexed, crystallized memory SauceOM builds from your vault. It lets SauceBot answer questions about your notes accurately, with far fewer tokens than pasting raw files into a prompt.

**How it builds automatically**

- On every Obsidian startup, SauceOM begins building or refreshing the brain in the background after the workspace has loaded (you will not notice a slowdown — it yields to the UI between batches).
- If the brain was never built, it builds from scratch.
- If the vault changed while Obsidian was closed, it detects the drift and rebuilds the affected parts.
- After that, edits to vault files trigger incremental updates automatically.

**Where it lives**

The brain is stored in the `_brain/` folder inside your vault. This folder is managed entirely by SauceOM — you do not need to edit it.

**To rebuild manually**

Open the command palette and run **SauceOM: Rebuild Brain**. A progress indicator appears in the Obsidian status bar while the rebuild runs; you can cancel it at any time and resume later.

**What the brain contains**

The brain is a "snowflake matrix" — a deterministic structure that includes:

- A **lexicon** of terms and entities found in your vault.
- A **taxonomy** and **fractal folder lattice** reflecting your folder structure.
- A **symmetric path and relationship matrix** encoding how notes relate to each other.
- **Per-entity crystal digests** — compact, hash-validated representations of each entity that reduce the token cost of retrieval by roughly 10x compared to inlining raw note text.

---

## 5. Using SauceBot chat

### Opening the chat

- Click the SauceBot ribbon icon (left sidebar), or
- Run **SauceOM: Open SauceBot** from the command palette.

The chat opens as a panel. When the transcript is empty, it shows **Relevant Notes** (the notes SauceBot currently considers most related to your context) and **Suggested Skills** (starting-point prompts for common tasks).

### The icon control panel

The header row of the chat contains icon buttons that open floating dropdowns:

| Icon | What it controls |
|---|---|
| Provider icon | **Provider picker** — switch between LM Studio, Ollama, Anthropic, OpenAI |
| Model icon | **Model picker** — select a model within the current provider |
| Embeddings icon | **Embeddings picker** — choose the embedding model used for retrieval |

The **model picker** shows rich detail for LM Studio models: context window size, quantization label, a filled circle (●) when the model is currently loaded in LM Studio, a "tools" badge if the model supports tool-use, and a vision badge if it supports image input.

### Sending a message

1. Click in the message bar at the bottom of the chat.
2. Type your question or instruction.
3. Press **Enter** (or click the **Send** button) to send.

While SauceBot is generating a response, the Send button becomes a **Stop** button. Click it to cancel generation at any point.

### Attaching files

Click the **paperclip icon** in the message bar to attach a vault file to your message. SauceBot will read the attached file as additional context.

### Voice input

Click the **microphone icon** in the message bar to dictate your message using your microphone. Speak, then click the microphone again to stop; the transcribed text is inserted into the message bar for you to review before sending.

### Copying answers

Every response includes a **Copy** button. Click it to copy the full response text to your clipboard.

### Starting a new conversation

Click the **New chat** icon in the header toolbar. The current conversation is saved automatically; see Section 7 to review it later.

### Model-load indicator

When you switch models, a loading indicator appears next to the model name. It transitions to **ready** when the model finishes loading in LM Studio, or **failed** if the model could not be loaded.

---

## 6. Slash commands

Type `/` in the message bar to open the slash command picker. Slash commands are shortcuts to built-in SauceBot skills. A few examples:

| Command | What it does |
|---|---|
| `/summarize` | Summarize the current note |
| `/weekly` | Generate a weekly briefing across your vault |
| `/research` | Research the active contact using web sources |
| `/draft-touch` | Draft a follow-up message for the active contact |
| `/merge` | Propose merges for near-duplicate people or organizations |

Type part of a command name to filter the list. Press **Enter** or click to run.

You can also run any skill from the command palette: **Sauce: Run Skill…** opens a picker of all enabled skills.

---

## 7. The help toggle

Every SauceOM view — the chat, the settings sections, and the CRM forms — includes a **?** button in the header. Clicking it turns the button purple and reveals contextual help text for each field or control in the current view. Click it again to hide the help text.

This is useful when configuring a new provider or filling in a CRM form for the first time.

---

## 8. Tuning local models for quality

Local models sometimes produce incomplete or malformed output. SauceOM includes several automatic mitigations, active by default whenever a local provider is selected:

- **Prose tool prompting** — rewrites tool-call instructions in plain prose rather than JSON schema, which many local models follow more reliably.
- **History compaction budget** — limits how much conversation history is kept in the context window, preventing the model from being overwhelmed on long conversations.
- **Malformed-tool-call repair** — detects and attempts to fix broken JSON in model tool responses before they reach the skill runtime.
- **Empty-answer self-correction** — if the model returns a blank or near-blank response, SauceBot automatically retries with a corrected prompt.

These settings are on by default for local providers and do not affect cloud providers.

**To adjust them:**

1. Open **Settings → SauceOM → Copilot**.
2. Scroll to **Local model tuning**. Each option has a toggle and a brief description.

You can also access a subset of these settings from the **quick-settings modal** inside the chat (click the gear/settings icon in the chat header toolbar).

---

## 9. Understanding Sauce Brain (deeper reference)

### Context distillation

Before each message is sent to the model, SauceOM compacts the relevant vault context into **TOON** (Token-Oriented Object Notation) — a dense, structured representation of your entities and relationships. This compaction is gated by a configurable token budget so the model never exceeds its context limit. Distilled context is cached and reused across turns in the same conversation.

### Crystal digests

Each entity (person, organization, touch log) in your vault is represented in the brain as a crystal digest — a compact, hash-validated snapshot. Crystal digests are stored in `_brain/` and validated on every read. If a digest is tampered with or out of date, SauceBot flags the inconsistency and rebuilds the affected entry.

### What triggers a rebuild

- First run (no brain exists yet).
- Vault drift: files changed while Obsidian was closed.
- Manual rebuild via command palette.
- The `_brain/` folder is deleted or corrupted.

Routine in-session edits trigger incremental updates — only the changed entities are recrystallized.

---

## 10. Viewing and replaying conversations

### Conversation history

Click the **History** icon in the SauceBot chat header. A list of past conversations appears, sorted by date. Click any conversation to reload it in the chat.

### Trace and audit log

Every SauceBot interaction is recorded with a stable, non-repeatable identifier at each layer:

- **Install id** — stable across sessions on this machine.
- **Conversation id** — one per conversation thread.
- **Chat id**, **Turn id**, **Response id**, **Message id** — finer-grained identifiers within a turn.

Each turn record includes the model that was used, token usage counts, and input/output fingerprints (SHA-256). Records are persisted under `_addenda/_copilot/` in your vault for replay and support.

The **audit log** is HMAC-chained — each entry contains a hash of the previous entry, making it tamper-evident. The audit log records which agent (identified by its functional agent id) made each change to a CRM entity.

To view the raw audit log, open the command palette and run **SauceOM: Open Skill Run Log**.

---

## 11. Using Sauce CRM

### Creating people and organizations

- Press `Cmd+Shift+P` (new person) or `Cmd+Shift+O` (new org) to open the creation modal.
- All fields are typed forms — you never need to remember frontmatter field names.
- Required fields are marked; the contract validator checks your entries before saving.

### Logging a touch

- Press `Cmd+Shift+T` or run **SauceOM: Log Touch** from the command palette.
- Select the person or org, fill in the touch type, date, and notes.
- Touches are stored as Markdown files in your vault under the `touches/` folder.

### Adding an addendum

- Press `Cmd+Shift+A` or run **SauceOM: New Addendum**.
- Addenda are supplementary records attached to a person or org (meeting notes, observations, ideas, etc.).

### Symmetric edges

When you record that person A knows person B, SauceOM automatically writes the reverse edge so that B also knows A. This applies to `knows`, `worked_with`, `intro_via`, and family relationships — you never have to update both sides manually.

### Editing existing records

- Open any person, org, or touch note in your vault.
- Press `Cmd+E` (or run **SauceOM: Edit Current**) to open the edit modal pre-populated with the current note's data.

---

## 12. Sauce RG — Relationship Graph

Open the Relationship Graph from the ribbon or via **SauceOM: Open Relationship Graph** in the command palette. The graph shows your people and organizations as nodes connected by the edges you have recorded (knows, worked\_with, intro\_via, etc.).

- **Map view** — plots contacts by location when `location:` fields are geocoded.
- **Graph view** — force-directed network of your relationships with closeness weighting.

Click any node to open the corresponding vault note. Use the filter bar to highlight by type, closeness score, or relationship kind.

---

## 13. The SauceDB upgrade (paid tier)

By default, Sauce Brain is fully local. The **SauceDB** paid tier mirrors your brain to a hosted LanceDB instance (on Kubernetes/k3s infrastructure you configure) for faster retrieval on very large vaults — useful when your vault grows beyond a few thousand notes.

**To enable SauceDB:**

1. Obtain a SauceDB license.
2. Open **Settings → SauceOM → SauceDB**.
3. Enter your license key and the endpoint URL for your hosted LanceDB instance.
4. Click **Connect**. SauceOM validates the license and begins mirroring the brain on the next rebuild.

The free tier (fully local) has no feature gates — all core functionality works without a SauceDB license.

---

## 14. Hotkeys reference

| Hotkey | Action |
|---|---|
| `Cmd/Ctrl+Shift+P` | New Person |
| `Cmd/Ctrl+Shift+O` | New Organization |
| `Cmd/Ctrl+Shift+T` | Log Touch |
| `Cmd/Ctrl+Shift+A` | New Addendum |
| `Cmd/Ctrl+Shift+I` | New Introduction |
| `Cmd/Ctrl+E` | Edit Current Note |

Hotkeys can be customized in **Settings → Hotkeys** — search for "Sauce" to find all SauceOM commands.

---

## 15. Privacy and data

- **Everything is local by default.** Your vault never leaves your machine. The plugin makes outbound calls only to providers you explicitly configure.
- **No telemetry.** The structured event log (`TRACE-LOG.jsonl`) is written locally only; nothing is transmitted to the plugin author or any third party.
- **Credentials are protected.** API keys and OAuth refresh tokens are stored in the OS keychain (Electron `safeStorage`) or, as a fallback, in the AES-256-GCM encrypted KeyVault behind your master password. They are never written to `data.json`.
- **No shared backend.** There is no "SauceOM account." Integrations with external services use your own OAuth apps and API keys.

---

## 16. Troubleshooting

| Symptom | Resolution |
|---|---|
| Plugin does not appear in Community plugins | Confirm the folder is named exactly `sauce-crm` and contains `main.js` + `manifest.json`. Reload plugins. |
| SauceBot says "no model available" | Open LM Studio, load a model, start the local server, then click **Refresh** in Settings → Copilot. |
| Brain build shows no progress | Check that `_brain/` is writable and not excluded by your vault sync client. Run **SauceOM: Rebuild Brain** manually. |
| Model picker shows no models after clicking Refresh | Confirm the provider server is running at the configured endpoint. For LM Studio, the default is `http://127.0.0.1:1234`. |
| Voice input button is grayed out | Voice input uses the browser Web Speech API (Chromium/Electron). Confirm your microphone is connected and Obsidian has microphone permission in your OS settings. |
| KeyVault locked / cannot save credentials | Your master password session has expired (auto-locks after 30 minutes of idle). Re-enter your master password when prompted. |
| SauceDB connection fails | Confirm your license key is correct and the hosted LanceDB endpoint is reachable from your machine. |

---

## 17. Getting help

- **In-app help:** click the **?** button in any SauceOM view header.
- **Docs:** `docs/` folder in the repository for deeper reference on specific topics.
- **Issues:** [github.com/Diatonic-OS/sauce-crm/issues](https://github.com/Diatonic-OS/sauce-crm/issues)
