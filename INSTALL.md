# SauceOM — Installation Guide

> **SauceOM** (Sauce Operating Memory) · Version **0.5.0** · Plugin id: `sauce-crm`
> Desktop-only · Requires Obsidian ≥ 1.5.0 (Windows, macOS, Linux)
>
> Repository: <https://github.com/Diatonic-OS/sauce-crm>

SauceOM is the umbrella Obsidian plugin that ships four integrated sub-features:
**Sauce CRM** (people, organizations, touch logs), **Sauce RG** (Relationship Graph
with map and graph views), **SauceBot** (the AI copilot), and **Sauce Brain** (the
indexed vault memory). All sub-features live in the single `sauce-crm` plugin.

---

## Network & Privacy Disclosure

> **Required disclosure (Obsidian community policy):**
>
> The SauceBot AI copilot makes network calls **only** to the provider you
> configure. The default is **LM Studio or Ollama running on localhost** — no
> data leaves your machine until you explicitly add a cloud provider key
> (Anthropic, OpenAI, or NVIDIA NIM). The optional paid **SauceDB** tier syncs
> brain data to a hosted endpoint you configure. No telemetry is collected or
> transmitted otherwise.

---

## The one rule that trips people up

Obsidian requires the plugin folder name to **exactly match the manifest `id`**.
That id is **`sauce-crm`**. The folder must be:

```
<your-vault>/.obsidian/plugins/sauce-crm/
```

Not `sauceom`, not `SauceOM`, not `sauce-graph` — exactly `sauce-crm`, or
Obsidian silently will not list it.

---

## Option A — Install a pre-built release (fastest, no toolchain)

1. Open the latest release:
   <https://github.com/Diatonic-OS/sauce-crm/releases/tag/0.5.0>
2. Download the three plugin assets: **`main.js`**, **`manifest.json`**, **`styles.css`**.
3. Create the plugin folder in your vault and drop the files in:

   ```bash
   mkdir -p "<your-vault>/.obsidian/plugins/sauce-crm"
   # move the three downloaded files into that folder
   ```

4. In Obsidian: **Settings → Community plugins** → toggle **Restricted mode OFF**
   if it isn't already → **Reload plugins** (or restart Obsidian) → enable
   **SauceOM**.

---

## Option B — Build from source

Use this if you want to hack on the plugin, verify the build yourself, or track
the development tip.

### Prerequisites

- **Node.js ≥ 18** (tested on 22). Run `node -v` to check.
- **git**
- Obsidian ≥ 1.5.0 (desktop only)

### Steps

```bash
# 1. Clone the stable tag
git clone --branch 0.5.0 --depth 1 https://github.com/Diatonic-OS/sauce-crm.git
cd sauce-crm

# 2. Install dev dependencies (build-time only; nothing ships to the vault)
npm install

# 3. Produce the production bundle
npm run build
```

`npm run build` runs `tsc -noEmit` for type-checking and then the esbuild
production bundle. It emits four files in the repo root:

```
main.js          ← bundled plugin
manifest.json
styles.css
versions.json
```

### Copy the build into your vault

```bash
DEST="<your-vault>/.obsidian/plugins/sauce-crm"
mkdir -p "$DEST"
cp main.js manifest.json styles.css versions.json "$DEST"/
```

Then enable it: **Settings → Community plugins → SauceOM** (reload plugins or
restart Obsidian first so it sees the new folder).

### Live-iterate (watch mode)

```bash
npm run dev     # esbuild watch — rebuilds main.js on every save
```

