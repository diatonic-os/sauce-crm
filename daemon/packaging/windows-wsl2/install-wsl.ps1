<#
.SYNOPSIS
  Install sauce-crm-daemon inside WSL2 so the Windows Obsidian sauce-crm
  plugin can reach it at http://127.0.0.1:8788.

.DESCRIPTION
  Runs on the WINDOWS side. It:
    1. Verifies WSL is installed and a default distro exists (`wsl --status`).
    2. Verifies systemd is enabled for that distro (/etc/wsl.conf [boot]
       systemd=true). If not, prints the EXACT steps to enable it and stops.
    3. Pushes the daemon bundle into the distro (copy into the distro fs).
    4. Runs install-inner.sh inside the distro via `wsl -e bash`, which
       installs the systemd *user* unit and enables linger.
    5. Health-checks http://127.0.0.1:<port>/health from PowerShell.

  Loopback only: the daemon binds 127.0.0.1 inside WSL2; on current Windows
  builds that is reachable from Windows at 127.0.0.1 via WSL2 localhost
  forwarding. See README.md for mirrored-networking and netsh portproxy
  fallbacks.

.PARAMETER Distro
  WSL distro name (default: the WSL default distro).

.PARAMETER Port
  TCP port for the daemon (default 8788).

.PARAMETER Vault
  Windows path to the Obsidian vault (e.g. C:\Users\me\Vault). Translated to a
  WSL path (/mnt/c/...) and passed as the daemon's default vault. Optional.

.PARAMETER BundlePath
  Path to sauce-crm-daemon.cjs. Defaults to ..\..\dist\sauce-crm-daemon.cjs
  relative to this script.

.PARAMETER NoStart
  Install + enable but do not start the unit now.

.EXAMPLE
  .\install-wsl.ps1 -Vault C:\Users\me\Documents\MyVault
#>
[CmdletBinding()]
param(
  [string]$Distro,
  [int]$Port = 8788,
  [string]$Vault,
  [string]$BundlePath,
  [switch]$NoStart,
  # OPT-IN, default-off: also provision openai-whisper inside the distro.
  [switch]$WithWhisper,
  # Assume "yes" to the whisper prompt (passed through to the inner script).
  [switch]$Yes
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
function Info($m) { Write-Host "install-wsl: $m" }
function Fail($m) { Write-Error "install-wsl: $m"; exit 1 }

# --- 0. Locate the bundle --------------------------------------------------
if (-not $BundlePath) {
  $BundlePath = Join-Path $PSScriptRoot '..\..\dist\sauce-crm-daemon.cjs'
}
# PowerShell 5.1-compatible resolution (no null-conditional operator).
$resolved = Resolve-Path -LiteralPath $BundlePath -ErrorAction SilentlyContinue
if ($resolved) { $BundlePath = $resolved.Path }
if (-not $BundlePath -or -not (Test-Path -LiteralPath $BundlePath)) {
  Fail "daemon bundle not found. Build it first: ``npm run daemon:build`` (produces daemon/dist/sauce-crm-daemon.cjs), or pass -BundlePath."
}
Info "bundle: $BundlePath"

# --- 1. Verify WSL + a default distro --------------------------------------
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) {
  Fail @"
WSL is not installed. Install it from an elevated PowerShell:
    wsl --install
then reboot and re-run this script.
"@
}

# `wsl --status` succeeds only when WSL is functional with a default distro.
$null = & wsl.exe --status 2>&1
if ($LASTEXITCODE -ne 0) {
  Fail @"
'wsl --status' failed — WSL is present but no usable default distro.
Install one and set it default:
    wsl --install -d Ubuntu
    wsl --set-default Ubuntu
then re-run this script.
"@
}

if (-not $Distro) {
  # Derive the default distro name (the one marked with '*' in `wsl -l -v`).
  $list = (& wsl.exe -l -q) 2>$null
  if (-not $list) { Fail "no WSL distros installed. Run: wsl --install -d Ubuntu" }
  $Distro = ($list | Where-Object { $_ -and $_.Trim() } | Select-Object -First 1).Trim()
}
Info "distro: $Distro"

function Invoke-Wsl {
  param([string[]]$DistroArgs, [string[]]$Cmd)
  & wsl.exe -d $Distro @DistroArgs -e @Cmd
}

# --- 2. Verify systemd is enabled in the distro ----------------------------
# Read /etc/wsl.conf and also probe `systemctl is-system-running`. WSL only
# honors [boot] systemd=true after a `wsl --shutdown`.
$wslConf = (& wsl.exe -d $Distro -e bash -lc 'cat /etc/wsl.conf 2>/dev/null || true') -join "`n"
$systemdEnabledInConf = $wslConf -match '(?ms)^\s*\[boot\].*?^\s*systemd\s*=\s*true'

