<#
================================================================================
 Sauce CRM — Windows installer (install.ps1)
================================================================================

 Purpose
   One-shot installer for the "Sauce CRM" Obsidian community plugin on Windows.
   Implements the SHARED INSTALLER CONTRACT (parity with installer/install.sh):
     1. Detect OS + arch.
     2. Detect the Obsidian *host app* (not the plugin).
     3. If absent: print the plan, prompt for consent (default No), and on
        consent install Obsidian (winget first, direct .exe fallback), waiting
        for the subprocess to exit 0.
     4. GUI folder/name picker for the new vault (WinForms + VisualBasic),
        graceful tty fallback. Refuses to clobber a non-empty folder.
     5. Stage the plugin into <vault>/.obsidian/plugins/sauce-crm/ from the
        0.4.1 release assets; integrity-check each download.
     6. Pre-enable: community-plugins.json = ["sauce-crm"]; register the vault
        in the global obsidian.json without clobbering existing entries.
     7. Honest restricted-mode notice (the one click the user must perform).
     8. Final summary.

 Plugin facts (load-bearing — do not edit casually)
   id            : sauce-crm   (vault plugin folder MUST be exactly this)
   display       : Sauce CRM
   minAppVersion : 1.5.0
   release tag   : 0.4.1
   assets        : https://github.com/Diatonic-OS/sauce-crm/releases/download/0.4.1/{main.js,manifest.json,styles.css}
   versions.json : https://raw.githubusercontent.com/Diatonic-OS/sauce-crm/0.4.1/versions.json

 Compatibility
   Windows PowerShell 5.1 compatible. NO PowerShell 7-only syntax:
   no ?. / ?? / ternary, no && / || statement chaining. Robust under
   `irm <url> | iex` (Read-Host works; GUI dialogs load WinForms +
   Microsoft.VisualBasic). No sudo/elevation unless a subprocess demands it.

 Hard rules
   Set-StrictMode -Version 2.0; $ErrorActionPreference = 'Stop'; consent
   before ANY system install; idempotent re-runs; every download is
   integrity-checked (non-empty + expected shape); never corrupt
   obsidian.json / community-plugins.json (parse-merge only).

 Author: Drew Fortini  (https://github.com/Diatonic-OS)
================================================================================
#>

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------------------
$PluginId       = 'sauce-crm'
$PluginDisplay  = 'Sauce CRM'
$PluginVersion  = '0.4.1'
$ReleaseBase    = 'https://github.com/Diatonic-OS/sauce-crm/releases/download/0.4.1'
$VersionsUrl    = 'https://raw.githubusercontent.com/Diatonic-OS/sauce-crm/0.4.1/versions.json'
$ObsidianApiLatest = 'https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest'
$DefaultVaultName  = 'sauce-crm-vault'

# ------------------------------------------------------------------------------
# Output helpers
# ------------------------------------------------------------------------------
function Write-Step    { param([string]$m) Write-Host ""; Write-Host ('==> ' + $m) -ForegroundColor Cyan }
function Write-Info    { param([string]$m) Write-Host ('    ' + $m) }
function Write-Ok      { param([string]$m) Write-Host ('    [ok] ' + $m) -ForegroundColor Green }
function Write-Warn2   { param([string]$m) Write-Host ('    [warn] ' + $m) -ForegroundColor Yellow }
function Write-Err2    { param([string]$m) Write-Host ('    [error] ' + $m) -ForegroundColor Red }

function Fail {
    param([string]$m)
    Write-Err2 $m
    exit 1
}

# ------------------------------------------------------------------------------
# Networking — TLS 1.2 + a downloader that integrity-checks every file
# ------------------------------------------------------------------------------
function Enable-Tls12 {
    # PS 5.1 / .NET defaults can omit TLS 1.2; GitHub requires it.
    try {
        [Net.ServicePointManager]::SecurityProtocol = `
            [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch {
        Write-Warn2 ('Could not force TLS 1.2: ' + $_.Exception.Message)
    }
}

function Invoke-Download {
    # Downloads $Url to $OutFile, verifies non-empty. Returns $true/$false.
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$OutFile
    )
    try {
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -ErrorAction Stop
    } catch {
        Write-Err2 ('Download failed: ' + $Url)
        Write-Err2 ('  ' + $_.Exception.Message)
        return $false
    }
    if (-not (Test-Path -LiteralPath $OutFile)) {
        Write-Err2 ('Download produced no file: ' + $Url)
        return $false
    }
    $len = (Get-Item -LiteralPath $OutFile).Length
    if ($len -le 0) {
        Write-Err2 ('Downloaded file is empty: ' + $Url)
        return $false
    }
    return $true
}

function Get-JsonFromUrl {
    # GET $Url and ConvertFrom-Json. Returns $null on failure (caller handles).
    param([Parameter(Mandatory = $true)][string]$Url)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -ErrorAction Stop
        return ($resp.Content | ConvertFrom-Json)
    } catch {
        Write-Warn2 ('Could not fetch/parse JSON from ' + $Url + ': ' + $_.Exception.Message)
        return $null
    }
}

# ------------------------------------------------------------------------------
# Interactive prompts (work under `irm | iex`)
# ------------------------------------------------------------------------------
function Confirm-YesNo {
    # Default No. Returns $true only on an explicit yes.
    param([Parameter(Mandatory = $true)][string]$Prompt)
    $ans = Read-Host ($Prompt + ' [y/N]')
    if ($null -eq $ans) { return $false }
    $ans = $ans.Trim().ToLower()
    if ($ans -eq 'y' -or $ans -eq 'yes') { return $true }
    return $false
}

# ------------------------------------------------------------------------------
# Step 1 — OS + arch
# ------------------------------------------------------------------------------
function Get-PlatformInfo {
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ([string]::IsNullOrEmpty($arch)) { $arch = 'unknown' }
    $osVer = [System.Environment]::OSVersion.Version.ToString()
    Write-Info ('OS    : Windows ' + $osVer)
    Write-Info ('Arch  : ' + $arch)
    $info = New-Object psobject
    $info | Add-Member -MemberType NoteProperty -Name Arch -Value $arch
    return $info
}

# ------------------------------------------------------------------------------
# Step 2 — detect Obsidian host app
# ------------------------------------------------------------------------------
function Test-WingetObsidian {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($null -eq $winget) { return $false }
    try {
        $out = & winget list --id Obsidian.Obsidian --exact 2>$null
        if ($LASTEXITCODE -eq 0 -and $null -ne $out) {
            $joined = ($out -join "`n")
            if ($joined -match 'Obsidian\.Obsidian') { return $true }
        }
    } catch {
        # winget can throw on odd locales; treat as not-found.
    }
    return $false
}

