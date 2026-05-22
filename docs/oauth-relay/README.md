# Self-hosted OAuth relay for Sauce CRM

A small Docker container that holds OAuth client credentials and proxies the PKCE flow on behalf of Sauce CRM. Useful when:

- You don't want to register OAuth apps yourself (you trust whoever runs the relay).
- You want to share one OAuth client across multiple Sauce CRM users on a team or family plan.
- You're behind corporate egress and want to centralize OAuth traffic.

**You do not need this to use Sauce CRM.** The plugin's default mode is direct PKCE to each provider with credentials stored only on your device. The relay is for teams or for users who explicitly want a centralized broker.

## Architecture

```
                ┌─────────────────────────┐
   Browser ────▶│  Provider OAuth server  │◀──── HTTPS
                └────────────┬────────────┘
                             │ redirect with ?code
                             ▼
                ┌─────────────────────────┐
   Plugin ─▶ /authorize/google ─▶ relay │ ─▶ exchanges code
                                  /callback│   for tokens
                ─◀ access_token   /refresh │ ─▶ stores refresh
                                  /revoke  │   in Redis/disk
                └─────────────────────────┘
```

- Relay holds `client_id` + `client_secret` per provider.
- Plugin only knows: relay base URL + relay's API token (issued by the relay).
- All token exchange happens server-side.

## Quick start (Docker)

```bash
cd plugin/docs/oauth-relay
cp .env.example .env       # fill in your provider client IDs/secrets
docker compose up -d
```

The relay listens on `http://127.0.0.1:8787` by default. Open `http://127.0.0.1:8787/health` — should return `{"ok":true}`.

## Configure Sauce CRM to use the relay

1. **Settings → Sauce CRM → Integrations → Google Workspace** (or Microsoft 365).
2. Click **Configure**.
3. Enable **Use relay** (planned UI toggle; currently set in `data.json`):
   ```json
   "credentials.relay.baseUrl": "http://127.0.0.1:8787",
   "credentials.relay.token":   "<paste-from-relay-token-file>"
   ```
4. **Connect** — the plugin now calls the relay's `/authorize/google` instead of opening a direct PKCE flow.

> The plugin → relay integration is currently scaffolded but not yet wired into `OAuthFlow`. See [TODO.md](TODO.md) for the remaining work. This relay is shippable today for any HTTP client that speaks the same protocol; integration into `OAuthFlow` is on the roadmap.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness check. Returns `{"ok": true}` if the relay is up. |
| `POST /authorize/:provider` | Body: `{ "scopes": [...] }`. Returns `{ "authorize_url": "...", "session_id": "..." }`. Plugin redirects user to `authorize_url`; relay receives the callback on its own redirect URI. |
| `GET /poll/:session_id` | Long-polls until the user completes the consent screen (or 5-min timeout). Returns `{ "access_token": "...", "expires_at": 1234567890, "scopes": [...] }`. The refresh token stays server-side. |
| `POST /refresh/:provider/:session_id` | Returns a freshly-refreshed access token. |
| `POST /revoke/:provider/:session_id` | Revokes both server-side refresh token and provider-side authorization. |

All endpoints require `Authorization: Bearer <relay-token>`. The relay generates the token on first start and writes it to `./data/relay-token.txt` — copy that into the plugin's config.

## Security model

- **Relay trust boundary**: anyone who controls the relay can act as you against the configured providers. Run it on hardware you trust; restrict ingress (e.g. Tailscale, mTLS).
- **Refresh tokens**: stored at-rest in a Redis or SQLite store backed by an LUKS/dm-crypt volume on the relay host. NOT in plaintext.
- **No persistent provider tokens in the plugin**: the relay's `/poll` returns short-lived access tokens only.
- **PKCE still used**: the relay generates the code_verifier server-side; provider sees a PKCE flow even though the plugin doesn't perform PKCE itself.

## Files

- `compose.yml` — Docker Compose definition (relay + Redis).
- `Dockerfile` — relay image (Node 20 LTS, multi-stage).
- `.env.example` — per-provider client_id/client_secret.
- `src/index.mjs` — Express app implementing the endpoints above.
- `src/providers.mjs` — provider config (authorize/token/revoke URLs).
- `src/store.mjs` — session store (Redis by default; in-memory fallback for dev).
- `TODO.md` — known limitations and remaining work.

## Status

The relay scaffolding is complete and the endpoints respond. **Plugin-side integration is not yet wired** — `OAuthFlow` currently only knows how to do direct PKCE. Wiring a `RelayOAuthHost` that implements the same `OAuthHost` interface (using the relay's `/authorize` + `/poll` instead of binding a local listener) is the next step. See [TODO.md](TODO.md).
