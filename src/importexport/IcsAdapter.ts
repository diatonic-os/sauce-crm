// SPEC §33 — iCalendar (RFC 5545) — Touch entities.
import type {
  IImportAdapter,
  IExportAdapter,
  ImportedEntity,
} from "./IAdapter";

/** Extended entity type for ICS export — includes vault entity types beyond
 *  the import-only "person|org|touch" set. Callers pass vault entities directly
 *  (type:task, followup, event) so the serializer can emit VEVENTs for them. */
interface ExportEntity {
  type: string;
  frontmatter: Record<string, unknown>;
}

function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]/g, "");
}

export class IcsImportAdapter implements IImportAdapter {
  readonly id = "ics";
  readonly label = "iCalendar";
  async detect(content: string | ArrayBuffer): Promise<boolean> {
    const s =
      typeof content === "string" ? content : new TextDecoder().decode(content);
    return s.includes("BEGIN:VCALENDAR");
  }
  async parse(content: string | ArrayBuffer): Promise<ImportedEntity[]> {
    const s = unfold(
      typeof content === "string" ? content : new TextDecoder().decode(content),
    );
    const events = s.split(/BEGIN:VEVENT/).slice(1);
    const out: ImportedEntity[] = [];
    for (const ev of events) {
      const fm: Record<string, unknown> = { channel: "meeting" };
      const attendees: string[] = [];
      for (const line of ev.split(/\r?\n/)) {
        if (/^END:VEVENT/.test(line)) break;
        const colonParts = line.split(":");
        const k = colonParts[0]; // split always produces ≥1 element
        const rest = colonParts.slice(1);
        if (!k || rest.length === 0) continue;
        const v = rest.join(":");
        const tag = k.split(";")[0]!.toUpperCase(); // split always produces ≥1 element
        if (tag === "SUMMARY") fm.summary = v;
        else if (tag === "DTSTART") fm.date = v;
        else if (tag === "UID") fm.id = v;
        else if (tag === "DESCRIPTION") fm.body = v;
        else if (tag === "ATTENDEE") {
          const m = /mailto:([^\s>]+)/i.exec(v);
          const mAddr = m?.[1];
          if (m && mAddr) attendees.push(mAddr);
        }
      }
      if (attendees.length) fm.attendees = attendees;
      out.push({ type: "touch", frontmatter: fm });
    }
    return out;
  }
}

export class IcsExportAdapter implements IExportAdapter {
  readonly id = "ics";
  readonly label = "iCalendar";
  async serialize(entities: ImportedEntity[]): Promise<string> {
    const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//sauce-graph//EN"];
    for (const e of entities as ExportEntity[]) {
      if (e.type === "touch") {
        out.push("BEGIN:VEVENT");
        if (e.frontmatter.id) out.push(`UID:${e.frontmatter.id}`);
        if (e.frontmatter.summary) out.push(`SUMMARY:${e.frontmatter.summary}`);
        if (e.frontmatter.date)
          out.push(`DTSTART:${String(e.frontmatter.date).slice(0, 10)}`);
        out.push("END:VEVENT");
      } else if (e.type === "task") {
        out.push("BEGIN:VEVENT");
        const uid = e.frontmatter.id ?? `sauce-task-${Date.now()}`;
        out.push(`UID:${uid}`);
        const title =
          e.frontmatter.title ?? e.frontmatter.summary ?? "Untitled task";
        out.push(`SUMMARY:${title}`);
        if (e.frontmatter.due) {
          out.push(`DTSTART:${String(e.frontmatter.due).slice(0, 10)}`);
        }
        out.push("END:VEVENT");
      } else if (e.type === "followup") {
        out.push("BEGIN:VEVENT");
        const uid = e.frontmatter.id ?? `sauce-followup-${Date.now()}`;
        out.push(`UID:${uid}`);
        const title =
          e.frontmatter.title ?? e.frontmatter.summary ?? "Untitled followup";
        out.push(`SUMMARY:${title}`);
        const dtDate = e.frontmatter.due ?? e.frontmatter.trigger;
        if (dtDate) {
          out.push(`DTSTART:${String(dtDate).slice(0, 10)}`);
        }
        out.push("END:VEVENT");
      } else if (e.type === "event") {
        out.push("BEGIN:VEVENT");
        const uid = e.frontmatter.id ?? `sauce-event-${Date.now()}`;
        out.push(`UID:${uid}`);
        const title =
          e.frontmatter.title ?? e.frontmatter.summary ?? "Untitled event";
        out.push(`SUMMARY:${title}`);
        if (e.frontmatter.date) {
          out.push(`DTSTART:${String(e.frontmatter.date).slice(0, 10)}`);
        }
        out.push("END:VEVENT");
      }
    }
    out.push("END:VCALENDAR");
    return out.join("\r\n");
  }
}
