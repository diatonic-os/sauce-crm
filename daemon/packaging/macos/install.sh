#!/usr/bin/env bash
#
# install.sh · install sauce-crm-daemon as a per-user launchd LaunchAgent.
#
# No sudo. Everything lands under the invoking user's $HOME:
#   bundle  -> ~/Library/Application Support/sauce-crm-daemon/sauce-crm-daemon.cjs
#   plist   -> ~/Library/LaunchAgents/com.sauce.crm-daemon.plist
#   logs    -> ~/Library/Logs/sauce-crm-daemon/{stdout,stderr}.log + daemon.jsonl
#
# Idempotent: re-running re-copies the bundle, re-renders the plist, boots out
# any prior instance, and bootstraps the fresh one.
#
# Optional flags:
#   --with-whisper   ALSO provision openai-whisper (asks first; default-off).
#   --yes | -y       assume "yes" to the whisper prompt.
# Whisper model weights are downloaded by whisper on first use, not here.
#
set -euo pipefail

WITH_WHISPER=0
ASSUME_YES=0
for arg in "$@"; do
  case "${arg}" in
    --with-whisper) WITH_WHISPER=1 ;;
    --yes|-y)       ASSUME_YES=1 ;;
    *)              printf 'install.sh: unknown argument: %s\n' "${arg}" >&2; exit 1 ;;
  esac
done

LABEL="com.sauce.crm-daemon"
APP_SUPPORT="${HOME}/Library/Application Support/sauce-crm-daemon"
LAUNCH_AGENTS="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs/sauce-crm-daemon"
PLIST_DST="${LAUNCH_AGENTS}/${LABEL}.plist"
BUNDLE_DST="${APP_SUPPORT}/sauce-crm-daemon.cjs"
PORT="${SAUCE_DAEMON_PORT:-8788}"

# Resolve this script's directory, then the source bundle + plist template.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAEMON_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"          # .../daemon
BUNDLE_SRC="${DAEMON_ROOT}/dist/sauce-crm-daemon.cjs"
PLIST_SRC="${SCRIPT_DIR}/${LABEL}.plist"

say()  { printf '  %s\n' "$*"; }
fail() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

# Provision openai-whisper (opt-in; default-off). Prefers brew, then uv, pipx,
# pip --user. Prints the command, requires interactive confirm (or --yes), no
# sudo. Returns 0 without acting when --with-whisper was not passed.
provision_whisper() {
  [ "${WITH_WHISPER}" -eq 1 ] || return 0
  local cmd=""
  if command -v brew >/dev/null 2>&1; then
    cmd="brew install openai-whisper"
  elif command -v uv >/dev/null 2>&1; then
    cmd="uv tool install openai-whisper"
  elif command -v pipx >/dev/null 2>&1; then
    cmd="pipx install openai-whisper"
  elif command -v python3 >/dev/null 2>&1; then
    cmd="python3 -m pip install --user openai-whisper"
  else
    fail "--with-whisper: no brew, uv, pipx, or python3 found to provision whisper."
  fi
  say "--with-whisper requested. This will run:"
  say "    ${cmd}"
  say "Model weights download on first use, not now."
  if [ "${ASSUME_YES}" -ne 1 ]; then
    printf 'install.sh: proceed with whisper install? [y/N] '
    read -r reply || reply=""
    case "${reply}" in
      y|Y|yes|YES) : ;;
      *) say "skipped whisper install (declined)."; return 0 ;;
    esac
  fi
  # Word-splitting of cmd is intentional (internally-built constant).
  # shellcheck disable=SC2086
  if ${cmd}; then
    local bin
    bin="$(command -v whisper 2>/dev/null || true)"
    if [ -n "${bin}" ]; then
      say "whisper installed -> ${bin}"
      say "set this ABSOLUTE path in the daemon config (whisper.binaryPath) or in"
      say "plugin Settings -> Skills -> Transcription, then enable whisper."
    else
      say "whisper installed but not yet on PATH; locate it and set its absolute path."
    fi
  else
    fail "whisper install command failed."
  fi
}

echo "sauce-crm-daemon · install"

# 1. Platform guard (launchd is macOS-only).
[ "$(uname -s)" = "Darwin" ] || fail "this installer targets macOS (launchd); got $(uname -s)."

# 2. node >= 18.
command -v node >/dev/null 2>&1 || fail "node not found on PATH. Install Node >= 18."
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "${NODE_MAJOR}" -ge 18 ] 2>/dev/null || fail "node >= 18 required; found $(node -v) at ${NODE_BIN}."
say "node ${NODE_MAJOR}.x at ${NODE_BIN} — ok"

# 3. Bundle present.
[ -f "${BUNDLE_SRC}" ] || fail "bundle not found at ${BUNDLE_SRC}. Run: npm run daemon:build"
[ -f "${PLIST_SRC}" ]  || fail "plist template not found at ${PLIST_SRC}."

# 4. Create dirs.
mkdir -p "${APP_SUPPORT}" "${LAUNCH_AGENTS}" "${LOG_DIR}"

# 5. Copy bundle.
cp "${BUNDLE_SRC}" "${BUNDLE_DST}"
chmod 0644 "${BUNDLE_DST}"
say "bundle -> ${BUNDLE_DST}"

# 6. Render plist template (tokens -> absolute paths).
#    Use a non-/ sed delimiter since the values contain spaces and slashes.
sed \
  -e "s|__NODE_BIN__|${NODE_BIN}|g" \
  -e "s|__DAEMON_BUNDLE__|${BUNDLE_DST}|g" \
  -e "s|__LOG_DIR__|${LOG_DIR}|g" \
  "${PLIST_SRC}" > "${PLIST_DST}"
chmod 0644 "${PLIST_DST}"
say "plist  -> ${PLIST_DST}"

# 7. (Re)bootstrap into the per-user GUI domain. Idempotent: bootout first,
#    ignoring "not loaded" errors, then bootstrap fresh.
DOMAIN="gui/$(id -u)"
launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "${DOMAIN}" "${PLIST_DST}"
launchctl enable "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "${DOMAIN}/${LABEL}"
say "launchd  -> bootstrapped + kickstarted in ${DOMAIN}"

# 8. Health probe (unauthenticated GET /health on localhost).
echo
echo "Probing http://127.0.0.1:${PORT}/health ..."
HEALTH_OK=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if OUT="$(curl -fsS "http://127.0.0.1:${PORT}/health" 2>/dev/null)"; then
    HEALTH_OK="1"
    echo "${OUT}"
    break
  fi
  sleep 0.5
done

echo
if [ -n "${HEALTH_OK}" ]; then
  echo "sauce-crm-daemon is up. Verify any time with:"
else
  echo "Daemon did not answer /health within ~5s. Check logs, then probe with:"
  echo "  tail -n 40 ${LOG_DIR}/stderr.log"
fi
echo "  curl -fsS http://127.0.0.1:${PORT}/health"
echo

# 9. Optional: provision whisper (opt-in, default-off).
provision_whisper

echo "Uninstall with: ${SCRIPT_DIR}/uninstall.sh"
