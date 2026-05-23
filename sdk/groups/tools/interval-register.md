---
group: tools
id: interval-register
summary: Register a recurring callback tied to plugin lifecycle (Component.registerInterval).
platform: universal
obsidian_api: Component.registerInterval
api_version: "1.8.0"
inputs:
  registerInterval: "(plugin: Plugin, callback: () => void, ms: number) => number"
outputs: "interval id (auto-cleared on plugin unload)"
side_effects: [timer]
deterministic: true
depends_on: []
---

# tools/interval-register

Wraps `window.setInterval` + `Component.registerInterval` (Plugin extends
Component) so every recurring task is auto-cleaned on unload — no leaked timers.
`chainers/time-sync-loop` builds on this, ticking `helpers/logical-clock`
(never wall-clock).

## Contract
- `registerInterval(plugin, callback, ms)` schedules `callback` every `ms` and
  registers the id with the plugin for lifecycle cleanup; returns the id.
- `obsidian_api: Component.registerInterval` MUST exist in `apiCatalog`
  (catalog gate in test).
- The interval itself is deterministic in registration; callback effects are the
  caller's concern.
