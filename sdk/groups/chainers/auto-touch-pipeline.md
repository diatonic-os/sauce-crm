---
group: chainers
id: auto-touch-pipeline
summary: Atomically record a touch into a contact's frontmatter; idempotent via logical clock.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
deterministic: true
depends_on: [tools/vault-process-note, helpers/frontmatter-merge, helpers/parse-yaml]
---

# chainers/auto-touch-pipeline

A connector event records a touch on a contact note: read frontmatter, merge
`last_touch`/`touch_count`/`last_channel`, write back atomically via
`vault-process-note`. **Idempotent** — applying an event whose `tick` is ≤ the
stored `last_touch` is a no-op (logical-clock guard, CONTRACT.md determinism).

## Contract
- `applyTouch(vault, file, { tick, channel })` updates frontmatter atomically and
  returns the new contents; preserves the body; bumps `touch_count`.
- `tick <= existing last_touch` ⇒ unchanged (idempotent). No wall-clock.
