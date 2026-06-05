import { App, TFile, normalizePath } from "obsidian";
import { EntityService } from "./EntityService";
import { wrapWikilink, parseWikilink } from "../util/Wikilink";
import { uniq } from "../util/Yaml";

export interface EdgeRule {
  symmetric: boolean;
  scalar: boolean;
}

export const DEFAULT_EDGE_RULES: Record<string, EdgeRule> = {
  knows: { symmetric: true, scalar: false },
  worked_with: { symmetric: true, scalar: false },
  intro_candidates: { symmetric: false, scalar: false },
  family_of: { symmetric: false, scalar: true },
  intro_via: { symmetric: false, scalar: true },
  parent: { symmetric: false, scalar: true },
};

export class EdgeSyncService {
  private debounce = new Map<string, NodeJS.Timeout>();

  constructor(
    public app: App,
    public entities: EntityService,
    public rules: Record<string, EdgeRule> = DEFAULT_EDGE_RULES,
  ) {}

  scheduleReconcile(file: TFile): void {
    const key = file.path;
    const prev = this.debounce.get(key);
    if (prev) clearTimeout(prev);
    this.debounce.set(
      key,
      setTimeout(() => {
        this.debounce.delete(key);
        void this.reconcile(file);
      }, 250),
    );
  }

  async reconcile(file: TFile): Promise<void> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return;
    const selfLink = wrapWikilink(file.basename);

    for (const [edge, rule] of Object.entries(this.rules)) {
      if (!rule.symmetric) continue;
      const targets = arr<string>(fm[edge]);
      for (const link of targets) {
        const target = this.resolveLink(link, file);
        if (!target) continue;
        await this.app.fileManager.processFrontMatter(target, (tfm) => {
          const cur = arr<string>(tfm[edge]);
          if (!cur.includes(selfLink)) tfm[edge] = uniq([...cur, selfLink]);
        });
      }
    }
    await this.removeDanglingInverses(file);
  }

  private async removeDanglingInverses(file: TFile): Promise<void> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return;
    const selfLink = wrapWikilink(file.basename);

    for (const [edge, rule] of Object.entries(this.rules)) {
      if (!rule.symmetric) continue;
      const declared = new Set(
        arr<string>(fm[edge]).map((l) => parseWikilink(l) ?? l),
      );
      for (const peer of this.app.vault.getMarkdownFiles()) {
        if (peer.path === file.path) continue;
        const peerFm = this.app.metadataCache.getFileCache(peer)?.frontmatter;
        if (!peerFm) continue;
        const peerEdges = arr<string>(peerFm[edge]);
        if (!peerEdges.some((l) => (parseWikilink(l) ?? l) === file.basename))
          continue;
        if (declared.has(peer.basename)) continue; // still mutual
        await this.app.fileManager.processFrontMatter(peer, (pfm) => {
          pfm[edge] = arr<string>(pfm[edge]).filter(
            (l) => (parseWikilink(l) ?? l) !== file.basename,
          );
        });
        void selfLink;
      }
    }
  }

  private resolveLink(link: string, source: TFile): TFile | null {
    const target = parseWikilink(link) ?? link;
    const f = this.app.metadataCache.getFirstLinkpathDest(target, source.path);
    if (f) return f;
    // try people/<target>.md and orgs/<target>.md
    for (const base of [this.entities.paths.people, this.entities.paths.orgs]) {
      const f2 = this.app.vault.getAbstractFileByPath(
        normalizePath(`${base}/${target}.md`),
      );
      if (f2 && f2 instanceof TFile) return f2;
    }
    return null;
  }

  async fullVaultReconcile(): Promise<number> {
    let n = 0;
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) continue;
      if (fm.knows || fm.worked_with) {
        await this.reconcile(f);
        n++;
      }
    }
    return n;
  }
}

function arr<T = unknown>(v: unknown): T[] {
  return (v == null ? [] : Array.isArray(v) ? v : [v]) as T[];
}