function Get-ObsidianExePath {
    # Returns the resolved Obsidian.exe path or $null. Checks the canonical
    # per-user install dir, then registry uninstall keys, then Start-Menu shortcut.
    $candidates = New-Object System.Collections.ArrayList

    if ($env:LOCALAPPDATA) {
        [void]$candidates.Add((Join-Path $env:LOCALAPPDATA 'Obsidian\Obsidian.exe'))
    }
    if ($env:ProgramFiles) {
        [void]$candidates.Add((Join-Path $env:ProgramFiles 'Obsidian\Obsidian.exe'))
    }

    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) { return $c }
    }

    # Registry uninstall keys (HKCU + HKLM, incl. WOW6432Node).
    $uninstallRoots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $uninstallRoots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        try {
            $subs = Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue
        } catch { $subs = $null }
        if ($null -eq $subs) { continue }
        foreach ($s in $subs) {
            try {
                $props = Get-ItemProperty -LiteralPath $s.PSPath -ErrorAction SilentlyContinue
            } catch { $props = $null }
            if ($null -eq $props) { continue }
            $display = $null
            if ($props.PSObject.Properties.Match('DisplayName').Count -gt 0) {
                $display = $props.DisplayName
            }
            if ($null -ne $display -and $display -match 'Obsidian') {
                # Prefer InstallLocation\Obsidian.exe, else DisplayIcon.
                if ($props.PSObject.Properties.Match('InstallLocation').Count -gt 0 -and $props.InstallLocation) {
                    $exe = Join-Path $props.InstallLocation 'Obsidian.exe'
                    if (Test-Path -LiteralPath $exe) { return $exe }
                }
                if ($props.PSObject.Properties.Match('DisplayIcon').Count -gt 0 -and $props.DisplayIcon) {
                    $icon = ($props.DisplayIcon -split ',')[0]
                    if ($icon -match 'Obsidian\.exe' -and (Test-Path -LiteralPath $icon)) { return $icon }
                }
            }
        }
    }

    # Start-Menu shortcut.
    $shortcutRoots = New-Object System.Collections.ArrayList
    if ($env:APPDATA) {
        [void]$shortcutRoots.Add((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))
    }
    [void]$shortcutRoots.Add('C:\ProgramData\Microsoft\Windows\Start Menu\Programs')
    foreach ($sr in $shortcutRoots) {
        if (-not (Test-Path -LiteralPath $sr)) { continue }
        try {
            $lnk = Get-ChildItem -LiteralPath $sr -Filter 'Obsidian.lnk' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        } catch { $lnk = $null }
        if ($null -ne $lnk) {
            try {
                $wsh = New-Object -ComObject WScript.Shell
                $target = $wsh.CreateShortcut($lnk.FullName).TargetPath
                if ($target -and (Test-Path -LiteralPath $target)) { return $target }
            } catch {
                # COM may be unavailable; ignore.
            }
        }
    }

    return $null
}

