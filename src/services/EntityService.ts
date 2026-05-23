import { App, TFile, TFolder, normalizePath } from "obsidian";
import { Entity } from "../domain/Entity";
import { entityFromFrontmatter } from "../domain/Factory";
import {
  normalizeObsidianFrontmatter,
  serializeObsidianFrontmatter,
} from "../util/Frontmatter";

export interface VaultPaths {
  people: string;
  orgs: string;
  touches: string;
  addenda: string;
  notes: string;
  ideas: string;
  observations: string;
  tasks: string;
  events: string;
  ledger: string;
  pipeline: string;
  templates: string;
  playbooks: string;
  user: string;
  vaults: string;
}

export const DEFAULT_PATHS: VaultPaths = {
  people: "people",
  orgs: "orgs",
  touches: "touches",
  addenda: "_addenda",
  notes: "notes",
  ideas: "ideas",
  observations: "observations",
  tasks: "tasks",
  events: "events",
  ledger: "ledger",
  pipeline: "pipeline",
  templates: "_templates",
  playbooks: "_playbooks",
  user: "$user",
  vaults: "vaults",
};

export class EntityService {
  constructor(
    public app: App,
    public paths: VaultPaths = DEFAULT_PATHS,
  ) {}

  async ensureFolder(path: string): Promise<TFolder> {
    const np = normalizePath(path);
    const existing = this.app.vault.getAbstractFileByPath(np);
    if (existing && existing instanceof TFolder) return existing;
    return await this.app.vault.createFolder(np);
  }

  getFile(path: string): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return f instanceof TFile ? f : null;
  }

  async createEntity(
    folder: string,
    basename: string,
    fm: Record<string, any>,
    body = "",
  ): Promise<TFile> {
    await this.ensureFolder(folder);
    const path = normalizePath(`${folder}/${basename}.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && existing instanceof TFile) {
      await this.updateFrontmatter(existing, () =>
        normalizeObsidianFrontmatter(fm),
      );
      return existing;
    }
    const fmYaml = serializeObsidianFrontmatter(fm);
    const content = `${fmYaml}\n${body}`;
    return await this.app.vault.create(path, content);
  }

  async updateFrontmatter(
    file: TFile,
    mutator: (fm: Record<string, any>) => Record<string, any> | void,
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const result = mutator(fm);
      if (result && typeof result === "object") {
        for (const k of Object.keys(fm)) delete fm[k];
        for (const [k, v] of Object.entries(
          normalizeObsidianFrontmatter(result),
        ))
          (fm as any)[k] = v;
      } else {
        const normalized = normalizeObsidianFrontmatter(fm);
        for (const k of Object.keys(fm)) delete fm[k];
        for (const [k, v] of Object.entries(normalized)) (fm as any)[k] = v;
      }
    });
  }

  loadEntity(file: TFile): Entity | null {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) return null;
    return entityFromFrontmatter(file, cache.frontmatter);
  }

  listEntitiesIn(folder: string): Entity[] {
    const np = normalizePath(folder);
    const out: Entity[] = [];
    const f = this.app.vault.getAbstractFileByPath(np);
    if (!(f instanceof TFolder)) return out;
    const recurse = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) recurse(child);
        else if (child instanceof TFile && child.extension === "md") {
          const e = this.loadEntity(child);
          if (e) out.push(e);
        }
      }
    };
    recurse(f);
    return out;
  }

  allPeople(): Entity[] {
    return this.listEntitiesIn(this.paths.people);
  }
  allOrgs(): Entity[] {
    return this.listEntitiesIn(this.paths.orgs);
  }
  allTouches(): Entity[] {
    return this.listEntitiesIn(this.paths.touches);
  }
  allAddenda(): Entity[] {
    return this.listEntitiesIn(this.paths.addenda);
  }
  allNotes(): Entity[] {
    return this.listEntitiesIn(this.paths.notes);
  }
  allIdeas(): Entity[] {
    return this.listEntitiesIn(this.paths.ideas);
  }
  allObservations(): Entity[] {
    return this.listEntitiesIn(this.paths.observations);
  }
  allTasks(): Entity[] {
    return this.listEntitiesIn(this.paths.tasks);
  }
  allEvents(): Entity[] {
    return this.listEntitiesIn(this.paths.events);
  }
  allLedgerEntries(): Entity[] {
    return this.listEntitiesIn(this.paths.ledger);
  }
  allPipelineDeals(): Entity[] {
    return this.listEntitiesIn(this.paths.pipeline);
  }
}
