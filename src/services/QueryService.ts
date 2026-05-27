import { App, TFile } from "obsidian";
import { DqlParser } from "../query/DqlParser";
import { DqlEvaluator, QueryRow } from "../query/DqlEvaluator";
import { runPath, AdjacencyRow } from "../query/PathQuery";
import { EntityService } from "./EntityService";
import { parseWikilink } from "../util/Wikilink";

export class QueryService {
  private parser = new DqlParser();
  private evaluator = new DqlEvaluator();

  constructor(
    public app: App,
    public entities: EntityService,
  ) {}

  runDql(src: string): { html?: HTMLElement; text?: string; error?: string } {
    let q;
    try {
      q = this.parser.parse(src);
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }

    if (q.shape === "PATH") {
      const nodes = this.collectNodeBasenames();
      const edges = this.collectAdjacency();
      const r = runPath(
        nodes,
        edges,
        q.pathFrom ?? "",
        q.pathTo ?? "",
        q.pathOver,
        q.pathObjective,
      );
      if (!r) return { text: `no path from ${q.pathFrom} to ${q.pathTo}` };
      return { text: r.nodes.join("  →  ") + `  (metric ${r.metric})` };
    }

    const rows: QueryRow[] = this.collectRows();
    const result = this.evaluator.evaluate(q, rows);
    return this.renderResult(result);
  }

  collectRows(): QueryRow[] {
    return this.app.vault.getMarkdownFiles().map((f: TFile) => ({
      file: f.basename,
      path: f.path,
      frontmatter: this.app.metadataCache.getFileCache(f)?.frontmatter ?? {},
    }));
  }

  collectNodeBasenames(): string[] {
    const out: string[] = [];
    for (const e of this.entities.allPeople()) out.push(e.file.basename);
    for (const e of this.entities.allOrgs()) out.push(e.file.basename);
    return out;
  }

  collectAdjacency(): AdjacencyRow[] {
    const out: AdjacencyRow[] = [];
    const edges = [
      "knows",
      "worked_with",
      "intro_candidates",
      "family_of",
      "intro_via",
      "parent",
    ];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) continue;
      const src = f.basename;
      const closeness = Number(fm.closeness ?? 3);
      const weight = 6 - closeness; // warmth: 5..1
      for (const edge of edges) {
        const v = fm[edge];
        const list = Array.isArray(v) ? v : v ? [v] : [];
        for (const link of list) {
          const dst = parseWikilink(String(link)) ?? String(link);
          out.push({ src, dst, edge, weight });
        }
      }
    }
    return out;
  }

  private renderResult(r: ReturnType<DqlEvaluator["evaluate"]>): {
    html: HTMLElement;
  } {
    const root = document.createElement("div");
    if (!r.rows || r.rows.length === 0) {
      root.createEl("em", { text: "no results" });
      return { html: root };
    }
    if (r.shape === "TABLE") {
      const table = root.createEl("table", { cls: "sauce-table" });
      const head = table.createEl("thead").createEl("tr");
      head.createEl("th", { text: "file" });
      for (const c of r.headers ?? []) head.createEl("th", { text: c });
      const tbody = table.createEl("tbody");
      for (const row of r.rows) {
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: row.file });
        for (const c of r.headers ?? [])
          tr.createEl("td", { text: fmt(row.frontmatter[c]) });
      }
    } else if (r.shape === "LIST") {
      const ul = root.createEl("ul");
      for (const row of r.rows) ul.createEl("li", { text: row.file });
    } else if (r.shape === "TASK") {
      const ul = root.createEl("ul");
      for (const row of r.rows) ul.createEl("li", { text: `□ ${row.file}` });
    }
    return { html: root };
  }
}

function fmt(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