function Test-ObsidianInstalled {
    # Returns an object: { Found = $bool; Path = <exe or $null>; Via = <string> }
    $r = New-Object psobject
    $r | Add-Member -MemberType NoteProperty -Name Found -Value $false
    $r | Add-Member -MemberType NoteProperty -Name Path  -Value $null
    $r | Add-Member -MemberType NoteProperty -Name Via   -Value 'none'

    $exe = Get-ObsidianExePath
    if ($null -ne $exe) {
        $r.Found = $true
        $r.Path  = $exe
        $r.Via   = 'filesystem/registry/shortcut'
        return $r
    }
    if (Test-WingetObsidian) {
        $r.Found = $true
        $r.Via   = 'winget'
        return $r
    }
    return $r
}

# ------------------------------------------------------------------------------
# Step 3 — install Obsidian (consented)
# ------------------------------------------------------------------------------
function Get-ObsidianLatestExeAsset {
    # Resolve the latest Obsidian .exe installer asset URL from the GitHub API.
    $rel = Get-JsonFromUrl -Url $ObsidianApiLatest
    if ($null -eq $rel) { return $null }
    if (-not ($rel.PSObject.Properties.Match('assets').Count -gt 0)) { return $null }
    foreach ($a in $rel.assets) {
        $name = $a.name
        if ($null -eq $name) { continue }
        # Prefer a non-portable, non-arm .exe (e.g. Obsidian.<ver>.exe).
        if ($name -match '^Obsidian.*\.exe$' -and $name -notmatch 'arm64' -and $name -notmatch 'portable') {
            return $a.browser_download_url
        }
    }
    # Fallback: any .exe asset.
    foreach ($a in $rel.assets) {
        if ($a.name -match '\.exe$') { return $a.browser_download_url }
    }
    return $null
}

