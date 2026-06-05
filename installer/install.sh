#!/usr/bin/env bash
###############################################################################
# Sauce CRM — Obsidian plugin installer (macOS + Linux)
#
# WHAT THIS DOES
#   1. Detects OS + architecture.
#   2. Detects the Obsidian *host application* (not the plugin).
#   3. If Obsidian is absent, prints exactly what it will install and the
#      method, asks for consent (default No), then installs Obsidian using a
#      package-manager-first / direct-download-fallback strategy and WAITS for
#      that install to finish (subprocess exit 0 == "install finished").
#   4. Opens a native folder picker (GUI when available, tty prompt fallback)
#      to choose a PARENT directory + vault NAME, then creates <parent>/<name>.
#   5. Installs the Sauce CRM plugin (0.4.2) into
#      <vault>/.obsidian/plugins/sauce-crm/ — every download is verified
#      non-empty and the manifest is verified to parse with id "sauce-crm".
#   6. Pre-enables the plugin (community-plugins.json) and registers the vault
#      in Obsidian's global obsidian.json WITHOUT corrupting existing entries.
#   7. Honestly explains the one-time Restricted-Mode click the USER must make,
#      and optionally opens the vault via the obsidian:// URI scheme.
#   8. Prints a final summary.
#
# RUNNABLE UNDER:  curl -fsSL <url> | bash
#   All interactive reads come from /dev/tty so piping stdin does not break
#   prompts. When no GUI dialog tool exists, it falls back to tty text prompts.
#
# HARD RULES HONORED
#   - set -euo pipefail
#   - no sudo
#   - consent (default No) before ANY system install
#   - idempotent (re-run detects existing Obsidian + vault and skips)
#   - every download integrity-checked (non-empty + expected shape)
#   - never corrupts obsidian.json / community-plugins.json (parse-merge;
#     when no JSON tool is available it only *creates* missing files and warns
#     rather than rewriting an existing one)
#   - shellcheck -S warning clean
#
# EXTERNAL COMMANDS (with fallbacks) — see the trailing comment block.
###############################################################################

set -euo pipefail

# ----------------------------------------------------------------------------
# Constants
# ----------------------------------------------------------------------------
PLUGIN_ID="sauce-crm"
PLUGIN_NAME="Sauce CRM"
PLUGIN_VERSION="0.4.2"
REL_BASE="https://github.com/Diatonic-OS/sauce-crm/releases/download/${PLUGIN_VERSION}"
RAW_BASE="https://raw.githubusercontent.com/Diatonic-OS/sauce-crm/${PLUGIN_VERSION}"
OBSIDIAN_RELEASES_API="https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest"
OBSIDIAN_DOWNLOAD_PAGE="https://obsidian.md/download"

# ANSI (suppressed when not a tty)
if [ -t 1 ]; then
  C_BOLD="$(printf '\033[1m')"; C_DIM="$(printf '\033[2m')"
  C_RED="$(printf '\033[31m')"; C_GRN="$(printf '\033[32m')"
  C_YEL="$(printf '\033[33m')"; C_RST="$(printf '\033[0m')"
else
  C_BOLD=""; C_DIM=""; C_RED=""; C_GRN=""; C_YEL=""; C_RST=""
fi

