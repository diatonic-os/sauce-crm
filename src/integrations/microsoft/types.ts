// SPEC §23 — Microsoft Graph types + shared get helper.

export interface FetchHost {
  fetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}
export interface TokenResolver {
  (): Promise<string>;
}

export interface GraphSubClientOpts {
  fetch: FetchHost;
  token: TokenResolver;
  base?: string;
}

export interface GraphEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  start: { dateTime?: string; timeZone?: string };
  end: { dateTime?: string; timeZone?: string };
  attendees?: Array<{
    emailAddress: { address: string; name?: string };
    type?: string;
    status?: { response?: string };
  }>;
  organizer?: { emailAddress: { address: string; name?: string } };
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string };
  webLink?: string;
}

export interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  from?: { emailAddress: { address: string; name?: string } };
  toRecipients?: Array<{ emailAddress: { address: string; name?: string } }>;
  ccRecipients?: Array<{ emailAddress: { address: string; name?: string } }>;
  receivedDateTime?: string;
  conversationId?: string;
}

export interface GraphContact {
  id: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  emailAddresses?: Array<{ address: string; name?: string }>;
  businessPhones?: string[];
  mobilePhone?: string;
  companyName?: string;
  jobTitle?: string;
}

export async function graphGet<T>(
  opts: GraphSubClientOpts,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const base = opts.base ?? "https://graph.microsoft.com/v1.0";
  const qs = params
    ? "?" +
      Object.entries(params)
        .filter(([, v]) => v != null)
        .map(
          ([k, v]) =>
            `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
        )
        .join("&")
    : "";
  const url = `${base}${path}${qs}`;
  const tok = await opts.token();
  const r = await opts.fetch.fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" },
  });
  if (r.status < 200 || r.status >= 300)
    throw new Error(`graph api ${r.status}: ${r.body.slice(0, 200)}`);
  return JSON.parse(r.body) as T;
}