function Install-Obsidian {
    # Returns $true on a successful install (subprocess exit 0), else $false.
    Write-Step 'Installing Obsidian'

    # winget first.
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($null -ne $winget) {
        Write-Info 'Method: winget (Obsidian.Obsidian)'
        try {
            & winget install -e --id Obsidian.Obsidian --accept-source-agreements --accept-package-agreements
            if ($LASTEXITCODE -eq 0) {
                Write-Ok 'Obsidian installed via winget.'
                return $true
            }
            Write-Warn2 ('winget exited with code ' + $LASTEXITCODE + '; falling back to direct download.')
        } catch {
            Write-Warn2 ('winget failed: ' + $_.Exception.Message + '; falling back to direct download.')
        }
    } else {
        Write-Info 'winget not present; using direct .exe download.'
    }

    # Direct .exe download fallback.
    $assetUrl = Get-ObsidianLatestExeAsset
    if ($null -eq $assetUrl) {
        Write-Err2 'Could not resolve the latest Obsidian .exe installer from GitHub.'
        return $false
    }
    Write-Info ('Method: direct download -> ' + $assetUrl)
    $tmpExe = Join-Path ([System.IO.Path]::GetTempPath()) ('Obsidian-Setup-' + [guid]::NewGuid().ToString('N') + '.exe')
    try {
        if (-not (Invoke-Download -Url $assetUrl -OutFile $tmpExe)) { return $false }
        Write-Info 'Launching the Obsidian installer (NSIS); waiting for it to finish...'
        # Obsidian uses an NSIS installer; /S = silent. Wait for exit.
        $p = Start-Process -FilePath $tmpExe -ArgumentList '/S' -PassThru -Wait -ErrorAction Stop
        if ($p.ExitCode -eq 0) {
            Write-Ok 'Obsidian installer completed (exit 0).'
            return $true
        }
        Write-Warn2 ('Silent install returned exit ' + $p.ExitCode + '; retrying interactively...')
        $p2 = Start-Process -FilePath $tmpExe -PassThru -Wait -ErrorAction Stop
        if ($p2.ExitCode -eq 0) {
            Write-Ok 'Obsidian installer completed (interactive, exit 0).'
            return $true
        }
        Write-Err2 ('Obsidian installer failed (exit ' + $p2.ExitCode + ').')
        return $false
    } finally {
        if (Test-Path -LiteralPath $tmpExe) {
            Remove-Item -LiteralPath $tmpExe -Force -ErrorAction SilentlyContinue
        }
    }
}

# ------------------------------------------------------------------------------
# Step 4 — vault folder/name picker
# ------------------------------------------------------------------------------
function Select-ParentDirectory {
    # Returns an absolute parent dir path, or $null on cancel.
    # GUI FolderBrowserDialog first; tty fallback under headless/`irm|iex`.
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = 'Select the PARENT folder for your new Sauce CRM vault'
        $dlg.ShowNewFolderButton = $true
        $result = $dlg.ShowDialog()
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
            return $dlg.SelectedPath
        }
        # User cancelled the GUI — fall through to tty prompt as a courtesy.
    } catch {
        Write-Warn2 ('GUI folder picker unavailable: ' + $_.Exception.Message)
    }

    $default = [Environment]::GetFolderPath('MyDocuments')
    $entered = Read-Host ('Parent folder for the vault [' + $default + ']')
    if ([string]::IsNullOrWhiteSpace($entered)) { return $default }
    return $entered.Trim()
}

function Select-VaultName {
    # Returns the vault folder name (not path). Default $DefaultVaultName.
    try {
        Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction Stop
        $name = [Microsoft.VisualBasic.Interaction]::InputBox(
            'Name for your new Sauce CRM vault folder:',
            'Vault name',
            $DefaultVaultName)
        if (-not [string]::IsNullOrWhiteSpace($name)) { return $name.Trim() }
        # Empty/cancel -> fall through to tty.
    } catch {
        Write-Warn2 ('GUI name prompt unavailable: ' + $_.Exception.Message)
    }

    $entered = Read-Host ('Vault folder name [' + $DefaultVaultName + ']')
    if ([string]::IsNullOrWhiteSpace($entered)) { return $DefaultVaultName }
    return $entered.Trim()
}

