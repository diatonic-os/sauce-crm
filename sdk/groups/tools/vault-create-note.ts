// SDK tool — source: sdk/groups/tools/vault-create-note.md | api_version: 1.8.0 | gen_hash: hand-t004
//
// Create a vault note at a normalized path. Composes helpers/normalize-path.

import { Vault, TFile } from 'obsidian';
import { normalizePath } from '../helpers/normalize-path';

/** Create a plaintext note at `path` (normalized) with `data`; returns the TFile. */
export async function createNote(vault: Vault, path: string, data: string): Promise<TFile> {
  return vault.create(normalizePath(path), data);
}
