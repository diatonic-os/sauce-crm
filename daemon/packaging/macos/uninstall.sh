#!/usr/bin/env bash
#
# uninstall.sh · remove the sauce-crm-daemon launchd LaunchAgent.
#
# No sudo. Boots the agent out of the per-user GUI domain and removes the
# plist + installed bundle. Logs are LEFT in place by default (forensics);
# pass --purge-logs to remove ~/Library/Logs/sauce-crm-daemon too.
#
set -euo pipefail

LABEL="com.sauce.crm-daemon"
APP_SUPPORT="${HOME}/Library/Application Support/sauce-crm-daemon"
LAUNCH_AGENTS="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs/sauce-crm-daemon"
PLIST_DST="${LAUNCH_AGENTS}/${LABEL}.plist"

PURGE_LOGS=""
[ "${1:-}" = "--purge-logs" ] && PURGE_LOGS="1"

say()  { printf '  %s\n' "$*"; }
fail() { printf 'uninstall.sh: %s\n' "$*" >&2; exit 1; }

echo "sauce-crm-daemon · uninstall"

[ "$(uname -s)" = "Darwin" ] || fail "this uninstaller targets macOS (launchd); got $(uname -s)."

DOMAIN="gui/$(id -u)"

# 1. Boot the agent out (graceful; KeepAlive is crash-only so it stays down).
if launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null; then
  say "launchd  -> booted out of ${DOMAIN}"
else
  say "launchd  -> not loaded (already stopped) — ok"
fi

# 2. Remove plist.
if [ -f "${PLIST_DST}" ]; then
  rm -f "${PLIST_DST}"
  say "removed  ${PLIST_DST}"
else
  say "plist already absent — ok"
fi

# 3. Remove installed bundle + (now empty) app-support dir.
if [ -d "${APP_SUPPORT}" ]; then
  rm -rf "${APP_SUPPORT}"
  say "removed  ${APP_SUPPORT}"
fi

# 4. Logs.
if [ -n "${PURGE_LOGS}" ]; then
  rm -rf "${LOG_DIR}"
  say "removed  ${LOG_DIR}"
else
  say "logs kept at ${LOG_DIR} (pass --purge-logs to remove)"
fi

echo
echo "sauce-crm-daemon uninstalled."