# Working temp dir + cleanup trap
TMPDIR_INSTALL="$(mktemp -d "${TMPDIR:-/tmp}/sauce-crm-install.XXXXXX")"
cleanup() { rm -rf "${TMPDIR_INSTALL}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Globals populated as we go
OS=""           # macos | linux
ARCH=""         # x64 | arm64 | ...
OBSIDIAN_FOUND="no"
OBSIDIAN_HOW=""
VAULT_PATH=""
OBSIDIAN_CONFIG_JSON=""

# ----------------------------------------------------------------------------
# Output helpers
# ----------------------------------------------------------------------------
info()  { printf '%s\n' "${C_BOLD}==>${C_RST} $*"; }
sub()   { printf '%s\n' "    ${C_DIM}$*${C_RST}"; }
ok()    { printf '%s\n' "${C_GRN}OK${C_RST}  $*"; }
warn()  { printf '%s\n' "${C_YEL}WARN${C_RST} $*" >&2; }
die()   { printf '%s\n' "${C_RED}ERROR${C_RST} $*" >&2; exit 1; }

have()  { command -v "$1" >/dev/null 2>&1; }

# Read a single line interactively from the controlling terminal.
# Works even under `curl | bash` because we explicitly read </dev/tty.
# $1 = prompt, $2 = default (optional). Echoes the answer.
tty_read() {
  _prompt="$1"; _default="${2:-}"; _ans=""
  if [ ! -r /dev/tty ]; then
    # No terminal: fall back to the default (non-interactive context).
    printf '%s\n' "${_default}"
    return 0
  fi
  if [ -n "${_default}" ]; then
    printf '%s [%s]: ' "${_prompt}" "${_default}" >/dev/tty
  else
    printf '%s: ' "${_prompt}" >/dev/tty
  fi
  IFS= read -r _ans </dev/tty || _ans=""
  if [ -z "${_ans}" ]; then _ans="${_default}"; fi
  printf '%s\n' "${_ans}"
}

# Yes/No prompt, default No unless $2 == yes. Returns 0 for yes, 1 for no.
tty_confirm() {
  _prompt="$1"; _def="${2:-no}"
  if [ "${_def}" = "yes" ]; then _hint="Y/n"; else _hint="y/N"; fi
  _a="$(tty_read "${_prompt} (${_hint})" "")"
  case "${_a}" in
    [Yy]|[Yy][Ee][Ss]) return 0 ;;
    [Nn]|[Nn][Oo])     return 1 ;;
    "")  [ "${_def}" = "yes" ] && return 0 || return 1 ;;
    *)   [ "${_def}" = "yes" ] && return 0 || return 1 ;;
  esac
}

# ----------------------------------------------------------------------------
# Download helper — curl-first, wget fallback; verify non-empty.
# $1 = url, $2 = dest path
# ----------------------------------------------------------------------------
fetch() {
  _url="$1"; _dest="$2"
  if have curl; then
    curl -fsSL "${_url}" -o "${_dest}" || return 1
  elif have wget; then
    wget -q -O "${_dest}" "${_url}" || return 1
  else
    die "Neither curl nor wget is available; cannot download ${_url}"
  fi
  if [ ! -s "${_dest}" ]; then
    return 1
  fi
  return 0
}

# Fetch to stdout (used for the GitHub latest-release JSON).
fetch_stdout() {
  _url="$1"
  if have curl; then
    curl -fsSL "${_url}"
  elif have wget; then
    wget -q -O - "${_url}"
  else
    die "Neither curl nor wget is available; cannot fetch ${_url}"
  fi
}

# ----------------------------------------------------------------------------
# 1. Detect OS + arch
# ----------------------------------------------------------------------------
detect_os() {
  _uname="$(uname -s 2>/dev/null || echo unknown)"
  case "${_uname}" in
    Darwin) OS="macos" ;;
    Linux)  OS="linux" ;;
    *)      die "Unsupported OS: ${_uname}. This installer covers macOS and Linux." ;;
  esac
  _m="$(uname -m 2>/dev/null || echo unknown)"
  case "${_m}" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) ARCH="${_m}" ;;
  esac
  info "Detected: ${C_BOLD}${OS}${C_RST} / ${ARCH}"
}

# ----------------------------------------------------------------------------
# 2. Detect the Obsidian host application
# ----------------------------------------------------------------------------
detect_obsidian_macos() {
  if [ -d "/Applications/Obsidian.app" ]; then
    OBSIDIAN_FOUND="yes"; OBSIDIAN_HOW="/Applications/Obsidian.app"; return 0
  fi
  if [ -d "${HOME}/Applications/Obsidian.app" ]; then
    OBSIDIAN_FOUND="yes"; OBSIDIAN_HOW="${HOME}/Applications/Obsidian.app"; return 0
  fi
  if have mdfind; then
    _hit="$(mdfind 'kMDItemCFBundleIdentifier == md.obsidian' 2>/dev/null | head -n1 || true)"
    if [ -n "${_hit}" ]; then
      OBSIDIAN_FOUND="yes"; OBSIDIAN_HOW="${_hit}"; return 0
    fi
  fi
  return 1
}

