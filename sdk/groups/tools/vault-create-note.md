---
group: tools
id: vault-create-note
summary: Create a plaintext note in the vault at a normalized path (Vault.create).
platform: universal
obsidian_api: Vault.create
api_version: "1.8.0"
inputs:
  createNote: "(vault: Vault, path: string, data: string) => Promise<TFile>"
outputs: "the created TFile"
side_effects: [vault.write]
deterministic: true
depends_on: [helpers/normalize-path]
---

# tools/vault-create-note

Wraps `Vault.create`, normalizing the path through `helpers/normalize-path`
first (canonical POSIX vault path). `actions/quick-capture` and note-producing
chainers use this. Universal — `Vault` is identical on desktop and mobile.

## Contract
- `createNote(vault, path, data)` normalizes `path`, calls `vault.create`,
  returns the new `TFile`.
- `obsidian_api: Vault.create` MUST exist in `apiCatalog` (catalog gate in test).
- Side effect: writes one file. Idempotency is the caller's concern (Vault.create
  rejects existing paths — callers check first or use vault-process-note).
