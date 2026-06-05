#!/bin/sh
# install.sh — install sauce-crm-daemon as a systemd USER service.
#
# NO sudo required. Everything lands under the invoking user's $HOME:
#   bundle  → ~/.local/lib/sauce-crm-daemon/sauce-crm-daemon.cjs
#   unit    → ~/.config/systemd/user/sauce-crm-daemon.service
#
# Usage:
#   ./install.sh                 # copy bundle from the repo's daemon/dist
#   ./install.sh <URL>           # download bundle from a release URL instead
#   ./install.sh /path/to.cjs    # copy bundle from an explicit local path
#
# Optional flags (any position):
#   --with-whisper               # ALSO provision openai-whisper (asks first)
#   --yes | -y                   # assume "yes" to the whisper prompt
#
# Whisper provisioning is OPT-IN and DEFAULT-OFF. When requested it installs the
# `openai-whisper` Python package via the platform-native supported route
# (uv tool install / pipx / pip --user, in that preference order). Model weights
# are NOT downloaded here — whisper fetches them on first use.
#
# Re-running is idempotent: it overwrites the bundle + unit, reloads, re-enables.
set -eu

DAEMON_NAME="sauce-crm-daemon"
BUNDLE_FILE="${DAEMON_NAME}.cjs"
UNIT_FILE="${DAEMON_NAME}.service"

LIB_DIR="${HOME}/.local/lib/${DAEMON_NAME}"
UNIT_DIR="${HOME}/.config/systemd/user"

# Directory this script lives in (so we can find the sibling unit + repo dist).
# Unset CDPATH so `cd` never echoes/jumps to an unexpected dir.
unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)

log()  { printf '%s\n' "install.sh: $*"; }
err()  { printf '%s\n' "install.sh: error: $*" >&2; }
die()  { err "$*"; exit 1; }

# Provision openai-whisper via the platform-native supported route. OPT-IN: only
# runs when --with-whisper is passed. Prints exactly what it will do and requires
# an interactive "yes" (or --yes). Default-OFF: returns 0 without acting when not
# requested. Never uses sudo; installs into the user scope.
provision_whisper() {
  [ "${WITH_WHISPER}" -eq 1 ] || return 0

  # Choose the installer: uv (preferred), pipx, then pip --user.
  WHISPER_CMD=""
  if command -v uv >/dev/null 2>&1; then
    WHISPER_CMD="uv tool install openai-whisper"
  elif command -v pipx >/dev/null 2>&1; then
    WHISPER_CMD="pipx install openai-whisper"
  elif command -v python3 >/dev/null 2>&1; then
    WHISPER_CMD="python3 -m pip install --user openai-whisper"
  else
    err "--with-whisper: no uv, pipx, or python3 found; cannot provision whisper."
    err "install one of them, or set the binary path manually in plugin settings."
    return 1
  fi

  log "--with-whisper requested. This will run:"
  log "    ${WHISPER_CMD}"
  log "Model weights are downloaded by whisper on first use, not now."

  if [ "${ASSUME_YES}" -ne 1 ]; then
    printf 'install.sh: proceed with whisper install? [y/N] '
    read -r reply || reply=""
    case "${reply}" in
      y|Y|yes|YES) : ;;
      *) log "skipped whisper install (declined)."; return 0 ;;
    esac
  fi

  # WHISPER_CMD is an internally-built constant; word-splitting is intended.
  # shellcheck disable=SC2086
  if ${WHISPER_CMD}; then
    WHISPER_BIN=$(command -v whisper 2>/dev/null || true)
    if [ -n "${WHISPER_BIN}" ]; then
      log "whisper installed → ${WHISPER_BIN}"
      log "set this ABSOLUTE path in the daemon config (whisper.binaryPath) or in"
      log "plugin Settings → Skills → Transcription, then enable whisper."
    else
      log "whisper install finished, but the binary is not on PATH yet."
      log "find it (e.g. ~/.local/bin/whisper) and set its absolute path in config."
    fi
  else
    err "whisper install command failed."
    return 1
  fi
}

# ── 1. Preconditions ────────────────────────────────────────────────────────

command -v node >/dev/null 2>&1 || die "node not found on PATH (need >= 18)."

NODE_BIN=$(command -v node)
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
case "${NODE_MAJOR}" in
  ''|*[!0-9]*) die "could not determine node version." ;;
esac
[ "${NODE_MAJOR}" -ge 18 ] || die "node >= 18 required (found ${NODE_MAJOR})."
log "node ${NODE_MAJOR} OK (${NODE_BIN})"

command -v systemctl >/dev/null 2>&1 || die "systemctl not found (systemd required)."

# ── 1b. Parse flags (separate --with-whisper / --yes from the bundle source) ─

