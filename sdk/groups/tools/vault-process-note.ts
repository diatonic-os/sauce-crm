// SDK tool — source: sdk/groups/tools/vault-process-note.md | api_version: 1.8.0 | gen_hash: hand-t005
//
// Atomic read-modify-write of a note via Vault.process.

import { Vault, TFile } from 'obsidian';

/** Atomically transform a note's contents; returns the new contents. */
export async function processNote(
  vault: Vault,
  file: TFile,
  transform: (data: string) => string,
): Promise<string> {
  return vault.process(file, transform);
}
