import { describe, it, expect } from 'vitest';
import { Vault } from 'obsidian';
import { createNote } from './vault-create-note';
import { processNote } from './vault-process-note';
import { hasApiSymbol } from '../../generated/api-catalog';

const makeVault = (): Vault => new (Vault as unknown as { new (): Vault })();

describe('tools/vault-process-note', () => {
  it('atomically transforms note contents and returns the result', async () => {
    const vault = makeVault();
    const file = await createNote(vault, 'note.md', 'hello');
    const result = await processNote(vault, file, (d) => d.toUpperCase());
    expect(result).toBe('HELLO');
    // change persisted: a second read-process sees the updated content
    const again = await processNote(vault, file, (d) => d + '!');
    expect(again).toBe('HELLO!');
  });

  it('catalog-validation gate: Vault.process exists in the catalog', () => {
    expect(hasApiSymbol('Vault.process')).toBe(true);
  });
});
