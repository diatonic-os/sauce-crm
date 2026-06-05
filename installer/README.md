# Sauce CRM — one-line installer (`installer/`)

This folder holds the cross-platform bootstrap installers for **Sauce CRM**
(`install.sh` for macOS/Linux, `install.ps1` for Windows). They take a fresh
machine from nothing to a vault with the plugin staged and pre-enabled,
leaving exactly **one click** for the user (Obsidian's Restricted-Mode trust
prompt, which an installer is not permitted to bypass).

- Plugin id: **`sauce-crm`** (the vault plugin folder name MUST be exactly this)
- Display name: **Sauce CRM** · Desktop-only · Requires **Obsidian ≥ 1.5.0**
- Pinned plugin release: **0.4.2**
- Repository: <https://github.com/Diatonic-OS/sauce-crm>

---

## Run it

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/Diatonic-OS/sauce-crm/main/installer/install.sh | bash
```

**Windows (PowerShell 5.1+):**

```powershell
irm https://raw.githubusercontent.com/Diatonic-OS/sauce-crm/main/installer/install.ps1 | iex
```

### Pin to a release tag (recommended)

`main` is the tip of the installer. For a repeatable install, replace `main`
with a release tag (e.g. `0.4.2`):

```bash
curl -fsSL https://raw.githubusercontent.com/Diatonic-OS/sauce-crm/0.4.2/installer/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/Diatonic-OS/sauce-crm/0.4.2/installer/install.ps1 | iex
```

### Prefer not to pipe to a shell?

Download, **read**, then run:

```bash
curl -fsSL -o install.sh https://raw.githubusercontent.com/Diatonic-OS/sauce-crm/main/installer/install.sh
less install.sh
bash install.sh
```

```powershell
irm https://raw.githubusercontent.com/Diatonic-OS/sauce-crm/main/installer/install.ps1 -OutFile install.ps1
notepad install.ps1
.\install.ps1
```

---

## What both scripts do (shared contract)

`install.sh` and `install.ps1` implement the **same** flow:

1. **Detect OS + architecture.**
2. **Detect the Obsidian *app*** (the host application, not the plugin):
   - macOS: `/Applications/Obsidian.app`, `~/Applications/Obsidian.app`,
     `mdfind 'kMDItemCFBundleIdentifier == md.obsidian'`.
   - Linux: `command -v obsidian`; `flatpak info md.obsidian.Obsidian`;
     `snap list obsidian`; AppImage under `~/Applications` / `~/.local/bin` /
     `/opt`; `.desktop` files in `/usr/share/applications` +
     `~/.local/share/applications`.
   - Windows: `%LOCALAPPDATA%\Obsidian\Obsidian.exe`;
     `winget list --id Obsidian.Obsidian`; HKCU/HKLM uninstall keys;
     Start-Menu shortcut.
3. **If Obsidian is absent → consent first (default *No*).** Print exactly
   what will be installed and the method, then prompt — interactively even
   under `curl | bash` (POSIX reads from `/dev/tty`; PowerShell uses
   `Read-Host`). On consent, install **package-manager-first with
   direct-download fallback**, and **wait for completion** (subprocess
   `exit 0` is the "install finished" event):
   - macOS: `brew install --cask obsidian`; else the latest official `.dmg`
     (resolved via the obsidian-releases GitHub *latest-release* API),
     `hdiutil attach` → `cp -R` the `.app` to `/Applications` →
     `hdiutil detach`.
   - Linux: `flatpak install -y flathub md.obsidian.Obsidian`; else the
     latest `.AppImage` → `chmod +x` into `~/.local/bin/obsidian` (or
     `~/Applications`) + a `.desktop` launcher; `snap` as a tertiary path.
   - Windows: `winget install -e --id Obsidian.Obsidian`; else the latest
     official `.exe` installer (silent flag where supported), waiting for exit.
   - **Decline → print <https://obsidian.md/download> and exit 0** (Obsidian
     is required; no vault is created).
4. **Folder picker** (native GUI dialog, graceful tty fallback). Pick a
   **parent** directory, then a vault **name** (default `sauce-crm-vault`);
   create `<parent>/<name>`:
   - macOS: `osascript` `choose folder` + `display dialog`.
   - Linux: `zenity --file-selection --directory` + `zenity --entry`;
     fallback `kdialog`; final fallback `read` from `/dev/tty`.
   - Windows: WinForms `FolderBrowserDialog` + an input prompt.
   - **Refuses to clobber a non-empty existing folder** (offers rename/abort).
5. **Install the plugin into the vault:** create
   `<vault>/.obsidian/plugins/sauce-crm/`, download `main.js`,
   `manifest.json`, `styles.css` from the **0.4.2** release and
   `versions.json` from raw, then **verify each** (non-empty;
   `manifest.json` parses and `.id == "sauce-crm"`).
6. **Pre-enable:** write `community-plugins.json = ["sauce-crm"]`, and
   **register the vault** in Obsidian's global `obsidian.json`
   (macOS `~/Library/Application Support/obsidian/`, Linux
   `~/.config/obsidian/`, Windows `%APPDATA%\obsidian\`) by **parse-merging**
   a `{ "<16-hex-id>": { "path": …, "ts": … } }` entry under `"vaults"` —
   never destroying existing entries. If a JSON parser is unavailable, it
   only creates the file when absent and warns otherwise — it never corrupts
   it.
7. **Honest Restricted-Mode step.** It prints clearly that on first open
   Obsidian shows a one-time **"Turn off Restricted Mode → Trust author and
   enable plugins"** prompt the **user** must click — a security boundary the
   installer **does not and cannot bypass**. It offers to open the vault now
   via `obsidian://open?path=<urlencoded path>`.
