---
group: tools
id: vault-read-note
summary: Read a note's current contents via Vault.cachedRead (display-safe, fast).
platform: universal
obsidian_api: Vault.cachedRead
api_version: "1.8.0"
inputs:
  readNote: "(vault: Vault, file: TFile) => Promise<string>"
outputs: "the note's text contents"
side_effects: none
deterministic: true
depends_on: []
---

# tools/vault-read-note

Wraps `Vault.cachedRead` — the read-for-display primitive (uses Obsidian's cache,
won't trigger a modify race; use `vault-process-note` for read-modify-write).
`chainers/embedding-pipeline` reads note bodies through here.

## Contract
- `readNote(vault, file)` returns the file's current text.
- Read-only, no side effects, universal platform.
- `obsidian_api: Vault.cachedRead` MUST exist in `apiCatalog` (catalog gate).