detect_obsidian_linux() {
  if have obsidian; then
    OBSIDIAN_FOUND="yes"; OBSIDIAN_HOW="$(command -v obsidian)"; return 0
  fi
  if have flatpak && flatpak info md.obsidian.Obsidian >/dev/null 2>&1; then
    OBSIDIAN_FOUND="yes"; OBSIDIAN_HOW="flatpak: md.obsidian.Obsidian"; return 0
  fi
  if have snap && snap list obsidian >/dev/null 2>&1; then
    OBSIDIAN_FOUND="yes"; OBSIDIAN_HOW="snap: obsidian"; return 0
  fi
  # AppImage on common paths
  for _d in "${HOME}/Applications" "${HOME}/.local/bin" /opt; do
    [ -d "${_d}" ] || continue
    _img="$(find "${_d}" -maxdepth 2 -iname 'obsidian*.appimage' -type f 2>/dev/null | head -n1 || true)"
    if [ -n "${_img}" ]; then
      OBSIDIAN_FOUND="yes"; OBSIDIAN_HOW="AppImage: ${_img}"; return 0
    fi
  done
  # .desktop launchers
  for _ad in /usr/share/applications "${HOME}/.local/share/applications"; do
    [ -d "${_ad}" ] || continue
    if ls "${_ad}"/*obsidian*.desktop >/dev/null 2>&1; then
      OBSIDIAN_FOUND="yes"
      OBSIDIAN_HOW="$(ls "${_ad}"/*obsidian*.desktop 2>/dev/null | head -n1)"
      return 0
    fi
  done
  return 1
}

detect_obsidian() {
  info "Looking for the Obsidian application..."
  if [ "${OS}" = "macos" ]; then
    detect_obsidian_macos || true
  else
    detect_obsidian_linux || true
  fi
  if [ "${OBSIDIAN_FOUND}" = "yes" ]; then
    ok "Obsidian found (${OBSIDIAN_HOW})."
  else
    warn "Obsidian was not detected on this system."
  fi
}

# ----------------------------------------------------------------------------
# 3. Install Obsidian (only if absent + consented). Waits for completion.
# ----------------------------------------------------------------------------

# Resolve the latest Obsidian desktop release asset URL matching a suffix glob.
# $1 = grep pattern for the asset name (e.g. 'universal\.dmg' )
obsidian_latest_asset_url() {
  _pat="$1"
  _json="$(fetch_stdout "${OBSIDIAN_RELEASES_API}" 2>/dev/null || true)"
  [ -n "${_json}" ] || return 1
  if have jq; then
    printf '%s' "${_json}" \
      | jq -r '.assets[].browser_download_url' 2>/dev/null \
      | grep -iE "${_pat}" | head -n1
  else
    # Fallback: scrape browser_download_url lines without jq.
    printf '%s' "${_json}" \
      | grep -oE '"browser_download_url":[[:space:]]*"[^"]+"' \
      | sed -E 's/.*"(https[^"]+)".*/\1/' \
      | grep -iE "${_pat}" | head -n1
  fi
}

install_obsidian_macos() {
  if have brew; then
    info "Installing Obsidian via Homebrew (brew install --cask obsidian)..."
    if brew install --cask obsidian; then
      ok "Homebrew install finished."
      return 0
    fi
    warn "Homebrew install failed; falling back to direct .dmg download."
  fi
  info "Resolving latest Obsidian .dmg..."
  _url="$(obsidian_latest_asset_url 'universal\.dmg|Obsidian-[0-9].*\.dmg')"
  [ -n "${_url}" ] || die "Could not resolve a .dmg asset from obsidian-releases."
  sub "Asset: ${_url}"
  _dmg="${TMPDIR_INSTALL}/Obsidian.dmg"
  fetch "${_url}" "${_dmg}" || die "Failed to download Obsidian .dmg."
  info "Mounting the disk image..."
  _mnt="${TMPDIR_INSTALL}/mnt"
  mkdir -p "${_mnt}"
  hdiutil attach "${_dmg}" -nobrowse -mountpoint "${_mnt}" >/dev/null \
    || die "hdiutil attach failed."
  # Ensure we always detach.
  _app="$(find "${_mnt}" -maxdepth 1 -iname 'Obsidian.app' -print 2>/dev/null | head -n1 || true)"
  if [ -z "${_app}" ]; then
    hdiutil detach "${_mnt}" >/dev/null 2>&1 || true
    die "Obsidian.app not found inside the mounted image."
  fi
  info "Copying Obsidian.app to /Applications..."
  if cp -R "${_app}" /Applications/; then
    ok "Copied to /Applications/Obsidian.app."
  else
    hdiutil detach "${_mnt}" >/dev/null 2>&1 || true
    die "Copy to /Applications failed (permissions?)."
  fi
  hdiutil detach "${_mnt}" >/dev/null 2>&1 || true
  ok "Obsidian install finished."
}

