import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  VaultPaths,
  DEFAULT_PATHS,
  LEGACY_PATH_MOVES,
  LEGACY_DASHBOARD_FILES,
  SAUCE_BRAIN_ROOT,
} from "./EntityService";

/**
 * Bump when the legacy→.sauceBrain mapping changes in a way that requires
 * re-running migration on already-migrated vaults. The stamp persisted in
 * settings gates re-runs (see {@link SauceBrainMigration.run}).
 */
export const SAUCE_BRAIN_MIGRATION_VERSION = 3;

export interface MigrationStamp {
  version: number;
  at: string;
}

/**
 * The slice of plugin settings this migration reads and rewrites. Kept
 * structurally minimal so it composes with the full settings object in
 * main.ts without importing it (avoids a cycle).
 */
export interface MigratedSettings {
  paths: VaultPaths;
  brainFolder?: string;
  sauceBrainMigration?: MigrationStamp;
}

export interface MoveRecord {
  from: string;
  to: string;
  files: number;
  conflicts: string[];
  /** True when the emptied legacy folder was removed after moving its files. */
  removedLegacyFolder?: boolean;
}

export interface MigrationReport {
  /** True when the vault was already at the current migration version. */
  skipped: boolean;
  ranAt: string;
  moves: MoveRecord[];
  totalFilesMoved: number;
  /** Destination paths that already existed; their sources were left intact. */
  conflicts: string[];
  manifestPath: string | null;
  pathsChanged: boolean;
}

/**
 * One-way consolidation of the pre-0.6 folder layout into the hidden
 * `.sauceBrain/` home. The contract, in order of importance:
 *
 *  1. **Never destroys user data.** Files are MOVED with the link-preserving
 *     `fileManager.renameFile`. A destination collision is recorded as a
 *     conflict and the source is left exactly where it was.
 *  2. **Idempotent.** A persisted version stamp short-circuits re-runs, so it
 *     is safe to call unconditionally on every plugin load.
 *  3. **Self-documenting.** Every run that moves anything writes a manifest
 *     under `.sauceBrain/.tmp/migrations/` for audit / rollback reference.
 */
export class SauceBrainMigration {
  constructor(
    private readonly app: App,
    private readonly opts: { now?: () => number } = {},
  ) {}

  async run(settings: MigratedSettings): Promise<MigrationReport> {
    const ranAt = new Date(this.opts.now?.() ?? Date.now()).toISOString();

    if (
      (settings.sauceBrainMigration?.version ?? 0) >=
      SAUCE_BRAIN_MIGRATION_VERSION
    ) {
      return {
        skipped: true,
        ranAt,
        moves: [],
        totalFilesMoved: 0,
        conflicts: [],
        manifestPath: null,
        pathsChanged: false,
      };
    }

    const moves: MoveRecord[] = [];
    const allConflicts: string[] = [];
    let totalFilesMoved = 0;

    for (const { from, to } of LEGACY_PATH_MOVES) {
      const record = await this.moveTree(from, to);
      totalFilesMoved += record.files;
      allConflicts.push(...record.conflicts);
      if (
        record.files > 0 ||
        record.conflicts.length > 0 ||
        record.removedLegacyFolder
      )
        moves.push(record);
    }

    // Relocate root dashboard `.md` files into .sauceBrain/dashboards/ so the
    // vault root holds only browsable CRM content.
    for (const name of LEGACY_DASHBOARD_FILES) {
      const moved = await this.moveFile(
        name,
        `${DEFAULT_PATHS.dashboards}/${name}`,
      );
      if (moved === "moved") totalFilesMoved += 1;
      else if (moved === "conflict") allConflicts.push(name);
    }

    const pathsChanged = this.rewireSettings(settings);

    const manifestPath =
      moves.length > 0 ? await this.writeManifest(ranAt, moves) : null;

    settings.sauceBrainMigration = {
      version: SAUCE_BRAIN_MIGRATION_VERSION,
      at: ranAt,
    };

    return {
      skipped: false,
      ranAt,
      moves,
      totalFilesMoved,
      conflicts: allConflicts,
      manifestPath,
      pathsChanged,
    };
  }

