---
group: tools
id: vault-process-note
summary: Atomic read-modify-write of a note (Vault.process) — the safe edit primitive.
platform: universal
obsidian_api: Vault.process
api_version: "1.8.0"
inputs:
  processNote: "(vault: Vault, file: TFile, transform: (data: string) => string) => Promise<string>"
outputs: "the new file contents"
side_effects: [vault.write]
deterministic: true
depends_on: []
---

# tools/vault-process-note

Wraps `Vault.process` — Obsidian's atomic read-modify-write (avoids the
read-then-modify race of `read`+`modify`). The sanctioned way to edit notes;
`auto-touch-pipeline` and `schedule-touch` use it, composing
`helpers/frontmatter-merge` inside the transform for frontmatter edits.

## Contract
- `processNote(vault, file, transform)` applies `transform(current)` atomically,
  returns the new contents.
- `transform` must be pure for determinism (same input ⇒ same output).
- `obsidian_api: Vault.process` MUST exist in `apiCatalog` (catalog gate in test).
