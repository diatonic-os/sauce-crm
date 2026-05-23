---
group: skills
id: research-org
summary: Research an organization by composing the websearch connector.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
deterministic: false
depends_on: [connectors/websearch]
---

# skills/research-org

Composes `connectors/websearch` to gather sources about an organization.

## Contract
- `researchOrg(org, config)` searches the org and returns
  `{ org, sources: SearchResult[] }`.
- Network (non-deterministic); empty/non-200 → empty `sources`.
