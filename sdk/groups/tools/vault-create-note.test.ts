import { describe, it, expect } from 'vitest';
import { Vault, TFile } from 'obsidian';
import { createNote } from './vault-create-note';
import { hasApiSymbol } from '../../generated/api-catalog';

const makeVault = (): Vault => new (Vault as unknown as { new (): Vault })();

describe('tools/vault-create-note', () => {
  it('creates a note and returns the TFile at the normalized path', async () => {
    const vault = makeVault();
    const file = await createNote(vault, 'people//Frank.md', 'hello');
    expect(file).toBeInstanceOf(TFile);
    expect(file.path).toBe('people/Frank.md'); // normalize-path collapsed the //
  });

  it('catalog-validation gate: Vault.create exists in the catalog', () => {
    expect(hasApiSymbol('Vault.create')).toBe(true);
  });
});