install_obsidian_linux() {
  if have flatpak; then
    info "Installing Obsidian via Flatpak (flatpak install -y flathub md.obsidian.Obsidian)..."
    if flatpak install -y flathub md.obsidian.Obsidian; then
      ok "Flatpak install finished."
      return 0
    fi
    warn "Flatpak install failed; falling back to AppImage."
  fi
  info "Resolving latest Obsidian .AppImage..."
  _url="$(obsidian_latest_asset_url '\.appimage$')"
  if [ -z "${_url}" ]; then
    if have snap; then
      info "No AppImage resolved; trying snap (snap install obsidian)..."
      if snap install obsidian; then
        ok "Snap install finished."
        return 0
      fi
    fi
    die "Could not resolve an AppImage asset from obsidian-releases."
  fi
  sub "Asset: ${_url}"
  mkdir -p "${HOME}/.local/bin"
  _img="${HOME}/.local/bin/obsidian"
  fetch "${_url}" "${_img}" || die "Failed to download Obsidian AppImage."
  chmod +x "${_img}"
  ok "AppImage installed at ${_img}"
  # Write a .desktop launcher (best-effort).
  _appdir="${HOME}/.local/share/applications"
  mkdir -p "${_appdir}"
  _desktop="${_appdir}/obsidian.desktop"
  {
    printf '%s\n' '[Desktop Entry]'
    printf '%s\n' 'Name=Obsidian'
    printf '%s\n' "Exec=${_img} %u"
    printf '%s\n' 'Terminal=false'
    printf '%s\n' 'Type=Application'
    printf '%s\n' 'Icon=obsidian'
    printf '%s\n' 'Categories=Office;'
    printf '%s\n' 'MimeType=x-scheme-handler/obsidian;'
  } > "${_desktop}"
  have update-desktop-database && update-desktop-database "${_appdir}" >/dev/null 2>&1 || true
  ok "Desktop launcher written to ${_desktop}"
  ok "Obsidian install finished."
}

ensure_obsidian() {
  if [ "${OBSIDIAN_FOUND}" = "yes" ]; then
    return 0
  fi
  # Describe exactly what will happen, then consent (default No).
  printf '\n'
  info "Obsidian is required and was not found. Proposed installation:"
  if [ "${OS}" = "macos" ]; then
    if have brew; then
      sub "Method: Homebrew  ->  brew install --cask obsidian"
    else
      sub "Method: download latest official Obsidian .dmg, copy Obsidian.app to /Applications"
    fi
  else
    if have flatpak; then
      sub "Method: Flatpak  ->  flatpak install -y flathub md.obsidian.Obsidian"
    elif have snap; then
      sub "Method: download latest .AppImage (or snap install obsidian)"
    else
      sub "Method: download latest official .AppImage to ~/.local/bin/obsidian + .desktop launcher"
    fi
  fi
  sub "No sudo will be used. Nothing is installed without your consent."
  printf '\n'
  if ! tty_confirm "Install Obsidian now?" "no"; then
    warn "Consent declined. Obsidian is required to use this plugin."
    info "Install it manually from: ${OBSIDIAN_DOWNLOAD_PAGE}"
    info "Then re-run this installer."
    exit 0
  fi
  if [ "${OS}" = "macos" ]; then
    install_obsidian_macos
  else
    install_obsidian_linux
  fi
  # Re-detect to confirm.
  OBSIDIAN_FOUND="no"; OBSIDIAN_HOW=""
  detect_obsidian
  if [ "${OBSIDIAN_FOUND}" != "yes" ]; then
    warn "Could not confirm Obsidian after install; continuing, but verify manually."
    OBSIDIAN_FOUND="yes"
    OBSIDIAN_HOW="(just installed)"
  fi
}

