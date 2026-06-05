<#
.SYNOPSIS
    Installs the sauce-crm-daemon as a per-user, at-logon background service
    on Windows via a Scheduled Task.

.DESCRIPTION
    - Verifies Node.js >= 18 is on PATH.
    - Copies daemon/dist/sauce-crm-daemon.cjs into %LOCALAPPDATA%\sauce-crm-daemon.
    - Registers an at-logon Scheduled Task "SauceCrmDaemon" that runs
        node <install>\sauce-crm-daemon.cjs
      hidden / in the background, restarted on failure.
    - Optionally starts the task and probes GET /health.

    No external downloads. No NSSM. No admin rights required (the task is
    registered in the current user's context and runs only at that user's logon).

    Why a Scheduled Task and NOT a native SCM (sc.exe) service:
      * The daemon is a *per-user* sidecar. It must run as the interactive user
        and read/write that user's %LOCALAPPDATA% (where the plugin's central
        Lance store + pairing token live). A classic SCM service runs in
        session 0 under LocalSystem/a service account by default and would see a
        different profile / %LOCALAPPDATA%, breaking the single-writer pairing.
      * Registering an SCM service requires Administrator. An at-logon Scheduled
        Task does not — install stays a non-elevated, per-user operation.
      * node.exe is a console process, not a Service Control Manager protocol
        binary; sc.exe would need a wrapper (e.g. NSSM/srvany) to translate
        START/STOP control codes, which this design explicitly forbids.
      * The task's lifecycle (start at logon, stop at logoff) matches a per-user
        daemon exactly. See the "Advanced: sc.exe alternative" section in the
        README for the caveats if you insist on an SCM service.

.PARAMETER Port
    TCP port the daemon binds on 127.0.0.1. Default 8788 (daemon's own default).

.PARAMETER Vault
    Absolute path to the default Obsidian vault the daemon owns. Optional; can
    also be supplied later via the daemon config / --vault flag.

.PARAMETER NoStart
    Register the task but do not start it now (it will start at next logon).

.PARAMETER BundlePath
    Override the source bundle path. Defaults to the sibling dist bundle.

.EXAMPLE
    .\install.ps1 -Vault "C:\Users\me\Vaults\Sauce_Relationship_Graph"

.EXAMPLE
    .\install.ps1 -Port 8790 -NoStart
#>
[CmdletBinding()]
param(
    [int]    $Port       = 8788,
    [string] $Vault      = "",
    [switch] $NoStart,
    [string] $BundlePath = ""
)

# PowerShell 5.1 compatible. Strict, fail-fast.
Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Constants (FIXED — must match the daemon design contract)
# ---------------------------------------------------------------------------
$TaskName    = "SauceCrmDaemon"
$BundleName  = "sauce-crm-daemon.cjs"
$InstallDir  = Join-Path $env:LOCALAPPDATA "sauce-crm-daemon"
$InstallBundle = Join-Path $InstallDir $BundleName

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Step([string] $Message) {
    Write-Host "[sauce-crm-daemon] $Message"
}

function Assert-NodeOnPath {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "Node.js was not found on PATH. Install Node 18+ from https://nodejs.org and re-run."
    }
    # `node --version` prints e.g. "v22.22.2"
    $raw = (& node --version) 2>$null
    if (-not $raw) { throw "Could not determine the Node.js version (node --version produced no output)." }
    $clean = $raw.Trim().TrimStart("v")
    $major = 0
    if (-not [int]::TryParse(($clean -split "\.")[0], [ref] $major)) {
        throw "Unexpected 'node --version' output: '$raw'."
    }
    if ($major -lt 18) {
        throw "Node.js $clean found, but >= 18 is required. Upgrade Node and re-run."
    }
    Write-Step "Node.js $clean on PATH (>= 18). OK."
    return $node.Source
}

function Resolve-Bundle {
    param([string] $Override)
    if ($Override) {
        if (-not (Test-Path -LiteralPath $Override)) {
            throw "BundlePath '$Override' does not exist."
        }
        return (Resolve-Path -LiteralPath $Override).Path
    }
    # This script lives at daemon/packaging/windows/. The bundle is at daemon/dist/.
    $here = Split-Path -Parent $MyInvocation.MyCommand.Path
    if (-not $here) { $here = $PSScriptRoot }
    $candidate = Join-Path $here "..\..\dist\$BundleName"
    if (-not (Test-Path -LiteralPath $candidate)) {
        throw "Bundle not found at '$candidate'. Run 'npm run daemon:build' first, or pass -BundlePath."
    }
    return (Resolve-Path -LiteralPath $candidate).Path
}

