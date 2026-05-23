---
group: tools
id: hotkey-register
summary: Register a keyboard shortcut on a Scope (Scope.register).
platform: desktop
obsidian_api: Scope.register
api_version: "1.8.0"
inputs:
  registerHotkey: "(scope: Scope, modifiers: Modifier[], key: string, callback: () => void) => KeymapEventHandler"
outputs: "the KeymapEventHandler"
side_effects: [ui]
deterministic: true
depends_on: []
---

# tools/hotkey-register

Wraps `Scope.register` for keyboard shortcuts. `actions/` bind palette commands
(cross-platform); hotkeys are a desktop refinement (mobile has no hardware
keyboard by default), hence `platform: desktop`. The wrapper swallows the
default by returning `false` from the listener after invoking the callback.

## Contract
- `registerHotkey(scope, modifiers, key, callback)` registers and returns the
  `KeymapEventHandler`; the listener calls `callback` then returns `false`
  (prevent default).
- `obsidian_api: Scope.register` MUST exist in `apiCatalog` (catalog gate).
