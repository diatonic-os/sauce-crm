// CON-OBS-INTEG-001 · T-C1-01 · CW-files — unified facade over the file-handling
// core plugins (file-explorer, file-recovery, format-converter, note-composer,
// unique-note-creator, templates).
//
// Canon-aware (G-003): a write to a canonized file NEVER calls the raw Vault
// modify path — it routes through the injected CanonGuard (SH-D CanonService
// satisfies it). The host + guard are injected so the service is unit-testable.

/** Minimal vault surface (injected) — SH-G wires this from app.vault. */
export interface FilesHost {
  exists(path: string): boolean;
  read(path: string): Promise<string>;
  create(path: string, content: string): Promise<void>;
  /** Raw modify — only legal for non-canonized files (the service enforces this). */
  modify(path: string, content: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  trash(path: string, system?: boolean): Promise<void>;
  /** file-recovery: restore a previous version's contents. */
  restoreFromHistory(path: string, content: string): Promise<void>;
}

/** Canon contract surface (injected) — SH-D CanonService satisfies it (G-003). */
export interface CanonGuard {
  isCanonized(path: string): boolean;
  /** The ONLY legal write path for a canonized file (appends a ledger entry). */
  mutateViaContract(
    path: string,
    mutator: (prev: string) => string,
  ): Promise<void>;
}

export interface TemplateHost {
  /** templates core plugin: render a template body for a target. */
  applyTemplate(templatePath: string, targetPath: string): Promise<void>;
  /** note-composer: merge/compose note bodies. */
  compose(sourcePaths: string[], destPath: string): Promise<void>;
  /** unique-note-creator: create a uniquely-named note, returns its path. */
  uniqueNote(folder: string, body?: string): Promise<string>;
}

export class FilesService {
  constructor(
    private readonly host: FilesHost,
    private readonly canon: CanonGuard,
    private readonly templates: TemplateHost,
  ) {}

  exists(path: string): boolean {
    return this.host.exists(path);
  }

  read(path: string): Promise<string> {
    return this.host.read(path);
  }

  create(path: string, content: string): Promise<void> {
    return this.host.create(path, content);
  }

  /**
   * The canon-aware write. For a canonized file the raw modify path is forbidden
   * (G-003) — the mutation routes through the contract channel. For a normal file
   * it's a direct modify.
   */
  async updateViaContract(
    path: string,
    mutator: (prev: string) => string,
  ): Promise<void> {
    if (this.canon.isCanonized(path)) {
      await this.canon.mutateViaContract(path, mutator);
      return;
    }
    const prev = this.host.exists(path) ? await this.host.read(path) : "";
    await this.host.modify(path, mutator(prev));
  }

  move(oldPath: string, newPath: string): Promise<void> {
    return this.host.rename(oldPath, newPath);
  }

  rename(oldPath: string, newPath: string): Promise<void> {
    return this.host.rename(oldPath, newPath);
  }

  /** Soft-delete by default (trash); pass system=false for vault-local .trash. */
  delete(path: string, system = true): Promise<void> {
    return this.host.trash(path, system);
  }

  trash(path: string, system = true): Promise<void> {
    return this.host.trash(path, system);
  }

  restoreFromHistory(path: string, content: string): Promise<void> {
    return this.host.restoreFromHistory(path, content);
  }

  applyTemplate(templatePath: string, targetPath: string): Promise<void> {
    return this.templates.applyTemplate(templatePath, targetPath);
  }

  compose(sourcePaths: string[], destPath: string): Promise<void> {
    return this.templates.compose(sourcePaths, destPath);
  }

  uniqueNote(folder: string, body = ""): Promise<string> {
    return this.templates.uniqueNote(folder, body);
  }
}
