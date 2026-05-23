---
group: connectors
summary: External-system integrations; the existing src/integrations/* migrate here.
generated_from: src/integrations (existing)
---

# connectors/ — external integrations

Network capabilities via `tools/requesturl-fetch` and the encrypted KeyVault.
Most are network-gated; a few are desktop-only and sit behind `Platform`
gates. Existing `src/integrations/*` are the migration source.

## Seed members (from existing src/integrations)

| id | platform | auth |
|---|---|---|
| `google` | [desktop, mobile] | OAuth (KeyVault) |
| `microsoft` | [desktop, mobile] | OAuth (KeyVault) |
| `notion` | [desktop, mobile] | token (KeyVault) |
| `twilio` | [desktop, mobile] | key (KeyVault) |
| `websearch` | [desktop, mobile] | key (KeyVault) |
| `apple` | desktop | CalDAV/CardDAV |
| `smtpimap` | desktop | native sockets (gated) |
