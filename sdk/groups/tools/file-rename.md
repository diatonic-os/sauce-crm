---
group: tools
id: file-rename
summary: Link-safe rename/move of a file (FileManager.renameFile) at a normalized path.
platform: universal
obsidian_api: FileManager.renameFile
api_version: "1.8.0"
inputs:
  renameFile: "(fileManager: FileManager, file: TAbstractFile, newPath: string) => Promise<void>"
outputs: "void"
side_effects: [vault.write]
deterministic: true
depends_on: [helpers/normalize-path]
---

# tools/file-rename

Wraps `FileManager.renameFile` — the **link-safe** rename (updates inbound
`[[wikilinks]]`), unlike `Vault.rename`. Used by `merge-duplicates` and any
promote/rename flow. Normalizes the target path first.

## Contract
- `renameFile(fileManager, file, newPath)` normalizes `newPath` and renames,
  preserving links.
- `obsidian_api: FileManager.renameFile` MUST exist in `apiCatalog` (catalog gate).
- Universal platform.
