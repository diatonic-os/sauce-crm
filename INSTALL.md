# Sauce CRM — Install (build from source / local install)

> Latest stable: **0.4.1**. This plugin is **not yet in the Obsidian community
> directory** — install it manually with one of the options below.
>
> Repository: <https://github.com/Diatonic-OS/sauce-crm>
> Plugin id: `sauce-crm` · Display name: **Sauce CRM** · Desktop-only · Requires Obsidian ≥ 1.5.0

---

## ⚠️ The one rule that trips everyone up

Obsidian requires the plugin **folder name to exactly match the manifest `id`**.
That id is **`sauce-crm`**. The install folder must be:

```
<your-vault>/.obsidian/plugins/sauce-crm/
```

Not `sauce-graph`, not `Sauce CRM` — exactly `sauce-crm`, or Obsidian silently
won't list it.

---

## Option A — install a pre-built release (fastest, no toolchain)

1. Open the release: <https://github.com/Diatonic-OS/sauce-crm/releases/tag/0.4.1>
2. Download the three plugin assets: **`main.js`**, **`manifest.json`**, **`styles.css`**.
   (Ignore `sauce-crm-daemon.cjs` unless you want the optional daemon — see below.)
3. Create the plugin folder in your vault and drop the files in:

   ```bash
   mkdir -p "<your-vault>/.obsidian/plugins/sauce-crm"
   # move the three downloaded files into that folder
   ```

4. In Obsidian: **Settings → Community plugins** → toggle **Restricted mode OFF**
   if it isn't already → **Reload plugins** (or restart Obsidian) → enable **Sauce CRM**.

---

## Option B — build from source (what you want if you're hacking on it)

### Prerequisites
- **Node.js ≥ 18** (tested on 22). `node -v` to check.
- **git**.
- Obsidian ≥ 1.5.0 (desktop — Windows, macOS, or Linux).

### Steps

```bash
# 1. clone the newest stable tag
git clone --branch 0.4.1 --depth 1 https://github.com/Diatonic-OS/sauce-crm.git
cd sauce-crm

# 2. install dev dependencies (build-time only; nothing ships to the vault)
npm install

# 3. produce the production bundle
npm run build
```

`npm run build` runs `tsc -noEmit -skipLibCheck` then the esbuild production
bundle. It emits four files in the repo root:

```
main.js          ← the bundled plugin (~600 KB)
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

Then enable it: **Settings → Community plugins → Sauce CRM** (reload plugins or
restart Obsidian first so it sees the new folder).

> **Auto-deploy shortcut:** `npm run build` (and `npm run dev`) also copy the
> artifacts into any vault that already has a `…/.obsidian/plugins/sauce-crm/`
> folder, for the maintainer's own vaults. If your vault path isn't one of the
> built-in targets, use the manual `cp` above — it always works.

### Live-iterate (watch mode)

```bash
npm run dev     # esbuild watch — rebuilds main.js on every save
```

With the plugin folder in place, toggle Sauce CRM off/on in Settings (or
`Cmd/Ctrl+R` → "Reload app without saving") to pick up each rebuild. If the
[Hot Reload](https://github.com/pjeby/hot-reload) community plugin is installed,
it reloads automatically.

---

## First run

1. Enable the plugin in **Settings → Community plugins**.
2. Open the command palette (`Cmd/Ctrl+P`) and run **`Sauce CRM: Onboarding Wizard`**
   — it scaffolds the vault, sets up the encrypted KeyVault, and configures your
   AI provider. Or, for a bare scaffold, run **`Sauce CRM: Initialize Vault`**
   (idempotent — it diffs `CLAUDE.md` and offers an addendum rather than
   overwriting).
3. Multi-vault federation (optional): run **`Sauce CRM: Initialize Parent Vault`**
   at the parent folder, then **`Sauce CRM: Register SubVault`** per child vault.
4. Curious about load time? **`Sauce CRM: Show boot timing`** reports the
   per-segment startup breakdown.

All AI/network features are **off by default**; nothing leaves your machine until
you enable a feature and supply your own credentials. Keys are stored in your OS
keychain or the encrypted KeyVault — never in `data.json`.

---

## Optional — the local daemon (0.4.x lightweight runtime)

The plugin works fully standalone. For larger vaults you can run the optional
**`sauce-crm-daemon`**, which moves the vector store, indexing, and compaction
out of Obsidian's UI process (the renderer becomes a thin, HMAC-authenticated
localhost client). It is a **separate, self-hosted artifact** — never installed
by the plugin, never part of the community-directory submission.

Build it from the same checkout:

```bash
npm run daemon:build          # → daemon/dist/sauce-crm-daemon.cjs
```

Then install it as a background service for your OS (each script is opt-in, needs
no `sudo` on Linux/macOS, and downloads nothing):

| OS | Installer |
|----|-----------|
| Linux (systemd user unit) | `daemon/packaging/linux/install.sh` |
| macOS (launchd LaunchAgent) | `daemon/packaging/macos/install.sh` |
| Windows (Scheduled Task) | `daemon/packaging/windows/install.ps1` |
| Windows + WSL2 | `daemon/packaging/windows-wsl2/install-wsl.ps1` |

Each packaging folder has its own `README.md`. Once the daemon is running
(`curl http://127.0.0.1:8788/health`), enable it in **Settings → Sauce CRM →
Local daemon** and pair it. Security details and the capability-by-capability
guard map live in [`docs/REVIEWER-NOTES.md`](docs/REVIEWER-NOTES.md).

---

## Verify your build

```bash
npm run typecheck     # tsc -noEmit, should print nothing
npm test              # vitest — full suite should pass
npm run build         # esbuild production bundle
ls -lh main.js        # ~600 KB
```

---

## Update to a newer version

```bash
cd sauce-crm
git fetch --tags
git checkout <new-tag>     # e.g. 0.4.2, or `git checkout main` for the tip
npm install               # in case deps changed
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

Your notes are untouched — every person, org, touch, and addendum is a plain
Obsidian Markdown file in your vault. If you ran the daemon, stop/remove it with
the `uninstall` script in the matching `daemon/packaging/<os>/` folder.

---

## Troubleshooting

- **Plugin doesn't appear in the list** → the folder name must be exactly
  `sauce-crm` and must contain `main.js` + `manifest.json`. Reload plugins.
- **"Could not resolve node:…" during build** → you're on a stale checkout;
  `git pull` to 0.4.1+ (a build-hygiene fix for the renderer bundle landed there).
- **`npm install` is slow / pulls native modules** → expected; the vector
  backend (`@lancedb/lancedb`) is an optional native dep used only on desktop.
  The plugin runs with lexical + graph search if it's absent.
- **Mobile** → not supported (`isDesktopOnly: true`); the vector backend and the
  daemon are native/desktop-only.