With the plugin folder in place, toggle SauceOM off/on in Settings (or
`Cmd/Ctrl+R` → "Reload app without saving") to pick up each rebuild. If the
[Hot Reload](https://github.com/pjeby/hot-reload) community plugin is installed,
it reloads automatically.

---

## Requirements

| Requirement | Minimum |
|---|---|
| Obsidian | 1.5.0 |
| Platform | Desktop only (Windows, macOS, Linux) |
| Node.js (build from source only) | 18 |

Mobile is **not supported** (`isDesktopOnly: true`).

---

## First run

1. Enable the plugin in **Settings → Community plugins**.
2. **Sauce Brain auto-builds in the background** on first startup (triggered on
   `onLayoutReady`). It builds a lexicon, taxonomy, fractal folder lattice, and
   symmetric relationship matrix from your vault, then persists the result to
   `_brain/` inside your vault. Nothing is sent off-device during this step.
3. Open the command palette (`Cmd/Ctrl+P`) and run
   **`SauceOM: Onboarding Wizard`** — it scaffolds the vault, sets up the
   encrypted KeyVault, and guides you through picking an AI provider.
   Alternatively, run **`SauceOM: Initialize Vault`** for a bare scaffold
   (idempotent — it diffs existing config and offers an addendum rather than
   overwriting).

### Picking an AI provider

All AI/network features are **off by default**. To enable SauceBot:

- **Local (recommended default):** start [LM Studio](https://lmstudio.ai/) or
  [Ollama](https://ollama.com/) on your machine, then select it in
  **Settings → SauceOM → Copilot → Provider**. Zero cloud calls; everything
  runs on localhost.
- **Cloud:** open Settings → SauceOM → Copilot, choose Anthropic, OpenAI, or
  NVIDIA NIM, and add your API key. Keys are stored in your OS keychain or the
  encrypted KeyVault — **never** in `data.json` or any plaintext file.

Credentials can also be managed from inside the SauceBot chat view via the
icon control panel (provider and model pickers as icon buttons → floating
dropdowns).

### Multi-vault federation (optional)

Run **`SauceOM: Initialize Parent Vault`** at the parent folder, then
**`SauceOM: Register SubVault`** for each child vault.

---

## What each sub-feature does

| Sub-feature | What it provides |
|---|---|
| **Sauce CRM** | People and organization notes, touch logs, and addendum records with a tamper-evident HMAC-chained audit trail |
| **Sauce RG** | Relationship Graph — interactive graph and map views across your vault entities |
| **SauceBot** | AI copilot chat with local-first LM Studio/Ollama support and optional cloud providers; rich model picker showing context size, quantization, load status, tool capability, and vision support |
| **Sauce Brain** | Deterministic "snowflake matrix" built from the vault — lexicon, taxonomy, folder lattice, path/relationship matrix, and per-entity crystal digests; rebuilds incrementally on edits; persists under `_brain/` |

---

## Optional — the local daemon (lightweight background runtime)

The plugin works fully standalone. For larger vaults you can run the optional
**`sauce-crm-daemon`**, which moves vector store operations, indexing, and
compaction out of Obsidian's UI process. The renderer then acts as a thin,
HMAC-authenticated localhost client.

The daemon is a **separate, self-hosted artifact** — it is never installed
automatically by the plugin and is not part of the community directory
submission.

Build it from the same checkout:

```bash
npm run daemon:build          # → daemon/dist/sauce-crm-daemon.cjs
```

Then install it as a background service for your OS (each script is opt-in,
requires no `sudo` on Linux/macOS, and downloads nothing external):

| OS | Installer |
|---|---|
| Linux (systemd user unit) | `daemon/packaging/linux/install.sh` |
| macOS (launchd LaunchAgent) | `daemon/packaging/macos/install.sh` |
| Windows (Scheduled Task) | `daemon/packaging/windows/install.ps1` |
| Windows + WSL2 | `daemon/packaging/windows-wsl2/install-wsl.ps1` |

Each packaging folder has its own `README.md`. Once the daemon is running
(`curl http://127.0.0.1:8788/health`), enable it in
**Settings → SauceOM → Local daemon** and pair it.

---

## Verify your build

```bash
npm run typecheck     # tsc -noEmit — should print nothing
npm test              # vitest full suite
npm run build         # esbuild production bundle
ls -lh main.js        # bundled output
```

---

## Update to a newer version

```bash
cd sauce-crm
git fetch --tags
git checkout <new-tag>     # e.g. 0.5.0, or `git checkout main` for the tip
npm install                # in case dependencies changed
npm run build
cp main.js manifest.json styles.css versions.json "<your-vault>/.obsidian/plugins/sauce-crm"/
```

Reload plugins (or restart Obsidian) afterward.

---

## Uninstall

Delete the plugin folder:

```bash
rm -rf "<your-vault>/.obsidian/plugins/sauce-crm"
```

Your notes are untouched — every person, org, touch log, and addendum is a
plain Obsidian Markdown file in your vault. If you ran the daemon, stop and
remove it with the `uninstall` script in the matching
`daemon/packaging/<os>/` folder.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Plugin does not appear in the list | The folder name must be exactly `sauce-crm` and must contain `main.js` + `manifest.json`. Reload plugins. |
| `npm install` is slow or pulls native modules | Expected — the vector backend (`@lancedb/lancedb`) is an optional native dependency used only on desktop. The plugin runs with lexical and graph search if it is absent. |
| Sauce Brain did not build | Open the command palette and run **`SauceOM: Initialize Vault`** to trigger a manual rebuild. Check that `_brain/` exists in your vault afterward. |
| SauceBot shows no models | Confirm LM Studio (or Ollama) is running and its API server is enabled. The model picker queries the LM Studio `/api/v0` endpoint; if the endpoint is unreachable the list will be empty. |
| Mobile | Not supported (`isDesktopOnly: true`). The vector backend and daemon are native/desktop-only. |
