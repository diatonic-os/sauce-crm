#!/bin/sh
# uninstall.sh — remove the sauce-crm-daemon systemd USER service.
#
# NO sudo required. Stops + disables the unit, removes the unit file and the
# installed bundle. By default it PRESERVES the daemon config + Lance data
# (your pairing token + memory store). Pass --purge to also delete those.
#
# Usage:
#   ./uninstall.sh            # stop, disable, remove unit + bundle (keep data)
#   ./uninstall.sh --purge    # also delete config + Lance data under the central dir
set -eu

DAEMON_NAME="sauce-crm-daemon"
BUNDLE_FILE="${DAEMON_NAME}.cjs"
UNIT_FILE="${DAEMON_NAME}.service"

LIB_DIR="${HOME}/.local/lib/${DAEMON_NAME}"
UNIT_DIR="${HOME}/.config/systemd/user"

# Central per-user data dir (XDG_DATA_HOME aware), mirroring platformPaths.
DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
CENTRAL_DIR="${DATA_HOME}/sauce-crm"

log() { printf '%s\n' "uninstall.sh: $*"; }

PURGE=0
if [ "${1:-}" = "--purge" ]; then
  PURGE=1
fi

# ── 1. Stop + disable the unit (tolerate it not being installed) ────────────

if command -v systemctl >/dev/null 2>&1; then
  if systemctl --user list-unit-files "${UNIT_FILE}" >/dev/null 2>&1; then
    systemctl --user disable --now "${UNIT_FILE}" 2>/dev/null || true
    log "stopped + disabled ${UNIT_FILE}"
  else
    # Still try to stop a transient instance.
    systemctl --user stop "${UNIT_FILE}" 2>/dev/null || true
  fi
else
  log "systemctl not found; skipping service stop."
fi

# ── 2. Remove the unit file + reload ────────────────────────────────────────

if [ -f "${UNIT_DIR}/${UNIT_FILE}" ]; then
  rm -f "${UNIT_DIR}/${UNIT_FILE}"
  log "removed ${UNIT_DIR}/${UNIT_FILE}"
fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user reset-failed "${UNIT_FILE}" 2>/dev/null || true
fi

# ── 3. Remove the installed bundle ──────────────────────────────────────────

if [ -f "${LIB_DIR}/${BUNDLE_FILE}" ]; then
  rm -f "${LIB_DIR}/${BUNDLE_FILE}"
  log "removed ${LIB_DIR}/${BUNDLE_FILE}"
fi
# Remove the lib dir only if now empty.
if [ -d "${LIB_DIR}" ]; then
  rmdir "${LIB_DIR}" 2>/dev/null || true
fi

# ── 4. Optionally purge config + data ───────────────────────────────────────

if [ "${PURGE}" -eq 1 ]; then
  if [ -d "${CENTRAL_DIR}" ]; then
    rm -rf "${CENTRAL_DIR}"
    log "PURGED config + Lance data at ${CENTRAL_DIR}"
  else
    log "no central data dir at ${CENTRAL_DIR} to purge."
  fi
else
  log "preserved config + Lance data at ${CENTRAL_DIR} (pass --purge to delete)."
fi

log "done."
