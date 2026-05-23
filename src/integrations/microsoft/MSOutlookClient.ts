// SPEC §23 — Microsoft Graph Mail (Outlook) client.
import { GraphMessage, GraphSubClientOpts, graphGet } from "./types";

export class MSOutlookClient {
  constructor(public opts: GraphSubClientOpts) {}

  async listMessages(
    params: { filter?: string; top?: number; orderBy?: string } = {},
  ): Promise<GraphMessage[]> {
    const r = await graphGet<{ value?: GraphMessage[] }>(
      this.opts,
      "/me/messages",
      {
        $top: params.top ?? 50,
        $filter: params.filter,
        $orderby: params.orderBy ?? "receivedDateTime desc",
        $select:
          "id,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,conversationId",
      },
    );
    return r.value ?? [];
  }

  async getMessage(
    id: string,
  ): Promise<
    GraphMessage & { body?: { contentType?: string; content?: string } }
  > {
    return graphGet(this.opts, `/me/messages/${encodeURIComponent(id)}`);
  }
}
