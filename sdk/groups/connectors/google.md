---
group: connectors
id: google
summary: Google connector: pure request builder + response parser over requesturl-fetch; OAuth bearer token from caller.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
inputs:
  buildGoogleRequest: "(query: string, config: GoogleConfig) => FetchRequest"
  parseGoogleResponse: "(json: unknown) => SearchResult[]"
  searchGoogle: "(query: string, config: GoogleConfig) => Promise<SearchResult[]>"
outputs: "SearchResult[]"
side_effects: [network]
deterministic: false
depends_on: [tools/requesturl-fetch]
---

# connectors/google

Connector pattern: split into a **pure** request builder and response parser
(unit-testable, deterministic) plus a thin `searchGoogle` orchestrator that calls
`tools/requesturl-fetch` (the only network egress). The `accessToken` is supplied by
the caller, resolved from the encrypted KeyVault — connectors never read secrets
directly. `skills/research-person|org` use this.

## Contract
- `buildGoogleRequest(query, { accessToken, endpoint? })` → `FetchRequest` with the
  query URL-encoded and a `Bearer` auth header. Pure.
- `parseGoogleResponse(json)` → `SearchResult[]`; non-conforming input ⇒ `[]`. Pure.
- `searchGoogle(query, config)` → results, or `[]` on non-200. Network (non-deterministic).
