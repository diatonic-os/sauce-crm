// SDK tool — source: sdk/groups/tools/interval-register.md | api_version: 1.8.0 | gen_hash: hand-t003
//
// Lifecycle-bound recurring timer. Basis for chainers/time-sync-loop.

import { Plugin } from 'obsidian';

/**
 * Schedule `callback` every `ms` and register it with `plugin` so Obsidian
 * clears it automatically on unload (Component.registerInterval). Returns the id.
 */
export function registerInterval(plugin: Plugin, callback: () => void, ms: number): number {
  const id = window.setInterval(callback, ms);
  return plugin.registerInterval(id);
}
