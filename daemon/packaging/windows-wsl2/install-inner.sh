#!/usr/bin/env bash
# sauce-crm-daemon · inside-WSL2-distro installer.
#
# Runs INSIDE the WSL2 Linux distro (invoked by install-wsl.ps1 via
# `wsl -e bash`). It is intentionally a near-clone of the plain Linux
# packaging flow: it installs the daemon bundle into the user's data dir
# and registers the SAME systemd *user* unit pattern, then enables it.
#
# The only WSL-specific concern is networking (handled by the unit binding
# 127.0.0.1, which the Windows host reaches via WSL2 localhost forwarding —
# see README.md). Nothing here binds a non-loopback address.
#
# Idempotent: re-running upgrades the bundle in place and never rotates the
# pairing token (that lives in the daemon's 0600 config, minted on first run).
#
# Inputs (env, set by install-wsl.ps1; all optional with sane defaults):
#   SAUCE_DAEMON_BUNDLE_SRC  absolute path (inside distro) to the staged
#                            sauce-crm-daemon.cjs to install. Required.
#   SAUCE_DAEMON_PORT        TCP port (default 8788).
#   SAUCE_DAEMON_VAULT       default vault base path (translated to a WSL
#                            path, e.g. /mnt/c/Users/me/Vault). Optional.
#   SAUCE_DAEMON_NO_START    if "1", install + enable but do not start now.
#   SAUCE_DAEMON_WITH_WHISPER if "1", ALSO provision openai-whisper (opt-in,
#                            default-off). Model weights download on first use.
#   SAUCE_DAEMON_ASSUME_YES  if "1", assume "yes" to the whisper prompt.
set -euo pipefail

log()  { printf 'install-inner: %s\n' "$*"; }
die()  { printf 'install-inner: ERROR: %s\n' "$*" >&2; exit 1; }

# Provision openai-whisper inside the distro (opt-in via env; default-off).
# Prefers uv, then pipx, then pip --user. No sudo. The WSL inner script inherits
# the same Linux provisioning route as the native Linux installer.
provision_whisper() {
  [ "${SAUCE_DAEMON_WITH_WHISPER:-0}" = "1" ] || return 0
  local cmd=""
  if command -v uv >/dev/null 2>&1; then
    cmd="uv tool install openai-whisper"
  elif command -v pipx >/dev/null 2>&1; then
    cmd="pipx install openai-whisper"
  elif command -v python3 >/dev/null 2>&1; then
    cmd="python3 -m pip install --user openai-whisper"
  else
    die "--with-whisper: no uv, pipx, or python3 in the distro to provision whisper."
  fi
  log "SAUCE_DAEMON_WITH_WHISPER=1 — this will run: ${cmd}"
  log "Model weights download on first use, not now."
  if [ "${SAUCE_DAEMON_ASSUME_YES:-0}" != "1" ]; then
    printf 'install-inner: proceed with whisper install? [y/N] '
    read -r reply || reply=""
    case "${reply}" in
      y|Y|yes|YES) : ;;
      *) log "skipped whisper install (declined)."; return 0 ;;
    esac
  fi
  # Word-splitting of cmd is intentional (internally-built constant).
  # shellcheck disable=SC2086
  if ${cmd}; then
    local bin
    bin="$(command -v whisper 2>/dev/null || true)"
    if [ -n "${bin}" ]; then
      log "whisper installed → ${bin} (set this absolute path in config/settings)."
    else
      log "whisper installed but not on PATH yet; locate it and set its absolute path."
    fi
  else
    die "whisper install command failed."
  fi
}

# --- 0. Preconditions ------------------------------------------------------
command -v node >/dev/null 2>&1 || die "node not found on PATH inside the distro. Install Node 18+ (e.g. via nvm or the distro package) and re-run."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "${NODE_MAJOR:-0}" -ge 18 ] || die "node 18+ required (found $(node -v 2>/dev/null || echo none))."

BUNDLE_SRC="${SAUCE_DAEMON_BUNDLE_SRC:-}"
[ -n "$BUNDLE_SRC" ] || die "SAUCE_DAEMON_BUNDLE_SRC not set (path to staged sauce-crm-daemon.cjs)."
[ -f "$BUNDLE_SRC" ] || die "bundle not found at: $BUNDLE_SRC"

PORT="${SAUCE_DAEMON_PORT:-8788}"
VAULT="${SAUCE_DAEMON_VAULT:-}"

