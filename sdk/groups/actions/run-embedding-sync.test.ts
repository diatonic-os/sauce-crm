import { describe, it, expect, vi } from 'vitest';
import { Plugin } from 'obsidian';
import { registerEmbeddingSync } from './run-embedding-sync';

const makePlugin = (): Plugin => new (Plugin as unknown as { new (): Plugin })();

describe('actions/run-embedding-sync', () => {
  it('registers the Run Embedding Sync command', async () => {
    const plugin = makePlugin();
    const spy = vi.spyOn(plugin, 'addCommand');
    const run = vi.fn();
    const cmd = registerEmbeddingSync(plugin, run);
    expect(cmd.id).toBe('sauce-run-embedding-sync');
    expect(spy).toHaveBeenCalled();
  });
});