function Resolve-VaultPath {
    # Loops the parent+name picker until it has a non-clobbering vault path.
    # Returns the absolute vault path. Exits on user abort.
    while ($true) {
        $parent = Select-ParentDirectory
        if ([string]::IsNullOrWhiteSpace($parent)) {
            Fail 'No parent folder selected. Aborting.'
        }
        if (-not (Test-Path -LiteralPath $parent)) {
            Write-Warn2 ('Parent does not exist: ' + $parent)
            if (Confirm-YesNo ('Create parent folder "' + $parent + '"?')) {
                New-Item -ItemType Directory -Path $parent -Force | Out-Null
            } else {
                continue
            }
        }

        $name  = Select-VaultName
        $vault = Join-Path $parent $name

        if (Test-Path -LiteralPath $vault) {
            $existing = @(Get-ChildItem -LiteralPath $vault -Force -ErrorAction SilentlyContinue)
            if ($existing.Count -gt 0) {
                # Treat an already-staged sauce-crm vault as idempotent reuse.
                $pluginDir = Join-Path $vault '.obsidian\plugins\sauce-crm'
                if (Test-Path -LiteralPath $pluginDir) {
                    Write-Warn2 ('Vault already exists with Sauce CRM staged: ' + $vault)
                    if (Confirm-YesNo 'Re-use this vault and refresh the plugin files?') {
                        return $vault
                    }
                } else {
                    Write-Warn2 ('Folder exists and is NOT empty: ' + $vault)
                }
                Write-Info 'Choose a different name (or empty folder), or abort.'
                if (-not (Confirm-YesNo 'Pick a different location/name?')) {
                    Fail 'Refusing to clobber a non-empty folder. Aborting.'
                }
                continue
            }
            # Exists but empty -> fine.
            return $vault
        }

        # Does not exist yet -> create.
        New-Item -ItemType Directory -Path $vault -Force | Out-Null
        return $vault
    }
}

# ------------------------------------------------------------------------------
# Step 5 — stage the plugin into the vault
# ------------------------------------------------------------------------------
function Install-PluginFiles {
    param([Parameter(Mandatory = $true)][string]$VaultPath)

    Write-Step 'Staging the Sauce CRM plugin into the vault'
    $pluginDir = Join-Path $VaultPath '.obsidian\plugins\sauce-crm'
    New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null

    # filename -> source url
    $assets = @{
        'main.js'       = ($ReleaseBase + '/main.js')
        'manifest.json' = ($ReleaseBase + '/manifest.json')
        'styles.css'    = ($ReleaseBase + '/styles.css')
        'versions.json' = $VersionsUrl
    }

    foreach ($fname in @('main.js', 'manifest.json', 'styles.css', 'versions.json')) {
        $url  = $assets[$fname]
        $dest = Join-Path $pluginDir $fname
        Write-Info ('Downloading ' + $fname + ' ...')
        if (-not (Invoke-Download -Url $url -OutFile $dest)) {
            Fail ('Failed to download required asset: ' + $fname)
        }
        Write-Ok ($fname + ' (' + (Get-Item -LiteralPath $dest).Length + ' bytes)')
    }

    # Integrity: manifest.json must parse and have id == sauce-crm.
    $manifestPath = Join-Path $pluginDir 'manifest.json'
    try {
        $manifest = (Get-Content -LiteralPath $manifestPath -Raw -ErrorAction Stop | ConvertFrom-Json)
    } catch {
        Fail ('manifest.json did not parse as JSON: ' + $_.Exception.Message)
    }
    if ($manifest.id -ne $PluginId) {
        Fail ('manifest.json id mismatch: expected "' + $PluginId + '", got "' + $manifest.id + '".')
    }
    Write-Ok ('manifest verified: id=' + $manifest.id + ' version=' + $manifest.version)

    return $pluginDir
}

# ------------------------------------------------------------------------------
# Step 6 — pre-enable + register vault
# ------------------------------------------------------------------------------
function Set-CommunityPluginsEnabled {
    param([Parameter(Mandatory = $true)][string]$VaultPath)

    $cfgDir  = Join-Path $VaultPath '.obsidian'
    New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null
    $cpPath  = Join-Path $cfgDir 'community-plugins.json'

    # Parse-merge: ensure sauce-crm is present without dropping other plugins.
    $list = @()
    if (Test-Path -LiteralPath $cpPath) {
        try {
            $parsed = (Get-Content -LiteralPath $cpPath -Raw -ErrorAction Stop | ConvertFrom-Json)
            if ($null -ne $parsed) {
                foreach ($item in $parsed) {
                    if ($null -ne $item) { $list += [string]$item }
                }
            }
        } catch {
            Write-Warn2 'community-plugins.json existed but did not parse; rewriting with sauce-crm only.'
            $list = @()
        }
    }
    if ($list -notcontains $PluginId) { $list += $PluginId }

    # ConvertTo-Json on a single-element array can emit a scalar; force an array shape.
    $json = ConvertTo-Json -InputObject @($list) -Depth 4
    Set-Content -LiteralPath $cpPath -Value $json -Encoding UTF8
    Write-Ok ('community-plugins.json set: ' + ($list -join ', '))
}

