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
set -euo pipefail

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
echo "Uninstall with: ${SCRIPT_DIR}/uninstall.sh"
