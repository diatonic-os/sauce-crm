// SDK tool — source: sdk/groups/tools/file-rename.md | api_version: 1.8.0 | gen_hash: hand-t013
//
// Link-safe rename/move via FileManager.renameFile. Composes normalize-path.

import { FileManager, TAbstractFile } from 'obsidian';
import { normalizePath } from '../helpers/normalize-path';

/** Rename/move `file` to a normalized `newPath`, updating inbound links. */
export async function renameFile(
  fileManager: FileManager,
  file: TAbstractFile,
  newPath: string,
): Promise<void> {
  return fileManager.renameFile(file, normalizePath(newPath));
}
