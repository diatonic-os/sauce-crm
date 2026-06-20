// BrainBuilder — orchestrates the deterministic brain build over the vault and
// keeps it current incrementally.
//
// Full build (`buildAll`, run on first install / on command): one pass over
// every note → lexicon + taxonomy + path matrix + manifest, persisted under
// _brain/. Incremental (`updateFile` / `removeFile`, wired to vault events):
// the path matrix (navigation + relationships) is updated in realtime; the
// aggregate lexicon/taxonomy are marked stale in the manifest so a coalesced
// rebuild can refresh them without blocking each keystroke.
//
// Persistence is an injected seam (Obsidian's vault.adapter satisfies it), so
// the whole builder is unit-testable without Obsidian.

import { DEFAULT_PATHS } from "../services/EntityService";
import {
  Lexicon,
  Taxonomy,
  tokenize,
  pathRecord,
  resolveLinkSymmetry,
  buildFolderLattice,
  type PathRecord,
} from "./BrainIndex";

export interface BrainPersistence {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
}

/** One note presented to the builder. `read()` returns the raw file (with
 *  frontmatter); frontmatter + tags come from the metadata cache. */
export interface BrainFile {
  path: string;
  mtime: number;
  read: () => Promise<string>;
  frontmatter: Record<string, unknown>;
  tags: string[];
}

export interface BrainManifest {
  version: number;
  builtAt: number;
  files: number;
  lexiconTerms: number;
  pathCount: number;
  taxonomy: {
    folders: number;
    types: number;
    tags: number;
    frontmatterKeys: number;
  };
  /** True when incremental edits landed since the last full build, so the
   *  aggregate lexicon/taxonomy may be behind (path matrix is always current). */
  stale: boolean;
}

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

export class BrainBuilder {
  private paths = new Map<string, PathRecord>();
  private lastManifest: BrainManifest | null = null;
  private now: () => number;

  constructor(
    private store: BrainPersistence,
    private folder = DEFAULT_PATHS.brain,
    now: () => number = () => Date.now(),
  ) {
    this.now = now;
  }

  private file(name: string): string {
    return `${this.folder}/${name}`;
  }

  /** Load the persisted path matrix + manifest (best-effort) so incremental
   *  updates start from the prior state instead of an empty map. */
  async load(): Promise<void> {
    try {
      if (await this.store.exists(this.file("brain-paths.json"))) {
        const j = JSON.parse(
          await this.store.read(this.file("brain-paths.json")),
        ) as {
          paths?: Record<string, PathRecord>;
        };
        this.paths = new Map(Object.entries(j.paths ?? {}));
      }
    } catch {
      this.paths = new Map();
    }
    try {
      if (await this.store.exists(this.file("brain.json"))) {
        this.lastManifest = JSON.parse(
          await this.store.read(this.file("brain.json")),
        ) as BrainManifest;
      }
    } catch {
      this.lastManifest = null;
    }
  }

  /** Whether a full build has ever been persisted (drives first-install build). */
  async isBuilt(): Promise<boolean> {
    try {
      return await this.store.exists(this.file("brain.json"));
    } catch {
      return false;
    }
  }

  /** The deterministic artifacts a complete brain must have on disk. (The
   *  crystal digest matrix is owned by the runtime and rebuilt separately.) */
  private static readonly ARTIFACTS = [
    "brain.json",
    "brain-lexicon.json",
    "brain-taxonomy.json",
    "brain-lattice.json",
    "brain-paths.json",
  ];

  /** True only when EVERY artifact is present — detects a wiped/partial index
   *  (e.g. the _brain folder was deleted or sync dropped files) so the caller
   *  can rebuild on launch. */
  async isIntact(): Promise<boolean> {
    try {
      for (const f of BrainBuilder.ARTIFACTS) {
        if (!(await this.store.exists(this.file(f)))) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  setFolder(folder: string): void {
    this.folder = folder.trim() || DEFAULT_PATHS.brain;
  }

  private async ensureFolder(): Promise<void> {
    if (!(await this.store.exists(this.folder)))
      await this.store.mkdir(this.folder);
  }

  /** Full deterministic build: lexicon + taxonomy + path matrix + manifest. */
  async buildAll(files: BrainFile[]): Promise<BrainManifest> {
    const lex = new Lexicon();
    const tax = new Taxonomy();
    this.paths = new Map();
    for (const f of files) {
      let raw = "";
      try {
        raw = await f.read();
      } catch {
        continue; // skip unreadable note, keep building the rest
      }
      const body = stripFrontmatter(raw);
      lex.addDocument(tokenize(body));
      tax.addDocument(f.path, f.frontmatter, f.tags);
      this.paths.set(f.path, pathRecord(f.frontmatter, body, f.mtime, f.tags));
    }
    // Snowflake symmetry: make the link lattice reciprocal (A→B ⇒ B←A).
    resolveLinkSymmetry(this.paths);
    const counts = tax.counts();
    const manifest: BrainManifest = {
      version: 1,
      builtAt: this.now(),
      files: files.length,
      lexiconTerms: lex.size,
      pathCount: this.paths.size,
      taxonomy: {
        folders: Object.keys(counts.folders).length,
        types: Object.keys(counts.types).length,
        tags: Object.keys(counts.tags).length,
        frontmatterKeys: Object.keys(counts.frontmatterKeys).length,
      },
      stale: false,
    };
    await this.ensureFolder();
    await this.store.write(this.file("brain-lexicon.json"), lex.toJSON());
    await this.store.write(this.file("brain-taxonomy.json"), tax.toJSON());
    // Fractal self-similar folder lattice (file → folder → vault).
    await this.store.write(
      this.file("brain-lattice.json"),
      JSON.stringify({ version: 1, lattice: buildFolderLattice(this.paths) }),
    );
    await this.persistPaths();
    await this.store.write(
      this.file("brain.json"),
      JSON.stringify(manifest, null, 2),
    );
    this.lastManifest = manifest;
    return manifest;
  }

  private async persistPaths(): Promise<void> {
    await this.ensureFolder();
    await this.store.write(
      this.file("brain-paths.json"),
      JSON.stringify({ version: 1, paths: Object.fromEntries(this.paths) }),
    );
  }

  /** Mark the aggregate indexes stale (path matrix stays current). */
  private async markStale(): Promise<void> {
    if (this.lastManifest && !this.lastManifest.stale) {
      this.lastManifest.stale = true;
      try {
        await this.store.write(
          this.file("brain.json"),
          JSON.stringify(this.lastManifest, null, 2),
        );
      } catch {
        /* best-effort */
      }
    }
  }

  /** Incremental: refresh one note's path-matrix record in realtime. */
  async updateFile(f: BrainFile): Promise<void> {
    let raw = "";
    try {
      raw = await f.read();
    } catch {
      return;
    }
    const body = stripFrontmatter(raw);
    this.paths.set(f.path, pathRecord(f.frontmatter, body, f.mtime, f.tags));
    await this.persistPaths();
    await this.markStale();
  }

  /** Incremental: drop a deleted note from the path matrix. */
  async removeFile(path: string): Promise<void> {
    if (this.paths.delete(path)) {
      await this.persistPaths();
      await this.markStale();
    }
  }

  /** Incremental: a rename is a remove + add. */
  async renameFile(oldPath: string, f: BrainFile): Promise<void> {
    this.paths.delete(oldPath);
    await this.updateFile(f);
  }

  get pathCount(): number {
    return this.paths.size;
  }
  getManifest(): BrainManifest | null {
    return this.lastManifest;
  }
}
