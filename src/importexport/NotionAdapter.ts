// SPEC §33 — Notion DB import/export. Configured per database (§25.3).
import type {
  IImportAdapter,
  IExportAdapter,
  ImportedEntity,
} from "./IAdapter";

export interface NotionPage {
  id: string;
  properties: Record<string, unknown>;
}

export class NotionImportAdapter implements IImportAdapter {
  readonly id = "notion";
  readonly label = "Notion";
  constructor(
    private readonly mappingForDb: (
      dbId: string,
    ) => Promise<Record<string, string> | null>,
  ) {}
  async detect(content: string | ArrayBuffer): Promise<boolean> {
    try {
      const j = JSON.parse(
        typeof content === "string"
          ? content
          : new TextDecoder().decode(content),
      ) as { object?: string };
      return j.object === "database" || j.object === "list";
    } catch {
      return false;
    }
  }
  async parse(content: string | ArrayBuffer): Promise<ImportedEntity[]> {
    const j = JSON.parse(
      typeof content === "string" ? content : new TextDecoder().decode(content),
    ) as { database_id?: string; results: NotionPage[] };
    const mapping = j.database_id
      ? await this.mappingForDb(j.database_id)
      : null;
    return j.results.map((p) => {
      const fm: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p.properties)) {
        const target = mapping?.[k] ?? k;
        fm[target] = v;
      }
      fm.notion_id = p.id;
      return { type: "person", frontmatter: fm };
    });
  }
}

export class NotionExportAdapter implements IExportAdapter {
  readonly id = "notion";
  readonly label = "Notion";
  async serialize(entities: ImportedEntity[]): Promise<string> {
    return JSON.stringify(
      {
        object: "list",
        results: entities.map((e) => ({
          object: "page",
          properties: e.frontmatter,
        })),
      },
      null,
      2,
    );
  }
}
