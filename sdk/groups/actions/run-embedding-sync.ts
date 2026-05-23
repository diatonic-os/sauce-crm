// SDK action — source: sdk/groups/actions/run-embedding-sync.md | api_version: 1.8.0 | gen_hash: hand-a002
//
// Register a command to run the embedding sync pipeline; expose as a command. Composes tools+helpers.

import { Plugin, Command } from 'obsidian';
import { registerCommand } from '../tools/command-register';

/** Register the Run Embedding Sync command bound to `run`. */
export function registerEmbeddingSync(plugin: Plugin, run: () => Promise<void>): Command {
  return registerCommand(plugin, { id: 'sauce-run-embedding-sync', name: 'Sauce: Run Embedding Sync', callback: async () => {
    await run();
  } });
}
