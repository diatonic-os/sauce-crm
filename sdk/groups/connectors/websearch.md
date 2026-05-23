---
group: connectors
id: websearch
summary: Web-search connector — pure request builder + response parser over requesturl-fetch.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
inputs:
  buildSearchRequest: "(query: string, config: WebSearchConfig) => FetchRequest"
  parseSearchResponse: "(json: unknown) => SearchResult[]"
  search: "(query: string, config: WebSearchConfig) => Promise<SearchResult[]>"
outputs: "SearchResult[]"
side_effects: [network]
deterministic: false
depends_on: [tools/requesturl-fetch]
---

# connectors/websearch

Connector pattern: split into a **pure** request builder and response parser
(unit-testable, deterministic) plus a thin `search` orchestrator that calls
`tools/requesturl-fetch` (the only network egress). The `apiKey` is supplied by
the caller, resolved from the encrypted KeyVault — connectors never read secrets
directly. `skills/research-person|org` use this.

## Contract
- `buildSearchRequest(query, { apiKey, endpoint? })` → `FetchRequest` with the
  query URL-encoded and a `Bearer` auth header. Pure.
- `parseSearchResponse(json)` → `SearchResult[]`; non-conforming input ⇒ `[]`. Pure.
- `search(query, config)` → results, or `[]` on non-200. Network (non-deterministic).
