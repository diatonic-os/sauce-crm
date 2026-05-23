---
group: skills
id: summarize-thread
summary: Summarize a message thread via an LLM endpoint — pure builder/parser + thin call.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
deterministic: false
depends_on: [tools/requesturl-fetch]
---

# skills/summarize-thread

Pure `buildSummarizeRequest` + `parseSummary` plus a thin `summarizeThread` over
`tools/requesturl-fetch` (an LLM chat endpoint; key from the KeyVault). On mobile
the endpoint is remote (no local model).

## Contract
- `buildSummarizeRequest(thread, { apiKey, endpoint?, model? })` → `FetchRequest`
  (POST JSON, Bearer auth). Pure.
- `parseSummary(json)` → summary string (`""` if absent). Pure.
- `summarizeThread(...)` → summary, `""` on non-200. Network.
