// SPEC §33.1 — Adapter interface.
export interface ImportPreview {
  newPersons: number;
  newOrgs: number;
  newTouches: number;
  duplicates: number;
  warnings: string[];
}

export interface ImportedEntity {
  type: "person" | "org" | "touch";
  frontmatter: Record<string, unknown>;
  body?: string;
  sourceRow?: number;
}

export interface IImportAdapter {
  readonly id: string;
  readonly label: string;
  detect(content: string | ArrayBuffer): Promise<boolean>;
  parse(
    content: string | ArrayBuffer,
    mapping?: Record<string, string>,
  ): Promise<ImportedEntity[]>;
}

export interface IExportAdapter {
  readonly id: string;
  readonly label: string;
  serialize(entities: ImportedEntity[]): Promise<string | ArrayBuffer>;
}