# --- 1. Resolve install locations (XDG, user-scoped, no root) --------------
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
BIN_HOME="${XDG_BIN_HOME:-$HOME/.local/bin}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
INSTALL_DIR="$DATA_HOME/sauce-crm/daemon"
BUNDLE_DST="$INSTALL_DIR/sauce-crm-daemon.cjs"
UNIT_NAME="sauce-crm-daemon.service"
UNIT_PATH="$UNIT_DIR/$UNIT_NAME"

mkdir -p "$INSTALL_DIR" "$BIN_HOME" "$UNIT_DIR"

# --- 2. Install the bundle -------------------------------------------------
install -m 0644 "$BUNDLE_SRC" "$BUNDLE_DST"
log "installed bundle → $BUNDLE_DST"

# Convenience launcher on PATH.
cat > "$BIN_HOME/sauce-crm-daemon" <<LAUNCH
#!/usr/bin/env bash
exec node "$BUNDLE_DST" "\$@"
LAUNCH
chmod 0755 "$BIN_HOME/sauce-crm-daemon"
log "installed launcher → $BIN_HOME/sauce-crm-daemon"

# --- 3. Write the systemd USER unit (same pattern as linux packaging) ------
# ExecStart binds the default 127.0.0.1 host inside the daemon; we pass only
# --port and (optionally) --vault. The pairing token + config are managed by
# the daemon itself at <central>/sauce-crm/daemon/config.json (mode 0600).
NODE_BIN="$(command -v node)"
EXEC="$NODE_BIN $BUNDLE_DST --port $PORT"
[ -n "$VAULT" ] && EXEC="$EXEC --vault $VAULT"

cat > "$UNIT_PATH" <<UNIT
[Unit]
Description=sauce-crm-daemon (localhost LanceDB sidecar for the sauce-crm Obsidian plugin)
Documentation=https://github.com/sauce/sauce-crm
After=network.target

[Service]
Type=simple
ExecStart=$EXEC
Restart=on-failure
RestartSec=2
# Loopback-only daemon; no elevated privileges required.
NoNewPrivileges=true
# Bind is 127.0.0.1 inside the process; nothing listens off-host.
Environment=SAUCE_DAEMON_PORT=$PORT

[Install]
WantedBy=default.target
UNIT
log "wrote systemd user unit → $UNIT_PATH"

# --- 4. Enable linger so the unit survives logout / runs headless ----------
# Under WSL2 there may be no seat; linger lets the user manager persist.
if command -v loginctl >/dev/null 2>&1; then
  if loginctl enable-linger "$USER" >/dev/null 2>&1; then
    log "enabled linger for $USER (user services persist without an active login)"
  else
    log "WARN: could not enable linger (loginctl enable-linger failed). The"
    log "      daemon will still run while a WSL session is open. To persist"
    log "      headless, ensure systemd is the WSL init (see README.md)."
  fi
else
  log "WARN: loginctl not available — systemd may not be the WSL init."
  log "      Enable it in /etc/wsl.conf ([boot] systemd=true) and run"
  log "      'wsl --shutdown' from Windows, then re-run this installer."
fi

# --- 5. Reload + enable + (optionally) start -------------------------------
if ! systemctl --user daemon-reload >/dev/null 2>&1; then
  die "systemctl --user not responding. systemd is likely not the WSL init.
       Add to /etc/wsl.conf:
         [boot]
         systemd=true
       then run 'wsl --shutdown' from Windows PowerShell and re-run the installer."
fi

systemctl --user enable "$UNIT_NAME" >/dev/null 2>&1 || die "failed to enable $UNIT_NAME"
log "enabled $UNIT_NAME (starts on boot/login)"

if [ "${SAUCE_DAEMON_NO_START:-0}" = "1" ]; then
  log "SAUCE_DAEMON_NO_START=1 → not starting now."
else
  systemctl --user restart "$UNIT_NAME" || die "failed to start $UNIT_NAME"
  log "started $UNIT_NAME"
  # Give it a beat to bind, then surface status + the first-run token line.
  sleep 1
  systemctl --user --no-pager --lines=20 status "$UNIT_NAME" || true
  log "first-run pairing token (if just minted) is in the log above and in:"
  log "  $DATA_HOME/sauce-crm/daemon/config.json"
fi

# --- 6. Optional: provision whisper (opt-in via env, default-off) ----------
provision_whisper

log "done. Health: curl -s http://127.0.0.1:$PORT/health"
