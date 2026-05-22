// SPEC §22.1 — Google People (Contacts) v1 client.
import { GContact, GoogleSubClientOpts, googleGetJson } from "./types";

export class GContactsClient {
  constructor(public opts: GoogleSubClientOpts) {}

  async listConnections(params: { pageSize?: number; pageToken?: string; syncToken?: string } = {}): Promise<{ connections: GContact[]; nextPageToken?: string; nextSyncToken?: string }> {
    const personFields = "names,emailAddresses,phoneNumbers,organizations,urls";
    const r = await googleGetJson<{ connections?: GContact[]; nextPageToken?: string; nextSyncToken?: string }>(this.opts, "/people/v1/people/me/connections", {
      pageSize: params.pageSize ?? 200,
      pageToken: params.pageToken,
      syncToken: params.syncToken,
      personFields,
      requestSyncToken: true,
    });
    return { connections: r.connections ?? [], nextPageToken: r.nextPageToken, nextSyncToken: r.nextSyncToken };
  }

  async search(query: string, pageSize = 25): Promise<GContact[]> {
    const r = await googleGetJson<{ results?: { person: GContact }[] }>(this.opts, "/people/v1/people:searchContacts", {
      query, pageSize, readMask: "names,emailAddresses,phoneNumbers,organizations",
    });
    return (r.results ?? []).map((x) => x.person);
  }
}
