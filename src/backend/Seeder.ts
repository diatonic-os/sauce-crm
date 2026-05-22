// SPEC §17.4 — Walks the vault on first run, populates entities/edges/tags/touches/addenda.
import type { ISqliteBackend } from './ISqliteBackend';
import { applyMigrations } from './Migrations';

export interface SeederHostFile {
  path: string;
  ctime: number;
  mtime: number;
  type: string;
  primaryType?: string;
  frontmatter: Record<string, unknown>;
  body: string;
  bodyHash: string;
  tags: string[];
  edges: { to: string; edgeType: string; directed: boolean }[];
  touch?: { id: string; contactId: string; date: string; channel?: string; playbook?: string; outcomeTags?: string[]; attendees?: string[]; source?: string; authorId?: string };
  addendum?: { id: string; targetId: string; date: string; kind: string; authorId: string; body: string; signature: string };
}

export interface SeederHost {
  walk(): AsyncIterable<SeederHostFile>;
}

export interface SeedReport {
  migrationsApplied: number;
  entities: number;
  edges: number;
  tags: number;
  touches: number;
  addenda: number;
  elapsedMs: number;
}

export class Seeder {
  constructor(private readonly db: ISqliteBackend, private readonly host: SeederHost) {}

  async run(): Promise<SeedReport> {
    const start = Date.now();
    const migrationsApplied = await applyMigrations(this.db);
    const report: SeedReport = { migrationsApplied, entities: 0, edges: 0, tags: 0, touches: 0, addenda: 0, elapsedMs: 0 };

    await this.db.transaction(async () => {
      for await (const f of this.host.walk()) {
        await this.db.exec(
          `INSERT OR REPLACE INTO entities (id,type,primary_type,frontmatter,body_md,body_hash,mtime,ctime) VALUES (?,?,?,?,?,?,?,?)`,
          [f.path, f.type, f.primaryType ?? null, JSON.stringify(f.frontmatter), f.body, f.bodyHash, f.mtime, f.ctime],
        );
        report.entities += 1;
        for (const t of f.tags) {
          await this.db.exec(`INSERT OR IGNORE INTO tags (entity_id, tag) VALUES (?,?)`, [f.path, t]);
          report.tags += 1;
        }
        for (const e of f.edges) {
          await this.db.exec(
            `INSERT OR REPLACE INTO edges (from_id,to_id,edge_type,directed,weight,source,ts) VALUES (?,?,?,?,?,?,?)`,
            [f.path, e.to, e.edgeType, e.directed ? 1 : 0, 1.0, 'manual', Date.now()],
          );
          report.edges += 1;
        }
        if (f.touch) {
          await this.db.exec(
            `INSERT OR REPLACE INTO touches (id,contact_id,date,channel,playbook,outcome_tags,attendees,source,author_id) VALUES (?,?,?,?,?,?,?,?,?)`,
            [f.touch.id, f.touch.contactId, f.touch.date, f.touch.channel ?? null, f.touch.playbook ?? null,
              JSON.stringify(f.touch.outcomeTags ?? []), JSON.stringify(f.touch.attendees ?? []),
              f.touch.source ?? null, f.touch.authorId ?? null],
          );
          report.touches += 1;
        }
        if (f.addendum) {
          await this.db.exec(
            `INSERT OR REPLACE INTO addenda (id,target_id,date,kind,author_id,body_md,signature) VALUES (?,?,?,?,?,?,?)`,
            [f.addendum.id, f.addendum.targetId, f.addendum.date, f.addendum.kind, f.addendum.authorId, f.addendum.body, f.addendum.signature],
          );
          report.addenda += 1;
        }
      }
    });

    report.elapsedMs = Date.now() - start;
    return report;
  }
}
