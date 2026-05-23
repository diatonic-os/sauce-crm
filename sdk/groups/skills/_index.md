---
group: skills
summary: Composed multi-step capabilities defined in .md; the existing src/skills/* migrate here.
generated_from: src/skills (existing) + .md contracts
---

# skills/ — composed capabilities

A skill is an `.md`-defined sequence over tools/chainers with a typed
input/output and a success assertion. Existing `src/skills/*.ts` are the
migration source; each gets a contract `.md` here.

## Seed members (from existing src/skills)

| id | platform | composes |
|---|---|---|
| `research-person` | [desktop, mobile] | connectors/websearch, tools/requesturl-fetch |
| `research-org` | [desktop, mobile] | connectors/websearch |
| `summarize-thread` | [desktop, mobile] | tools/requesturl-fetch |
| `infer-edges` | [desktop, mobile] | tools/metadata-read, helpers/wikilink |
| `merge-duplicates` | [desktop, mobile] | tools/vault-process-note |
| `capture-call` | desktop | connectors/twilio |
| `transcribe` | desktop | (native; gated) |
