# OAuth relay — known limitations

## Status as of 0.1.0

The relay server (this directory) is **complete** — endpoints respond, PKCE
runs server-side, Redis-backed sessions, Docker compose ready. You can curl
`POST /authorize/google` and walk through the consent flow today.

What's **not** yet shipped on the plugin side:

1. **`RelayOAuthHost`** — a sibling to `ObsidianOAuthHost` that implements the
   same `OAuthHost` interface (`openBrowser` + `listenOnce` + `fetchJson`) by
   calling the relay's `/authorize` + long-polling `/poll` instead of binding
   a local Node listener. Without this, the plugin's `OAuthFlow.authorize`
   can't target the relay.
2. **Settings UI** — toggle in the Credentials modal to pick "Direct" (current
   default) vs "Relay" mode per-provider, plus fields for relay base URL and
   bearer token.
3. **Token TTL syncing** — when the relay sends back `expires_at`, the plugin
   should schedule a refresh through the relay (not direct) so the relay's
   stored refresh token rotates correctly.

## Implementation sketch for `RelayOAuthHost`

```ts
// plugin/src/security/RelayOAuthHost.ts (to write)
export class RelayOAuthHost implements OAuthHost {
  constructor(private base: string, private bearer: string, private providerKey: string) {}
  // openBrowser still opens the system browser, but with the URL the relay returned
  async openBrowser(url: string): Promise<void> { /* shell.openExternal as today */ }
  // listenOnce becomes /poll/{session_id} long-poll; port arg is ignored
  async listenOnce(port: number, path: string): Promise<URL> {
    const sid = this.pendingSessionId;        // set during /authorize call
    const r = await fetch(`${this.base}/poll/${sid}`, { headers: { Authorization: `Bearer ${this.bearer}` }});
    const j = await r.json();
    // Synthesize a URL with ?code=... so OAuthFlow's existing path still works,
    // OR — better — short-circuit by returning the token set directly. Requires
    // a small refactor of OAuthFlow.authorize to allow "I already have tokens".
    return new URL(`http://relay/cb?code=${encodeURIComponent(j.access_token)}&state=ok`);
  }
  async fetchJson<T>(url: string): Promise<T> { /* unchanged for tokenUrl call, but with relay-side exchange */ }
}
```

The cleanest refactor on the plugin side is to split `OAuthFlow.authorize` into
two methods: `authorize(provider, scopes)` (current, direct) and `obtain(provider, scopes)`
(provider-agnostic — could be direct PKCE OR relay long-poll). Both end in the
same `TokenSet` shape; the integration code doesn't care which path was used.

## Relay-side improvements on the roadmap

- **Per-user authorization** — currently anyone holding the bearer token can
  initiate flows for any provider. For multi-user relays we want per-user
  tokens (e.g. one bearer per Sauce CRM install).
- **TLS termination guidance** — production deployments should sit behind a
  reverse proxy (Caddy/Traefik) with a real cert. Document the pattern.
- **Audit log** — write every flow start + completion to a JSONL log so the
  relay operator can see who connected what + when. Useful for shared
  family/team relays.
- **Provider list endpoint scope filtering** — let the plugin ask "what
  scopes does this relay's Google client request" so the consent screen
  doesn't surprise users.

## Security review checklist (before publishing the relay image)

- [ ] Confirm no plaintext refresh tokens written to disk (only via the Redis
      store which is bound to an LUKS volume).
- [ ] Confirm bearer token has at least 256 bits of entropy (current: 32 bytes).
- [ ] Confirm `/callback` validates `state` AND `session_id` AND provider name.
- [ ] Confirm `/poll` doesn't leak refresh tokens (it only returns access_token).
- [ ] Confirm Dockerfile runs as non-root (USER relay ✓).
- [ ] Run `docker scan` / `trivy` on the image; address any HIGH/CRITICAL.
- [ ] Document Tailscale/mTLS as the recommended ingress.
