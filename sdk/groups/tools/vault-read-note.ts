// SDK tool — source: sdk/groups/tools/vault-read-note.md | api_version: 1.8.0 | gen_hash: hand-t010
//
// Read a note's contents (cache-backed, display-safe).

import { Vault, TFile } from 'obsidian';

/** Read the current text of a note via the cache. */
export async function readNote(vault: Vault, file: TFile): Promise<string> {
  return vault.cachedRead(file);
}
