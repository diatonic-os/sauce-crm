// SPEC §22 — Shared types for Google Workspace sub-clients.
// Designed to be Obsidian-agnostic: every sub-client takes a `fetch` host
// (matching ProviderHost.fetch) and a `token()` async resolver.

export interface FetchHost {
  fetch(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

export interface TokenResolver { (): Promise<string>; }

export interface GoogleSubClientOpts {
  fetch: FetchHost;
  token: TokenResolver;
  proxyBase?: string;   // optional override (proxy mode per §18.4)
}

export interface CalendarEvent {
  id: string;
  iCalUID?: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string; organizer?: boolean }>;
  location?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ uri?: string; entryPointType?: string }> };
  status?: string;
  htmlLink?: string;
}

export interface GmailMessageMeta {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  payload?: { headers?: Array<{ name: string; value: string }> };
  internalDate?: string;
}

export interface GContact {
  resourceName: string;
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>;
  emailAddresses?: Array<{ value: string; type?: string }>;
  phoneNumbers?: Array<{ value: string; type?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
  urls?: Array<{ value: string; type?: string }>;
}

export interface GDriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
  owners?: Array<{ emailAddress?: string; displayName?: string }>;
}

export async function googleGetJson<T>(opts: GoogleSubClientOpts, path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const base = opts.proxyBase ?? "https://www.googleapis.com";
  const qs = params ? "?" + Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
  const url = `${base}${path}${qs}`;
  const tok = await opts.token();
  const r = await opts.fetch.fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" },
  });
  if (r.status < 200 || r.status >= 300) throw new Error(`google api ${r.status}: ${r.body.slice(0, 200)}`);
  return JSON.parse(r.body) as T;
}
