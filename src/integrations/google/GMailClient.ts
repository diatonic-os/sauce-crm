// SPEC §22.1 — Gmail v1 client.
import { GmailMessageMeta, GoogleSubClientOpts, googleGetJson } from "./types";

export class GMailClient {
  constructor(public opts: GoogleSubClientOpts) {}

  async listMessages(params: {
    q?: string;
    labelIds?: string[];
    maxResults?: number;
    pageToken?: string;
  }): Promise<{
    messages: { id: string; threadId: string }[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }> {
    const r = await googleGetJson<{
      messages?: { id: string; threadId: string }[];
      nextPageToken?: string;
      resultSizeEstimate?: number;
    }>(this.opts, "/gmail/v1/users/me/messages", {
      q: params.q,
      labelIds: params.labelIds?.join(","),
      maxResults: params.maxResults ?? 100,
      pageToken: params.pageToken,
    });
    return {
      messages: r.messages ?? [],
      ...(r.nextPageToken !== undefined ? { nextPageToken: r.nextPageToken } : {}),
      ...(r.resultSizeEstimate !== undefined ? { resultSizeEstimate: r.resultSizeEstimate } : {}),
    };
  }

  async getMessageMeta(id: string): Promise<GmailMessageMeta> {
    return googleGetJson<GmailMessageMeta>(
      this.opts,
      `/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
      {
        format: "metadata",
        metadataHeaders: "From,To,Cc,Subject,Date,Message-ID",
      },
    );
  }

  async getMessageFull(
    id: string,
  ): Promise<{
    id: string;
    threadId: string;
    snippet?: string;
    /** Gmail MIME message part tree — shape is recursive and API-version-dependent. */
    payload: unknown;
    internalDate?: string;
  }> {
    return googleGetJson(
      this.opts,
      `/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
      { format: "full" },
    );
  }

  async listLabels(): Promise<{ id: string; name: string }[]> {
    const r = await googleGetJson<{ labels?: { id: string; name: string }[] }>(
      this.opts,
      "/gmail/v1/users/me/labels",
    );
    return r.labels ?? [];
  }
}

export function headersMap(
  headers?: Array<{ name: string; value: string }>,
): Record<string, string> {
  const m: Record<string, string> = {};
  for (const h of headers ?? []) m[h.name.toLowerCase()] = h.value;
  return m;
}

export function parseAddressHeader(
  raw: string,
): { name: string; email: string }[] {
  if (!raw) return [];
  const out: { name: string; email: string }[] = [];
  const parts: string[] = [];
  let buf = "",
    inQ = false;
  for (const c of raw) {
    if (c === '"') inQ = !inQ;
    if (c === "," && !inQ) {
      parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) parts.push(buf.trim());
  for (const p of parts) {
    const lt = p.indexOf("<");
    const gt = p.indexOf(">");
    if (lt > -1 && gt > lt) {
      const name = p.slice(0, lt).trim().replace(/^"|"$/g, "");
      const email = p.slice(lt + 1, gt).trim();
      out.push({ name, email });
    } else if (p.includes("@")) {
      out.push({ name: "", email: p.trim() });
    }
  }
  return out;
}
