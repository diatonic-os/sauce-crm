import { describe, it, expect, vi } from 'vitest';
import { Vault, FileManager } from 'obsidian';
import { createNote } from './vault-create-note';
import { renameFile } from './file-rename';
import { hasApiSymbol } from '../../generated/api-catalog';

const makeVault = (): Vault => new (Vault as unknown as { new (): Vault })();

describe('tools/file-rename', () => {
  it('renames via FileManager with a normalized path', async () => {
    const file = await createNote(makeVault(), 'people/Old.md', '');
    const spy = vi.fn(async () => {});
    const fm = { renameFile: spy } as unknown as FileManager;
    await renameFile(fm, file, 'people//New.md');
    expect(spy).toHaveBeenCalledWith(file, 'people/New.md'); // normalize collapsed //
  });

  it('catalog-validation gate: FileManager.renameFile exists', () => {
    expect(hasApiSymbol('FileManager.renameFile')).toBe(true);
  });
});
