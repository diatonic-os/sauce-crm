<#
.SYNOPSIS
    Uninstalls the sauce-crm-daemon Scheduled Task and removes the installed bundle.

.DESCRIPTION
    - Stops and unregisters the "SauceCrmDaemon" Scheduled Task.
    - Removes %LOCALAPPDATA%\sauce-crm-daemon (the bundle install dir).
    - By default LEAVES the daemon's data + config
      (%LOCALAPPDATA%\sauce-crm\daemon\config.json and the per-vault Lance
      stores) intact, so re-installing keeps the same pairing token and data.
      Pass -PurgeData to also delete the config (NOT the Lance stores — those
      are the plugin's shared central data and are never touched here).

    No admin rights required; mirrors the per-user install.

.PARAMETER PurgeData
    Also delete %LOCALAPPDATA%\sauce-crm\daemon\config.json (the pairing token).
    The per-vault Lance stores under %LOCALAPPDATA%\sauce-crm\vaults are NEVER
    deleted by this script — they are owned by the plugin.

.EXAMPLE
    .\uninstall.ps1

.EXAMPLE
    .\uninstall.ps1 -PurgeData
#>
[CmdletBinding()]
param(
    [switch] $PurgeData
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$TaskName   = "SauceCrmDaemon"
$InstallDir = Join-Path $env:LOCALAPPDATA "sauce-crm-daemon"
$ConfigFile = Join-Path $env:LOCALAPPDATA "sauce-crm\daemon\config.json"

function Write-Step([string] $Message) {
    Write-Host "[sauce-crm-daemon] $Message"
}

# Stop + unregister the task (idempotent).
$useCmdlets = $null -ne (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)
if ($useCmdlets) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch { }
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Step "Unregistered scheduled task '$TaskName'."
    } else {
        Write-Step "Task '$TaskName' not registered; nothing to remove."
    }
} else {
    # Fallback to schtasks.exe.
    $query = schtasks /Query /TN $TaskName 2>$null
    if ($LASTEXITCODE -eq 0) {
        schtasks /End    /TN $TaskName 2>$null | Out-Null
        schtasks /Delete /TN $TaskName /F | Out-Null
        Write-Step "Deleted scheduled task '$TaskName' via schtasks."
    } else {
        Write-Step "Task '$TaskName' not registered; nothing to remove."
    }
}

# Remove the installed bundle dir.
if (Test-Path -LiteralPath $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
    Write-Step "Removed install dir $InstallDir."
} else {
    Write-Step "Install dir $InstallDir not present."
}

# Optionally purge the daemon config (pairing token). Lance stores left alone.
if ($PurgeData) {
    if (Test-Path -LiteralPath $ConfigFile) {
        Remove-Item -LiteralPath $ConfigFile -Force
        Write-Step "Purged daemon config $ConfigFile (pairing token removed)."
    } else {
        Write-Step "Daemon config $ConfigFile not present."
    }
    Write-Step "NOTE: per-vault Lance stores under %LOCALAPPDATA%\sauce-crm\vaults were NOT touched (plugin-owned)."
} else {
    Write-Step "Left daemon config + data intact (re-install reuses the pairing token). Use -PurgeData to remove the token."
}

Write-Step "Uninstall complete."