WITH_WHISPER=0
ASSUME_YES=0
ARG=""
for a in "$@"; do
  case "${a}" in
    --with-whisper) WITH_WHISPER=1 ;;
    --yes|-y)       ASSUME_YES=1 ;;
    --*)            die "unknown flag: ${a}" ;;
    *)
      if [ -z "${ARG}" ]; then
        ARG="${a}"
      else
        die "unexpected extra argument: ${a}"
      fi
      ;;
  esac
done

# ── 2. Resolve the bundle source ────────────────────────────────────────────

TMP_DOWNLOAD=""

cleanup() {
  [ -n "${TMP_DOWNLOAD}" ] && [ -f "${TMP_DOWNLOAD}" ] && rm -f "${TMP_DOWNLOAD}"
  return 0
}
trap cleanup EXIT INT TERM

if [ -z "${ARG}" ]; then
  # Default: the repo's built bundle, two dirs up from packaging/linux.
  BUNDLE_SRC="${SCRIPT_DIR}/../../dist/${BUNDLE_FILE}"
  [ -f "${BUNDLE_SRC}" ] || die "bundle not found at ${BUNDLE_SRC}; run 'npm run daemon:build' first or pass a URL/path."
elif printf '%s' "${ARG}" | grep -Eq '^https?://'; then
  # Release URL: download to a temp file.
  TMP_DOWNLOAD=$(mktemp "${TMPDIR:-/tmp}/${DAEMON_NAME}.XXXXXX") \
    || die "mktemp failed."
  log "downloading bundle from ${ARG}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${ARG}" -o "${TMP_DOWNLOAD}" || die "download failed (curl)."
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "${TMP_DOWNLOAD}" "${ARG}" || die "download failed (wget)."
  else
    die "neither curl nor wget available to download ${ARG}."
  fi
  [ -s "${TMP_DOWNLOAD}" ] || die "downloaded bundle is empty."
  BUNDLE_SRC="${TMP_DOWNLOAD}"
else
  # Explicit local path.
  BUNDLE_SRC="${ARG}"
  [ -f "${BUNDLE_SRC}" ] || die "bundle not found at ${BUNDLE_SRC}."
fi

# ── 3. Install the bundle ───────────────────────────────────────────────────

mkdir -p "${LIB_DIR}"
cp -f "${BUNDLE_SRC}" "${LIB_DIR}/${BUNDLE_FILE}"
chmod 0755 "${LIB_DIR}/${BUNDLE_FILE}"
log "installed bundle → ${LIB_DIR}/${BUNDLE_FILE}"

# ── 4. Install the unit (substitute the resolved node binary) ───────────────

UNIT_SRC="${SCRIPT_DIR}/${UNIT_FILE}"
[ -f "${UNIT_SRC}" ] || die "unit template not found at ${UNIT_SRC}."

mkdir -p "${UNIT_DIR}"
# Substitute __NODE_BIN__ with the resolved absolute node path. Use a sed
# delimiter unlikely to appear in a path.
sed "s|__NODE_BIN__|${NODE_BIN}|g" "${UNIT_SRC}" > "${UNIT_DIR}/${UNIT_FILE}"
chmod 0644 "${UNIT_DIR}/${UNIT_FILE}"
log "installed unit → ${UNIT_DIR}/${UNIT_FILE}"

# ── 5. Reload + enable + start ──────────────────────────────────────────────

systemctl --user daemon-reload
systemctl --user enable --now "${UNIT_FILE}"
log "enabled + started ${UNIT_FILE}"

# ── 6. Health check ─────────────────────────────────────────────────────────

PORT="${SAUCE_DAEMON_PORT:-8788}"
HEALTH_URL="http://127.0.0.1:${PORT}/health"

log "waiting for daemon to answer ${HEALTH_URL} ..."
i=0
ok=0
while [ "${i}" -lt 20 ]; do
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then ok=1; break; fi
  elif command -v wget >/dev/null 2>&1; then
    if wget -qO- "${HEALTH_URL}" >/dev/null 2>&1; then ok=1; break; fi
  else
    log "no curl/wget for health probe; check manually: ${HEALTH_URL}"
    ok=2
    break
  fi
  i=$((i + 1))
  sleep 1
done

if [ "${ok}" -eq 1 ]; then
  log "health check OK:"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "${HEALTH_URL}" || true
  else
    wget -qO- "${HEALTH_URL}" || true
  fi
  printf '\n'
elif [ "${ok}" -eq 2 ]; then
  : # already messaged
else
  err "daemon did not answer ${HEALTH_URL} within 20s."
  err "inspect logs: journalctl --user -u ${UNIT_FILE} -n 50 --no-pager"
  exit 1
fi

# ── 7. Optional: provision whisper (opt-in, default-off) ────────────────────

provision_whisper || die "whisper provisioning failed (the daemon is still installed)."

log "done. Manage with:"
log "  systemctl --user status ${UNIT_FILE}"
log "  journalctl  --user -u  ${UNIT_FILE} -f"
log "Pairing token (first run) is in the daemon config + journal output above."
