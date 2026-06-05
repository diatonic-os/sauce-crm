# sauce-crm-daemon · macOS launchd packaging

Run `sauce-crm-daemon` as a headless, localhost-only **per-user LaunchAgent**.
No `sudo`, no root, no system daemon — everything lives under your `$HOME`.

## What gets installed

| Artifact | Path |
|---|---|
| Daemon bundle | `~/Library/Application Support/sauce-crm-daemon/sauce-crm-daemon.cjs` |
| LaunchAgent plist | `~/Library/LaunchAgents/com.sauce.crm-daemon.plist` |
| stdout / stderr | `~/Library/Logs/sauce-crm-daemon/{stdout,stderr}.log` |
| Structured log | `~/Library/Logs/sauce-crm-daemon/daemon.jsonl` |

The label is `com.sauce.crm-daemon`. It loads into the per-user GUI domain
(`gui/$UID`), so it starts at login and runs without an admin prompt.

## Prerequisites

- macOS (launchd).
- Node.js **>= 18** on `PATH` (`install.sh` resolves it via `command -v node`
  and aborts if the major version is below 18).
- A built bundle at `daemon/dist/sauce-crm-daemon.cjs`. Build it from the repo
  root with:

  ```sh
  npm run daemon:build
  ```

## Install

```sh
daemon/packaging/macos/install.sh
```

The installer:

1. Verifies macOS + Node >= 18 + presence of the bundle.
2. Copies the bundle into Application Support.
3. Renders the plist template (substituting the absolute `node` path, the
   installed bundle path, and the log dir) into `~/Library/LaunchAgents`.
4. `launchctl bootout` any prior instance, then `bootstrap` + `enable` +
   `kickstart -k` the fresh one in `gui/$UID`.
5. Polls `GET http://127.0.0.1:8788/health` and prints the JSON response.

Override the health-probe port with `SAUCE_DAEMON_PORT=NNNN install.sh` (this
only affects the probe URL; set the daemon's actual port via its config file).

## Verify

`/health` is unauthenticated (info-only, localhost bind):

```sh
curl -fsS http://127.0.0.1:8788/health
# {"ok":true,"name":"sauce-crm-daemon","version":"0.3.0","pid":...,"uptimeMs":...,"lance":{"available":false,"dim":null}}
```

Check launchd state / recent logs:

```sh
launchctl print gui/$(id -u)/com.sauce.crm-daemon | head -n 30
tail -n 40 ~/Library/Logs/sauce-crm-daemon/stderr.log
```

## KeepAlive policy

`KeepAlive` is **crash-only** (`Crashed=true`, `SuccessfulExit=false`): an
unexpected crash is relaunched, but a clean shutdown (graceful `SIGTERM` via
`launchctl bootout`, or an explicit exit-0) is **not** relaunched. This keeps
`uninstall.sh` and manual stops from fighting launchd.

## Uninstall

```sh
daemon/packaging/macos/uninstall.sh              # keep logs
daemon/packaging/macos/uninstall.sh --purge-logs # also remove logs
```

This boots the agent out of `gui/$UID`, removes the plist and the installed
bundle, and (with `--purge-logs`) the log directory.

## Single-writer note

The daemon is the **sole** opener of a given vault's Lance store. The Obsidian
plugin probes `GET /health` first and, when the daemon answers, uses the remote
backend and skips its own `initLanceBackend`. Do not run a second daemon
instance against the same data dir.