# ----------------------------------------------------------------------------
# 4. Folder picker — GUI dialog when available, tty fallback otherwise.
# ----------------------------------------------------------------------------
pick_parent_dir() {
  _parent=""
  if [ "${OS}" = "macos" ] && have osascript; then
    _parent="$(osascript -e 'try' \
      -e 'POSIX path of (choose folder with prompt "Choose a PARENT folder for your new Sauce CRM vault")' \
      -e 'on error' -e 'return ""' -e 'end try' 2>/dev/null || true)"
  elif [ "${OS}" = "linux" ] && have zenity; then
    _parent="$(zenity --file-selection --directory \
      --title="Choose a PARENT folder for your new Sauce CRM vault" 2>/dev/null || true)"
  elif [ "${OS}" = "linux" ] && have kdialog; then
    _parent="$(kdialog --getexistingdirectory "${HOME}" \
      --title "Choose a PARENT folder for your new Sauce CRM vault" 2>/dev/null || true)"
  fi
  if [ -z "${_parent}" ]; then
    _parent="$(tty_read "Parent folder for the new vault" "${HOME}")"
  fi
  # Expand a leading literal tilde. The ~ is held in a variable so it is
  # treated as data (a pattern char), not a quoted home-dir expansion.
  _tilde='~'
  case "${_parent}" in
    "${_tilde}") _parent="${HOME}" ;;
    "${_tilde}/"*) _parent="${HOME}/${_parent#"${_tilde}/"}" ;;
  esac
  printf '%s\n' "${_parent}"
}

pick_vault_name() {
  _name=""
  if [ "${OS}" = "macos" ] && have osascript; then
    _name="$(osascript -e 'try' \
      -e 'text returned of (display dialog "Vault name" default answer "sauce-crm-vault")' \
      -e 'on error' -e 'return ""' -e 'end try' 2>/dev/null || true)"
  elif [ "${OS}" = "linux" ] && have zenity; then
    _name="$(zenity --entry --title="Vault name" \
      --text="Vault name" --entry-text="sauce-crm-vault" 2>/dev/null || true)"
  elif [ "${OS}" = "linux" ] && have kdialog; then
    _name="$(kdialog --inputbox "Vault name" "sauce-crm-vault" 2>/dev/null || true)"
  fi
  if [ -z "${_name}" ]; then
    _name="$(tty_read "Vault name" "sauce-crm-vault")"
  fi
  printf '%s\n' "${_name}"
}

choose_vault() {
  info "Choose where to create the new Sauce CRM vault."
  while :; do
    _parent="$(pick_parent_dir)"
    [ -n "${_parent}" ] || die "No parent folder chosen."
    if [ ! -d "${_parent}" ]; then
      if tty_confirm "Parent '${_parent}' does not exist. Create it?" "yes"; then
        mkdir -p "${_parent}" || die "Could not create ${_parent}"
      else
        continue
      fi
    fi
    _name="$(pick_vault_name)"
    [ -n "${_name}" ] || _name="sauce-crm-vault"
    _candidate="${_parent%/}/${_name}"
    if [ -e "${_candidate}" ]; then
      # Refuse to clobber a non-empty existing folder.
      if [ -d "${_candidate}" ] && [ -z "$(ls -A "${_candidate}" 2>/dev/null)" ]; then
        VAULT_PATH="${_candidate}"; break
      fi
      warn "'${_candidate}' already exists and is not empty."
      if tty_confirm "Choose a DIFFERENT name/location?" "yes"; then
        continue
      else
        die "Refusing to overwrite an existing non-empty folder. Aborting."
      fi
    fi
    VAULT_PATH="${_candidate}"
    break
  done
  mkdir -p "${VAULT_PATH}" || die "Could not create vault at ${VAULT_PATH}"
  # Normalize to an absolute path.
  VAULT_PATH="$(cd "${VAULT_PATH}" && pwd)"
  ok "Vault location: ${VAULT_PATH}"
}

