// SDK tool — source: sdk/groups/tools/hotkey-register.md | api_version: 1.8.0 | gen_hash: hand-t012
//
// Register a keyboard shortcut on a Scope.

import { Scope, Modifier, KeymapEventHandler } from 'obsidian';

/** Register a hotkey; the listener runs `callback` then prevents default. */
export function registerHotkey(
  scope: Scope,
  modifiers: Modifier[],
  key: string,
  callback: () => void,
): KeymapEventHandler {
  return scope.register(modifiers, key, () => {
    callback();
    return false;
  });
}
