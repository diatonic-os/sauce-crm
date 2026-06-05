// SPEC §23 — Microsoft Graph Calendar client.
import { GraphEvent, GraphSubClientOpts, graphGet } from "./types";

export class MSCalendarClient {
  constructor(public opts: GraphSubClientOpts) {}

  async listEvents(params: {
    startDateTime: string;
    endDateTime: string;
    top?: number;
    skipToken?: string;
  }): Promise<{ events: GraphEvent[]; nextLink?: string }> {
    const path = "/me/calendarView";
    const r = await graphGet<{
      value?: GraphEvent[];
      "@odata.nextLink"?: string;
    }>(this.opts, path, {
      startDateTime: params.startDateTime,
      endDateTime: params.endDateTime,
      $top: params.top ?? 100,
      $orderby: "start/dateTime",
    });
    return {
      events: r.value ?? [],
      ...(r["@odata.nextLink"] !== undefined
        ? { nextLink: r["@odata.nextLink"] }
        : {}),
    };
  }

  async getEvent(id: string): Promise<GraphEvent> {
    return graphGet<GraphEvent>(
      this.opts,
      `/me/events/${encodeURIComponent(id)}`,
    );
  }
}
