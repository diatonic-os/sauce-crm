# sauce-crm-daemon — Windows packaging

Per-user install of the `sauce-crm-daemon` as an **at-logon background
Scheduled Task** on Windows. PowerShell 5.1 compatible. No external downloads,
no NSSM, no admin rights.

## What gets installed

| Item | Location |
|------|----------|
| Bundle | `%LOCALAPPDATA%\sauce-crm-daemon\sauce-crm-daemon.cjs` |
| Scheduled Task | `SauceCrmDaemon` (trigger: At log on; hidden; restart-on-failure) |
| Daemon config (first run) | `%LOCALAPPDATA%\sauce-crm\daemon\config.json` (owner-only) |
| Per-vault Lance store | `%LOCALAPPDATA%\sauce-crm\vaults\<vaultId>\lancedb` (plugin-owned) |

The bundle install dir (`sauce-crm-daemon`) is intentionally **separate** from
the daemon's data root (`sauce-crm`). The data root is resolved at runtime by
the daemon itself via the plugin's `platformPaths` (`app.data.user` → on Windows
`%LOCALAPPDATA%`), so daemon and plugin agree byte-for-byte on the store and the
pairing token. The installer never writes config — the daemon mints its `0600`
config + pairing token on first run.

## Install

```powershell
# From an unelevated PowerShell prompt:
cd daemon\packaging\windows

# Minimal — default port 8788, vault set later in the plugin:
.\install.ps1

# With a default vault and a custom port:
.\install.ps1 -Vault "C:\Users\me\Vaults\Sauce_Relationship_Graph" -Port 8790

# Register but do not start now (starts at next logon):
.\install.ps1 -NoStart
```

The installer:

1. Verifies **Node.js >= 18** is on `PATH` (fails fast otherwise — Node is not
   downloaded for you; `@lancedb/lancedb` is resolved at runtime from the
   plugin's central runtime install, exactly as the plugin does).
2. Copies the bundle into `%LOCALAPPDATA%\sauce-crm-daemon`.
3. Registers the `SauceCrmDaemon` at-logon task running
   `node sauce-crm-daemon.cjs --port <N> [--vault <ABS>]` hidden / in the
   background, restarted up to 3× on failure.
4. Unless `-NoStart`, starts the task and probes `GET /health` with
   `Invoke-WebRequest`, printing the daemon's health JSON.

Re-running `install.ps1` is idempotent: it unregisters any prior `SauceCrmDaemon`
task before re-creating it, and re-copies the bundle.

## Manage

The installer defines these helpers in the current session:

```powershell
Start-SauceCrmDaemon          # Start-ScheduledTask SauceCrmDaemon
Stop-SauceCrmDaemon           # Stop-ScheduledTask  SauceCrmDaemon
Test-SauceCrmDaemonHealth     # Invoke-WebRequest http://127.0.0.1:<port>/health
```

Outside that session, use Task Scheduler or `schtasks`:

```powershell
schtasks /Run /TN SauceCrmDaemon     # start now
schtasks /End /TN SauceCrmDaemon     # stop
schtasks /Query /TN SauceCrmDaemon   # status
```

Manual health probe:

```powershell
(Invoke-WebRequest -Uri http://127.0.0.1:8788/health -UseBasicParsing).Content
```

Expected (before any vault store has opened):

```json
{"ok":true,"name":"sauce-crm-daemon","version":"0.3.0","pid":1234,"uptimeMs":42,"lance":{"available":false,"dim":null}}
```

## Uninstall

```powershell
.\uninstall.ps1               # stop + unregister task, remove bundle dir; keep token+data
.\uninstall.ps1 -PurgeData    # also delete the daemon config (pairing token)
```

The per-vault Lance stores under `%LOCALAPPDATA%\sauce-crm\vaults` are **never**
deleted by uninstall — they are the plugin's shared central data.

## Why a Scheduled Task, not a native Windows service (SCM / `sc.exe`)?

This daemon is a **per-user** sidecar. The decision is deliberate:

1. **Profile / `%LOCALAPPDATA%` correctness.** The daemon must run as the
   interactive user and read/write *that user's* `%LOCALAPPDATA%`, where the
   plugin's central Lance store and pairing token live. A classic SCM service
   runs in **session 0** under `LocalSystem` (or a dedicated service account) by
   default, which resolves a **different** `%LOCALAPPDATA%`. That breaks the
   shared-path contract and the single-writer pairing. An at-logon Scheduled
   Task runs in the user's own session with the correct profile.

2. **No admin required.** Registering an SCM service needs Administrator. An
   at-logon Scheduled Task in the current user's context does not, so install is
   a non-elevated, per-user operation — consistent with the plugin install.

3. **`node.exe` is not a service binary.** The SCM speaks a control protocol
   (START/STOP/INTERROGATE control codes) that a plain console process like
   `node.exe` does not implement. Running it under `sc.exe` directly yields
   *"the service did not respond to the start control"*. Bridging that requires
   a wrapper (NSSM, `srvany`, WinSW) — which this design explicitly forbids.

4. **Lifecycle match.** "Start at logon, stop at logoff" is exactly the lifetime
   of a per-user daemon. The Scheduled Task trigger models this natively; an SCM
   service models "runs whether or not anyone is logged on", which is wrong for
   a sidecar tied to one interactive user's vault.

### Advanced: `sc.exe` SCM service alternative (and its caveats)

If you must register an SCM service anyway, understand the trade-offs first.
`sc.exe` cannot wrap a console app correctly on its own:

```powershell
# Runs ELEVATED. Illustrative ONLY — node.exe will NOT respond to SCM control
# codes, so the SCM will report the service "did not respond to start" and
# eventually kill it. Do not rely on this.
sc.exe create SauceCrmDaemon binPath= "\"C:\Program Files\nodejs\node.exe\" \"%LOCALAPPDATA%\sauce-crm-daemon\sauce-crm-daemon.cjs\" --port 8788" start= auto
sc.exe description SauceCrmDaemon "sauce-crm-daemon"
sc.exe start SauceCrmDaemon
```

Caveats with the SCM route:

- **Wrong profile.** Under `LocalSystem` the service's `%LOCALAPPDATA%` is
  `C:\Windows\System32\config\systemprofile\AppData\Local`, **not** the user's.
  The daemon would open a different (empty) store and never pair with the plugin.
  Pointing it at a user account (`obj= .\user password= ...`) embeds a password
  and still runs in session 0.
- **No real start/stop.** Without a service wrapper, the SCM cannot stop the
  process gracefully; it force-terminates it, defeating the daemon's
  in-flight-drain + Lance-handle-close shutdown.
- **Requires admin** for create/delete/start.
- **`%LOCALAPPDATA%` is not expanded** inside an SCM `binPath=` the way it is in
  a user task; you would have to hardcode the absolute path.

For all of the above, the Scheduled Task is the correct vehicle for this
per-user daemon. The `sc.exe` snippet is documented only for completeness.

## Files

- `install.ps1` — verify Node >= 18, copy bundle, register at-logon task, start + health-check.
- `uninstall.ps1` — stop + unregister task, remove bundle (optionally purge config).
- `README.md` — this file.
