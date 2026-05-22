// SPEC §33 — iCalendar (RFC 5545) — Touch entities.
import type { IImportAdapter, IExportAdapter, ImportedEntity } from './IAdapter';

function unfold(text: string): string { return text.replace(/\r?\n[ \t]/g, ''); }

export class IcsImportAdapter implements IImportAdapter {
  readonly id = 'ics';
  readonly label = 'iCalendar';
  async detect(content: string | ArrayBuffer): Promise<boolean> {
    const s = typeof content === 'string' ? content : new TextDecoder().decode(content);
    return s.includes('BEGIN:VCALENDAR');
  }
  async parse(content: string | ArrayBuffer): Promise<ImportedEntity[]> {
    const s = unfold(typeof content === 'string' ? content : new TextDecoder().decode(content));
    const events = s.split(/BEGIN:VEVENT/).slice(1);
    const out: ImportedEntity[] = [];
    for (const ev of events) {
      const fm: Record<string, unknown> = { channel: 'meeting' };
      const attendees: string[] = [];
      for (const line of ev.split(/\r?\n/)) {
        if (/^END:VEVENT/.test(line)) break;
        const [k, ...rest] = line.split(':');
        if (!k || rest.length === 0) continue;
        const v = rest.join(':');
        const tag = k.split(';')[0].toUpperCase();
        if (tag === 'SUMMARY') fm.summary = v;
        else if (tag === 'DTSTART') fm.date = v;
        else if (tag === 'UID') fm.id = v;
        else if (tag === 'DESCRIPTION') fm.body = v;
        else if (tag === 'ATTENDEE') {
          const m = /mailto:([^\s>]+)/i.exec(v);
          if (m) attendees.push(m[1]);
        }
      }
      if (attendees.length) fm.attendees = attendees;
      out.push({ type: 'touch', frontmatter: fm });
    }
    return out;
  }
}

export class IcsExportAdapter implements IExportAdapter {
  readonly id = 'ics';
  readonly label = 'iCalendar';
  async serialize(entities: ImportedEntity[]): Promise<string> {
    const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//sauce-graph//EN'];
    for (const e of entities.filter((x) => x.type === 'touch')) {
      out.push('BEGIN:VEVENT');
      if (e.frontmatter.id) out.push(`UID:${e.frontmatter.id}`);
      if (e.frontmatter.summary) out.push(`SUMMARY:${e.frontmatter.summary}`);
      if (e.frontmatter.date) out.push(`DTSTART:${e.frontmatter.date}`);
      out.push('END:VEVENT');
    }
    out.push('END:VCALENDAR');
    return out.join('\r\n');
  }
}