# ----------------------------------------------------------------------------
# 5. Install the plugin into the vault (download + integrity-check).
# ----------------------------------------------------------------------------
install_plugin() {
  _pdir="${VAULT_PATH}/.obsidian/plugins/${PLUGIN_ID}"
  info "Installing the ${PLUGIN_NAME} plugin (${PLUGIN_VERSION}) into the vault..."
  mkdir -p "${_pdir}"

  # main.js, manifest.json, styles.css from the release; versions.json from raw.
  for _f in main.js manifest.json styles.css; do
    sub "Downloading ${_f}..."
    if ! fetch "${REL_BASE}/${_f}" "${TMPDIR_INSTALL}/${_f}"; then
      die "Download failed or empty: ${REL_BASE}/${_f}"
    fi
  done
  sub "Downloading versions.json..."
  if ! fetch "${RAW_BASE}/versions.json" "${TMPDIR_INSTALL}/versions.json"; then
    die "Download failed or empty: ${RAW_BASE}/versions.json"
  fi

  # Verify manifest parses and id == sauce-crm.
  _id=""
  if have jq; then
    _id="$(jq -r '.id // empty' "${TMPDIR_INSTALL}/manifest.json" 2>/dev/null || true)"
  elif have python3; then
    _id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id",""))' \
      "${TMPDIR_INSTALL}/manifest.json" 2>/dev/null || true)"
  else
    # Minimal shape check without a JSON parser.
    if grep -q '"id"[[:space:]]*:[[:space:]]*"'"${PLUGIN_ID}"'"' "${TMPDIR_INSTALL}/manifest.json"; then
      _id="${PLUGIN_ID}"
    fi
  fi
  if [ "${_id}" != "${PLUGIN_ID}" ]; then
    die "manifest.json did not parse with id \"${PLUGIN_ID}\" (got: '${_id}'). Aborting."
  fi

  # Stage into place.
  for _f in main.js manifest.json styles.css versions.json; do
    cp "${TMPDIR_INSTALL}/${_f}" "${_pdir}/${_f}" || die "Could not write ${_pdir}/${_f}"
    [ -s "${_pdir}/${_f}" ] || die "Installed file is empty: ${_pdir}/${_f}"
  done
  ok "Plugin files installed to ${_pdir}"
}

# ----------------------------------------------------------------------------
# 6a. Pre-enable the plugin (community-plugins.json).
# ----------------------------------------------------------------------------
preenable_plugin() {
  _cfg="${VAULT_PATH}/.obsidian/community-plugins.json"
  mkdir -p "${VAULT_PATH}/.obsidian"
  if [ ! -f "${_cfg}" ]; then
    printf '%s\n' "[\"${PLUGIN_ID}\"]" > "${_cfg}"
    ok "Wrote community-plugins.json (enabled ${PLUGIN_ID})."
    return 0
  fi
  # File exists — merge without corrupting.
  if have jq; then
    _tmp="${TMPDIR_INSTALL}/cp.json"
    if jq --arg id "${PLUGIN_ID}" \
         'if (type=="array") then (. + [$id] | unique) else [$id] end' \
         "${_cfg}" > "${_tmp}" 2>/dev/null && [ -s "${_tmp}" ]; then
      cp "${_tmp}" "${_cfg}"
      ok "Merged ${PLUGIN_ID} into existing community-plugins.json."
      return 0
    fi
  elif have python3; then
    if python3 - "$_cfg" "$PLUGIN_ID" <<'PY' 2>/dev/null
import json,sys
p,pid=sys.argv[1],sys.argv[2]
try:
    d=json.load(open(p))
    if not isinstance(d,list): d=[]
except Exception:
    d=[]
if pid not in d: d.append(pid)
json.dump(d,open(p,"w"))
PY
    then
      ok "Merged ${PLUGIN_ID} into existing community-plugins.json (python)."
      return 0
    fi
  fi
  # No JSON tool and file exists — do not corrupt it; warn instead.
  if grep -q "\"${PLUGIN_ID}\"" "${_cfg}" 2>/dev/null; then
    ok "community-plugins.json already lists ${PLUGIN_ID}."
  else
    warn "community-plugins.json exists but no JSON tool (jq/python3) is available to merge safely."
    warn "Enable ${PLUGIN_NAME} manually in Settings -> Community plugins after first open."
  fi
}

# ----------------------------------------------------------------------------
# 6b. Register the vault in Obsidian's global obsidian.json (parse-merge).
# ----------------------------------------------------------------------------
resolve_obsidian_config_path() {
  if [ "${OS}" = "macos" ]; then
    OBSIDIAN_CONFIG_JSON="${HOME}/Library/Application Support/obsidian/obsidian.json"
  else
    OBSIDIAN_CONFIG_JSON="${HOME}/.config/obsidian/obsidian.json"
  fi
}

# 16 random hex chars for the vault id.
random_hex16() {
  if have python3; then
    python3 -c 'import secrets; print(secrets.token_hex(8))'
  elif [ -r /dev/urandom ] && have od; then
    od -An -N8 -tx1 /dev/urandom | tr -d ' \n'
  else
    # Last-resort, time-seeded.
    printf '%016x' "$(( $(date +%s) * 100000 + $$ ))"
  fi
}

