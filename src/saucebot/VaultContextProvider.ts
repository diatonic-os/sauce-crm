/**
 * VaultContextProvider — links / backlinks index from MetadataCache.resolvedLinks.
 * (F2 / CON-SAUCEBOT S2)
 *
 * Obsidian's MetadataCache.resolvedLinks is a map:
 *   { [sourcePath]: { [targetPath]: linkCount } }
 *
 * Backlinks are derived by inverting this map (MetadataCache.getBacklinksForFile
 * is semi-private / not reliably available in all API versions).
 *
 * The provider also exposes a SkillLike `get_links` tool that the model can
 * call to traverse the vault graph during a conversation.
 */

import type { SkillLike } from "./ToolUseAdapter";

// ---------------------------------------------------------------------------
// Narrow host interface — injected so the class is unit-testable.
// ---------------------------------------------------------------------------

/**
 * The MetadataCache surface we need.
 * In production, pass `app.metadataCache` directly.
 */
export interface MetadataCacheHost {
  /** { [sourcePath]: { [resolvedTargetPath]: linkCount } } */
  resolvedLinks: Record<string, Record<string, number>>;
}

// ---------------------------------------------------------------------------
// VaultContextProvider
// ---------------------------------------------------------------------------

export class VaultContextProvider {
  /** Forward index: sourcePath → set of target paths. */
  private links = new Map<string, Set<string>>();
  /** Inverted index: targetPath → set of source paths (backlinks). */
  private backlinks = new Map<string, Set<string>>();

  constructor(private readonly cache: MetadataCacheHost) {}

  /**
   * (Re-)build the link/backlink index from the current MetadataCache snapshot.
   * Call this at startup and whenever MetadataCache triggers "resolved".
   */
  rebuild(): void {
    this.links.clear();
    this.backlinks.clear();
    for (const [src, targets] of Object.entries(this.cache.resolvedLinks)) {
      const srcSet = this.links.get(src) ?? new Set<string>();
      for (const tgt of Object.keys(targets)) {
        srcSet.add(tgt);
        const blSet = this.backlinks.get(tgt) ?? new Set<string>();
        blSet.add(src);
        this.backlinks.set(tgt, blSet);
      }
      this.links.set(src, srcSet);
    }
  }

  /** Return all vault paths that `path` links to (outgoing wikilinks). */
  getLinks(path: string): string[] {
    return [...(this.links.get(path) ?? [])];
  }

  /** Return all vault paths that link to `path` (backlinks). */
  getBacklinks(path: string): string[] {
    return [...(this.backlinks.get(path) ?? [])];
  }

  /**
   * One-hop neighbourhood: all files reachable from `path` in either
   * direction (union of links + backlinks, excluding `path` itself).
   */
  oneHop(path: string): string[] {
    const out = new Set([...this.getLinks(path), ...this.getBacklinks(path)]);
    out.delete(path);
    return [...out];
  }

  // ---------------------------------------------------------------------------
  // SkillLike tool — registered to ToolUseAdapter so the model can call it.
  // ---------------------------------------------------------------------------

  /**
   * Returns a SkillLike that the model can call as `get_links`.
   * Returns { links, backlinks } for a given vault path.
   */
  asSkill(): SkillLike {
    return {
      id: "get_links",
      description:
        "Return the outgoing links and backlinks for a vault note. " +
        "Use this to explore the relationship graph around a contact or note.",
      risk: "low",
      contract: {
        level: "read",
        inputs: [
          {
            name: "path",
            type: "string",
            description:
              "Vault-relative path of the note (e.g. 'contacts/Alice.md')",
            required: true,
          },
        ],
      },
      // Arrow function preserves the outer `this` (VaultContextProvider instance).
      execute: async (
        args: Record<string, unknown>,
      ): Promise<{ links: string[]; backlinks: string[] }> => {
        const path = String(args["path"] ?? "");
        return {
          links: this.getLinks(path),
          backlinks: this.getBacklinks(path),
        };
      },
    };
  }
}
