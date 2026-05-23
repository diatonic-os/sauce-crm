---
group: skills
id: research-person
summary: Research a person by composing the websearch connector.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
deterministic: false
depends_on: [connectors/websearch]
---

# skills/research-person

Composes `connectors/websearch` to gather sources about a person.

## Contract
- `researchPerson(name, config)` runs a professional-background search and returns
  `{ name, sources: SearchResult[] }`.
- Network (non-deterministic); empty/non-200 → empty `sources`.
