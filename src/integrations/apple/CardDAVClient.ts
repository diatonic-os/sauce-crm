// SPEC §24 — iCloud CardDAV (Contacts) client.
import { DAVOpts, basicAuthHeader, extractTagContents } from "./types";

export interface VCardSummary {
  href: string;
  uid: string;
  fullName?: string;
  emails: string[];
  phones: string[];
  org?: string;
  title?: string;
  etag?: string;
}

export class CardDAVClient {
  constructor(public opts: DAVOpts) {}

  private base(): string {
    return this.opts.carddavBase ?? "https://contacts.icloud.com";
  }

  private async request(
    url: string,
    method: string,
    body?: string,
    depth = "1",
  ): Promise<{ status: number; body: string }> {
    const auth = await this.opts.auth();
    const r = await this.opts.fetch.fetch(url, {
      method,
      headers: {
        Authorization: basicAuthHeader(auth),
        Depth: depth,
        "Content-Type": "application/xml; charset=utf-8",
      },
      ...(body !== undefined ? { body } : {}),
    });
    return { status: r.status, body: r.body };
  }

  async discoverPrincipal(): Promise<string | null> {
    const xml = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
    const r = await this.request(
      `${this.base()}/.well-known/carddav`,
      "PROPFIND",
      xml,
      "0",
    );
    if (r.status >= 400) return null;
    return extractTagContents(r.body, "href")[0] ?? null;
  }

  async listAddressBooks(principalUrl: string): Promise<string[]> {
    const xml = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><card:addressbook-home-set/></d:prop></d:propfind>`;
    const r = await this.request(
      abs(this.base(), principalUrl),
      "PROPFIND",
      xml,
      "0",
    );
    if (r.status >= 400) return [];
    return extractTagContents(r.body, "href").filter((h) =>
      h.includes("/cards/"),
    );
  }

  async listContacts(addressBookUrl: string): Promise<VCardSummary[]> {
    const xml =
      `<?xml version="1.0"?>` +
      `<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">` +
      `<d:prop><d:getetag/><card:address-data/></d:prop>` +
      `<card:filter><card:prop-filter name="FN"/></card:filter>` +
      `</card:addressbook-query>`;
    const r = await this.request(
      abs(this.base(), addressBookUrl),
      "REPORT",
      xml,
      "1",
    );
    if (r.status >= 400) return [];
    const out: VCardSummary[] = [];
    for (const resp of extractTagContents(r.body, "response")) {
      const href = extractTagContents(resp, "href")[0] ?? "";
      const etag = extractTagContents(resp, "getetag")[0];
      const card = extractTagContents(resp, "address-data")[0] ?? "";
      if (!card) continue;
      out.push(parseVCard(card, href, etag));
    }
    return out;
  }
}

function abs(base: string, p: string): string {
  if (p.startsWith("http")) return p;
  return `${base.replace(/\/$/, "")}${p.startsWith("/") ? "" : "/"}${p}`;
}

function parseVCard(vcf: string, href: string, etag?: string): VCardSummary {
  const lines = vcf.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  let uid = "",
    fullName: string | undefined,
    org: string | undefined,
    title: string | undefined;
  const emails: string[] = [];
  const phones: string[] = [];
  for (const raw of lines) {
    const sep = raw.indexOf(":");
    if (sep === -1) continue;
    const key = raw.slice(0, sep).toUpperCase();
    const val = raw.slice(sep + 1);
    if (key === "UID") uid = val;
    else if (key === "FN") fullName = val;
    else if (key.startsWith("EMAIL")) emails.push(val);
    else if (key.startsWith("TEL")) phones.push(val);
    else if (key === "ORG") org = val.split(";")[0];
    else if (key === "TITLE") title = val;
  }
  return {
    href,
    uid,
    ...(fullName !== undefined ? { fullName } : {}),
    emails,
    phones,
    ...(org !== undefined ? { org } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(etag !== undefined ? { etag } : {}),
  };
}
