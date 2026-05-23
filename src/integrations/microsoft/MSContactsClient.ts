// SPEC §23 — Microsoft Graph Contacts.
import { GraphContact, GraphSubClientOpts, graphGet } from "./types";

export class MSContactsClient {
  constructor(public opts: GraphSubClientOpts) {}

  async listContacts(
    params: { top?: number; skip?: number } = {},
  ): Promise<GraphContact[]> {
    const r = await graphGet<{ value?: GraphContact[] }>(
      this.opts,
      "/me/contacts",
      {
        $top: params.top ?? 100,
        $skip: params.skip,
        $select:
          "id,displayName,givenName,surname,emailAddresses,businessPhones,mobilePhone,companyName,jobTitle",
      },
    );
    return r.value ?? [];
  }
}