  /**
   * Move every file under `from/` to the mirrored location under `to/`. Returns
   * a per-tree record. Folders themselves are not deleted (Obsidian prunes
   * empty folders lazily, and leaving them is harmless and non-destructive).
   */
  private async moveTree(from: string, to: string): Promise<MoveRecord> {
    const src = normalizePath(from);
    const dst = normalizePath(to);
    const record: MoveRecord = { from: src, to: dst, files: 0, conflicts: [] };

    const root = this.app.vault.getAbstractFileByPath(src);
    if (!root) return record; // Nothing to migrate for this entry.

    // Enumerate descendant files by path prefix — robust whether `src` is a
    // folder with tracked children or just a flat key in the vault index.
    const files = this.app.vault
      .getFiles()
      .filter((f) => f.path === src || f.path.startsWith(src + "/"));

    for (const file of files) {
      const destPath = normalizePath(dst + file.path.slice(src.length));
      if (this.app.vault.getAbstractFileByPath(destPath)) {
        record.conflicts.push(destPath); // Collision — leave source intact.
        continue;
      }
      await this.ensureParent(destPath);
      await this.app.fileManager.renameFile(file, destPath);
      record.files += 1;
    }

    // Remove the now-empty legacy folder so the vault root isn't left littered
    // with hollow `_meta` / `$user` / `_templates` shells (the visible symptom
    // of "migration didn't move folders"). Only delete when NO files remain
    // under it (any conflict that kept a file in place ⇒ keep the folder).
    const remaining = this.app.vault
      .getFiles()
      .filter((f) => f.path === src || f.path.startsWith(src + "/"));
    if (remaining.length === 0) {
      const folder = this.app.vault.getAbstractFileByPath(src);
      if (folder) {
        try {
          await this.app.vault.delete(folder, true); // recursive: only empty dirs left
          record.removedLegacyFolder = true;
        } catch {
          // Best-effort cleanup; a failure here never fails the migration.
        }
      }
    }

    return record;
  }

  /** Move a single root file to a destination. Returns "moved", "conflict"
   *  (destination already exists — source left intact), or "absent". */
  private async moveFile(
    from: string,
    to: string,
  ): Promise<"moved" | "conflict" | "absent"> {
    const src = normalizePath(from);
    const file = this.app.vault.getAbstractFileByPath(src);
    if (!(file instanceof TFile)) return "absent";
    const dst = normalizePath(to);
    if (this.app.vault.getAbstractFileByPath(dst)) return "conflict";
    await this.ensureParent(dst);
    await this.app.fileManager.renameFile(file, dst);
    return "moved";
  }

  /**
   * Point persisted path settings at the new layout. Only keys whose stored
   * value still equals a known legacy folder are rewritten, so a user who
   * customized a folder name keeps it. New keys (inbox/brain/cache/tmp/
   * artifacts) are backfilled from defaults. `brainFolder` follows `_brain`.
   */
  private rewireSettings(settings: MigratedSettings): boolean {
    let changed = false;

    // Generic prefix-remap: rewrite ANY persisted value that is a legacy folder
    // OR lives under one (e.g. `_saucebot/agents` → `.sauceBrain/saucebot/agents`).
    // This is the fix for sub-path keys (saucebotAgents/saucebotPrompts) that the
    // old top-level-only rewrite missed, leaving `_saucebot` to be recreated.
    const remap = (val: string | undefined): string | undefined => {
      if (!val) return undefined;
      for (const { from, to } of LEGACY_PATH_MOVES) {
        if (val === from) return to;
        if (val.startsWith(from + "/")) return to + val.slice(from.length);
      }
      return undefined;
    };
    for (const key of Object.keys(settings.paths) as (keyof VaultPaths)[]) {
      const mapped = remap(settings.paths[key]);
      if (mapped && settings.paths[key] !== mapped) {
        settings.paths[key] = mapped;
        changed = true;
      }
    }

    // Backfill keys absent from older saved settings (cache/tmp/artifacts/
    // dashboards/inbox/brain) from the current defaults.
    for (const key of Object.keys(DEFAULT_PATHS) as (keyof VaultPaths)[]) {
      const current = settings.paths[key];
      if (current == null || current === "") {
        settings.paths[key] = DEFAULT_PATHS[key];
        changed = true;
      }
    }

    if (!settings.brainFolder || settings.brainFolder === "_brain") {
      if (settings.brainFolder !== DEFAULT_PATHS.brain) {
        settings.brainFolder = DEFAULT_PATHS.brain;
        changed = true;
      }
    }

    return changed;
  }

  private async writeManifest(
    ranAt: string,
    moves: MoveRecord[],
  ): Promise<string | null> {
    const dir = `${SAUCE_BRAIN_ROOT}/.tmp/migrations`;
    const stamp = ranAt.replace(/[:.]/g, "-");
    const path = normalizePath(`${dir}/migration-${stamp}.json`);
    const body = JSON.stringify(
      { version: SAUCE_BRAIN_MIGRATION_VERSION, ranAt, moves },
      null,
      2,
    );
    try {
      await this.ensureFolder(dir);
      if (this.app.vault.getAbstractFileByPath(path)) return path;
      await this.app.vault.create(path, body);
      return path;
    } catch {
      // A manifest is best-effort audit metadata; never fail the migration on it.
      return null;
    }
  }

  private async ensureParent(filePath: string): Promise<void> {
    const ix = filePath.lastIndexOf("/");
    if (ix <= 0) return;
    await this.ensureFolder(filePath.slice(0, ix));
  }

  private async ensureFolder(path: string): Promise<void> {
    const parts = normalizePath(path).split("/");
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(acc);
      if (existing instanceof TFolder) continue;
      if (existing) return; // A file occupies this path — bail rather than clobber.
      try {
        await this.app.vault.createFolder(acc);
      } catch {
        // Concurrent create / already-exists race — tolerate.
      }
    }
  }
}

// Re-export to make TFile importable usage explicit for downstream typing.
export type { TFile };
