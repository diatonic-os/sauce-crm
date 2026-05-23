---
group: tools
id: requesturl-fetch
summary: Wrap Obsidian requestUrl into a typed, CORS-free fetch for connectors and embeddings.
platform: universal
obsidian_api: requestUrl
api_version: "1.8.0"
inputs:
  fetchUrl: "(req: FetchRequest) => Promise<FetchResponse>"
outputs: "FetchResponse = { status, text, json, headers }"
side_effects: [network]
deterministic: false
depends_on: []
---

# tools/requesturl-fetch

Wraps Obsidian's `requestUrl` — the only sanctioned network primitive (works on
desktop and mobile, no CORS, no raw `fetch`). `connectors/` and the embedding
chainer route all HTTP through here. Uses `throw: false` so non-2xx responses
return a status rather than throwing (deterministic error handling at the call
site). `deterministic: false` (network I/O — documented exception).

## Contract
- `fetchUrl({ url, method?, headers?, body? })` → normalized `FetchResponse`.
- Never throws on HTTP status; caller branches on `status`.
- `obsidian_api: requestUrl` MUST exist in `apiCatalog` (catalog gate in test).
- Universal platform; the only network egress point for the SDK.