$systemctlOk = $false
try {
  $probe = (& wsl.exe -d $Distro -e bash -lc 'systemctl is-system-running 2>/dev/null || true').Trim()
  # running/degraded both mean systemd is PID 1 and usable.
  if ($probe -match 'running|degraded|starting|maintenance') { $systemctlOk = $true }
} catch { $systemctlOk = $false }

if (-not ($systemdEnabledInConf -and $systemctlOk)) {
  Fail @"
systemd is NOT enabled in distro '$Distro' (required for the user service).

Enable it:
  1. Open the distro:           wsl -d $Distro
  2. Edit /etc/wsl.conf (sudo), add or update:
         [boot]
         systemd=true
  3. Exit the distro, then from Windows PowerShell:
         wsl --shutdown
  4. Re-run this installer:
         .\install-wsl.ps1 -Distro $Distro

(Detected: wsl.conf systemd=true => $systemdEnabledInConf ; systemctl usable => $systemctlOk)
"@
}
Info "systemd: enabled and usable in $Distro"

# --- 3. Push the bundle + installer into the distro ------------------------
# Stage under the distro's /tmp using a Windows->WSL path translation of the
# bundle (\\wsl is unreliable for writes; copy via cat through stdin instead).
$stageDir   = '/tmp/sauce-crm-daemon-install'
$stageBundle= "$stageDir/sauce-crm-daemon.cjs"
$stageInner = "$stageDir/install-inner.sh"
$innerSrc   = Join-Path $PSScriptRoot 'install-inner.sh'
if (-not (Test-Path -LiteralPath $innerSrc)) { Fail "install-inner.sh missing next to this script." }

& wsl.exe -d $Distro -e bash -lc "mkdir -p '$stageDir'" | Out-Null

# Stream bytes through stdin to avoid CRLF/UNC pitfalls.
Get-Content -LiteralPath $BundlePath -Raw -Encoding Byte |
  & wsl.exe -d $Distro -e bash -lc "cat > '$stageBundle'"
# Normalize the script to LF as it crosses, then strip CRs defensively.
Get-Content -LiteralPath $innerSrc -Raw |
  & wsl.exe -d $Distro -e bash -lc "cat > '$stageInner'; sed -i 's/\r$//' '$stageInner'; chmod +x '$stageInner'"
Info "staged bundle + installer in ${Distro}:$stageDir"

# Translate the Windows vault path to a WSL /mnt path, if given.
$wslVault = ''
if ($Vault) {
  $wslVault = (& wsl.exe -d $Distro -e wslpath -a "$Vault").Trim()
  Info "vault (WSL path): $wslVault"
}

# --- 4. Run the inner installer inside the distro --------------------------
$envPrefix = "SAUCE_DAEMON_BUNDLE_SRC='$stageBundle' SAUCE_DAEMON_PORT='$Port'"
if ($wslVault)     { $envPrefix += " SAUCE_DAEMON_VAULT='$wslVault'" }
if ($NoStart)      { $envPrefix += " SAUCE_DAEMON_NO_START='1'" }
if ($WithWhisper)  { $envPrefix += " SAUCE_DAEMON_WITH_WHISPER='1'" }
if ($Yes)          { $envPrefix += " SAUCE_DAEMON_ASSUME_YES='1'" }

Info "running inner installer..."
& wsl.exe -d $Distro -e bash -lc "$envPrefix bash '$stageInner'"
if ($LASTEXITCODE -ne 0) { Fail "inner installer failed (exit $LASTEXITCODE)." }

# --- 5. Health check from the WINDOWS side ---------------------------------
if ($NoStart) {
  Info "installed (not started, -NoStart). Start later with:  wsl -d $Distro -e systemctl --user start sauce-crm-daemon"
  exit 0
}

$healthUrl = "http://127.0.0.1:$Port/health"
Info "health-checking $healthUrl from Windows..."
$ok = $false
for ($i = 1; $i -le 10; $i++) {
  try {
    $resp = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3 -ErrorAction Stop
    if ($resp.ok -and $resp.name -eq 'sauce-crm-daemon') {
      Info "HEALTHY: name=$($resp.name) version=$($resp.version) pid=$($resp.pid) uptimeMs=$($resp.uptimeMs) lance.available=$($resp.lance.available)"
      $ok = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 700
  }
}

if (-not $ok) {
  Write-Warning @"
Daemon installed but Windows could not reach $healthUrl.
This is almost always WSL2 localhost forwarding not being active. Fixes (see README.md):
  - Confirm it works inside WSL:  wsl -d $Distro -e curl -s $healthUrl
  - Enable mirrored networking in %USERPROFILE%\.wslconfig:
        [wsl2]
        networkingMode=mirrored
    then:  wsl --shutdown
  - Or add a netsh portproxy from the WSL IP (see README.md 'Fallback').
"@
  exit 2
}

Info "done. The Obsidian plugin can now pair to http://127.0.0.1:$Port (token is in the distro at ~/.local/share/sauce-crm/daemon/config.json, also printed in the unit log on first run)."