# ---------------------------------------------------------------------------
# Start / stop helpers (exported into the session; usable interactively too)
# ---------------------------------------------------------------------------
function Start-SauceCrmDaemon {
    [CmdletBinding()] param()
    Start-ScheduledTask -TaskName $script:TaskName
    Write-Step "Started scheduled task '$script:TaskName'."
}

function Stop-SauceCrmDaemon {
    [CmdletBinding()] param()
    $t = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
    if ($t) {
        Stop-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
        Write-Step "Stopped scheduled task '$script:TaskName'."
    } else {
        Write-Step "Task '$script:TaskName' is not registered; nothing to stop."
    }
}

function Test-SauceCrmDaemonHealth {
    [CmdletBinding()]
    param(
        [int] $HealthPort = $script:Port,
        [int] $TimeoutSeconds = 15
    )
    $url = "http://127.0.0.1:$HealthPort/health"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
            if ($resp.StatusCode -eq 200) {
                Write-Step "Health OK ($url):"
                Write-Host $resp.Content
                return $true
            }
        } catch {
            Start-Sleep -Milliseconds 600
        }
    } while ((Get-Date) -lt $deadline)
    Write-Warning "Health check did not succeed within $TimeoutSeconds s at $url."
    return $false
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
$nodePath = Assert-NodeOnPath
$bundle   = Resolve-Bundle -Override $BundlePath

Write-Step "Install dir: $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -LiteralPath $bundle -Destination $InstallBundle -Force
Write-Step "Copied bundle -> $InstallBundle"

# Build the argument string the task runs: node <bundle> [--port N] [--vault ABS]
$nodeArgs = @("`"$InstallBundle`"", "--port", "$Port")
if ($Vault) {
    $nodeArgs += @("--vault", "`"$Vault`"")
}
$argString = [string]::Join(" ", $nodeArgs)

# Remove any prior registration so re-install is idempotent.
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Step "Existing task '$TaskName' found; unregistering before re-create."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Prefer the richer Register-ScheduledTask cmdlets (Win8/Server2012+, PS 5.1).
# Hidden window: -WindowStyle Hidden on the action + Settings Hidden=$true.
$useCmdlets = $null -ne (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)

if ($useCmdlets) {
    Write-Step "Registering at-logon Scheduled Task via Register-ScheduledTask."
    $action = New-ScheduledTaskAction -Execute $nodePath -Argument $argString -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    # Run in the current interactive user's context (per-user daemon). No admin.
    $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet `
        -Hidden `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
    Register-ScheduledTask -TaskName $TaskName `
        -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
        -Description "sauce-crm-daemon: per-user localhost LanceDB sidecar for the Obsidian sauce-crm plugin." | Out-Null
    Write-Step "Registered '$TaskName' (at logon, hidden, restart-on-failure)."
}
else {
    # Fallback for older hosts: schtasks.exe. Window is hidden by launching node
    # through a VBScript-free trick — wscript not allowed, so we rely on the
    # daemon being a console app started detached; schtasks /IT keeps it
    # interactive but minimized is not guaranteed. Cmdlet path above is preferred.
    Write-Step "Register-ScheduledTask unavailable; falling back to schtasks.exe."
    $tr = "`"$nodePath`" $argString"
    schtasks /Create /TN $TaskName /SC ONLOGON /RL LIMITED /F /TR $tr | Out-Null
    Write-Step "Registered '$TaskName' via schtasks (ONLOGON)."
}

if (-not $NoStart) {
    Start-SauceCrmDaemon
    [void] (Test-SauceCrmDaemonHealth -HealthPort $Port -TimeoutSeconds 20)
} else {
    Write-Step "-NoStart specified; task will start at next logon."
}

Write-Host ""
Write-Step "Install complete."
Write-Host "  Task     : $TaskName (at logon, runs as $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name))"
Write-Host "  Bundle   : $InstallBundle"
Write-Host "  Port     : $Port"
Write-Host "  Config   : %LOCALAPPDATA%\sauce-crm\daemon\config.json (created on first run, mode 0600-equivalent)"
Write-Host ""
Write-Host "  Manage from this session:"
Write-Host "    Start-SauceCrmDaemon"
Write-Host "    Stop-SauceCrmDaemon"
Write-Host "    Test-SauceCrmDaemonHealth"
Write-Host "  Or via Task Scheduler: schtasks /Run /TN $TaskName   |   schtasks /End /TN $TaskName"