function Register-VaultGlobally {
    param([Parameter(Mandatory = $true)][string]$VaultPath)

    if ([string]::IsNullOrEmpty($env:APPDATA)) {
        Write-Warn2 'APPDATA is not set; cannot register the vault globally. Open it manually in Obsidian.'
        return
    }
    $obsCfgDir = Join-Path $env:APPDATA 'obsidian'
    $obsJson   = Join-Path $obsCfgDir 'obsidian.json'

    $absVault  = (Resolve-Path -LiteralPath $VaultPath).Path
    $vaultId   = ([guid]::NewGuid().ToString('N')).Substring(0, 16)
    $tsMs      = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())

    if (Test-Path -LiteralPath $obsJson) {
        # Parse-merge into the existing global config.
        try {
            $root = (Get-Content -LiteralPath $obsJson -Raw -ErrorAction Stop | ConvertFrom-Json)
        } catch {
            Write-Warn2 'obsidian.json exists but did not parse. NOT modifying it to avoid corruption.'
            Write-Warn2 ('You can open the vault manually: ' + $absVault)
            return
        }
        if ($null -eq $root) {
            Write-Warn2 'obsidian.json parsed to null. NOT modifying it to avoid corruption.'
            return
        }

        # Ensure a 'vaults' object exists.
        if (-not ($root.PSObject.Properties.Match('vaults').Count -gt 0) -or $null -eq $root.vaults) {
            $root | Add-Member -MemberType NoteProperty -Name vaults -Value (New-Object psobject) -Force
        }

        # Idempotency: if any existing vault entry already points here, skip.
        $already = $false
        foreach ($p in $root.vaults.PSObject.Properties) {
            $entry = $p.Value
            if ($null -ne $entry -and ($entry.PSObject.Properties.Match('path').Count -gt 0)) {
                if ([string]$entry.path -eq $absVault) { $already = $true; break }
            }
        }
        if ($already) {
            Write-Ok 'Vault already registered in obsidian.json (idempotent).'
            return
        }

        $newEntry = New-Object psobject
        $newEntry | Add-Member -MemberType NoteProperty -Name path -Value $absVault
        $newEntry | Add-Member -MemberType NoteProperty -Name ts   -Value $tsMs
        $root.vaults | Add-Member -MemberType NoteProperty -Name $vaultId -Value $newEntry -Force

        $out = ConvertTo-Json -InputObject $root -Depth 12
        Set-Content -LiteralPath $obsJson -Value $out -Encoding UTF8
        Write-Ok ('Registered vault in obsidian.json (id ' + $vaultId + ').')
    } else {
        # File absent -> safe to create fresh.
        New-Item -ItemType Directory -Path $obsCfgDir -Force | Out-Null
        $newEntry = New-Object psobject
        $newEntry | Add-Member -MemberType NoteProperty -Name path -Value $absVault
        $newEntry | Add-Member -MemberType NoteProperty -Name ts   -Value $tsMs
        $vaults = New-Object psobject
        $vaults | Add-Member -MemberType NoteProperty -Name $vaultId -Value $newEntry
        $root = New-Object psobject
        $root | Add-Member -MemberType NoteProperty -Name vaults -Value $vaults
        $out = ConvertTo-Json -InputObject $root -Depth 12
        Set-Content -LiteralPath $obsJson -Value $out -Encoding UTF8
        Write-Ok ('Created obsidian.json and registered the vault (id ' + $vaultId + ').')
    }
}

# ------------------------------------------------------------------------------
# Step 7 — open the vault (optional)
# ------------------------------------------------------------------------------
function Open-VaultInObsidian {
    param([Parameter(Mandatory = $true)][string]$VaultPath)

    $absVault = (Resolve-Path -LiteralPath $VaultPath).Path
    $encoded  = [System.Uri]::EscapeDataString($absVault)
    $uri      = 'obsidian://open?path=' + $encoded
    try {
        Start-Process $uri -ErrorAction Stop
        Write-Ok 'Asked Windows to open the vault in Obsidian.'
    } catch {
        Write-Warn2 ('Could not auto-open the vault. Open Obsidian and pick: ' + $absVault)
    }
}

