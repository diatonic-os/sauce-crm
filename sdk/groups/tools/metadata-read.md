---
group: tools
id: metadata-read
summary: Read a note's cached metadata / frontmatter (MetadataCache.getFileCache).
platform: universal
obsidian_api: MetadataCache.getFileCache
api_version: "1.8.0"
inputs:
  readMetadata: "(cache: MetadataCache, file: TFile) => CachedMetadata | null"
  readFrontmatter: "(cache: MetadataCache, file: TFile) => Record<string, unknown>"
outputs: "CachedMetadata | null / frontmatter record"
side_effects: none
deterministic: true
depends_on: []
---

# tools/metadata-read

Wraps `MetadataCache.getFileCache` — the parsed view of a note (frontmatter,
links, headings) without re-reading the file. `skills/infer-edges` reads
frontmatter `knows`/`worked_with` through here; `chainers/embedding-pipeline`
reads it to decide what to embed.

## Contract
- `readMetadata(cache, file)` → the `CachedMetadata` or `null`.
- `readFrontmatter(cache, file)` → frontmatter record, or `{}` if absent.
- No side effects (read-only cache access); universal platform.
- `obsidian_api: MetadataCache.getFileCache` MUST exist in `apiCatalog`.
