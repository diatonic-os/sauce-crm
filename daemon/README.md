# sauce-crm-daemon

A headless, **localhost-only** sidecar that owns a vault's LanceDB store so the
Obsidian `sauce-crm` plugin can run lightweight. The plugin probes the daemon's
`GET /health` first; when the daemon answers, the plugin uses the **remote**
memory backend and **skips its own `initLanceBackend`** — enforcing a single
writer per Lance store.

It is composed entirely from the plugin's existing modules (no forked logic):

- `MemoryHttpServer` (`src/bridge/server`) — the `/v1/*` RPC surface.
- `HmacAuthVerifier` (`src/bridge/auth`) + Web-Crypto HMAC (`src/bridge/crypto`)
  — the **same** request signing as the mobile bridge.
- `initLanceBackend` (`src/backend/lance`) — the per-vault store.
- `platformPaths` (`src/services`) — the **same** central per-user paths the
  plugin uses, so daemon and plugin agree byte-for-byte on store locations.

## Build & run

```bash
npm run daemon:build          # → daemon/dist/sauce-crm-daemon.cjs
node daemon/dist/sauce-crm-daemon.cjs --vault /abs/path/to/Vault
```

`@lancedb/lancedb` is an esbuild **external**: the native N-API addon is resolved
at runtime from the shared central runtime install
(`<app.data.user>/sauce-crm/runtime/node_modules`), exactly like the plugin.
Install it there once (the plugin's installer already does this).

### CLI flags / env

| Flag | Env | Effect |
|------|-----|--------|
| `--port N` | `SAUCE_DAEMON_PORT` | TCP port (default **8788**). |
| `--config PATH` | `SAUCE_DAEMON_CONFIG` | Config file path override. |
| `--data-dir DIR` | `SAUCE_DAEMON_DATA_DIR` | Fallback default-vault store dir. |
| `--vault ABS` | `SAUCE_DAEMON_VAULT` | Default vault base path. |
| `--log-file PATH` | `SAUCE_DAEMON_LOG_FILE` | Append JSONL request/event log. |

argv overrides env; neither rotates an existing pairing token.

## Config

Resolved via the plugin's `platformPaths` (`app.data.user` intent):

```
<central>/sauce-crm/daemon/config.json     ← mode 0600, owner-only
<central>/sauce-crm/vaults/<vaultId>/lancedb  ← per-vault store (shared key)
```

`config.json`:

```json
{
  "version": 1,
  "bindHost": "127.0.0.1",
  "port": 8788,
  "pairingToken": "<64 hex>",
  "defaultVault": "/abs/path/to/Vault",
  "vaults": []
}
```

On **first run** the daemon mints a `pairingToken` via the bridge `Pairing` code
(`generatePairingToken`, 32 random bytes → 64 hex), writes it `0600`, and prints
it once to stdout. Reloads never rotate the token.

## Endpoints

| Method | Path | Auth | Body / notes |
|--------|------|------|--------------|
| GET | `/health` | none | Daemon info (see below). Localhost only. |
| GET | `/v1/health` | none | Bridge-protocol health (`{ok, version, lance}`). |
| GET | `/v1/memory/by-fp/:fp` | HMAC | `{fp, known}` (404 when unknown). |
| GET | `/v1/provenance/:fp` | HMAC | `{fp, records}`. |
| POST | `/v1/memory/embed` | HMAC | `{fp, text}` → `{fp, dim, cached}`. |
| POST | `/v1/memory/search` | HMAC | `{query, k?}` → `{hits}`. |
| POST | `/v1/memory/recall` | HMAC | `{q, k?}` → `{hits}`. |

`GET /health` returns:

```json
{
  "ok": true,
  "name": "sauce-crm-daemon",
  "version": "0.3.0",
  "pid": 12345,
  "uptimeMs": 4210,
  "lance": { "available": true, "dim": 768 }
}
```

`lance.available`/`dim` reflect whether any vault store has been opened yet
(stores open **lazily** on first request).

## Multi-vault

The bridge wire contract carries **no** vault identity. The daemon therefore
keys Lance stores by the **vault data-dir**, derived from the vault's absolute
base path via the plugin's `lanceDataDir` (vaultId = sanitized-basename +
8-hex hash). A request selects its vault with the **`x-sauce-vault`** header
(absolute vault base path); absent that, the configured `defaultVault` is used.
Each `vaultId` opens **exactly one** `LanceBackend` for the daemon's lifetime
(single writer), lazily and de-duplicated across concurrent first-requests.

## Security model

- **Loopback only.** Binds `127.0.0.1`; the constructor refuses `0.0.0.0`/`::`.
- **HMAC on every `/v1/*` route.** The plugin and daemon derive the same key
  from the shared pairing token (`tokenToKey`), so the key never crosses the
  wire. Requests carry `x-sauce-sig` / `x-sauce-nonce` / `x-sauce-ts`; the
  verifier enforces a ±300s clock-skew window, rejects replayed nonces, and
  compares signatures in constant time.
- `GET /health` is intentionally unauthenticated — info only, localhost-bound,
  so the plugin can probe presence before pairing.
- The config file is `0600`; the pairing token is the only secret and never
  leaves the host.

## How the plugin pairs

1. Start the daemon — it prints the pairing token (also in `config.json`).
2. Enter that token in the plugin's daemon pairing field.
3. The plugin probes `GET /health`; on success it signs all memory RPCs with the
   derived key and **skips local Lance init** (the daemon is the single writer).

## Graceful shutdown

`SIGTERM` / `SIGINT` stop accepting connections, let in-flight requests finish,
then close every open Lance store (releasing native handles). Idempotent.