# ==============================================================================
# MAIN
# ==============================================================================
Write-Host ''
Write-Host '================================================================'
Write-Host (' ' + $PluginDisplay + ' installer (v' + $PluginVersion + ') — Windows')
Write-Host '================================================================'

Enable-Tls12

# --- Step 1 ---
Write-Step 'Detecting platform'
$platform = Get-PlatformInfo

# --- Step 2 ---
Write-Step 'Detecting Obsidian (host app)'
$obs = Test-ObsidianInstalled
if ($obs.Found) {
    if ($null -ne $obs.Path) {
        Write-Ok ('Obsidian found via ' + $obs.Via + ': ' + $obs.Path)
    } else {
        Write-Ok ('Obsidian found via ' + $obs.Via + '.')
    }
} else {
    # --- Step 3 ---
    Write-Step 'Obsidian was NOT found'
    Write-Info 'Planned action:'
    Write-Info '  - Install the Obsidian desktop app.'
    $hasWinget = ($null -ne (Get-Command winget -ErrorAction SilentlyContinue))
    if ($hasWinget) {
        Write-Info '  - Method: winget install -e --id Obsidian.Obsidian'
    } else {
        Write-Info '  - Method: download the latest Obsidian .exe from GitHub and run it.'
    }
    Write-Info 'Obsidian is REQUIRED — the plugin cannot run without it.'
    Write-Host ''
    if (-not (Confirm-YesNo 'Proceed with installing Obsidian now?')) {
        Write-Warn2 'Consent declined. Download Obsidian manually: https://obsidian.md/download'
        exit 0
    }
    if (-not (Install-Obsidian)) {
        Fail 'Obsidian installation failed. Install it manually from https://obsidian.md/download and re-run.'
    }
    # Re-detect to confirm.
    $obs2 = Test-ObsidianInstalled
    if (-not $obs2.Found) {
        Write-Warn2 'Obsidian install finished but detection is inconclusive; continuing to stage the plugin.'
    } else {
        Write-Ok 'Obsidian is now present.'
    }
}

# --- Step 4 ---
Write-Step 'Choosing the vault location'
$vaultPath = Resolve-VaultPath
Write-Ok ('Vault: ' + $vaultPath)

# --- Step 5 ---
$pluginDir = Install-PluginFiles -VaultPath $vaultPath

# --- Step 6 ---
Write-Step 'Pre-enabling the plugin and registering the vault'
Set-CommunityPluginsEnabled -VaultPath $vaultPath
Register-VaultGlobally -VaultPath $vaultPath

# --- Step 7 ---
Write-Step 'IMPORTANT — one manual click remains (security boundary)'
Write-Info 'On first open, Obsidian shows a one-time prompt:'
Write-Info '   "Turn off Restricted Mode" -> "Trust author and enable plugins".'
Write-Info 'This installer CANNOT and DOES NOT bypass that prompt — you must click it'
Write-Info 'to actually enable Sauce CRM. After that, the plugin loads on every open.'
Write-Host ''
if (Confirm-YesNo 'Open the vault in Obsidian now?') {
    Open-VaultInObsidian -VaultPath $vaultPath
}

# --- Step 8 ---
$absVault = (Resolve-Path -LiteralPath $vaultPath).Path
Write-Step 'Summary'
if ($obs.Found) {
    Write-Info 'Obsidian      : already installed'
} else {
    Write-Info 'Obsidian      : installed by this script'
}
Write-Info ('Vault         : ' + $absVault)
Write-Info ('Plugin        : ' + $PluginDisplay + ' v' + $PluginVersion + ' (id ' + $PluginId + ')')
Write-Info ('Plugin folder : ' + $pluginDir)
Write-Info 'Remaining     : open the vault, then "Turn off Restricted Mode" ->'
Write-Info '                "Trust author and enable plugins" (one click).'
Write-Info 'Optional daemon: see daemon/packaging/ in the Sauce CRM repo.'
Write-Host ''
Write-Ok 'Done.'
exit 0
