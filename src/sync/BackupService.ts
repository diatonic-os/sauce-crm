// SPEC §34 — Backup pipeline. Snapshots vault entities + adjacency to a dated JSON file.
// Encryption layer (SPEC §18.7 "Export Encrypted Backup") wires once KeyVault is unlocked;
// the v0 path writes plaintext into `_backups/` and emits an audit row.

import { App, TFile, normalizePath } from "obsidian";
import { EntityService } from "../services/EntityService";
import { QueryService } from "../services/QueryService";

export interface BackupReport {
  ts: number;
  path: string;
  entities: number;
  edges: number;
  bytes: number;
}

export class BackupService {
  constructor(
    public app: App,
    public entities: EntityService,
    public query: QueryService,
  ) {}

  async run(): Promise<BackupReport> {
    const ts = Date.now();
    const stamp = new Date(ts).toISOString().replace(/[:.]/g, "-");
    const folder = this.entities.paths.backups;
    if (!this.app.vault.getAbstractFileByPath(folder))
      await this.app.vault.createFolder(folder).catch(() => {
        /* ok */
      });
    const path = normalizePath(`${folder}/sauce-backup-${stamp}.json`);

    const people = this.entities.allPeople().map((e) => ({
      id: e.file.path,
      basename: e.file.basename,
      fm: e.frontmatter,
    }));
    const orgs = this.entities.allOrgs().map((e) => ({
      id: e.file.path,
      basename: e.file.basename,
      fm: e.frontmatter,
    }));
    const touches = this.entities.allTouches().map((e) => ({
      id: e.file.path,
      basename: e.file.basename,
      fm: e.frontmatter,
    }));
    const addenda = this.entities.allAddenda().map((e) => ({
      id: e.file.path,
      basename: e.file.basename,
      fm: e.frontmatter,
    }));
    const adjacency = this.query.collectAdjacency();

    const payload = {
      version: 1,
      generatedAt: stamp,
      people,
      orgs,
      touches,
      addenda,
      adjacency,
    };
    const content = JSON.stringify(payload, null, 2);
    const ex = this.app.vault.getAbstractFileByPath(path);
    if (ex && ex instanceof TFile) await this.app.vault.modify(ex, content);
    else await this.app.vault.create(path, content);

    return {
      ts,
      path,
      entities: people.length + orgs.length + touches.length + addenda.length,
      edges: adjacency.length,
      bytes: content.length,
    };
  }

  /** Garbage-collect old backups, keeping the most recent N. */
  async prune(keep = 14): Promise<number> {
    const bdir = this.entities.paths.backups;
    const folder = this.app.vault.getAbstractFileByPath(bdir);
    if (!folder) return 0;
    const files = this.app.vault
      .getMarkdownFiles()
      .concat(
        this.app.vault
          .getFiles()
          .filter(
            (f) => f.path.startsWith(bdir + "/") && f.path.endsWith(".json"),
          ),
      );
    const backups = files.filter(
      (f) =>
        f.path.startsWith(bdir + "/sauce-backup-") && f.path.endsWith(".json"),
    );
    backups.sort((a, b) => b.path.localeCompare(a.path));
    const removed: TFile[] = backups.slice(keep);
    for (const f of removed) await this.app.vault.delete(f);
    return removed.length;
  }
}
