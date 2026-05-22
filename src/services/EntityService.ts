import { App, TFile, TFolder, normalizePath } from "obsidian";
import { Entity } from "../domain/Entity";
import { entityFromFrontmatter } from "../domain/Factory";

export interface VaultPaths {
  people: string;
  orgs: string;
  touches: string;
  addenda: string;
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
  templates: "_templates",
  playbooks: "_playbooks",
  user: "$user",
  vaults: "vaults",
};

export class EntityService {
  constructor(public app: App, public paths: VaultPaths = DEFAULT_PATHS) {}

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

  async createEntity(folder: string, basename: string, fm: Record<string, any>, body = ""): Promise<TFile> {
    await this.ensureFolder(folder);
    const path = normalizePath(`${folder}/${basename}.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && existing instanceof TFile) {
      await this.updateFrontmatter(existing, () => ({ ...fm }));
      return existing;
    }
    const fmYaml = serializeFrontmatter(fm);
    const content = `${fmYaml}\n${body}`;
    return await this.app.vault.create(path, content);
  }

  async updateFrontmatter(file: TFile, mutator: (fm: Record<string, any>) => Record<string, any> | void): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const result = mutator(fm);
      if (result && typeof result === "object") {
        for (const k of Object.keys(fm)) delete fm[k];
        for (const [k, v] of Object.entries(result)) (fm as any)[k] = v;
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

  allPeople(): Entity[] { return this.listEntitiesIn(this.paths.people); }
  allOrgs(): Entity[] { return this.listEntitiesIn(this.paths.orgs); }
  allTouches(): Entity[] { return this.listEntitiesIn(this.paths.touches); }
  allAddenda(): Entity[] { return this.listEntitiesIn(this.paths.addenda); }
}

function serializeFrontmatter(fm: Record<string, any>): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    lines.push(serializeKv(k, v, 0));
  }
  lines.push("---");
  return lines.join("\n");
}

function serializeKv(key: string, val: any, depth: number): string {
  const pad = "  ".repeat(depth);
  if (val == null) return `${pad}${key}:`;
  if (Array.isArray(val)) {
    if (val.length === 0) return `${pad}${key}: []`;
    const lines = [`${pad}${key}:`];
    for (const item of val) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item);
        lines.push(`${pad}  - ${entries.map(([k, v]) => `${k}: ${formatScalar(v)}`).join(", ")}`);
      } else {
        lines.push(`${pad}  - ${formatScalar(item)}`);
      }
    }
    return lines.join("\n");
  }
  if (typeof val === "object") {
    const lines = [`${pad}${key}:`];
    for (const [k, v] of Object.entries(val)) lines.push(serializeKv(k, v, depth + 1));
    return lines.join("\n");
  }
  return `${pad}${key}: ${formatScalar(val)}`;
}

function formatScalar(v: any): string {
  if (v == null) return "";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const s = String(v);
  if (s.includes(":") || s.includes("#") || s.includes("[") || s.startsWith(" ") || s.endsWith(" ")) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}