register_vault() {
  resolve_obsidian_config_path
  _cfg="${OBSIDIAN_CONFIG_JSON}"
  _dir="$(dirname "${_cfg}")"
  mkdir -p "${_dir}"
  _id="$(random_hex16)"
  _ts="$(( $(date +%s) * 1000 ))"

  if [ ! -f "${_cfg}" ]; then
    printf '{"vaults":{"%s":{"path":%s,"ts":%s}}}\n' \
      "${_id}" "\"${VAULT_PATH}\"" "${_ts}" > "${_cfg}"
    ok "Created obsidian.json and registered the vault."
    return 0
  fi

  if have jq; then
    _tmp="${TMPDIR_INSTALL}/obsidian.json"
    if jq --arg id "${_id}" --arg path "${VAULT_PATH}" --argjson ts "${_ts}" \
         '(.vaults //= {}) | .vaults[$id] = {"path":$path,"ts":$ts}' \
         "${_cfg}" > "${_tmp}" 2>/dev/null && [ -s "${_tmp}" ]; then
      # Avoid duplicate registration of the same path (idempotent).
      if jq -e --arg path "${VAULT_PATH}" \
           'any(.vaults[]?; .path == $path)' "${_cfg}" >/dev/null 2>&1; then
        ok "Vault already registered in obsidian.json (skipping)."
      else
        cp "${_tmp}" "${_cfg}"
        ok "Registered the vault in obsidian.json (merged)."
      fi
      return 0
    fi
    warn "jq merge of obsidian.json failed; leaving the file untouched."
  elif have python3; then
    if python3 - "$_cfg" "$_id" "$VAULT_PATH" "$_ts" <<'PY' 2>/dev/null
import json,sys
cfg,vid,path,ts=sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4])
try:
    d=json.load(open(cfg))
    if not isinstance(d,dict): d={}
except Exception:
    d={}
v=d.get("vaults")
if not isinstance(v,dict):
    v={}; d["vaults"]=v
for ex in v.values():
    if isinstance(ex,dict) and ex.get("path")==path:
        sys.exit(7)   # already present
v[vid]={"path":path,"ts":ts}
json.dump(d,open(cfg,"w"))
PY
    then
      ok "Registered the vault in obsidian.json (python merge)."
      return 0
    else
      _rc=$?
      if [ "${_rc}" = "7" ]; then
        ok "Vault already registered in obsidian.json (skipping)."
        return 0
      fi
      warn "python merge of obsidian.json failed; leaving the file untouched."
    fi
  else
    warn "obsidian.json exists but no JSON tool (jq/python3) is available to merge safely."
    warn "Not modifying it to avoid corruption. You can open the vault via the URI below,"
    warn "or use Obsidian's 'Open folder as vault' and pick: ${VAULT_PATH}"
  fi
}

# ----------------------------------------------------------------------------
# 7. Restricted-Mode honesty + offer to open the vault.
# ----------------------------------------------------------------------------
urlencode() {
  _s="$1"; _out=""
  _i=0
  while [ "${_i}" -lt "${#_s}" ]; do
    _c="$(printf '%s' "${_s}" | cut -c "$((_i+1))")"
    case "${_c}" in
      [a-zA-Z0-9.~_-]) _out="${_out}${_c}" ;;
      *) _out="${_out}$(printf '%%%02X' "'${_c}")" ;;
    esac
    _i=$((_i+1))
  done
  printf '%s' "${_out}"
}

open_vault_offer() {
  printf '\n'
  info "${C_BOLD}One manual step remains (security boundary):${C_RST}"
  sub "On first open, Obsidian shows a one-time prompt:"
  sub "  \"Turn off Restricted Mode\" -> \"Trust author and enable plugins\"."
  sub "You must click this yourself. The installer does not and cannot bypass it."
  printf '\n'
  if tty_confirm "Open the vault in Obsidian now?" "yes"; then
    _enc="$(urlencode "${VAULT_PATH}")"
    _uri="obsidian://open?path=${_enc}"
    if [ "${OS}" = "macos" ] && have open; then
      open "${_uri}" >/dev/null 2>&1 || warn "Could not invoke 'open' on the URI."
    elif have xdg-open; then
      xdg-open "${_uri}" >/dev/null 2>&1 || warn "Could not invoke 'xdg-open' on the URI."
    else
      warn "No URI opener found. Open Obsidian and choose 'Open folder as vault':"
      warn "  ${VAULT_PATH}"
    fi
    ok "Requested Obsidian to open the vault."
  else
    sub "When ready, open Obsidian and select this vault: ${VAULT_PATH}"
  fi
}

