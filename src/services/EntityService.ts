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
  pipeline: string;
  templates: string;
  playbooks: string;
  user: string;
  vaults: string;
  // Content folders present in mature vaults (non-finance).
  meetings: string;
  lanes: string;
  meta: string;
  weekly: string;
  staging: string;
  scripts: string;
  // SauceBot agent workspace (coexists with any third-party `copilot/` folder).
  // `saucebot` is the workspace root; chat sessions live under
  // `${addenda}/_copilot` via ConversationStore.
  saucebot: string;
  saucebotAgents: string;
  saucebotPrompts: string;
  // Capture lane for un-triaged items (formerly the bare `_inbox`).
  inbox: string;
  // Deterministic brain build artifacts (formerly the bare `_brain`).
  brain: string;
  // Hidden machine-generated tiers (regenerable cache + ephemeral tmp +
  // durable long-term artifacts). All nested under SAUCE_BRAIN_ROOT.
  cache: string;
  tmp: string;
  artifacts: string;
  // Dashboard `.md` surfaces (sauce-dql / dataview rollups). Hidden under
  // .sauceBrain — the interactive Sauce views are the primary UI.
  dashboards: string;
  // Local vault backups (BackupService / EncryptedBackupService).
  backups: string;
}

/**
 * Single hidden home for all plugin scaffolding + machine-generated state.
 * Underscore-prefixed system folders (`_addenda`, `_meta`, …), the `$user`
 * workspace, the brain build, and the cache/tmp/artifact tiers all consolidate
 * here so the vault root shows only browsable CRM content. Obsidian hides
 * dot-prefixed folders from the file explorer by default.
 */
export const SAUCE_BRAIN_ROOT = ".sauceBrain";

export const DEFAULT_PATHS: VaultPaths = {
  // Visible CRM content — browsable in the vault root.
  people: "people",
  orgs: "orgs",
  touches: "touches",
  notes: "notes",
  ideas: "ideas",
  observations: "observations",
  tasks: "tasks",
  events: "events",
  pipeline: "pipeline",
  vaults: "vaults",
  meetings: "meetings",
  lanes: "lanes",
  // Hidden scaffolding — consolidated under .sauceBrain/.
  addenda: `${SAUCE_BRAIN_ROOT}/addenda`,
  templates: `${SAUCE_BRAIN_ROOT}/templates`,
  playbooks: `${SAUCE_BRAIN_ROOT}/playbooks`,
  user: `${SAUCE_BRAIN_ROOT}/users`,
  meta: `${SAUCE_BRAIN_ROOT}/meta`,
  weekly: `${SAUCE_BRAIN_ROOT}/weekly`,
  staging: `${SAUCE_BRAIN_ROOT}/staging`,
  scripts: `${SAUCE_BRAIN_ROOT}/scripts`,
  saucebot: `${SAUCE_BRAIN_ROOT}/saucebot`,
  saucebotAgents: `${SAUCE_BRAIN_ROOT}/saucebot/agents`,
  saucebotPrompts: `${SAUCE_BRAIN_ROOT}/saucebot/prompts`,
  inbox: `${SAUCE_BRAIN_ROOT}/inbox`,
  brain: `${SAUCE_BRAIN_ROOT}/brain`,
  cache: `${SAUCE_BRAIN_ROOT}/cache`,
  tmp: `${SAUCE_BRAIN_ROOT}/.tmp`,
  artifacts: `${SAUCE_BRAIN_ROOT}/artifacts`,
  dashboards: `${SAUCE_BRAIN_ROOT}/dashboards`,
  backups: `${SAUCE_BRAIN_ROOT}/backups`,
};

/**
 * Root-level dashboard `.md` files seeded by older bootstraps. The migration
 * relocates these into `${SAUCE_BRAIN_ROOT}/dashboards/` so the vault root shows
 * only browsable CRM content. The interactive Sauce views supersede them; these
 * remain as the file-native dataview/sauce-dql rollup surfaces.
 */
export const LEGACY_DASHBOARD_FILES: readonly string[] = [
  "_DASHBOARD.md",
  "_MOC.md",
  "_TASKS.md",
  "_ADDENDA.md",
  "_IDEAS.md",
  "_EVENTS.md",
  "_POLICY.md",
  "_PLUGIN-CONFIG.md",
  "_README.md",
  "_MEETINGS.md",
  "_LANES.md",
  "_WEEKLY.md",
];

/**
 * Pre-consolidation folder layout (≤ 0.5.0). Each entry maps a legacy folder to
 * its `.sauceBrain` destination. Drives {@link SauceBrainMigration}: data is
 * MOVED (link-preserving), never deleted. Order matters only for display —
 * moves are independent. `_saucebot/agents` and `_saucebot/prompts` ride along
 * with the recursive `_saucebot` move, so only roots are listed.
 */
export const LEGACY_PATH_MOVES: ReadonlyArray<{ from: string; to: string }> = [
  { from: "_addenda", to: `${SAUCE_BRAIN_ROOT}/addenda` },
  { from: "_templates", to: `${SAUCE_BRAIN_ROOT}/templates` },
  { from: "_playbooks", to: `${SAUCE_BRAIN_ROOT}/playbooks` },
  { from: "$user", to: `${SAUCE_BRAIN_ROOT}/users` },
  { from: "_meta", to: `${SAUCE_BRAIN_ROOT}/meta` },
  { from: "_weekly", to: `${SAUCE_BRAIN_ROOT}/weekly` },
  { from: "_staging", to: `${SAUCE_BRAIN_ROOT}/staging` },
  { from: "_scripts", to: `${SAUCE_BRAIN_ROOT}/scripts` },
  { from: "_saucebot", to: `${SAUCE_BRAIN_ROOT}/saucebot` },
  { from: "_brain", to: `${SAUCE_BRAIN_ROOT}/brain` },
  { from: "_inbox", to: `${SAUCE_BRAIN_ROOT}/inbox` },
  // `$`-prefixed legacy scratch dirs (pre-consolidation cache/user workspace).
  { from: "$cache", to: `${SAUCE_BRAIN_ROOT}/cache` },
  { from: "_backups", to: `${SAUCE_BRAIN_ROOT}/backups` },
];

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
          // fm is typed `any` by Obsidian's processFrontMatter API — no cast needed
          fm[k] = v;
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
  allPipelineDeals(): Entity[] {
    return this.listEntitiesIn(this.paths.pipeline);
  }
}
