// SPEC §22.1 — Google Calendar v3 client (pull + per-event detail).
import { CalendarEvent, GoogleSubClientOpts, googleGetJson } from "./types";

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
}

export class GCalendarClient {
  constructor(public opts: GoogleSubClientOpts) {}

  async listCalendars(): Promise<CalendarListEntry[]> {
    const r = await googleGetJson<{ items?: CalendarListEntry[] }>(
      this.opts,
      "/calendar/v3/users/me/calendarList",
      { maxResults: 250 },
    );
    return r.items ?? [];
  }

  /** Pull events from `calendarId` updated after `syncToken` (or in [timeMin, timeMax] window). */
  async listEvents(
    calendarId: string,
    params: {
      syncToken?: string;
      timeMin?: string;
      timeMax?: string;
      pageToken?: string;
      maxResults?: number;
    },
  ): Promise<{
    events: CalendarEvent[];
    nextSyncToken?: string;
    nextPageToken?: string;
  }> {
    const r = await googleGetJson<{
      items?: CalendarEvent[];
      nextSyncToken?: string;
      nextPageToken?: string;
    }>(
      this.opts,
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        syncToken: params.syncToken,
        timeMin: params.timeMin,
        timeMax: params.timeMax,
        pageToken: params.pageToken,
        maxResults: params.maxResults ?? 250,
        singleEvents: true,
        orderBy: params.syncToken ? undefined : "startTime",
      },
    );
    return {
      events: r.items ?? [],
      nextSyncToken: r.nextSyncToken,
      nextPageToken: r.nextPageToken,
    };
  }

  async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
    return googleGetJson<CalendarEvent>(
      this.opts,
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
  }
}
