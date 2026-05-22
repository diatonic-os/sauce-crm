// SPEC §24 — Apple ecosystem types. CalDAV/CardDAV use HTTP + WebDAV verbs (PROPFIND, REPORT).

export interface FetchHost {
  fetch(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

export interface AppleAuth {
  appleId: string;
  appPassword: string;        // app-specific password
}

export interface DAVOpts {
  fetch: FetchHost;
  auth: () => Promise<AppleAuth>;
  caldavBase?: string;
  carddavBase?: string;
}

export function basicAuthHeader(auth: AppleAuth): string {
  // Electron renderer has btoa
  const enc = typeof btoa === "function" ? btoa : (s: string) => Buffer.from(s, "utf-8").toString("base64");
  return "Basic " + enc(`${auth.appleId}:${auth.appPassword}`);
}

/**
 * Tiny XML extractor — sufficient for CalDAV/CardDAV PROPFIND responses.
 * Returns text content of every element matching `tagName` (namespace-agnostic).
 * No external DOM parser; no dynamic RegExp from user input (search uses static probes).
 */
export function extractTagContents(xml: string, tagName: string): string[] {
  const out: string[] = [];
  const localName = tagName.includes(":") ? tagName.split(":")[1] : tagName;
  const open = `:${localName}>`;
  const openNoNs = `<${localName}>`;
  const closeNoNs = `</${localName}>`;
  let i = 0;
  while (i < xml.length) {
    let start = xml.indexOf(open, i);
    let openLen: number;
    let endTag: string;
    if (start === -1) {
      start = xml.indexOf(openNoNs, i);
      if (start === -1) break;
      openLen = openNoNs.length;
      endTag = closeNoNs;
    } else {
      // back up to the `<`
      const lt = xml.lastIndexOf("<", start);
      if (lt === -1) { i = start + 1; continue; }
      const gt = xml.indexOf(">", start);
      if (gt === -1) break;
      openLen = gt - lt + 1;
      start = lt;
      // closing tag has same prefix
      const prefix = xml.slice(lt + 1, lt + (gt - lt));
      const colon = prefix.indexOf(":");
      const ns = colon >= 0 ? prefix.slice(0, colon) : "";
      endTag = ns ? `</${ns}:${localName}>` : `</${localName}>`;
    }
    const contentStart = start + openLen;
    const end = xml.indexOf(endTag, contentStart);
    if (end === -1) break;
    out.push(xml.slice(contentStart, end));
    i = end + endTag.length;
  }
  return out;
}
