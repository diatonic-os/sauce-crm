import { describe, it, expect } from 'vitest';
import { Vault } from 'obsidian';
import { createNote } from './vault-create-note';
import { readNote } from './vault-read-note';
import { hasApiSymbol } from '../../generated/api-catalog';

const makeVault = (): Vault => new (Vault as unknown as { new (): Vault })();

describe('tools/vault-read-note', () => {
  it('reads back the contents of a created note', async () => {
    const vault = makeVault();
    const file = await createNote(vault, 'note.md', 'the body');
    expect(await readNote(vault, file)).toBe('the body');
  });

  it('catalog-validation gate: Vault.cachedRead exists', () => {
    expect(hasApiSymbol('Vault.cachedRead')).toBe(true);
  });
});