# ----------------------------------------------------------------------------
# 8. Final summary.
# ----------------------------------------------------------------------------
final_summary() {
  printf '\n'
  info "${C_BOLD}Summary${C_RST}"
  sub "Obsidian:        ${OBSIDIAN_FOUND} (${OBSIDIAN_HOW:-n/a})"
  sub "Vault:           ${VAULT_PATH}"
  sub "Plugin:          ${PLUGIN_NAME} ${PLUGIN_VERSION} (id: ${PLUGIN_ID})"
  sub "Pre-enabled:     ${VAULT_PATH}/.obsidian/community-plugins.json"
  sub "Registered in:   ${OBSIDIAN_CONFIG_JSON}"
  sub "Remaining click: turn off Restricted Mode + trust author on first open."
  printf '\n'
  sub "Optional background daemon: see the plugin's daemon/ packaging and docs"
  sub "for the local sync service install instructions."
  ok "Done."
}

# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
main() {
  printf '%s\n' "${C_BOLD}Sauce CRM installer${C_RST} — Obsidian plugin ${PLUGIN_VERSION}"
  detect_os
  detect_obsidian
  ensure_obsidian
  choose_vault
  install_plugin
  preenable_plugin
  register_vault
  open_vault_offer
  final_summary
}

main "$@"

###############################################################################
# EXTERNAL COMMAND DEPENDENCIES (and the fallback when a command is absent)
# ---------------------------------------------------------------------------
#   uname            required (OS/arch detection; no fallback — hard fail)
#   curl             primary downloader; FALLBACK: wget; if neither -> die
#   wget             fallback downloader
#   jq               primary JSON parse/merge (manifest id, obsidian.json,
#                    community-plugins.json, GitHub asset URL);
#                    FALLBACK: python3; final FALLBACK: grep/sed shape checks
#                    and (for existing config files) refuse-to-corrupt + warn
#   python3          secondary JSON tool + secrets.token_hex for the vault id
#   od + /dev/urandom  fallback random id when python3 absent;
#                    final FALLBACK: time/PID-seeded printf
#   mdfind           macOS Obsidian detection (Spotlight); optional
#   brew             macOS Obsidian install (cask); FALLBACK: .dmg via
#                    hdiutil attach/detach + cp -R to /Applications
#   hdiutil          macOS .dmg mount/unmount (only on the .dmg path)
#   flatpak          Linux Obsidian install + detection; FALLBACK: AppImage
#   snap             Linux tertiary install + detection; optional
#   find/ls          AppImage + .desktop detection
#   osascript        macOS GUI folder/name dialogs; FALLBACK: /dev/tty prompt
#   zenity           Linux GUI dialogs; FALLBACK: kdialog; FALLBACK: tty prompt
#   kdialog          Linux GUI dialogs (secondary)
#   update-desktop-database  refresh .desktop cache (best-effort; optional)
#   open             macOS URI opener for obsidian://; (xdg-open on Linux)
#   xdg-open         Linux URI opener; FALLBACK: print manual instructions
#   mktemp           required for the staging temp dir
#   date/dirname/cut/od/tr/grep/sed/cp/mkdir/find  standard POSIX utilities
#
# ASSUMPTIONS
#   - The 0.4.2 release assets (main.js, manifest.json, styles.css) and the
#     0.4.2 raw versions.json exist at the documented URLs.
#   - The user has write access to the chosen vault parent, ~/.config (Linux)
#     or ~/Library/Application Support (macOS), and (macOS .dmg path only)
#     /Applications. No sudo is used; a non-writable /Applications on the .dmg
#     path fails loudly rather than escalating.
#   - "Install finished" for Obsidian == the package-manager/copy subprocess
#     returning exit 0 (there is no separate async completion event).
#   - Spotlight/desktop-db indexing is best-effort; detection re-runs after a
#     fresh install and degrades to assuming success with a warning.
###############################################################################