8. **Summary:** Obsidian status, vault path, plugin version, the one click
   remaining, and how to install the optional daemon.

### Release assets the scripts fetch

- `main.js`, `manifest.json`, `styles.css` —
  `https://github.com/Diatonic-OS/sauce-crm/releases/download/0.4.2/{…}`
- `versions.json` —
  `https://raw.githubusercontent.com/Diatonic-OS/sauce-crm/0.4.2/versions.json`

---

## Consent points (both default-safe)

| # | Action | Default | Notes |
|---|--------|---------|-------|
| 1 | Install Obsidian | **No** | Only prompted if Obsidian is absent. Decline ⇒ exit 0 with the manual link. |
| 2 | Open the vault at the end | — | Via `obsidian://open?path=…`. |

No `sudo` is used unless genuinely unavoidable, and only with explicit consent.

## The one click the installer can't do for you

On first open, Obsidian shows a one-time **Restricted-Mode trust** dialog. The
installer pre-enables the plugin and registers the vault, but Obsidian
deliberately requires the human to confirm *"Turn off Restricted Mode → Trust
author and enable plugins"*. This is a security boundary — by design, no
installer can click it for you.

---

## Safety / engineering guarantees

- **Strict shells:** `set -euo pipefail` (sh) /
  `Set-StrictMode -Version 2.0` + `$ErrorActionPreference = 'Stop'` (ps).
- **PowerShell 5.1-compatible:** no `?.` / `??` / ternary, no `&&` / `||`
  statement chaining.
- **Idempotent:** re-running detects an existing Obsidian install and an
  existing vault and skips that work.
- **Integrity-checked downloads:** every file is verified non-empty and of the
  expected shape (`manifest.json` parses + `id == "sauce-crm"`).
- **Never corrupts** `obsidian.json` or `community-plugins.json`
  (parse-merge, or create-only-when-absent).
- `shellcheck -S warning` clean.

---

## After install — optional daemon

The plugin runs fully standalone. For larger vaults, the optional
`sauce-crm-daemon` runs as a background service. See the parent
[`INSTALL.md`](../INSTALL.md) ("Optional — the local daemon") and the
per-OS packaging folders under `daemon/packaging/`.
