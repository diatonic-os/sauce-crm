# sauce-crm-daemon — Linux packaging (systemd user service)

Install `sauce-crm-daemon` as a **systemd user service** — no root, no sudo.
The daemon binds `127.0.0.1:8788` (loopback only) and owns a vault's LanceDB
store as the single writer, so the Obsidian `sauce-crm` plugin can run
lightweight (it probes `GET /health`, and when the daemon answers it uses the
remote backend and skips its own `initLanceBackend`).

## Files

| File | Purpose |
|------|---------|
| `sauce-crm-daemon.service` | systemd **user** unit template (`__NODE_BIN__` substituted at install). |
| `install.sh` | POSIX `sh` installer: checks node ≥ 18, installs bundle + unit, enables + starts, health-checks. |
| `uninstall.sh` | POSIX `sh` uninstaller: stops, disables, removes unit + bundle; `--purge` also deletes data. |

## Prerequisites

- **Node.js ≥ 18** on `PATH`.
- **systemd** with a user instance (standard on modern Linux desktops/servers).
- The daemon bundle, either:
  - built in-repo at `daemon/dist/sauce-crm-daemon.cjs` (`npm run daemon:build`), or
  - a release URL / local path you pass to `install.sh`.
- `@lancedb/lancedb` native module installed once in the shared central runtime
  (`~/.local/share/sauce-crm/runtime/node_modules`) — the plugin's installer
  already does this. Without it, `/health` reports `lance.available:false` until
  the module is present; the daemon still boots and serves `/health`.

## Install

```sh
# From this directory, using the repo's built bundle:
./install.sh

# Or from a release URL:
./install.sh https://example.com/releases/sauce-crm-daemon.cjs

# Or from an explicit local bundle path:
./install.sh /path/to/sauce-crm-daemon.cjs
```

What it does:

1. Verifies `node` is present and `>= 18`.
2. Copies the bundle to `~/.local/lib/sauce-crm-daemon/sauce-crm-daemon.cjs`.
3. Writes the unit to `~/.config/systemd/user/sauce-crm-daemon.service`
   (substituting the resolved `node` path into `ExecStart`).
4. `systemctl --user daemon-reload && systemctl --user enable --now ...`.
5. Polls `http://127.0.0.1:8788/health` and prints the JSON on success.

On **first run** the daemon mints a pairing token (mode 0600 in its config) and
prints it once — visible via `journalctl --user -u sauce-crm-daemon`. Enter that
token in the plugin to pair.

## Manage

```sh
systemctl --user status  sauce-crm-daemon.service
systemctl --user restart sauce-crm-daemon.service
journalctl  --user -u    sauce-crm-daemon.service -f
curl -s http://127.0.0.1:8788/health
```

To keep the daemon running after you log out (no active graphical session):

```sh
loginctl enable-linger "$USER"
```

## Uninstall

```sh
./uninstall.sh           # stop + disable + remove unit and bundle; KEEP data
./uninstall.sh --purge   # also delete config + Lance data (pairing token + store)
```

Data (config + per-vault Lance stores) lives under
`<XDG_DATA_HOME or ~/.local/share>/sauce-crm`. Plain `uninstall.sh` preserves it;
`--purge` removes the whole `sauce-crm` central dir.

## Paths at a glance

| What | Path |
|------|------|
| Bundle | `~/.local/lib/sauce-crm-daemon/sauce-crm-daemon.cjs` |
| Unit | `~/.config/systemd/user/sauce-crm-daemon.service` |
| Config (0600) | `~/.local/share/sauce-crm/daemon/config.json` |
| Native runtime | `~/.local/share/sauce-crm/runtime/node_modules/@lancedb/lancedb` |
| Per-vault store | `~/.local/share/sauce-crm/vaults/<vaultId>/lancedb` |

(All under `$XDG_DATA_HOME/sauce-crm` if `XDG_DATA_HOME` is set.)

## Configuration

The unit runs the bundle with no flags; the daemon resolves its config path and
data dir itself via the same `platformPaths` helpers the plugin uses. To
override the port or point at a default vault, either edit
`~/.local/share/sauce-crm/daemon/config.json`, or add an `Environment=` line to
the unit (then `systemctl --user daemon-reload && restart`), e.g.:

```ini
[Service]
Environment=SAUCE_DAEMON_PORT=8799
Environment=SAUCE_DAEMON_VAULT=/abs/path/to/Vault
```

Recognized env: `SAUCE_DAEMON_PORT`, `SAUCE_DAEMON_CONFIG`,
`SAUCE_DAEMON_DATA_DIR`, `SAUCE_DAEMON_VAULT`, `SAUCE_DAEMON_LOG_FILE`.

> If you set a non-default `XDG_DATA_HOME`, add a matching `ReadWritePaths=`
> line to the unit so the sandbox permits writes to your data dir.

## Optional: Whisper transcription (`--with-whisper`)

The daemon can serve `POST /v1/transcribe` (HMAC-signed + AES-GCM encrypted,
100 MB body cap) so the plugin transcribes audio without spawning anything
locally. This capability is **opt-in and default-off**.

```sh
./install.sh --with-whisper          # asks before installing whisper
./install.sh --with-whisper --yes    # unattended (assume yes)
```

`--with-whisper` provisions the `openai-whisper` Python package via the first
available platform-native route — `uv tool install`, then `pipx install`, then
`pip install --user`. It prints exactly what it will run and requires an
interactive confirm unless `--yes` is passed. No `sudo`.

> **Model weights are NOT downloaded by the installer.** Whisper fetches the
> model on first use (e.g. the first transcription request), per upstream
> behavior.

After install, set the resolved **absolute** binary path and enable the route in
the daemon config (`<central>/sauce-crm/daemon/config.json`):

```json
"whisper": { "enabled": true, "binaryPath": "/home/you/.local/bin/whisper" }
```

When `whisper.enabled` is true and the binary validates, `GET /health` reports
`"whisper": { "available": true }` and the plugin (with "Prefer daemon for
transcription" on) routes transcription to the daemon — zero local spawn.

## Security model

- **Loopback only** (`127.0.0.1`); the daemon constructor refuses `0.0.0.0`/`::`.
- **HMAC on every `/v1/*` route** — same pairing/signing as the mobile bridge.
- `GET /health` is unauthenticated (info only, localhost-bound) so the plugin
  can probe presence before pairing.
- Config file is `0600`; the pairing token is the only secret and never leaves
  the host.
- The unit is hardened (`ProtectSystem=strict`, `ProtectHome=read-only`,
  `NoNewPrivileges`, a `@system-service` syscall filter, and a single writable
  `ReadWritePaths` carve-out for the data dir). All achievable without root.
