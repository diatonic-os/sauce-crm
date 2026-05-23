---
group: actions
summary: User-triggerable operations registered as Obsidian commands.
generated_from: Reference/TypeScript API/Command
---

# actions/ — command-bound operations

Each action registers via `command-register` (tools/), is hotkey-able via
`Scope`, and is reachable on mobile unless marked `Command.mobileOnly: false`.
Actions orchestrate tools/chainers; they hold no side effects of their own.

## Seed members

| id | platform | composes |
|---|---|---|
| `quick-capture` | [desktop, mobile] | tools/vault-create-note, helpers/frontmatter-merge |
| `log-touch` | [desktop, mobile] | chainers/auto-touch-pipeline |
| `schedule-touch` | [desktop, mobile] | tools/vault-process-note, helpers/logical-clock |
| `open-crm-inbox` | [desktop, mobile] | components/inbox-view |
| `run-embedding-sync` | [desktop, mobile] | chainers/embedding-pipeline |
| `route-introduction` | [desktop, mobile] | skills/infer-edges |
