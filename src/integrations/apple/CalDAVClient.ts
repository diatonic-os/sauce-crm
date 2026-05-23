// SPEC §24 — iCloud CalDAV client. Discovers principal → calendar-home → calendars → events.
import { DAVOpts, basicAuthHeader, extractTagContents } from "./types";

export interface ICalEventSummary {
  href: string;
  uid: string;
  summary?: string;
  start?: string; // raw ICS DTSTART
  end?: string;
  attendees: string[];
  etag?: string;
}

export class CalDAVClient {
  constructor(public opts: DAVOpts) {}

  private base(): string {
    return this.opts.caldavBase ?? "https://caldav.icloud.com";
  }

  private async request(
    url: string,
    method: string,
    body?: string,
    depth = "1",
    extra: Record<string, string> = {},
  ): Promise<{ status: number; body: string }> {
    const auth = await this.opts.auth();
    const r = await this.opts.fetch.fetch(url, {
      method,
      headers: {
        Authorization: basicAuthHeader(auth),
        Depth: depth,
        "Content-Type": "application/xml; charset=utf-8",
        ...extra,
      },
      body,
    });
    return { status: r.status, body: r.body };
  }

  /** Discover the principal URL via PROPFIND on /.well-known/caldav. */
  async discoverPrincipal(): Promise<string | null> {
    const xml = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
    const r = await this.request(
      `${this.base()}/.well-known/caldav`,
      "PROPFIND",
      xml,
      "0",
    );
    if (r.status >= 400) return null;
    const hrefs = extractTagContents(r.body, "href");
    return hrefs[0] ?? null;
  }

  /** List calendar collections under the principal's calendar-home-set. */
  async listCalendars(principalUrl: string): Promise<string[]> {
    const xml = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
    const r = await this.request(
      absolute(this.base(), principalUrl),
      "PROPFIND",
      xml,
      "0",
    );
    if (r.status >= 400) return [];
    const hrefs = extractTagContents(r.body, "href");
    return hrefs.filter((h) => h.includes("/calendars/"));
  }

  /** REPORT calendar-query to fetch VEVENTs in a time range. */
  async listEvents(
    calendarUrl: string,
    startUtc: string,
    endUtc: string,
  ): Promise<ICalEventSummary[]> {
    const xml =
      `<?xml version="1.0"?>` +
      `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">` +
      `<d:prop><d:getetag/><c:calendar-data/></d:prop>` +
      `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
      `<c:time-range start="${toIcsTimestamp(startUtc)}" end="${toIcsTimestamp(endUtc)}"/>` +
      `</c:comp-filter></c:comp-filter></c:filter>` +
      `</c:calendar-query>`;
    const r = await this.request(
      absolute(this.base(), calendarUrl),
      "REPORT",
      xml,
      "1",
    );
    if (r.status >= 400) return [];
    return parseEventResponses(r.body);
  }
}

function absolute(base: string, p: string): string {
  if (p.startsWith("http")) return p;
  const slash = p.startsWith("/") ? "" : "/";
  return `${base.replace(/\/$/, "")}${slash}${p}`;
}

function toIcsTimestamp(iso: string): string {
  // 2026-05-21T12:34:56Z → 20260521T123456Z
  return iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
}

function parseEventResponses(xml: string): ICalEventSummary[] {
  const out: ICalEventSummary[] = [];
  // Each <response> has <href>, <getetag>, <calendar-data>
  const responses = extractTagContents(xml, "response");
  for (const resp of responses) {
    const href = extractTagContents(resp, "href")[0] ?? "";
    const etag = extractTagContents(resp, "getetag")[0];
    const ics = extractTagContents(resp, "calendar-data")[0] ?? "";
    if (!ics) continue;
    out.push(parseVevent(ics, href, etag));
  }
  return out;
}

function parseVevent(
  ics: string,
  href: string,
  etag?: string,
): ICalEventSummary {
  const lines = ics.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  let uid = "",
    summary: string | undefined,
    start: string | undefined,
    end: string | undefined;
  const attendees: string[] = [];
  for (const raw of lines) {
    const sep = raw.indexOf(":");
    if (sep === -1) continue;
    const key = raw.slice(0, sep);
    const val = raw.slice(sep + 1);
    const kup = key.toUpperCase();
    if (kup === "UID") uid = val;
    else if (kup === "SUMMARY") summary = val;
    else if (kup.startsWith("DTSTART")) start = val;
    else if (kup.startsWith("DTEND")) end = val;
    else if (kup.startsWith("ATTENDEE")) {
      const mailto = val.toLowerCase().startsWith("mailto:")
        ? val.slice(7)
        : val;
      attendees.push(mailto);
    }
  }
  return { href, uid, summary, start, end, attendees, etag };
}
