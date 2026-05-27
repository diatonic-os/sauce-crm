// SPEC §33 — vCard 4.0 (RFC 6350) — Person only.
import type {
  IImportAdapter,
  IExportAdapter,
  ImportedEntity,
} from "./IAdapter";

export class VcardImportAdapter implements IImportAdapter {
  readonly id = "vcard";
  readonly label = "vCard 4.0";
  async detect(content: string | ArrayBuffer): Promise<boolean> {
    const s =
      typeof content === "string" ? content : new TextDecoder().decode(content);
    return s.includes("BEGIN:VCARD");
  }
  async parse(content: string | ArrayBuffer): Promise<ImportedEntity[]> {
    const s =
      typeof content === "string" ? content : new TextDecoder().decode(content);
    const cards = s.split(/BEGIN:VCARD/i).slice(1);
    const out: ImportedEntity[] = [];
    for (const c of cards) {
      const fm: Record<string, unknown> = {};
      const emails: string[] = [];
      const phones: string[] = [];
      for (const rawLine of c.split(/\r?\n/)) {
        const line = rawLine.replace(/\s+$/, "");
        if (/^END:VCARD/i.test(line)) break;
        if (!line) continue;
        const colonParts = line.split(":");
        const keyAndParams = colonParts[0]; // split always produces ≥1 element
        const rest = colonParts.slice(1);
        if (!keyAndParams || rest.length === 0) continue;
        const value = rest.join(":");
        const key = keyAndParams.split(";")[0]!.toUpperCase(); // split always produces ≥1 element
        if (key === "FN") fm.name = value;
        else if (key === "N") fm.fullName = value;
        else if (key === "EMAIL") emails.push(value);
        else if (key === "TEL") phones.push(value);
        else if (key === "ORG") fm.company = value;
        else if (key === "TITLE") fm.title = value;
        else if (key === "URL") fm.url = value;
      }
      if (emails.length) fm.emails = emails;
      if (phones.length) fm.phones = phones;
      out.push({ type: "person", frontmatter: fm });
    }
    return out;
  }
}

export class VcardExportAdapter implements IExportAdapter {
  readonly id = "vcard";
  readonly label = "vCard 4.0";
  async serialize(entities: ImportedEntity[]): Promise<string> {
    const out: string[] = [];
    for (const e of entities.filter((x) => x.type === "person")) {
      out.push("BEGIN:VCARD", "VERSION:4.0");
      const fm = e.frontmatter;
      if (fm.name) out.push(`FN:${fm.name}`);
      if (fm.company) out.push(`ORG:${fm.company}`);
      if (fm.title) out.push(`TITLE:${fm.title}`);
      for (const em of (fm.emails as string[] | undefined) ?? [])
        out.push(`EMAIL:${em}`);
      for (const ph of (fm.phones as string[] | undefined) ?? [])
        out.push(`TEL:${ph}`);
      out.push("END:VCARD");
    }
    return out.join("\n");
  }
}
