// SDK tool — source: sdk/groups/tools/metadata-read.md | api_version: 1.8.0 | gen_hash: hand-t006
//
// Read parsed note metadata / frontmatter via MetadataCache.

import { MetadataCache, TFile, CachedMetadata } from 'obsidian';

/** The parsed CachedMetadata for a file, or null if not cached. */
export function readMetadata(cache: MetadataCache, file: TFile): CachedMetadata | null {
  return cache.getFileCache(file);
}

/** The file's frontmatter record, or `{}` when absent. */
export function readFrontmatter(cache: MetadataCache, file: TFile): Record<string, unknown> {
  return (readMetadata(cache, file)?.frontmatter ?? {}) as Record<string, unknown>;
}
