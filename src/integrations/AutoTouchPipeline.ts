// SPEC §29 — Automated touch capture. Provider-agnostic: takes a normalized
// CalendarEventSummary and returns a TouchDraft. Wiring of calendar pollers
// → pipeline lives in main.ts (P15 finalization).

export interface CalendarEventSummary {
  id: string;
  source: "google" | "microsoft" | "apple" | "manual";
  startIso: string;       // ISO 8601 — UTC normalized
  endIso: string;
  subject?: string;
  description?: string;
  organizerEmail?: string;
  attendees: { email: string; displayName?: string; responseStatus?: string }[];
  location?: string;
  meetingUrl?: string;
  webLink?: string;
}

export interface TouchDraft {
  date: string;              // YYYY-MM-DD
  channel: "in-person" | "call" | "dinner" | "email" | "event";
  contactEmails: string[];   // attendees minus organizer/self
  contactBasenameHints: string[];
  subject?: string;
  meetingUrl?: string;
  webLink?: string;
  notes: string;             // pre-filled body
  source: string;            // "google:cal/<id>", etc.
  followups: string[];
}

export interface AutoTouchOpts {
  selfEmails?: string[];     // user's own emails — exclude from attendees
  minDurationMin?: number;   // ignore < 5 min "events"
  inferChannel?: boolean;
}

export class AutoTouchPipeline {
  constructor(public opts: AutoTouchOpts = {}) {}

  /** Returns a draft only for events that meet capture criteria. */
  draft(ev: CalendarEventSummary): TouchDraft | null {
    const dur = (Date.parse(ev.endIso) - Date.parse(ev.startIso)) / 60_000;
    if (Number.isFinite(dur) && dur < (this.opts.minDurationMin ?? 5)) return null;
    if (!ev.endIso || Date.parse(ev.endIso) > Date.now()) return null;   // only past/ended events

    const self = new Set((this.opts.selfEmails ?? []).map((e) => e.toLowerCase()));
    const others = ev.attendees.filter((a) => !self.has(a.email.toLowerCase()) && a.email !== ev.organizerEmail);
    if (others.length === 0) return null;

    const channel = inferChannel(ev, this.opts.inferChannel ?? true);
    const contactEmails = others.map((a) => a.email);
    const contactBasenameHints = others.map((a) => a.displayName ?? a.email.split("@")[0]);

    const date = ev.startIso.slice(0, 10);
    const notes = [
      ev.subject ? `**${ev.subject}**` : "",
      ev.description ? "\n" + ev.description.trim() : "",
      ev.location ? `\nLocation: ${ev.location}` : "",
      ev.meetingUrl ? `\nMeeting: ${ev.meetingUrl}` : "",
    ].filter(Boolean).join("\n").trim();

    return {
      date,
      channel,
      contactEmails,
      contactBasenameHints,
      subject: ev.subject,
      meetingUrl: ev.meetingUrl,
      webLink: ev.webLink,
      notes,
      source: `${ev.source}:cal/${ev.id}`,
      followups: [],
    };
  }
}

function inferChannel(ev: CalendarEventSummary, on: boolean): TouchDraft["channel"] {
  if (!on) return "event";
  if (ev.meetingUrl) return "call";
  const loc = (ev.location ?? "").toLowerCase();
  if (loc.includes("zoom") || loc.includes("meet") || loc.includes("teams")) return "call";
  if (loc.includes("restaurant") || loc.includes("dinner") || /lunch|coffee/.test(ev.subject?.toLowerCase() ?? "")) return "dinner";
  if (loc) return "in-person";
  return "call";
}
