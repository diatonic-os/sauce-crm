# Sauce CRM Settings

Welcome to the Sauce CRM control plane. This page is Markdown-rendered by
contract and will become the first settings page shown when `settings-md` lands.

Sauce CRM keeps Markdown as the source of truth while giving operators a
modal-first CRM, graph, Copilot, and light ERP interface inside Obsidian.

## Quick Links

- General settings: `settings/general.md`
- Vault layout: `settings/vault.md`
- Validation and contracts: `settings/validation.md`
- Copilot: `settings/copilot.md`
- Skills: `settings/skills.md`
- Integrations: `settings/integrations.md`
- Data and backups: `settings/data.md`
- Advanced: `settings/advanced.md`

## Getting Started

```settings
type: button
key: actions.initializeVault
label: Initialize vault scaffolding
description: Create required folders and dashboard notes if they are missing.
```

```settings
type: button
key: actions.openDashboard
label: Open dashboard
description: Jump to the Sauce CRM command center.
```

```settings
type: toggle
key: ui.showAdvanced
label: Show advanced controls
description: Reveal controls intended for operators and maintainers.
default: false
```

## What Is New

The current working tree contains the CRM/ERP UI buildout: modal-first capture
for notes, ideas, observations, tasks, events, ledger entries, and pipeline
deals; live dashboard refresh; and policy scaffolding.

When `settings-md` is implemented, this section should render the tail of
`CHANGELOG.md` if present.

## About

Sauce CRM is a local-first Obsidian relationship graph. People, organizations,
touches, tasks, notes, ideas, observations, events, ledger entries, and
pipeline deals stay queryable as Markdown records with structured frontmatter.
