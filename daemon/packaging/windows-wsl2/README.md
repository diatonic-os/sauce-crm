# sauce-crm-daemon — Windows + WSL2 packaging

Run the `sauce-crm-daemon` LanceDB sidecar **inside a WSL2 Linux distro** and
let the **Windows** Obsidian `sauce-crm` plugin reach it at
`http://127.0.0.1:8788`.

The daemon is a Node CJS bundle that links `@lancedb/lancedb` (a native
N-API addon). Native addons are far simpler to run under Linux than native
Windows, so on a Windows host we run the daemon in WSL2 and rely on WSL2's
**localhost forwarding** so Windows-side Obsidian sees it on loopback — no
plugin code changes, no non-loopback bind.

```
┌─────────────── Windows ───────────────┐        ┌──────── WSL2 distro ─────────┐
│  Obsidian (sauce-crm plugin)           │        │  systemd --user             │
│    probes GET http://127.0.0.1:8788/health ───▶ │   sauce-crm-daemon.service  │
│    → uses REMOTE backend, skips local  │  loopback│   node …/sauce-crm-daemon  │
│      Lance init (single-writer rule)   │ forward │   bind 127.0.0.1:8788       │
└────────────────────────────────────────┘        └──────────────────────────────┘
```

---

## Prerequisites

- Windows 10 (21H2+) or Windows 11 with **WSL2**.
- A default WSL2 distro (Ubuntu recommended) with **systemd enabled**.
- **Node 18+ inside the distro** (`node -v`). Install via the distro package
  manager or `nvm`. The plugin's runtime install also places
  `@lancedb/lancedb` under `~/.local/share/sauce-crm/runtime/node_modules`
  inside the distro (the daemon resolves the native addon from there, exactly
  like the plugin).

---

## Install

From a **Windows PowerShell** prompt in this directory, after building the
bundle (`npm run daemon:build` at the repo root):

```powershell
.\install-wsl.ps1 -Vault C:\Users\me\Documents\MyVault
```

What it does:

1. `wsl --status` — verifies WSL and a default distro exist.
2. Verifies **systemd** is on (`/etc/wsl.conf` `[boot] systemd=true` **and**
   `systemctl is-system-running` usable). If not, it prints the exact enable
   steps and stops (it does **not** silently continue).
3. Copies `sauce-crm-daemon.cjs` + `install-inner.sh` into the distro.
4. Runs `install-inner.sh` inside the distro, which installs the **same
   systemd user-unit pattern as the Linux packaging**, enables it, and turns
   on **linger** (`loginctl enable-linger`) so it survives logout.
5. Health-checks `http://127.0.0.1:8788/health` from **Windows**.

Useful flags: `-Distro <name>`, `-Port <n>`, `-BundlePath <path>`, `-NoStart`.

### Enabling systemd (if step 2 stops you)

```bash
# inside:  wsl -d <distro>
sudo tee -a /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
exit
```
```powershell
wsl --shutdown          # from Windows; required for wsl.conf to take effect
.\install-wsl.ps1       # re-run
```

---

## Networking: how Windows reaches the daemon

The daemon binds **`127.0.0.1` only** (it refuses `0.0.0.0`/`::`). Three ways
Windows reaches it, in order of preference:

### 1. WSL2 localhost forwarding (default, works out of the box)

On current Windows builds, ports a Linux process binds on `127.0.0.1` inside
WSL2 are automatically reachable from Windows at `127.0.0.1:<same-port>`. The
installer's PowerShell health check relies on exactly this. **No config
needed** in the common case — point the plugin at `http://127.0.0.1:8788`.

If it stops working (some corporate images disable it), it can be re-enabled
in `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
localhostForwarding=true
```
then `wsl --shutdown`.

### 2. Mirrored networking mode (robust option — recommended for flaky setups)

Windows 11 22H2+ supports **mirrored networking**, which makes WSL2 share the
Windows network namespace. `127.0.0.1` is then truly identical on both sides,
which is the most robust localhost story. In `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
```
then from PowerShell:
```powershell
wsl --shutdown
```
Re-open the distro; `127.0.0.1:8788` now resolves identically from Windows and
WSL. This is the recommended mode if localhost forwarding is unreliable on
your machine.

### 3. Fallback: `netsh portproxy` (when neither of the above is available)

If you cannot use mirrored mode and localhost forwarding is broken, forward
the Windows loopback port to the WSL2 VM's IP. The WSL IP changes per boot, so
this must be refreshed (script it on login if you rely on it):

```powershell
# get the current WSL IP
$wslIp = (wsl -e hostname -I).Trim().Split(' ')[0]

# remove any stale rule, then add a fresh one
netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=8788 2>$null
netsh interface portproxy add    v4tov4 listenaddress=127.0.0.1 listenport=8788 `
      connectaddress=$wslIp connectport=8788
```

> Caveat: with `netsh portproxy`, the daemon must be reachable on the WSL IP,
> not just `127.0.0.1`-inside-WSL. Since the daemon binds loopback only, prefer
> modes (1) or (2). Use portproxy only if you also run the daemon bound to the
> distro's primary IP — which is **not** the default and weakens the
> loopback-only guarantee. Mirrored networking (2) is the better robust path.

---

## Pointing the Obsidian plugin at the daemon

1. The daemon mints a **pairing token** on first run (mode-`0600` config at
   `~/.local/share/sauce-crm/daemon/config.json` inside the distro). It is also
   printed once to the unit log — view it with:
   ```powershell
   wsl -d <distro> -e journalctl --user -u sauce-crm-daemon --no-pager
   # or read the config directly:
   wsl -d <distro> -e cat ~/.local/share/sauce-crm/daemon/config.json
   ```
2. In Obsidian → sauce-crm settings, set the daemon URL to
   `http://127.0.0.1:8788` and paste the pairing token.
3. The plugin probes `GET /health`; on success it signs all memory RPCs with
   the HMAC key derived from the token and **skips its own local Lance init**.
   The daemon is then the single writer for that vault's store.

---

## Verify

```powershell
# from Windows
Invoke-RestMethod http://127.0.0.1:8788/health | ConvertTo-Json -Depth 4
```
Expected:
```json
{ "ok": true, "name": "sauce-crm-daemon", "version": "0.3.0",
  "pid": 1234, "uptimeMs": 4210, "lance": { "available": true, "dim": 768 } }
```
(`lance.available`/`dim` are `false`/`null` until the first store opens.)

```powershell
# inside the distro, if the Windows-side check fails (isolates a networking issue)
wsl -d <distro> -e curl -s http://127.0.0.1:8788/health
```
If the in-distro `curl` works but the Windows one does not, it is a networking
mode problem — apply section 2 (mirrored) or 3 (portproxy).

---

## Manage the service

```powershell
wsl -d <distro> -e systemctl --user status   sauce-crm-daemon
wsl -d <distro> -e systemctl --user restart  sauce-crm-daemon
wsl -d <distro> -e systemctl --user stop     sauce-crm-daemon
wsl -d <distro> -e systemctl --user disable  sauce-crm-daemon
wsl -d <distro> -e journalctl --user -u sauce-crm-daemon -f
```

Re-running `install-wsl.ps1` upgrades the bundle in place; it never rotates the
pairing token.
