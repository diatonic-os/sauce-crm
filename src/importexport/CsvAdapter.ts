// SPEC §33 — CSV import/export. RFC-4180-ish parser; quotes + escaped quotes.
import type {
  IImportAdapter,
  IExportAdapter,
  ImportedEntity,
} from "./IAdapter";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (c === "\r") {
        /* skip */
      } else cur += c;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function quote(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export class CsvImportAdapter implements IImportAdapter {
  readonly id = "csv";
  readonly label = "CSV";
  async detect(content: string | ArrayBuffer): Promise<boolean> {
    const s =
      typeof content === "string" ? content : new TextDecoder().decode(content);
    const firstLine = s.split("\n")[0]!; // split always produces ≥1 element
    return s.includes(",") && firstLine.split(",").length > 1;
  }
  async parse(
    content: string | ArrayBuffer,
    mapping: Record<string, string> = {},
  ): Promise<ImportedEntity[]> {
    const s =
      typeof content === "string" ? content : new TextDecoder().decode(content);
    const rows = parseCsv(s);
    if (rows.length === 0) return [];
    const header = rows[0]!; // rows.length > 0 confirmed above
    const out: ImportedEntity[] = [];
    for (let i = 1; i < rows.length; i++) {
      const fm: Record<string, unknown> = {};
      let type: "person" | "org" | "touch" = "person";
      for (let j = 0; j < header.length; j++) {
        const src = header[j]!; // j < header.length — bounds-checked
        const tgt = mapping[src] ?? src;
        const cellValue = rows[i]?.[j]; // row may be shorter than header — genuinely optional
        if (tgt === "__type__") {
          type = (cellValue as "person" | "org" | "touch") ?? "person";
          continue;
        }
        fm[tgt] = cellValue;
      }
      out.push({ type, frontmatter: fm, sourceRow: i + 1 });
    }
    return out;
  }
}

export class CsvExportAdapter implements IExportAdapter {
  readonly id = "csv";
  readonly label = "CSV";
  async serialize(entities: ImportedEntity[]): Promise<string> {
    const keys = new Set<string>(["__type__"]);
    for (const e of entities)
      for (const k of Object.keys(e.frontmatter)) keys.add(k);
    const header = [...keys];
    const lines: string[] = [header.map(quote).join(",")];
    for (const e of entities) {
      const row = header.map((k) =>
        k === "__type__" ? e.type : String(e.frontmatter[k] ?? ""),
      );
      lines.push(row.map(quote).join(","));
    }
    return lines.join("\n");
  }
}
