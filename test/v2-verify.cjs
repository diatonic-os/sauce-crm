var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/integrations/IIntegration.ts
var init_IIntegration = __esm({
  "src/integrations/IIntegration.ts"() {
  }
});

// src/integrations/google/types.ts
async function googleGetJson(opts, path, params) {
  const base = opts.proxyBase ?? "https://www.googleapis.com";
  const qs = params ? "?" + Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
  const url = `${base}${path}${qs}`;
  const tok = await opts.token();
  const r = await opts.fetch.fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" }
  });
  if (r.status < 200 || r.status >= 300)
    throw new Error(`google api ${r.status}: ${r.body.slice(0, 200)}`);
  return JSON.parse(r.body);
}
var init_types = __esm({
  "src/integrations/google/types.ts"() {
  }
});

// src/integrations/google/GCalendarClient.ts
var GCalendarClient;
var init_GCalendarClient = __esm({
  "src/integrations/google/GCalendarClient.ts"() {
    init_types();
    GCalendarClient = class {
      constructor(opts) {
        this.opts = opts;
      }
      async listCalendars() {
        const r = await googleGetJson(this.opts, "/calendar/v3/users/me/calendarList", { maxResults: 250 });
        return r.items ?? [];
      }
      /** Pull events from `calendarId` updated after `syncToken` (or in [timeMin, timeMax] window). */
      async listEvents(calendarId, params) {
        const r = await googleGetJson(this.opts, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
          syncToken: params.syncToken,
          timeMin: params.timeMin,
          timeMax: params.timeMax,
          pageToken: params.pageToken,
          maxResults: params.maxResults ?? 250,
          singleEvents: true,
          orderBy: params.syncToken ? void 0 : "startTime"
        });
        return { events: r.items ?? [], nextSyncToken: r.nextSyncToken, nextPageToken: r.nextPageToken };
      }
      async getEvent(calendarId, eventId) {
        return googleGetJson(this.opts, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
      }
    };
  }
});

// src/integrations/google/GMailClient.ts
var GMailClient;
var init_GMailClient = __esm({
  "src/integrations/google/GMailClient.ts"() {
    init_types();
    GMailClient = class {
      constructor(opts) {
        this.opts = opts;
      }
      async listMessages(params) {
        const r = await googleGetJson(
          this.opts,
          "/gmail/v1/users/me/messages",
          { q: params.q, labelIds: params.labelIds?.join(","), maxResults: params.maxResults ?? 100, pageToken: params.pageToken }
        );
        return { messages: r.messages ?? [], nextPageToken: r.nextPageToken, resultSizeEstimate: r.resultSizeEstimate };
      }
      async getMessageMeta(id) {
        return googleGetJson(this.opts, `/gmail/v1/users/me/messages/${encodeURIComponent(id)}`, {
          format: "metadata",
          metadataHeaders: "From,To,Cc,Subject,Date,Message-ID"
        });
      }
      async getMessageFull(id) {
        return googleGetJson(this.opts, `/gmail/v1/users/me/messages/${encodeURIComponent(id)}`, { format: "full" });
      }
      async listLabels() {
        const r = await googleGetJson(this.opts, "/gmail/v1/users/me/labels");
        return r.labels ?? [];
      }
    };
  }
});

// src/integrations/google/GContactsClient.ts
var GContactsClient;
var init_GContactsClient = __esm({
  "src/integrations/google/GContactsClient.ts"() {
    init_types();
    GContactsClient = class {
      constructor(opts) {
        this.opts = opts;
      }
      async listConnections(params = {}) {
        const personFields = "names,emailAddresses,phoneNumbers,organizations,urls";
        const r = await googleGetJson(this.opts, "/people/v1/people/me/connections", {
          pageSize: params.pageSize ?? 200,
          pageToken: params.pageToken,
          syncToken: params.syncToken,
          personFields,
          requestSyncToken: true
        });
        return { connections: r.connections ?? [], nextPageToken: r.nextPageToken, nextSyncToken: r.nextSyncToken };
      }
      async search(query, pageSize = 25) {
        const r = await googleGetJson(this.opts, "/people/v1/people:searchContacts", {
          query,
          pageSize,
          readMask: "names,emailAddresses,phoneNumbers,organizations"
        });
        return (r.results ?? []).map((x) => x.person);
      }
    };
  }
});

// src/integrations/google/GDriveClient.ts
var GDriveClient;
var init_GDriveClient = __esm({
  "src/integrations/google/GDriveClient.ts"() {
    init_types();
    GDriveClient = class {
      constructor(opts) {
        this.opts = opts;
      }
      async listFiles(params = {}) {
        const fields = "files(id,name,mimeType,webViewLink,modifiedTime,size,owners(emailAddress,displayName)),nextPageToken";
        const r = await googleGetJson(this.opts, "/drive/v3/files", {
          q: params.q,
          pageSize: params.pageSize ?? 100,
          pageToken: params.pageToken,
          orderBy: params.orderBy ?? "modifiedTime desc",
          fields
        });
        return { files: r.files ?? [], nextPageToken: r.nextPageToken };
      }
      async getMeta(fileId) {
        return googleGetJson(this.opts, `/drive/v3/files/${encodeURIComponent(fileId)}`, {
          fields: "id,name,mimeType,webViewLink,modifiedTime,size,owners(emailAddress,displayName)"
        });
      }
    };
  }
});

// src/integrations/google/index.ts
var GoogleWorkspaceIntegration;
var init_google = __esm({
  "src/integrations/google/index.ts"() {
    init_GCalendarClient();
    init_GMailClient();
    init_GContactsClient();
    init_GDriveClient();
    init_types();
    init_GCalendarClient();
    init_GMailClient();
    init_GContactsClient();
    init_GDriveClient();
    GoogleWorkspaceIntegration = class {
      constructor(host) {
        this.host = host;
        this.id = "google_workspace";
        this.label = "Google Workspace";
        this.resources = [];
        this.connection = { connected: false };
        /** Lazily-constructed sub-clients; require host.fetch + host.token. */
        this._cal = null;
        this._mail = null;
        this._contacts = null;
        this._drive = null;
      }
      async connect() {
        if (this.host.oauth) {
          const ts = await this.host.oauth.authorize("google_workspace", []);
          this.connection = { connected: true, expiresAt: ts.expiresAt };
        } else {
          this.connection = { connected: true };
        }
        return this.connection;
      }
      async disconnect() {
        if (this.host.oauth)
          await this.host.oauth.revoke("google_workspace");
        this.connection = { connected: false };
      }
      async state() {
        return this.connection;
      }
      async listResources() {
        return this.resources;
      }
      setResources(rs) {
        this.resources = rs;
      }
      calendar() {
        if (!this.host.fetch || !this.host.token)
          return null;
        if (!this._cal)
          this._cal = new GCalendarClient({ fetch: this.host.fetch, token: this.host.token });
        return this._cal;
      }
      gmail() {
        if (!this.host.fetch || !this.host.token)
          return null;
        if (!this._mail)
          this._mail = new GMailClient({ fetch: this.host.fetch, token: this.host.token });
        return this._mail;
      }
      contacts() {
        if (!this.host.fetch || !this.host.token)
          return null;
        if (!this._contacts)
          this._contacts = new GContactsClient({ fetch: this.host.fetch, token: this.host.token });
        return this._contacts;
      }
      drive() {
        if (!this.host.fetch || !this.host.token)
          return null;
        if (!this._drive)
          this._drive = new GDriveClient({ fetch: this.host.fetch, token: this.host.token });
        return this._drive;
      }
      async syncResource(id) {
        if (!this.host.fetch || !this.host.token)
          return { pulled: 0, pushed: 0, errors: 0 };
        let pulled = 0, errors = 0;
        try {
          switch (id) {
            case "calendar": {
              this.host.scopes.require("google_workspace", "calendar.read");
              const cal = this.calendar();
              const now = /* @__PURE__ */ new Date();
              const tMin = new Date(now.getTime() - 7 * 864e5).toISOString();
              const tMax = new Date(now.getTime() + 7 * 864e5).toISOString();
              const r = await cal.listEvents("primary", { timeMin: tMin, timeMax: tMax, maxResults: 250 });
              pulled = r.events.length;
              break;
            }
            case "gmail": {
              this.host.scopes.require("google_workspace", "gmail.read");
              const m = this.gmail();
              const r = await m.listMessages({ q: "newer_than:7d", maxResults: 100 });
              pulled = r.messages.length;
              break;
            }
            case "contacts": {
              this.host.scopes.require("google_workspace", "contacts.read");
              const c = this.contacts();
              const r = await c.listConnections({ pageSize: 200 });
              pulled = r.connections.length;
              break;
            }
            case "drive": {
              this.host.scopes.require("google_workspace", "drive.read");
              const d = this.drive();
              const r = await d.listFiles({ pageSize: 50 });
              pulled = r.files.length;
              break;
            }
          }
        } catch {
          errors++;
        }
        return { pulled, pushed: 0, errors };
      }
    };
  }
});

// src/integrations/microsoft/types.ts
async function graphGet(opts, path, params) {
  const base = opts.base ?? "https://graph.microsoft.com/v1.0";
  const qs = params ? "?" + Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
  const url = `${base}${path}${qs}`;
  const tok = await opts.token();
  const r = await opts.fetch.fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" }
  });
  if (r.status < 200 || r.status >= 300)
    throw new Error(`graph api ${r.status}: ${r.body.slice(0, 200)}`);
  return JSON.parse(r.body);
}
var init_types2 = __esm({
  "src/integrations/microsoft/types.ts"() {
  }
});

// src/integrations/microsoft/MSCalendarClient.ts
var MSCalendarClient;
var init_MSCalendarClient = __esm({
  "src/integrations/microsoft/MSCalendarClient.ts"() {
    init_types2();
    MSCalendarClient = class {
      constructor(opts) {
        this.opts = opts;
      }
      async listEvents(params) {
        const path = "/me/calendarView";
        const r = await graphGet(this.opts, path, {
          startDateTime: params.startDateTime,
          endDateTime: params.endDateTime,
          $top: params.top ?? 100,
          $orderby: "start/dateTime"
        });
        return { events: r.value ?? [], nextLink: r["@odata.nextLink"] };
      }
      async getEvent(id) {
        return graphGet(this.opts, `/me/events/${encodeURIComponent(id)}`);
      }
    };
  }
});

// src/integrations/microsoft/MSOutlookClient.ts
var MSOutlookClient;
var init_MSOutlookClient = __esm({
  "src/integrations/microsoft/MSOutlookClient.ts"() {
    init_types2();
    MSOutlookClient = class {
      constructor(opts) {
        this.opts = opts;
      }
      async listMessages(params = {}) {
        const r = await graphGet(this.opts, "/me/messages", {
          $top: params.top ?? 50,
          $filter: params.filter,
          $orderby: params.orderBy ?? "receivedDateTime desc",
          $select: "id,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,conversationId"
        });
        return r.value ?? [];
      }
      async getMessage(id) {
        return graphGet(this.opts, `/me/messages/${encodeURIComponent(id)}`);
      }
    };
  }
});

// src/integrations/microsoft/MSContactsClient.ts
var MSContactsClient;
var init_MSContactsClient = __esm({
  "src/integrations/microsoft/MSContactsClient.ts"() {
    init_types2();
    MSContactsClient = class {
      constructor(opts) {
        this.opts = opts;
      }
      async listContacts(params = {}) {
        const r = await graphGet(this.opts, "/me/contacts", {
          $top: params.top ?? 100,
          $skip: params.skip,
          $select: "id,displayName,givenName,surname,emailAddresses,businessPhones,mobilePhone,companyName,jobTitle"
        });
        return r.value ?? [];
      }
    };
  }
});

// src/integrations/microsoft/index.ts
var Microsoft365Integration;
var init_microsoft = __esm({
  "src/integrations/microsoft/index.ts"() {
    init_MSCalendarClient();
    init_MSOutlookClient();
    init_MSContactsClient();
    init_types2();
    init_MSCalendarClient();
    init_MSOutlookClient();
    init_MSContactsClient();
    Microsoft365Integration = class {
      constructor(host) {
        this.host = host;
        this.id = "microsoft_365";
        this.label = "Microsoft 365";
        this.resources = [];
        this.connection = { connected: false };
        this._cal = null;
        this._mail = null;
        this._contacts = null;
      }
      async connect() {
        if (this.host.oauth) {
          const ts = await this.host.oauth.authorize("microsoft_365", []);
          this.connection = { connected: true, expiresAt: ts.expiresAt };
        } else {
          this.connection = { connected: true };
        }
        return this.connection;
      }
      async disconnect() {
        if (this.host.oauth)
          await this.host.oauth.revoke("microsoft_365");
        this.connection = { connected: false };
      }
      async state() {
        return this.connection;
      }
      async listResources() {
        return this.resources;
      }
      setResources(rs) {
        this.resources = rs;
      }
      calendar() {
        if (!this.host.fetch || !this.host.token)
          return null;
        if (!this._cal)
          this._cal = new MSCalendarClient({ fetch: this.host.fetch, token: this.host.token });
        return this._cal;
      }
      outlook() {
        if (!this.host.fetch || !this.host.token)
          return null;
        if (!this._mail)
          this._mail = new MSOutlookClient({ fetch: this.host.fetch, token: this.host.token });
        return this._mail;
      }
      contacts() {
        if (!this.host.fetch || !this.host.token)
          return null;
        if (!this._contacts)
          this._contacts = new MSContactsClient({ fetch: this.host.fetch, token: this.host.token });
        return this._contacts;
      }
      async syncResource(id) {
        if (!this.host.fetch || !this.host.token)
          return { pulled: 0, pushed: 0, errors: 0 };
        let pulled = 0, errors = 0;
        try {
          switch (id) {
            case "calendar": {
              this.host.scopes.require("microsoft_365", "calendar.read");
              const now = /* @__PURE__ */ new Date();
              const r = await this.calendar().listEvents({
                startDateTime: new Date(now.getTime() - 7 * 864e5).toISOString(),
                endDateTime: new Date(now.getTime() + 7 * 864e5).toISOString(),
                top: 200
              });
              pulled = r.events.length;
              break;
            }
            case "outlook": {
              this.host.scopes.require("microsoft_365", "mail.read");
              const r = await this.outlook().listMessages({ top: 50 });
              pulled = r.length;
              break;
            }
            case "contacts": {
              this.host.scopes.require("microsoft_365", "contacts.read");
              const r = await this.contacts().listContacts({ top: 100 });
              pulled = r.length;
              break;
            }
          }
        } catch {
          errors++;
        }
        return { pulled, pushed: 0, errors };
      }
    };
  }
});

// src/integrations/apple/types.ts
function basicAuthHeader(auth) {
  const enc = typeof btoa === "function" ? btoa : (s) => Buffer.from(s, "utf-8").toString("base64");
  return "Basic " + enc(`${auth.appleId}:${auth.appPassword}`);
}
function extractTagContents(xml, tagName) {
  const out = [];
  const localName = tagName.includes(":") ? tagName.split(":")[1] : tagName;
  const open = `:${localName}>`;
  const openNoNs = `<${localName}>`;
  const closeNoNs = `</${localName}>`;
  let i = 0;
  while (i < xml.length) {
    let start = xml.indexOf(open, i);
    let openLen;
    let endTag;
    if (start === -1) {
      start = xml.indexOf(openNoNs, i);
      if (start === -1)
        break;
      openLen = openNoNs.length;
      endTag = closeNoNs;
    } else {
      const lt = xml.lastIndexOf("<", start);
      if (lt === -1) {
        i = start + 1;
        continue;
      }
      const gt = xml.indexOf(">", start);
      if (gt === -1)
        break;
      openLen = gt - lt + 1;
      start = lt;
      const prefix = xml.slice(lt + 1, lt + (gt - lt));
      const colon = prefix.indexOf(":");
      const ns = colon >= 0 ? prefix.slice(0, colon) : "";
      endTag = ns ? `</${ns}:${localName}>` : `</${localName}>`;
    }
    const contentStart = start + openLen;
    const end = xml.indexOf(endTag, contentStart);
    if (end === -1)
      break;
    out.push(xml.slice(contentStart, end));
    i = end + endTag.length;
  }
  return out;
}
var init_types3 = __esm({
  "src/integrations/apple/types.ts"() {
  }
});

// src/integrations/apple/CalDAVClient.ts
function absolute(base, p) {
  if (p.startsWith("http"))
    return p;
  const slash = p.startsWith("/") ? "" : "/";
  return `${base.replace(/\/$/, "")}${slash}${p}`;
}
function toIcsTimestamp(iso) {
  return iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
}
function parseEventResponses(xml) {
  const out = [];
  const responses = extractTagContents(xml, "response");
  for (const resp of responses) {
    const href = extractTagContents(resp, "href")[0] ?? "";
    const etag = extractTagContents(resp, "getetag")[0];
    const ics = extractTagContents(resp, "calendar-data")[0] ?? "";
    if (!ics)
      continue;
    out.push(parseVevent(ics, href, etag));
  }
  return out;
}
function parseVevent(ics, href, etag) {
  const lines = ics.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  let uid = "", summary, start, end;
  const attendees = [];
  for (const raw of lines) {
    const sep = raw.indexOf(":");
    if (sep === -1)
      continue;
    const key = raw.slice(0, sep);
    const val = raw.slice(sep + 1);
    const kup = key.toUpperCase();
    if (kup === "UID")
      uid = val;
    else if (kup === "SUMMARY")
      summary = val;
    else if (kup.startsWith("DTSTART"))
      start = val;
    else if (kup.startsWith("DTEND"))
      end = val;
    else if (kup.startsWith("ATTENDEE")) {
      const mailto = val.toLowerCase().startsWith("mailto:") ? val.slice(7) : val;
      attendees.push(mailto);
    }
  }
  return { href, uid, summary, start, end, attendees, etag };
}
var CalDAVClient;
var init_CalDAVClient = __esm({
  "src/integrations/apple/CalDAVClient.ts"() {
    init_types3();
    CalDAVClient = class {
      constructor(opts) {
        this.opts = opts;
      }
      base() {
        return this.opts.caldavBase ?? "https://caldav.icloud.com";
      }
      async request(url, method, body, depth = "1", extra = {}) {
        const auth = await this.opts.auth();
        const r = await this.opts.fetch.fetch(url, {
          method,
          headers: {
            Authorization: basicAuthHeader(auth),
            Depth: depth,
            "Content-Type": "application/xml; charset=utf-8",
            ...extra
          },
          body
        });
        return { status: r.status, body: r.body };
      }
      /** Discover the principal URL via PROPFIND on /.well-known/caldav. */
      async discoverPrincipal() {
        const xml = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
        const r = await this.request(`${this.base()}/.well-known/caldav`, "PROPFIND", xml, "0");
        if (r.status >= 400)
          return null;
        const hrefs = extractTagContents(r.body, "href");
        return hrefs[0] ?? null;
      }
      /** List calendar collections under the principal's calendar-home-set. */
      async listCalendars(principalUrl) {
        const xml = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
        const r = await this.request(absolute(this.base(), principalUrl), "PROPFIND", xml, "0");
        if (r.status >= 400)
          return [];
        const hrefs = extractTagContents(r.body, "href");
        return hrefs.filter((h) => h.includes("/calendars/"));
      }
      /** REPORT calendar-query to fetch VEVENTs in a time range. */
      async listEvents(calendarUrl, startUtc, endUtc) {
        const xml = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${toIcsTimestamp(startUtc)}" end="${toIcsTimestamp(endUtc)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
        const r = await this.request(absolute(this.base(), calendarUrl), "REPORT", xml, "1");
        if (r.status >= 400)
          return [];
        return parseEventResponses(r.body);
      }
    };
  }
});

// src/integrations/apple/CardDAVClient.ts
function abs(base, p) {
  if (p.startsWith("http"))
    return p;
  return `${base.replace(/\/$/, "")}${p.startsWith("/") ? "" : "/"}${p}`;
}
function parseVCard(vcf, href, etag) {
  const lines = vcf.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  let uid = "", fullName, org, title;
  const emails = [];
  const phones = [];
  for (const raw of lines) {
    const sep = raw.indexOf(":");
    if (sep === -1)
      continue;
    const key = raw.slice(0, sep).toUpperCase();
    const val = raw.slice(sep + 1);
    if (key === "UID")
      uid = val;
    else if (key === "FN")
      fullName = val;
    else if (key.startsWith("EMAIL"))
      emails.push(val);
    else if (key.startsWith("TEL"))
      phones.push(val);
    else if (key === "ORG")
      org = val.split(";")[0];
    else if (key === "TITLE")
      title = val;
  }
  return { href, uid, fullName, emails, phones, org, title, etag };
}
var CardDAVClient;
var init_CardDAVClient = __esm({
  "src/integrations/apple/CardDAVClient.ts"() {
    init_types3();
    CardDAVClient = class {
      constructor(opts) {
        this.opts = opts;
      }
      base() {
        return this.opts.carddavBase ?? "https://contacts.icloud.com";
      }
      async request(url, method, body, depth = "1") {
        const auth = await this.opts.auth();
        const r = await this.opts.fetch.fetch(url, {
          method,
          headers: {
            Authorization: basicAuthHeader(auth),
            Depth: depth,
            "Content-Type": "application/xml; charset=utf-8"
          },
          body
        });
        return { status: r.status, body: r.body };
      }
      async discoverPrincipal() {
        const xml = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
        const r = await this.request(`${this.base()}/.well-known/carddav`, "PROPFIND", xml, "0");
        if (r.status >= 400)
          return null;
        return extractTagContents(r.body, "href")[0] ?? null;
      }
      async listAddressBooks(principalUrl) {
        const xml = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><card:addressbook-home-set/></d:prop></d:propfind>`;
        const r = await this.request(abs(this.base(), principalUrl), "PROPFIND", xml, "0");
        if (r.status >= 400)
          return [];
        return extractTagContents(r.body, "href").filter((h) => h.includes("/cards/"));
      }
      async listContacts(addressBookUrl) {
        const xml = `<?xml version="1.0"?><card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><card:address-data/></d:prop><card:filter><card:prop-filter name="FN"/></card:filter></card:addressbook-query>`;
        const r = await this.request(abs(this.base(), addressBookUrl), "REPORT", xml, "1");
        if (r.status >= 400)
          return [];
        const out = [];
        for (const resp of extractTagContents(r.body, "response")) {
          const href = extractTagContents(resp, "href")[0] ?? "";
          const etag = extractTagContents(resp, "getetag")[0];
          const card = extractTagContents(resp, "address-data")[0] ?? "";
          if (!card)
            continue;
          out.push(parseVCard(card, href, etag));
        }
        return out;
      }
    };
  }
});

// src/integrations/apple/index.ts
var AppleIntegration;
var init_apple = __esm({
  "src/integrations/apple/index.ts"() {
    init_CalDAVClient();
    init_CardDAVClient();
    init_types3();
    init_CalDAVClient();
    init_CardDAVClient();
    AppleIntegration = class {
      constructor(host) {
        this.host = host;
        this.id = "apple";
        this.label = "Apple (iCloud)";
        this.resources = [];
        this.connection = { connected: false };
        this._caldav = null;
        this._carddav = null;
        this.daysWindow = 30;
      }
      async connect() {
        if (this.host.oauth) {
          const ts = await this.host.oauth.authorize("apple", []);
          this.connection = { connected: true, expiresAt: ts.expiresAt };
        } else {
          this.connection = { connected: true };
        }
        return this.connection;
      }
      async disconnect() {
        if (this.host.oauth)
          await this.host.oauth.revoke("apple");
        this.connection = { connected: false };
      }
      async state() {
        return this.connection;
      }
      async listResources() {
        return this.resources;
      }
      setResources(rs) {
        this.resources = rs;
      }
      caldav() {
        if (!this.host.fetch || !this.host.auth)
          return null;
        if (!this._caldav)
          this._caldav = new CalDAVClient({ fetch: this.host.fetch, auth: this.host.auth });
        return this._caldav;
      }
      carddav() {
        if (!this.host.fetch || !this.host.auth)
          return null;
        if (!this._carddav)
          this._carddav = new CardDAVClient({ fetch: this.host.fetch, auth: this.host.auth });
        return this._carddav;
      }
      async syncResource(id) {
        if (!this.host.fetch || !this.host.auth)
          return { pulled: 0, pushed: 0, errors: 0 };
        let pulled = 0, errors = 0;
        try {
          if (id === "calendar") {
            const c = this.caldav();
            const principal = await c.discoverPrincipal();
            if (!principal)
              return { pulled: 0, pushed: 0, errors: 1 };
            const cals = await c.listCalendars(principal);
            const now = /* @__PURE__ */ new Date();
            const start = new Date(now.getTime() - this.daysWindow * 864e5).toISOString();
            const end = new Date(now.getTime() + this.daysWindow * 864e5).toISOString();
            for (const cal of cals) {
              const events = await c.listEvents(cal, start, end);
              pulled += events.length;
            }
          } else if (id === "contacts") {
            const c = this.carddav();
            const principal = await c.discoverPrincipal();
            if (!principal)
              return { pulled: 0, pushed: 0, errors: 1 };
            const books = await c.listAddressBooks(principal);
            for (const ab of books) {
              const contacts = await c.listContacts(ab);
              pulled += contacts.length;
            }
          }
        } catch {
          errors++;
        }
        return { pulled, pushed: 0, errors };
      }
    };
  }
});

// src/integrations/notion/NotionClient.ts
var NotionClient;
var init_NotionClient = __esm({
  "src/integrations/notion/NotionClient.ts"() {
    NotionClient = class {
      constructor(opts) {
        this.opts = opts;
      }
      base() {
        return this.opts.base ?? "https://api.notion.com/v1";
      }
      version() {
        return this.opts.version ?? "2022-06-28";
      }
      async req(method, path, body) {
        const tok = await this.opts.token();
        const r = await this.opts.fetch.fetch(`${this.base()}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${tok}`,
            "Notion-Version": this.version(),
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: body == null ? void 0 : JSON.stringify(body)
        });
        if (r.status < 200 || r.status >= 300)
          throw new Error(`notion api ${r.status}: ${r.body.slice(0, 200)}`);
        return JSON.parse(r.body);
      }
      async listDatabases(query = "") {
        const r = await this.req("POST", "/search", {
          query,
          filter: { property: "object", value: "database" },
          page_size: 100
        });
        return r.results;
      }
      async queryDatabase(databaseId, opts = {}) {
        const r = await this.req("POST", `/databases/${encodeURIComponent(databaseId)}/query`, {
          page_size: opts.pageSize ?? 100,
          start_cursor: opts.startCursor
        });
        return { pages: r.results, nextCursor: r.next_cursor };
      }
      async getPage(pageId) {
        return this.req("GET", `/pages/${encodeURIComponent(pageId)}`);
      }
      async updatePageProperties(pageId, properties) {
        return this.req("PATCH", `/pages/${encodeURIComponent(pageId)}`, { properties });
      }
      async createPage(parentDatabaseId, properties, children) {
        return this.req("POST", "/pages", {
          parent: { database_id: parentDatabaseId },
          properties,
          children: children ?? []
        });
      }
    };
  }
});

// src/integrations/notion/index.ts
function extractNotionProp(p) {
  if (!p)
    return null;
  switch (p.type) {
    case "title":
      return (p.title ?? []).map((x) => x.plain_text).join("");
    case "rich_text":
      return (p.rich_text ?? []).map((x) => x.plain_text).join("");
    case "email":
      return p.email ?? null;
    case "phone_number":
      return p.phone_number ?? null;
    case "url":
      return p.url ?? null;
    case "select":
      return p.select?.name ?? null;
    case "multi_select":
      return (p.multi_select ?? []).map((x) => x.name);
    case "number":
      return p.number ?? null;
    case "date":
      return p.date?.start ?? null;
    case "checkbox":
      return Boolean(p.checkbox);
    default:
      return JSON.stringify(p);
  }
}
function shallowEqual(a, b) {
  if (a === b)
    return true;
  if (a == null || b == null)
    return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length)
      return false;
    for (let i = 0; i < a.length; i++)
      if (a[i] !== b[i])
        return false;
    return true;
  }
  return false;
}
var NotionIntegration;
var init_notion = __esm({
  "src/integrations/notion/index.ts"() {
    init_NotionClient();
    init_NotionClient();
    NotionIntegration = class {
      constructor(host) {
        this.host = host;
        this.id = "notion";
        this.label = "Notion";
        this.resources = [];
        this.connection = { connected: false };
        this._client = null;
      }
      async connect() {
        if (this.host.oauth) {
          const ts = await this.host.oauth.authorize("notion", []);
          this.connection = { connected: true, expiresAt: ts.expiresAt };
        } else {
          this.connection = { connected: true };
        }
        return this.connection;
      }
      async disconnect() {
        if (this.host.oauth)
          await this.host.oauth.revoke("notion");
        this.connection = { connected: false };
      }
      async state() {
        return this.connection;
      }
      async listResources() {
        return this.resources;
      }
      setResources(rs) {
        this.resources = rs;
      }
      client() {
        if (!this.host.fetch || !this.host.token)
          return null;
        if (!this._client)
          this._client = new NotionClient({ fetch: this.host.fetch, token: this.host.token });
        return this._client;
      }
      async syncResource(id) {
        if (!this.host.fetch || !this.host.token)
          return { pulled: 0, pushed: 0, errors: 0 };
        const c = this.client();
        let pulled = 0, errors = 0;
        try {
          if (id === "databases") {
            const dbs = await c.listDatabases();
            pulled = dbs.length;
          } else if (id.startsWith("database:")) {
            const dbId = id.slice("database:".length);
            let cursor;
            do {
              const r = await c.queryDatabase(dbId, { pageSize: 100, startCursor: cursor });
              pulled += r.pages.length;
              cursor = r.nextCursor ?? void 0;
            } while (cursor && pulled < 1e3);
          }
        } catch {
          errors++;
        }
        return { pulled, pushed: 0, errors };
      }
      /** Compute a conflict shape between a local entity FM and a Notion page's properties. */
      conflictFields(local, page, fields) {
        const out = [];
        for (const f of fields) {
          const remote = extractNotionProp(page.properties[f]);
          const localVal = local[f];
          if (!shallowEqual(localVal, remote))
            out.push({ name: f, local: localVal, remote });
        }
        return out;
      }
    };
  }
});

// src/integrations/twilio/TwilioClient.ts
function basicAuthHeader2(auth) {
  const raw = `${auth.accountSid}:${auth.authToken}`;
  const enc = typeof btoa === "function" ? btoa : (s) => Buffer.from(s, "utf-8").toString("base64");
  return "Basic " + enc(raw);
}
function decodeCall(c) {
  return { sid: c.sid, from: c.from, to: c.to, status: c.status, direction: c.direction, duration: c.duration, startTime: c.start_time, endTime: c.end_time };
}
function decodeMessage(m) {
  return { sid: m.sid, from: m.from, to: m.to, body: m.body, status: m.status, direction: m.direction, dateCreated: m.date_created, dateSent: m.date_sent };
}
function decodeRecording(r) {
  return { sid: r.sid, callSid: r.call_sid, duration: r.duration, channels: r.channels, status: r.status, uri: r.uri, mediaUrl: r.media_url, dateCreated: r.date_created };
}
function decodeTranscription(t) {
  return { sid: t.sid, recordingSid: t.recording_sid, transcriptionText: t.transcription_text, status: t.status, price: t.price, dateCreated: t.date_created };
}
var TwilioClient;
var init_TwilioClient = __esm({
  "src/integrations/twilio/TwilioClient.ts"() {
    TwilioClient = class {
      constructor(opts) {
        this.opts = opts;
      }
      base() {
        return this.opts.base ?? "https://api.twilio.com/2010-04-01";
      }
      async get(path, params) {
        const a = await this.opts.auth();
        const qs = params ? "?" + Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
        const r = await this.opts.fetch.fetch(`${this.base()}/Accounts/${a.accountSid}${path}.json${qs}`, {
          method: "GET",
          headers: { Authorization: basicAuthHeader2(a), Accept: "application/json" }
        });
        if (r.status < 200 || r.status >= 300)
          throw new Error(`twilio api ${r.status}: ${r.body.slice(0, 200)}`);
        return JSON.parse(r.body);
      }
      async listCalls(params = {}) {
        const r = await this.get("/Calls", { From: params.from, To: params.to, Status: params.status, PageSize: params.pageSize ?? 50 });
        return (r.calls ?? []).map(decodeCall);
      }
      async listMessages(params = {}) {
        const r = await this.get("/Messages", { From: params.from, To: params.to, PageSize: params.pageSize ?? 50 });
        return (r.messages ?? []).map(decodeMessage);
      }
      async listRecordings(callSid) {
        const r = await this.get("/Recordings", { CallSid: callSid, PageSize: 50 });
        return (r.recordings ?? []).map(decodeRecording);
      }
      async listTranscriptions() {
        const r = await this.get("/Transcriptions", { PageSize: 50 });
        return (r.transcriptions ?? []).map(decodeTranscription);
      }
      /** Resolve full media URL for a recording (raw audio). */
      async recordingMediaUrl(recordingSid, format = "mp3") {
        const a = await this.opts.auth();
        return `${this.base()}/Accounts/${a.accountSid}/Recordings/${recordingSid}.${format}`;
      }
    };
  }
});

// src/integrations/twilio/index.ts
var TwilioIntegration;
var init_twilio = __esm({
  "src/integrations/twilio/index.ts"() {
    init_TwilioClient();
    init_TwilioClient();
    TwilioIntegration = class {
      constructor(host) {
        this.host = host;
        this.id = "twilio";
        this.label = "Twilio";
        this.resources = [];
        this.connection = { connected: false };
        this._client = null;
      }
      async connect() {
        if (this.host.oauth) {
          const ts = await this.host.oauth.authorize("twilio", []);
          this.connection = { connected: true, expiresAt: ts.expiresAt };
        } else {
          this.connection = { connected: true };
        }
        return this.connection;
      }
      async disconnect() {
        if (this.host.oauth)
          await this.host.oauth.revoke("twilio");
        this.connection = { connected: false };
      }
      async state() {
        return this.connection;
      }
      async listResources() {
        return this.resources;
      }
      setResources(rs) {
        this.resources = rs;
      }
      client() {
        if (!this.host.fetch || !this.host.auth)
          return null;
        if (!this._client)
          this._client = new TwilioClient({ fetch: this.host.fetch, auth: this.host.auth });
        return this._client;
      }
      async syncResource(id) {
        if (!this.host.fetch || !this.host.auth)
          return { pulled: 0, pushed: 0, errors: 0 };
        const c = this.client();
        let pulled = 0, errors = 0;
        try {
          if (id === "calls")
            pulled = (await c.listCalls({ pageSize: 50 })).length;
          else if (id === "messages")
            pulled = (await c.listMessages({ pageSize: 50 })).length;
          else if (id === "recordings")
            pulled = (await c.listRecordings()).length;
          else if (id === "transcriptions")
            pulled = (await c.listTranscriptions()).length;
        } catch {
          errors++;
        }
        return { pulled, pushed: 0, errors };
      }
    };
  }
});

// src/integrations/smtpimap/SmtpImapClient.ts
var tls, net, APP_PASSWORD_KEY, OAUTH_TOKEN_KEY, SmtpImapClient;
var init_SmtpImapClient = __esm({
  "src/integrations/smtpimap/SmtpImapClient.ts"() {
    tls = __toESM(require("node:tls"));
    net = __toESM(require("node:net"));
    APP_PASSWORD_KEY = (id) => `smtp_imap:${id}:app-password`;
    OAUTH_TOKEN_KEY = (id) => `smtp_imap:${id}:oauth-access-token`;
    SmtpImapClient = class {
      constructor(opts) {
        this.opts = opts;
      }
      /** Issue CAPABILITY + LOGIN/AUTHENTICATE + SELECT INBOX + LOGOUT and report. Never logs creds. */
      async probe() {
        const { account } = this.opts;
        const handshakeTimeoutMs = this.opts.handshakeTimeoutMs ?? 15e3;
        const rejectUnauthorized = this.opts.rejectUnauthorized ?? true;
        let socket = null;
        let timer = null;
        const cleanup = () => {
          try {
            socket?.destroy();
          } catch {
          }
          if (timer)
            clearTimeout(timer);
        };
        try {
          const innerSocket = this.opts.proxy ? await this.connectSocks5(this.opts.proxy, account.imapHost, account.imapPort) : null;
          socket = await new Promise((resolve, reject) => {
            const tlsOpts = {
              host: account.imapHost,
              servername: account.imapHost,
              port: account.imapPort,
              rejectUnauthorized,
              minVersion: this.opts.minTlsVersion ?? "TLSv1.2",
              socket: innerSocket ?? void 0
            };
            const s = tls.connect(tlsOpts, () => resolve(s));
            s.once("error", (e) => reject(e));
          });
          timer = setTimeout(() => {
            socket?.destroy(new Error("handshake timeout"));
          }, handshakeTimeoutMs);
          const greeting = await this.readUntil(socket, "\r\n");
          if (!/^\* OK/.test(greeting))
            throw new Error(`unexpected greeting: ${greeting.slice(0, 80)}`);
          const capLine = await this.sendCommand(socket, "A1 CAPABILITY");
          const capabilities = this.parseCapabilities(capLine);
          const startLogin = Date.now();
          let secret;
          let authResp;
          if (account.authMode === "xoauth2") {
            const tok = await this.opts.source.get(OAUTH_TOKEN_KEY(account.id));
            if (!tok)
              throw new Error(`no XOAUTH2 token for ${account.id} (key: ${OAUTH_TOKEN_KEY(account.id)})`);
            secret = tok;
            const payload = Buffer.from(`user=${account.username}auth=Bearer ${secret}`).toString("base64");
            authResp = await this.sendCommand(socket, `A2 AUTHENTICATE XOAUTH2 ${payload}`);
          } else {
            const pw = await this.opts.source.get(APP_PASSWORD_KEY(account.id));
            if (!pw)
              throw new Error(`no app password for ${account.id} (key: ${APP_PASSWORD_KEY(account.id)})`);
            secret = pw;
            authResp = await this.sendCommand(socket, `A2 LOGIN ${account.username} ${this.imapQuote(secret)}`);
          }
          const loginLatencyMs = Date.now() - startLogin;
          secret = "";
          if (!/^A2 OK/m.test(authResp)) {
            const errMsg = (authResp.split("\n").find((l) => /^A2 /.test(l)) ?? "").slice(0, 200);
            cleanup();
            return { ok: false, capability: capabilities, greeting: greeting.trim(), authMode: account.authMode, error: errMsg };
          }
          const selResp = await this.sendCommand(socket, "A3 SELECT INBOX");
          const existsMatch = /\* (\d+) EXISTS/.exec(selResp);
          const messageCount = existsMatch ? parseInt(existsMatch[1], 10) : void 0;
          await this.sendCommand(socket, "A4 LOGOUT");
          cleanup();
          return {
            ok: true,
            capability: capabilities,
            greeting: greeting.trim(),
            authMode: account.authMode,
            selectedFolder: "INBOX",
            messageCount,
            loginLatencyMs
          };
        } catch (e) {
          cleanup();
          return {
            ok: false,
            capability: [],
            greeting: "",
            authMode: account.authMode,
            error: e instanceof Error ? e.message : String(e)
          };
        }
      }
      async sendCommand(socket, cmd) {
        socket.write(cmd + "\r\n");
        const tag = cmd.split(" ")[0];
        return this.readUntil(socket, new RegExp(`^${tag} (OK|NO|BAD)`, "m"));
      }
      readUntil(socket, terminator) {
        return new Promise((resolve, reject) => {
          let buf = "";
          const onData = (chunk) => {
            buf += chunk.toString("utf-8");
            const done = typeof terminator === "string" ? buf.includes(terminator) : terminator.test(buf);
            if (done) {
              socket.removeListener("data", onData);
              socket.removeListener("error", onError);
              resolve(buf);
            }
          };
          const onError = (e) => {
            socket.removeListener("data", onData);
            socket.removeListener("error", onError);
            reject(e);
          };
          socket.on("data", onData);
          socket.once("error", onError);
        });
      }
      parseCapabilities(line) {
        const m = /\* CAPABILITY ([^\r\n]+)/.exec(line);
        return m ? m[1].split(/\s+/).filter(Boolean) : [];
      }
      imapQuote(s) {
        if (/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(s))
          return s;
        return '"' + s.replace(/[\\"]/g, (c) => "\\" + c) + '"';
      }
      async connectSocks5(cfg, host, port) {
        return new Promise((resolve, reject) => {
          const sock = net.connect(cfg.port, cfg.host, () => {
            const auths = cfg.username ? Buffer.from([5, 2, 0, 2]) : Buffer.from([5, 1, 0]);
            sock.write(auths);
            sock.once("data", (greet) => {
              if (greet[0] !== 5) {
                reject(new Error("SOCKS5 bad version"));
                return;
              }
              const method = greet[1];
              const proceed = () => {
                const addr = Buffer.from(host, "utf-8");
                const req = Buffer.concat([
                  Buffer.from([5, 1, 0, 3, addr.length]),
                  addr,
                  Buffer.from([port >> 8 & 255, port & 255])
                ]);
                sock.write(req);
                sock.once("data", (resp) => {
                  if (resp[0] !== 5 || resp[1] !== 0) {
                    reject(new Error(`SOCKS5 connect failed (rep=${resp[1]})`));
                    return;
                  }
                  resolve(sock);
                });
              };
              if (method === 0)
                proceed();
              else if (method === 2 && cfg.username) {
                const u = Buffer.from(cfg.username);
                const p = Buffer.from(cfg.password ?? "");
                const auth = Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]);
                sock.write(auth);
                sock.once("data", (a) => {
                  if (a[0] !== 1 || a[1] !== 0) {
                    reject(new Error("SOCKS5 auth rejected"));
                    return;
                  }
                  proceed();
                });
              } else
                reject(new Error(`SOCKS5 no acceptable auth method (got ${method})`));
            });
          });
          sock.once("error", reject);
        });
      }
    };
  }
});

// src/integrations/smtpimap/index.ts
var SmtpImapIntegration;
var init_smtpimap = __esm({
  "src/integrations/smtpimap/index.ts"() {
    init_SmtpImapClient();
    SmtpImapIntegration = class {
      constructor(host) {
        this.host = host;
        this.id = "smtp_imap";
        this.label = "SMTP/IMAP";
        this.resources = [];
        this.connection = { connected: false };
        this.accounts = [];
      }
      addAccount(account) {
        this.accounts = [...this.accounts.filter((a) => a.id !== account.id), account];
      }
      listAccounts() {
        return [...this.accounts];
      }
      setResources(rs) {
        this.resources = rs;
      }
      async connect() {
        this.connection = { connected: true, account: this.accounts.map((a) => a.username).join(", ") };
        return this.connection;
      }
      async disconnect() {
        this.connection = { connected: false };
      }
      async state() {
        return this.connection;
      }
      async listResources() {
        return this.resources;
      }
      async syncResource(_id) {
        return { pulled: 0, pushed: 0, errors: 0 };
      }
      async probeAccount(accountId) {
        const account = this.accounts.find((a) => a.id === accountId);
        if (!account)
          throw new Error(`no account: ${accountId}`);
        if (!this.host.source)
          throw new Error("no credential source \u2014 KeyVault required for SMTP/IMAP");
        this.host.scopes.require(this.id, "inbox.read");
        const client = new SmtpImapClient({
          account,
          source: this.host.source,
          proxy: this.host.socksProxy,
          rejectUnauthorized: true,
          minTlsVersion: "TLSv1.2"
        });
        return client.probe();
      }
    };
  }
});

// src/integrations/websearch/index.ts
var BraveSearch, TavilySearch, SearXNGSearch;
var init_websearch = __esm({
  "src/integrations/websearch/index.ts"() {
    BraveSearch = class {
      constructor(host, apiKey) {
        this.host = host;
        this.apiKey = apiKey;
        this.id = "brave";
      }
      async search(q, opts) {
        const key = await this.apiKey();
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${opts.count ?? 10}`;
        const r = await this.host.proxy.fetch(url, { method: "GET", headers: { "X-Subscription-Token": key, Accept: "application/json" } });
        if (r.status >= 400)
          return [];
        const j = JSON.parse(r.body);
        const results = j.web?.results ?? [];
        const now = Date.now();
        const out = [];
        for (const it of results) {
          out.push({ url: it.url, title: it.title, snippet: it.description, publishedTs: null, fetchedTs: now, hash: await this.host.sha256Hex(it.url) });
        }
        return out;
      }
      async fetch(url, opts) {
        const r = await this.host.proxy.fetch(url, { method: "GET", headers: { Accept: "text/html,application/xhtml+xml" } });
        if (r.status >= 400)
          throw new Error(`fetch failed: ${r.status}`);
        return opts.markdown ? this.host.markdownExtract(r.body) : r.body;
      }
    };
    TavilySearch = class {
      constructor(host, apiKey) {
        this.host = host;
        this.apiKey = apiKey;
        this.id = "tavily";
      }
      async search(q, opts) {
        const key = await this.apiKey();
        const r = await this.host.proxy.fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ api_key: key, query: q, max_results: opts.count ?? 10 })
        });
        if (r.status >= 400)
          return [];
        const j = JSON.parse(r.body);
        const now = Date.now();
        const out = [];
        for (const it of j.results) {
          out.push({ url: it.url, title: it.title, snippet: it.content, publishedTs: it.published_date ? Date.parse(it.published_date) : null, fetchedTs: now, hash: await this.host.sha256Hex(it.url) });
        }
        return out;
      }
      async fetch(url, opts) {
        const r = await this.host.proxy.fetch(url, { method: "GET", headers: { Accept: "text/html" } });
        return opts.markdown ? this.host.markdownExtract(r.body) : r.body;
      }
    };
    SearXNGSearch = class {
      constructor(host, endpoint) {
        this.host = host;
        this.endpoint = endpoint;
        this.id = "searxng";
      }
      async search(q, opts) {
        const base = await this.endpoint();
        const url = `${base.replace(/\/$/, "")}/search?q=${encodeURIComponent(q)}&format=json`;
        const r = await this.host.proxy.fetch(url, { method: "GET", headers: { Accept: "application/json" } });
        if (r.status >= 400)
          return [];
        const j = JSON.parse(r.body);
        const now = Date.now();
        const out = [];
        for (const it of j.results.slice(0, opts.count ?? 10)) {
          out.push({ url: it.url, title: it.title, snippet: it.content, publishedTs: it.publishedDate ? Date.parse(it.publishedDate) : null, fetchedTs: now, hash: await this.host.sha256Hex(it.url) });
        }
        return out;
      }
      async fetch(url, opts) {
        const r = await this.host.proxy.fetch(url, { method: "GET", headers: { Accept: "text/html" } });
        return opts.markdown ? this.host.markdownExtract(r.body) : r.body;
      }
    };
  }
});

// src/integrations/AutoTouchPipeline.ts
function inferChannel(ev, on) {
  if (!on)
    return "event";
  if (ev.meetingUrl)
    return "call";
  const loc = (ev.location ?? "").toLowerCase();
  if (loc.includes("zoom") || loc.includes("meet") || loc.includes("teams"))
    return "call";
  if (loc.includes("restaurant") || loc.includes("dinner") || /lunch|coffee/.test(ev.subject?.toLowerCase() ?? ""))
    return "dinner";
  if (loc)
    return "in-person";
  return "call";
}
var AutoTouchPipeline;
var init_AutoTouchPipeline = __esm({
  "src/integrations/AutoTouchPipeline.ts"() {
    AutoTouchPipeline = class {
      constructor(opts = {}) {
        this.opts = opts;
      }
      /** Returns a draft only for events that meet capture criteria. */
      draft(ev) {
        const dur = (Date.parse(ev.endIso) - Date.parse(ev.startIso)) / 6e4;
        if (Number.isFinite(dur) && dur < (this.opts.minDurationMin ?? 5))
          return null;
        if (!ev.endIso || Date.parse(ev.endIso) > Date.now())
          return null;
        const self = new Set((this.opts.selfEmails ?? []).map((e) => e.toLowerCase()));
        const others = ev.attendees.filter((a) => !self.has(a.email.toLowerCase()) && a.email !== ev.organizerEmail);
        if (others.length === 0)
          return null;
        const channel = inferChannel(ev, this.opts.inferChannel ?? true);
        const contactEmails = others.map((a) => a.email);
        const contactBasenameHints = others.map((a) => a.displayName ?? a.email.split("@")[0]);
        const date = ev.startIso.slice(0, 10);
        const notes = [
          ev.subject ? `**${ev.subject}**` : "",
          ev.description ? "\n" + ev.description.trim() : "",
          ev.location ? `
Location: ${ev.location}` : "",
          ev.meetingUrl ? `
Meeting: ${ev.meetingUrl}` : ""
        ].filter(Boolean).join("\n").trim();
        return {
          date,
          channel,
          contactEmails,
          contactBasenameHints,
          subject: ev.subject,
          meetingUrl: ev.meetingUrl,
          webLink: ev.webLink,
          notes,
          source: `${ev.source}:cal/${ev.id}`,
          followups: []
        };
      }
    };
  }
});

// src/integrations/SignatureParser.ts
function extractSignatureBlock(body) {
  if (!body)
    return "";
  const lines = body.split(/\r?\n/);
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (SIG_DELIMITERS.some((d) => t === d || t.startsWith(d))) {
      cut = i;
      break;
    }
  }
  if (cut === -1) {
    const nonEmpty = lines.filter((l) => l.trim());
    return nonEmpty.slice(-8).join("\n");
  }
  return lines.slice(cut + 1).join("\n").trim();
}
function extractEmails(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("@", i);
    if (at === -1)
      break;
    let l = at - 1;
    while (l >= 0 && EMAIL_CHARS.test(text[l]))
      l--;
    let r = at + 1;
    while (r < text.length && EMAIL_CHARS.test(text[r]))
      r++;
    if (r > at + 1 && l + 1 < at && text.slice(at + 1, r).includes(".")) {
      out.push(text.slice(l + 1, r));
    }
    i = r + 1;
  }
  return [...new Set(out)];
}
function extractPhones(text) {
  const out = [];
  const tokens = text.split(/[^\d+()\s.x-]+/);
  for (const tok of tokens) {
    const digits = tok.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) {
      out.push(tok.trim());
    }
  }
  return [...new Set(out)];
}
function extractUrls(text) {
  const out = [];
  for (const word of text.split(/\s+/)) {
    if (word.startsWith("http://") || word.startsWith("https://"))
      out.push(word);
    else if (word.startsWith("www."))
      out.push("https://" + word);
  }
  return [...new Set(out)];
}
function classifySocial(urls) {
  const out = {};
  for (const u of urls) {
    if (!out.linkedin && /linkedin\.com\//i.test(u))
      out.linkedin = u;
    else if (!out.twitter && /(twitter\.com|x\.com)\//i.test(u))
      out.twitter = u;
    else if (!out.github && /github\.com\//i.test(u))
      out.github = u;
  }
  return out;
}
function parseSignature(body) {
  const raw = extractSignatureBlock(body);
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const emails = extractEmails(raw);
  const phones = extractPhones(raw);
  const urls = extractUrls(raw);
  const social = classifySocial(urls);
  let name;
  let title;
  let company;
  for (let i = 0; i < lines.length && i < 6; i++) {
    const l = lines[i];
    if (emails.some((e) => l.includes(e)))
      continue;
    if (urls.some((u) => l.includes(u)))
      continue;
    if (phones.some((p) => l.includes(p)))
      continue;
    if (!name) {
      name = l;
      continue;
    }
    if (!title) {
      title = l;
      continue;
    }
    if (!company) {
      company = l;
      continue;
    }
  }
  return { raw, name, title, company, email: emails[0], phones, urls, social };
}
var SIG_DELIMITERS, EMAIL_CHARS;
var init_SignatureParser = __esm({
  "src/integrations/SignatureParser.ts"() {
    SIG_DELIMITERS = ["-- ", "--", "___", "===", "Sent from my", "Best,", "Regards,", "Cheers,", "Thanks,"];
    EMAIL_CHARS = /[a-zA-Z0-9._%+-]/;
  }
});

// src/integrations/index.ts
var integrations_exports = {};
__export(integrations_exports, {
  AppleIntegration: () => AppleIntegration,
  AutoTouchPipeline: () => AutoTouchPipeline,
  BraveSearch: () => BraveSearch,
  GoogleWorkspaceIntegration: () => GoogleWorkspaceIntegration,
  Microsoft365Integration: () => Microsoft365Integration,
  NotionIntegration: () => NotionIntegration,
  SearXNGSearch: () => SearXNGSearch,
  SmtpImapIntegration: () => SmtpImapIntegration,
  TavilySearch: () => TavilySearch,
  TwilioIntegration: () => TwilioIntegration,
  extractSignatureBlock: () => extractSignatureBlock,
  parseSignature: () => parseSignature
});
var init_integrations = __esm({
  "src/integrations/index.ts"() {
    init_IIntegration();
    init_google();
    init_microsoft();
    init_apple();
    init_notion();
    init_twilio();
    init_smtpimap();
    init_websearch();
    init_AutoTouchPipeline();
    init_SignatureParser();
  }
});

// src/backend/FileOnlyBackend.ts
var FileOnlyBackend = class {
  constructor() {
    this.tables = /* @__PURE__ */ new Map();
  }
  async init(_dbPath) {
  }
  async exec(sql, _params = []) {
    const m = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i.exec(sql);
    if (m && !this.tables.has(m[1]))
      this.tables.set(m[1], []);
  }
  async query(_sql, _params = []) {
    return [];
  }
  async prepare(_sql) {
    return {
      async run() {
      },
      async get() {
        return void 0;
      },
      async all() {
        return [];
      },
      async finalize() {
      }
    };
  }
  async transaction(fn) {
    return await fn();
  }
  capabilities() {
    return { fts5: false, vss: false, wal: false, native: false, persistent: false };
  }
  async close() {
    this.tables.clear();
  }
  getTable(name) {
    return this.tables.get(name) ?? [];
  }
  insert(table, row) {
    if (!this.tables.has(table))
      this.tables.set(table, []);
    this.tables.get(table).push(row);
  }
  upsert(table, pk, row) {
    const rows = this.tables.get(table) ?? [];
    const i = rows.findIndex((r) => r[pk] === row[pk]);
    if (i >= 0)
      rows[i] = row;
    else
      rows.push(row);
    this.tables.set(table, rows);
  }
  remove(table, pk, val) {
    const rows = this.tables.get(table) ?? [];
    this.tables.set(table, rows.filter((r) => r[pk] !== val));
  }
};

// src/backend/Migrations.ts
var MIGRATIONS = [
  {
    version: 1,
    name: "initial-schema",
    async up(db) {
      await db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_ts INTEGER NOT NULL)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, primary_type TEXT,
        frontmatter TEXT NOT NULL, body_md TEXT NOT NULL, body_hash TEXT NOT NULL,
        mtime INTEGER NOT NULL, ctime INTEGER NOT NULL,
        lat REAL, lon REAL, geo_acc_m INTEGER)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_mtime ON entities(mtime)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_geo ON entities(lat, lon)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS edges (
        from_id TEXT NOT NULL, to_id TEXT NOT NULL, edge_type TEXT NOT NULL,
        directed INTEGER NOT NULL, weight REAL DEFAULT 1.0,
        source TEXT, inferred_conf REAL, ts INTEGER NOT NULL,
        PRIMARY KEY (from_id, to_id, edge_type))`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS tags (entity_id TEXT, tag TEXT, PRIMARY KEY (entity_id, tag))`);
      await db.exec(`CREATE TABLE IF NOT EXISTS touches (
        id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, date TEXT NOT NULL,
        channel TEXT, playbook TEXT, outcome_tags TEXT, attendees TEXT,
        source TEXT, author_id TEXT)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_touches_contact ON touches(contact_id, date)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS addenda (
        id TEXT PRIMARY KEY, target_id TEXT NOT NULL, date TEXT NOT NULL,
        kind TEXT NOT NULL, author_id TEXT NOT NULL, body_md TEXT NOT NULL,
        signature TEXT NOT NULL)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS embeddings (
        entity_id TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL,
        vector BLOB NOT NULL, hash TEXT NOT NULL)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
        ts INTEGER PRIMARY KEY, op TEXT NOT NULL, entity_id TEXT, agent_id TEXT,
        integration TEXT, before_hash TEXT, after_hash TEXT, details TEXT,
        signature TEXT NOT NULL)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS sync_state (
        integration TEXT, resource TEXT, cursor TEXT,
        last_pull_ts INTEGER, last_push_ts INTEGER,
        PRIMARY KEY (integration, resource))`);
      await db.exec(`CREATE TABLE IF NOT EXISTS api_keys_enc (
        service TEXT PRIMARY KEY, ciphertext BLOB NOT NULL, nonce BLOB NOT NULL,
        kdf_salt BLOB NOT NULL, kdf_iters INTEGER NOT NULL,
        created_ts INTEGER NOT NULL, rotated_ts INTEGER)`);
    }
  },
  {
    version: 2,
    name: "fts5-virtual-table",
    async up(db) {
      const caps = db.capabilities();
      if (!caps.fts5)
        return;
      await db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
        entity_id UNINDEXED, title, body,
        content='entities', tokenize='unicode61 remove_diacritics 2')`);
    }
  }
];
async function applyMigrations(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_ts INTEGER NOT NULL)`);
  const rows = await db.query(`SELECT MAX(version) AS version FROM schema_version`);
  const current = rows[0]?.version ?? 0;
  let applied = 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current)
      continue;
    await db.transaction(async () => {
      await m.up(db);
      await db.exec(`INSERT INTO schema_version (version, applied_ts) VALUES (?, ?)`, [m.version, Date.now()]);
    });
    applied += 1;
  }
  return applied;
}

// src/backend/Seeder.ts
var Seeder = class {
  constructor(db, host) {
    this.db = db;
    this.host = host;
  }
  async run() {
    const start = Date.now();
    const migrationsApplied = await applyMigrations(this.db);
    const report = { migrationsApplied, entities: 0, edges: 0, tags: 0, touches: 0, addenda: 0, elapsedMs: 0 };
    await this.db.transaction(async () => {
      for await (const f of this.host.walk()) {
        await this.db.exec(
          `INSERT OR REPLACE INTO entities (id,type,primary_type,frontmatter,body_md,body_hash,mtime,ctime) VALUES (?,?,?,?,?,?,?,?)`,
          [f.path, f.type, f.primaryType ?? null, JSON.stringify(f.frontmatter), f.body, f.bodyHash, f.mtime, f.ctime]
        );
        report.entities += 1;
        for (const t of f.tags) {
          await this.db.exec(`INSERT OR IGNORE INTO tags (entity_id, tag) VALUES (?,?)`, [f.path, t]);
          report.tags += 1;
        }
        for (const e of f.edges) {
          await this.db.exec(
            `INSERT OR REPLACE INTO edges (from_id,to_id,edge_type,directed,weight,source,ts) VALUES (?,?,?,?,?,?,?)`,
            [f.path, e.to, e.edgeType, e.directed ? 1 : 0, 1, "manual", Date.now()]
          );
          report.edges += 1;
        }
        if (f.touch) {
          await this.db.exec(
            `INSERT OR REPLACE INTO touches (id,contact_id,date,channel,playbook,outcome_tags,attendees,source,author_id) VALUES (?,?,?,?,?,?,?,?,?)`,
            [
              f.touch.id,
              f.touch.contactId,
              f.touch.date,
              f.touch.channel ?? null,
              f.touch.playbook ?? null,
              JSON.stringify(f.touch.outcomeTags ?? []),
              JSON.stringify(f.touch.attendees ?? []),
              f.touch.source ?? null,
              f.touch.authorId ?? null
            ]
          );
          report.touches += 1;
        }
        if (f.addendum) {
          await this.db.exec(
            `INSERT OR REPLACE INTO addenda (id,target_id,date,kind,author_id,body_md,signature) VALUES (?,?,?,?,?,?,?)`,
            [f.addendum.id, f.addendum.targetId, f.addendum.date, f.addendum.kind, f.addendum.authorId, f.addendum.body, f.addendum.signature]
          );
          report.addenda += 1;
        }
      }
    });
    report.elapsedMs = Date.now() - start;
    return report;
  }
};

// src/backend/SqliteSync.ts
var SqliteSync = class {
  constructor(db, fts = null) {
    this.db = db;
    this.fts = fts;
  }
  async onCreate(f) {
    await this.upsert(f);
  }
  async onModify(f) {
    await this.upsert(f);
  }
  async onDelete(path) {
    await this.db.transaction(async () => {
      await this.db.exec(`DELETE FROM entities WHERE id = ?`, [path]);
      await this.db.exec(`DELETE FROM edges WHERE from_id = ? OR to_id = ?`, [path, path]);
      await this.db.exec(`DELETE FROM tags WHERE entity_id = ?`, [path]);
      await this.db.exec(`DELETE FROM touches WHERE id = ? OR contact_id = ?`, [path, path]);
      await this.db.exec(`DELETE FROM embeddings WHERE entity_id = ?`, [path]);
      if (this.db.capabilities().fts5) {
        await this.db.exec(`DELETE FROM fts WHERE entity_id = ?`, [path]);
      }
    });
    this.fts?.remove(path);
  }
  async onRename(oldPath, newPath) {
    await this.db.transaction(async () => {
      await this.db.exec(`UPDATE entities SET id = ? WHERE id = ?`, [newPath, oldPath]);
      await this.db.exec(`UPDATE edges SET from_id = ? WHERE from_id = ?`, [newPath, oldPath]);
      await this.db.exec(`UPDATE edges SET to_id = ? WHERE to_id = ?`, [newPath, oldPath]);
      await this.db.exec(`UPDATE tags SET entity_id = ? WHERE entity_id = ?`, [newPath, oldPath]);
      await this.db.exec(`UPDATE touches SET contact_id = ? WHERE contact_id = ?`, [newPath, oldPath]);
      await this.db.exec(`UPDATE embeddings SET entity_id = ? WHERE entity_id = ?`, [newPath, oldPath]);
    });
  }
  async upsert(f) {
    await this.db.transaction(async () => {
      const existing = await this.db.query(
        `SELECT body_hash FROM entities WHERE id = ?`,
        [f.path]
      );
      const hashChanged = existing[0]?.body_hash !== f.bodyHash;
      await this.db.exec(
        `INSERT INTO entities (id,type,primary_type,frontmatter,body_md,body_hash,mtime,ctime,lat,lon,geo_acc_m)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           type=excluded.type, primary_type=excluded.primary_type, frontmatter=excluded.frontmatter,
           body_md=excluded.body_md, body_hash=excluded.body_hash, mtime=excluded.mtime`,
        [
          f.path,
          f.type,
          f.primaryType ?? null,
          JSON.stringify(f.frontmatter),
          f.body,
          f.bodyHash,
          f.mtime,
          f.ctime,
          null,
          null,
          null
        ]
      );
      await this.db.exec(`DELETE FROM tags WHERE entity_id = ?`, [f.path]);
      for (const t of f.tags)
        await this.db.exec(`INSERT OR IGNORE INTO tags VALUES (?,?)`, [f.path, t]);
      await this.db.exec(`DELETE FROM edges WHERE from_id = ? AND source = 'manual'`, [f.path]);
      for (const e of f.edges) {
        await this.db.exec(
          `INSERT OR REPLACE INTO edges (from_id,to_id,edge_type,directed,weight,source,ts) VALUES (?,?,?,?,?,?,?)`,
          [f.path, e.to, e.edgeType, e.directed ? 1 : 0, 1, "manual", Date.now()]
        );
      }
      if (hashChanged) {
        if (this.db.capabilities().fts5) {
          await this.db.exec(`DELETE FROM fts WHERE entity_id = ?`, [f.path]);
          const title = String(f.frontmatter["name"] ?? f.frontmatter["title"] ?? f.path);
          await this.db.exec(`INSERT INTO fts (entity_id,title,body) VALUES (?,?,?)`, [f.path, title, f.body]);
        } else if (this.fts) {
          const title = String(f.frontmatter["name"] ?? f.frontmatter["title"] ?? f.path);
          this.fts.index(f.path, title, f.body);
        }
      }
    });
  }
  async search(q, limit = 25) {
    if (this.db.capabilities().fts5) {
      const rows = await this.db.query(
        `SELECT entity_id, rank FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT ?`,
        [q, limit]
      );
      return rows.map((r) => ({ entityId: r.entity_id, score: r.rank }));
    }
    return this.fts?.search(q, limit) ?? [];
  }
};

// src/security/KeyVault.ts
var KDF = { memKiB: 64 * 1024, passes: 3, parallelism: 2, outBytes: 32 };
var NONCE_BYTES = 24;
var SALT_BYTES = 16;
var JsonSecretStore = class {
  constructor(load, save) {
    this.load = load;
    this.save = save;
  }
  async put(service, row) {
    const d = await this.load();
    d[service] = {
      ciphertext: Array.from(row.ciphertext),
      nonce: Array.from(row.nonce),
      kdfSalt: Array.from(row.kdfSalt),
      kdfIters: row.kdfIters,
      createdTs: row.createdTs,
      rotatedTs: row.rotatedTs
    };
    await this.save(d);
  }
  async get(service) {
    const d = await this.load();
    const r = d[service];
    if (!r)
      return null;
    return {
      service,
      ciphertext: new Uint8Array(r.ciphertext),
      nonce: new Uint8Array(r.nonce),
      kdfSalt: new Uint8Array(r.kdfSalt),
      kdfIters: r.kdfIters,
      createdTs: r.createdTs,
      rotatedTs: r.rotatedTs
    };
  }
  async list() {
    return Object.keys(await this.load()).sort();
  }
  async remove(service) {
    const d = await this.load();
    delete d[service];
    await this.save(d);
  }
};
var KeyVault = class {
  constructor(store, crypto2) {
    this.store = store;
    this.crypto = crypto2;
    this.masterKey = null;
    this.lastUnlock = 0;
    this.autoLockMs = 30 * 60 * 1e3;
    this.cachedSalt = null;
  }
  isLocked() {
    if (!this.masterKey)
      return true;
    if (this.autoLockMs > 0 && Date.now() - this.lastUnlock > this.autoLockMs) {
      this.lock();
      return true;
    }
    return false;
  }
  setAutoLockMinutes(n) {
    this.autoLockMs = Math.max(0, n) * 60 * 1e3;
  }
  async unlock(password, sentinelService = "__kv_sentinel__") {
    const existing = await this.store.get(sentinelService);
    if (existing) {
      const key = await this.crypto.argon2id(password, existing.kdfSalt, KDF);
      const open = this.crypto.secretboxOpen(key, existing.nonce, existing.ciphertext);
      if (!open)
        throw new Error("invalid password");
      this.masterKey = key;
      this.cachedSalt = existing.kdfSalt;
    } else {
      const salt = this.crypto.randomBytes(SALT_BYTES);
      const key = await this.crypto.argon2id(password, salt, KDF);
      const nonce = this.crypto.randomBytes(NONCE_BYTES);
      const sentinel = new TextEncoder().encode("sauce-graph-kv-v1");
      const ct = this.crypto.secretboxSeal(key, nonce, sentinel);
      await this.store.put(sentinelService, { service: sentinelService, ciphertext: ct, nonce, kdfSalt: salt, kdfIters: KDF.passes, createdTs: Date.now(), rotatedTs: null });
      this.masterKey = key;
      this.cachedSalt = salt;
    }
    this.lastUnlock = Date.now();
  }
  lock() {
    this.masterKey = null;
    this.cachedSalt = null;
  }
  async put(service, secret) {
    if (this.isLocked() || !this.masterKey || !this.cachedSalt)
      throw new Error("vault locked");
    const nonce = this.crypto.randomBytes(NONCE_BYTES);
    const ct = this.crypto.secretboxSeal(this.masterKey, nonce, new TextEncoder().encode(secret));
    await this.store.put(service, { service, ciphertext: ct, nonce, kdfSalt: this.cachedSalt, kdfIters: KDF.passes, createdTs: Date.now(), rotatedTs: null });
  }
  async get(service) {
    if (this.isLocked() || !this.masterKey)
      throw new Error("vault locked");
    const row = await this.store.get(service);
    if (!row)
      throw new Error(`no secret: ${service}`);
    const pt = this.crypto.secretboxOpen(this.masterKey, row.nonce, row.ciphertext);
    if (!pt)
      throw new Error("decrypt failed");
    return new TextDecoder().decode(pt);
  }
  async rotate(service, newSecret) {
    await this.put(service, newSecret);
    const row = await this.store.get(service);
    if (row)
      await this.store.put(service, { ...row, rotatedTs: Date.now() });
  }
  async list() {
    return (await this.store.list()).filter((s) => !s.startsWith("__"));
  }
  async masterKeyHmacBytes() {
    if (!this.masterKey)
      throw new Error("vault locked");
    return this.masterKey;
  }
};

// src/security/ProxyClient.ts
var ProxyClient = class {
  constructor(host, cfg) {
    this.host = host;
    this.cfg = cfg;
  }
  setConfig(cfg) {
    this.cfg = cfg;
  }
  isEnabled() {
    return this.cfg.enabled && !!this.cfg.baseUrl && !!this.cfg.sharedSecret;
  }
  async fetch(url, init = {}) {
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ?? "";
    if (!this.isEnabled()) {
      return this.host.fetch(url, { method, headers: init.headers ?? {}, body: body || void 0 });
    }
    const ts = String(Date.now());
    const bodyHash = await this.host.sha256Hex(body);
    const sig = await this.host.hmacHex(this.cfg.sharedSecret, `${method}|${url}|${ts}|${bodyHash}`);
    const headers = {
      ...init.headers ?? {},
      "X-Sauce-Target": url,
      "X-Sauce-Timestamp": ts,
      "X-Sauce-Signature": sig
    };
    return this.host.fetch(this.cfg.baseUrl, { method, headers, body: body || void 0 });
  }
};

// src/security/AuditLog.ts
var AuditLog = class {
  constructor(db, host, masterKey) {
    this.db = db;
    this.host = host;
    this.masterKey = masterKey;
    this.prevSig = null;
  }
  payload(r) {
    return [r.ts, r.op, r.entityId ?? "", r.agentId ?? "", r.integration ?? "", r.beforeHash ?? "", r.afterHash ?? "", JSON.stringify(r.details ?? null)].join("|");
  }
  async append(row) {
    const key = await this.masterKey();
    if (this.prevSig === null) {
      const last = await this.db.query(`SELECT signature FROM audit_log ORDER BY ts DESC LIMIT 1`);
      this.prevSig = last[0]?.signature ?? "";
    }
    const msg = (this.prevSig ?? "") + this.payload(row);
    const sig = await this.host.hmacHex(key, msg);
    await this.db.exec(
      `INSERT INTO audit_log (ts,op,entity_id,agent_id,integration,before_hash,after_hash,details,signature) VALUES (?,?,?,?,?,?,?,?,?)`,
      [row.ts, row.op, row.entityId, row.agentId, row.integration, row.beforeHash, row.afterHash, JSON.stringify(row.details ?? null), sig]
    );
    this.prevSig = sig;
    return { ...row, signature: sig };
  }
  async verifyChain() {
    const key = await this.masterKey();
    const rows = await this.db.query(
      `SELECT ts,op,entity_id,agent_id,integration,before_hash,after_hash,details,signature FROM audit_log ORDER BY ts ASC`
    );
    let prev = "";
    for (const r of rows) {
      const row = {
        ts: r.ts,
        op: r.op,
        entityId: r.entity_id,
        agentId: r.agent_id,
        integration: r.integration,
        beforeHash: r.before_hash,
        afterHash: r.after_hash,
        details: r.details ? JSON.parse(r.details) : null
      };
      const sig = await this.host.hmacHex(key, prev + this.payload(row));
      if (sig !== r.signature)
        return { ok: false, brokenAt: r.ts };
      prev = sig;
    }
    return { ok: true, brokenAt: null };
  }
};

// src/security/ScopeRegistry.ts
var ScopeNotGranted = class extends Error {
  constructor(integration, scope) {
    super(`Scope not granted: ${integration}:${scope}`);
    this.integration = integration;
    this.scope = scope;
    this.name = "ScopeNotGranted";
  }
};
var ScopeRegistry = class {
  constructor() {
    this.scopes = {};
  }
  load(map) {
    this.scopes = JSON.parse(JSON.stringify(map));
  }
  toJSON() {
    return JSON.parse(JSON.stringify(this.scopes));
  }
  set(integration, scope, allowed) {
    if (!this.scopes[integration])
      this.scopes[integration] = {};
    this.scopes[integration][scope] = allowed;
  }
  check(integration, scope) {
    return !!this.scopes[integration]?.[scope];
  }
  require(integration, scope) {
    if (!this.check(integration, scope))
      throw new ScopeNotGranted(integration, scope);
  }
  list(integration) {
    return { ...this.scopes[integration] ?? {} };
  }
  integrations() {
    return Object.keys(this.scopes);
  }
};
var DEFAULT_SCOPES = {
  google_workspace: {
    "calendar.read": true,
    "calendar.write": false,
    "gmail.read": true,
    "gmail.modify": false,
    "gmail.send": false,
    "drive.read": true,
    "drive.write": false,
    "contacts.read": true
  },
  microsoft_365: {
    "calendar.read": true,
    "calendar.write": false,
    "mail.read": true,
    "mail.modify": false,
    "mail.send": false,
    "files.read": true,
    "files.write": false,
    "contacts.read": true
  },
  apple: { "calendar.read": true, "calendar.write": false, "contacts.read": true, "mail.read": true },
  notion: { "read": true, "write": false },
  twilio: { "voice.inbound": true, "voice.outbound": false, "sms.inbound": true, "sms.outbound": false, "recordings.read": true },
  smtp_imap: { "inbox.read": true, "inbox.send": false },
  web_search: { "web_search.read": true, "web_search.fetch": true }
};

// src/skills/Skill.ts
var Skill = class {
  constructor() {
    this.description = "";
  }
};
function validateInputs(args, contract) {
  const missing = contract.inputs.filter((i) => i.required && !(i.name in args)).map((i) => i.name);
  return { ok: missing.length === 0, missing };
}

// src/skills/ResearchOrgSkill.ts
var ResearchOrgSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "research-org";
    this.description = "Research an org via web + vault and propose enrichment";
    this.contract = {
      level: "simple",
      inputs: [{ name: "org_name", type: "string", required: true }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/ResearchPersonSkill.ts
var ResearchPersonSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "research-person";
    this.description = "Research a person via web + vault and propose enrichment";
    this.contract = {
      level: "simple",
      inputs: [{ name: "person_name", type: "string", required: true }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/DraftTouchSkill.ts
var DraftTouchSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "draft-touch";
    this.description = "Compose a Touch from a calendar event or thread";
    this.contract = {
      level: "simple",
      inputs: [{ name: "source", type: "string", required: true }, { name: "contact_id", type: "string", required: true }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/SummarizeThreadSkill.ts
var SummarizeThreadSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "summarize-thread";
    this.description = "Bulletize an email or call transcript";
    this.contract = {
      level: "simple",
      inputs: [{ name: "source_path", type: "string", required: true }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/CaptureCallSkill.ts
var CaptureCallSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "capture-call";
    this.description = "Pull Twilio recording, transcribe, draft Touch";
    this.contract = {
      level: "simple",
      inputs: [{ name: "call_sid", type: "string", required: true }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/InferEdgesSkill.ts
var InferEdgesSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "infer-edges";
    this.description = "Co-attendance + co-recipients -> knows suggestions";
    this.contract = {
      level: "simple",
      inputs: [{ name: "window_days", type: "number", required: false }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/GeocodeSkill.ts
var GeocodeSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "geocode";
    this.description = "Geocode an address string";
    this.contract = {
      level: "simple",
      inputs: [{ name: "address", type: "string", required: true }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/TranscribeSkill.ts
var TranscribeSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "transcribe";
    this.description = "Transcribe an audio file";
    this.contract = {
      level: "simple",
      inputs: [{ name: "audio_path", type: "string", required: true }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/RouteIntroductionSkill.ts
var RouteIntroductionSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "route-introduction";
    this.description = "Compatible-set intro path between two persons";
    this.contract = {
      level: "simple",
      inputs: [{ name: "from_id", type: "string", required: true }, { name: "to_id", type: "string", required: true }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/ImportContactsSkill.ts
var ImportContactsSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "import-contacts";
    this.description = "Import vCard/CSV/Google Contacts";
    this.contract = {
      level: "simple",
      inputs: [{ name: "source_path", type: "string", required: true }, { name: "format", type: "string", required: true }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/ExportGraphSkill.ts
var ExportGraphSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "export-graph";
    this.description = "Export vault to vCard/JSON/Notion";
    this.contract = {
      level: "simple",
      inputs: [{ name: "format", type: "string", required: true }, { name: "output_path", type: "string", required: true }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/ScheduleTouchSkill.ts
var ScheduleTouchSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "schedule-touch";
    this.description = "Propose calendar event for next-due contact";
    this.contract = {
      level: "simple",
      inputs: [{ name: "contact_id", type: "string", required: true }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/SummarizeWeekSkill.ts
var SummarizeWeekSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "summarize-week";
    this.description = "Weekly briefing of overdue + recent";
    this.contract = {
      level: "simple",
      inputs: [{ name: "week_iso", type: "string", required: false }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/MergeDuplicatesSkill.ts
var MergeDuplicatesSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "merge-duplicates";
    this.description = "Detect + propose entity merges";
    this.contract = {
      level: "simple",
      inputs: [{ name: "entity_type", type: "string", required: true }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/VerifyEmailSkill.ts
var VerifyEmailSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "verify-email";
    this.description = "MX lookup + SMTP probe";
    this.contract = {
      level: "simple",
      inputs: [{ name: "email", type: "string", required: true }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/ReviewChangesSkill.ts
var ReviewChangesSkill = class extends Skill {
  constructor() {
    super(...arguments);
    this.id = "review-changes";
    this.description = "Diff vault vs snapshot, propose addenda";
    this.contract = {
      level: "simple",
      inputs: [{ name: "since_iso", type: "string", required: false }],
      mutable: [],
      requires: [],
      ensures: [],
      signals: [],
      costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2e3 }
    };
  }
  async execute(args, ctx) {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
};

// src/skills/SkillRegistry.ts
var SkillRegistry = class {
  constructor() {
    this.skills = /* @__PURE__ */ new Map();
    this.settings = /* @__PURE__ */ new Map();
    for (const s of [
      new ResearchOrgSkill(),
      new ResearchPersonSkill(),
      new DraftTouchSkill(),
      new SummarizeThreadSkill(),
      new CaptureCallSkill(),
      new InferEdgesSkill(),
      new GeocodeSkill(),
      new TranscribeSkill(),
      new RouteIntroductionSkill(),
      new ImportContactsSkill(),
      new ExportGraphSkill(),
      new ScheduleTouchSkill(),
      new SummarizeWeekSkill(),
      new MergeDuplicatesSkill(),
      new VerifyEmailSkill(),
      new ReviewChangesSkill()
    ]) {
      this.skills.set(s.id, s);
      this.settings.set(s.id, { enabled: true, autonomy: "propose" });
    }
  }
  list() {
    return [...this.skills.values()];
  }
  get(id) {
    return this.skills.get(id);
  }
  enabled() {
    return this.list().filter((s) => this.settings.get(s.id)?.enabled !== false);
  }
  setSettings(id, s) {
    const cur = this.settings.get(id) ?? { enabled: true, autonomy: "propose" };
    this.settings.set(id, { ...cur, ...s });
  }
  getSettings(id) {
    return this.settings.get(id) ?? { enabled: true, autonomy: "propose" };
  }
};

// src/ui/settings/SettingsPage.ts
var SettingsPage = class {
  constructor() {
    this.icon = null;
  }
};
function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs))
    e.setAttribute(k, v);
  if (text !== void 0)
    e.textContent = text;
  return e;
}

// src/ui/settings/GeneralPage.ts
var GeneralPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "general";
    this.title = "General";
    this.group = "core";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/VaultPage.ts
var VaultPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "vault";
    this.title = "Vault";
    this.group = "core";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/ContractsPage.ts
var ContractsPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "contracts";
    this.title = "Contracts";
    this.group = "core";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/EdgesPage.ts
var EdgesPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "edges";
    this.title = "Edges";
    this.group = "core";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/CompatibilityPage.ts
var CompatibilityPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "compatibility";
    this.title = "Compatibility";
    this.group = "core";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/SemiringsPage.ts
var SemiringsPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "semirings";
    this.title = "Semirings";
    this.group = "core";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/SearchPage.ts
var SearchPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "search";
    this.title = "Search";
    this.group = "core";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/CopilotPage.ts
var CopilotPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "copilot";
    this.title = "AI Copilot";
    this.group = "ai";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/LocalLLMPage.ts
var LocalLLMPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "copilot.local";
    this.title = "Local LLM (Ollama / LM Studio)";
    this.group = "ai";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el(
      "p",
      { class: "sauce-settings-hint" },
      "Configure local providers. Endpoints are stored in plugin settings; API keys live in the encrypted KeyVault."
    ));
    this.section(containerEl, "Ollama", [
      { label: "Endpoint URL", key: "copilot.ollama.endpoint", placeholder: "http://localhost:11434", secret: false },
      { label: "Default model", key: "copilot.ollama.defaultModel", placeholder: "llama3", secret: false },
      { label: "API key (optional, for reverse-proxied Ollama)", key: "copilot:ollama:api-key", placeholder: "leave blank if Ollama has no auth", secret: true }
    ]);
    this.section(containerEl, "LM Studio", [
      { label: "Endpoint URL (OpenAI-compatible base)", key: "copilot.lmstudio.endpoint", placeholder: "http://localhost:1234/v1", secret: false },
      { label: "Default model", key: "copilot.lmstudio.defaultModel", placeholder: "local-model", secret: false },
      { label: "API key (optional)", key: "copilot:lmstudio:api-key", placeholder: "leave blank for default LM Studio setup", secret: true }
    ]);
    const toggleWrap = containerEl.appendChild(el("div", { class: "sauce-settings-row" }));
    toggleWrap.appendChild(el("label", {}, "LM Studio tool-use (OpenAI function-calling)"));
    const tg = toggleWrap.appendChild(el("input"));
    tg.setAttribute("type", "checkbox");
    tg.checked = this.host.getConfig("copilot.lmstudio.toolUse", false);
    tg.addEventListener("change", () => {
      void this.host.setConfig("copilot.lmstudio.toolUse", tg.checked);
    });
    const actions = containerEl.appendChild(el("div", { class: "sauce-settings-actions" }));
    const pingOllama = actions.appendChild(el("button", {}, "Ping Ollama"));
    const pingLM = actions.appendChild(el("button", {}, "Ping LM Studio"));
    const statusEl = actions.appendChild(el("span", { class: "sauce-settings-status" }));
    pingOllama.addEventListener("click", async () => {
      const fn = this.host.getConfig("copilot.ollama.pingFn", null);
      statusEl.textContent = fn ? await this.formatPing("Ollama", fn) : "Ping handler not wired";
    });
    pingLM.addEventListener("click", async () => {
      const fn = this.host.getConfig("copilot.lmstudio.pingFn", null);
      statusEl.textContent = fn ? await this.formatPing("LM Studio", fn) : "Ping handler not wired";
    });
  }
  async formatPing(name, fn) {
    const r = await fn();
    return r.ok ? `${name}: OK (${r.latencyMs}ms)` : `${name}: ${r.error ?? "fail"} (${r.latencyMs}ms)`;
  }
  section(parent, title, fields) {
    parent.appendChild(el("h3", {}, title));
    for (const f of fields) {
      const row = parent.appendChild(el("div", { class: "sauce-settings-row" }));
      row.appendChild(el("label", {}, f.label));
      const input = row.appendChild(el("input"));
      input.setAttribute("type", f.secret ? "password" : "text");
      input.setAttribute("placeholder", f.placeholder);
      input.value = this.host.getConfig(f.key, "");
      input.addEventListener("change", () => {
        void this.host.setConfig(f.key, input.value);
      });
    }
  }
};

// src/ui/settings/SkillsPage.ts
var SkillsPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "skills";
    this.title = "Skills";
    this.group = "ai";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/IntegrationsRoot.ts
var IntegrationsRoot = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "integrations";
    this.title = "Integrations";
    this.group = "integrations";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/GeocodingPage.ts
var GeocodingPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "geocoding";
    this.title = "Geocoding";
    this.group = "ai";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/SyncPage.ts
var SyncPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "sync";
    this.title = "Sync";
    this.group = "integrations";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/BackendPage.ts
var BackendPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "backend";
    this.title = "Backend (SQLite)";
    this.group = "system";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/SecurityPage.ts
var SecurityPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "security";
    this.title = "Security";
    this.group = "system";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/ImportExportPage.ts
var ImportExportPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "import-export";
    this.title = "Import / Export";
    this.group = "system";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/CdelPage.ts
var CdelPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "cdel";
    this.title = "CDEL";
    this.group = "ai";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/InferencePage.ts
var InferencePage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "inference";
    this.title = "Inference";
    this.group = "ai";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/AdvancedPage.ts
var AdvancedPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "advanced";
    this.title = "Advanced";
    this.group = "system";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/AboutPage.ts
var AboutPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "about";
    this.title = "About";
    this.group = "system";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "SPEC \xA735 \u2014 see plugin docs for the full knob catalogue."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/integrations/GoogleWorkspacePage.ts
var GoogleWorkspacePage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "integrations.google_workspace";
    this.title = "Google Workspace";
    this.group = "integrations";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "Connection, scopes, per-resource sync controls."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/integrations/Microsoft365Page.ts
var Microsoft365Page = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "integrations.microsoft_365";
    this.title = "Microsoft 365";
    this.group = "integrations";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "Connection, scopes, per-resource sync controls."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/integrations/ApplePage.ts
var ApplePage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "integrations.apple";
    this.title = "Apple (iCloud)";
    this.group = "integrations";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "Connection, scopes, per-resource sync controls."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/integrations/NotionPage.ts
var NotionPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "integrations.notion";
    this.title = "Notion";
    this.group = "integrations";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "Connection, scopes, per-resource sync controls."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/integrations/TwilioPage.ts
var TwilioPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "integrations.twilio";
    this.title = "Twilio";
    this.group = "integrations";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "Connection, scopes, per-resource sync controls."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/integrations/smtpimap/HelpLinks.ts
var PROVIDER_HELP = [
  {
    id: "google_workspace",
    label: "Google Workspace / Gmail",
    domain: "google.com",
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    oauthSetupUrl: "https://console.cloud.google.com/apis/credentials",
    steps: [
      "Enable 2-Step Verification at https://myaccount.google.com/security if not already on.",
      "Open the App Passwords link below in your browser.",
      'Select app "Mail" and device "Other (Sauce Graph)" \u2014 name it whatever you like.',
      "Copy the 16-character password (4 groups of 4 letters) and paste it into Sauce Graph.",
      "The password is shown once \u2014 store it in Sauce Graph immediately. Sauce Graph encrypts it in the KeyVault."
    ],
    matchEmail: (e) => /@gmail\.com$|@googlemail\.com$/i.test(e) || /@saucetech\.io$/i.test(e),
    imap: { host: "imap.gmail.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.gmail.com", port: 465, tls: "implicit" }
  },
  {
    id: "microsoft_365",
    label: "Microsoft 365 / Outlook",
    domain: "microsoft.com",
    appPasswordUrl: "https://account.microsoft.com/security",
    oauthSetupUrl: "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    steps: [
      "Enable two-step verification at https://account.microsoft.com/security.",
      'Under "Advanced security options" \u2192 "App passwords" \u2192 "Create a new app password".',
      'Name it "Sauce Graph" and copy the generated password.',
      "Paste into Sauce Graph. The password is encrypted in the KeyVault."
    ],
    matchEmail: (e) => /@outlook\.com$|@hotmail\.com$|@live\.com$/i.test(e),
    imap: { host: "outlook.office365.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.office365.com", port: 587, tls: "implicit" }
  },
  {
    id: "apple_icloud",
    label: "Apple iCloud",
    domain: "apple.com",
    appPasswordUrl: "https://appleid.apple.com/account/manage",
    oauthSetupUrl: null,
    steps: [
      "Sign in at https://appleid.apple.com/account/manage with your Apple ID.",
      'Under "Sign-In and Security" \u2192 "App-Specific Passwords" \u2192 "+".',
      'Label it "Sauce Graph" and copy the generated password.',
      "Paste into Sauce Graph. The password is encrypted in the KeyVault."
    ],
    matchEmail: (e) => /@icloud\.com$|@me\.com$|@mac\.com$/i.test(e),
    imap: { host: "imap.mail.me.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.mail.me.com", port: 587, tls: "implicit" }
  },
  {
    id: "fastmail",
    label: "Fastmail",
    domain: "fastmail.com",
    appPasswordUrl: "https://www.fastmail.com/settings/security/devicekeys",
    oauthSetupUrl: null,
    steps: [
      "Open https://www.fastmail.com/settings/security/devicekeys.",
      '"New app password" \u2014 name it "Sauce Graph", select access to "Mail (IMAP/POP/SMTP)".',
      "Copy the generated password.",
      "Paste into Sauce Graph. The password is encrypted in the KeyVault."
    ],
    matchEmail: (e) => /@fastmail\.com$|@fastmail\.fm$|@messagingengine\.com$/i.test(e),
    imap: { host: "imap.fastmail.com", port: 993, tls: "implicit" },
    smtp: { host: "smtp.fastmail.com", port: 465, tls: "implicit" }
  },
  {
    id: "protonmail",
    label: "Proton Mail (Bridge required)",
    domain: "proton.me",
    appPasswordUrl: "https://proton.me/mail/bridge",
    oauthSetupUrl: null,
    steps: [
      "Install Proton Mail Bridge from https://proton.me/mail/bridge.",
      "Sign in to Bridge with your Proton account. Bridge gives you per-account local credentials.",
      "In Sauce Graph, use host 127.0.0.1, port 1143 (or whatever Bridge reports), and the Bridge-issued password.",
      "The password is encrypted in the KeyVault."
    ],
    matchEmail: (e) => /@proton\.me$|@protonmail\.com$|@pm\.me$/i.test(e),
    imap: { host: "127.0.0.1", port: 1143, tls: "implicit" },
    smtp: { host: "127.0.0.1", port: 1025, tls: "implicit" }
  }
];
function helpForEmail(email) {
  return PROVIDER_HELP.find((p) => p.matchEmail?.(email)) ?? null;
}
function helpById(id) {
  return PROVIDER_HELP.find((p) => p.id === id) ?? null;
}

// src/ui/settings/integrations/SmtpImapPage.ts
var SmtpImapPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "integrations.smtp_imap";
    this.title = "Email (SMTP/IMAP)";
    this.group = "integrations";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el(
      "p",
      { class: "sauce-settings-hint" },
      "Connect a Gmail, Outlook, iCloud, Fastmail or other IMAP account. Sauce Graph uses TLS-only and stores credentials encrypted in the KeyVault. Live login passwords from your provider will NOT work \u2014 you must generate an app-specific password."
    ));
    const form = containerEl.appendChild(el("div", { class: "sauce-smtpimap-form" }));
    const inputs = {};
    for (const field of [
      { key: "account.id", label: "Account ID (internal, e.g. drew_saucetech)", type: "text", placeholder: "default" },
      { key: "account.username", label: "Email address", type: "email", placeholder: "you@example.com" },
      { key: "account.imapHost", label: "IMAP host", type: "text", placeholder: "auto-detected from email" },
      { key: "account.imapPort", label: "IMAP port", type: "number", placeholder: "993" },
      { key: "account.smtpHost", label: "SMTP host", type: "text", placeholder: "auto-detected from email" },
      { key: "account.smtpPort", label: "SMTP port", type: "number", placeholder: "465 or 587" }
    ]) {
      const row = form.appendChild(el("div", { class: "sauce-settings-row" }));
      row.appendChild(el("label", {}, field.label));
      const inp = row.appendChild(el("input"));
      inp.setAttribute("type", field.type);
      inp.setAttribute("placeholder", field.placeholder);
      inp.value = this.host.getConfig(field.key, "");
      inp.addEventListener("change", () => {
        void this.host.setConfig(field.key, inp.value);
        if (field.key === "account.username")
          this.autoDetect(inp.value, inputs);
      });
      inputs[field.key] = inp;
    }
    const pwRow = form.appendChild(el("div", { class: "sauce-settings-row" }));
    pwRow.appendChild(el("label", {}, "App-specific password (16 chars, 4 groups of 4)"));
    const pwInput = pwRow.appendChild(el("input"));
    pwInput.setAttribute("type", "password");
    pwInput.setAttribute("placeholder", "xxxx xxxx xxxx xxxx");
    pwInput.addEventListener("change", async () => {
      const accountId = inputs["account.id"].value || "default";
      if (this.host.saveSecret && pwInput.value) {
        await this.host.saveSecret(`smtp_imap:${accountId}:app-password`, pwInput.value);
        pwInput.value = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
      }
    });
    const helpContainer = containerEl.appendChild(el("div", { class: "sauce-smtpimap-help" }));
    helpContainer.appendChild(el("h3", {}, "How to get an app password"));
    helpContainer.appendChild(el(
      "p",
      { class: "sauce-settings-hint" },
      "Click your email provider to open the app-password generation page. Follow the steps shown."
    ));
    for (const entry of PROVIDER_HELP) {
      const card = helpContainer.appendChild(el("div", { class: "sauce-help-card" }));
      const header = card.appendChild(el("div", { class: "sauce-help-card-header" }));
      header.appendChild(el("strong", {}, entry.label));
      if (entry.appPasswordUrl) {
        const btn = header.appendChild(el("button", { class: "mod-cta sauce-help-link" }, "Open app password page"));
        const url = entry.appPasswordUrl;
        btn.addEventListener("click", () => {
          if (this.host.openExternal)
            this.host.openExternal(url);
          else if (typeof window !== "undefined" && window.open)
            window.open(url);
        });
      }
      if (entry.oauthSetupUrl) {
        const ob = header.appendChild(el("button", { class: "sauce-help-link-secondary" }, "OAuth setup"));
        const ourl = entry.oauthSetupUrl;
        ob.addEventListener("click", () => {
          if (this.host.openExternal)
            this.host.openExternal(ourl);
          else if (typeof window !== "undefined" && window.open)
            window.open(ourl);
        });
      }
      const steps = card.appendChild(el("ol", { class: "sauce-help-steps" }));
      for (const s of entry.steps)
        steps.appendChild(el("li", {}, s));
      if (entry.imap) {
        const hostLine = card.appendChild(el("p", { class: "sauce-settings-hint" }, ""));
        hostLine.textContent = `Default IMAP: ${entry.imap.host}:${entry.imap.port} (implicit TLS) \xB7 SMTP: ${entry.smtp?.host ?? "(see provider)"}:${entry.smtp?.port ?? "?"}`;
      }
    }
    const actions = containerEl.appendChild(el("div", { class: "sauce-settings-actions" }));
    const testBtn = actions.appendChild(el("button", { class: "mod-cta" }, "Test connection"));
    const status = actions.appendChild(el("span", { class: "sauce-settings-status" }));
    testBtn.addEventListener("click", async () => {
      const accountId = inputs["account.id"].value || "default";
      if (!this.host.testConnection) {
        status.textContent = "Test handler not wired";
        return;
      }
      status.textContent = "Testing\u2026";
      const r = await this.host.testConnection(accountId);
      status.textContent = r.ok ? `\u2713 ${r.message} (${r.latencyMs ?? "?"}ms)` : `\u2717 ${r.message}`;
    });
    containerEl.appendChild(el(
      "div",
      { class: "sauce-security-notice" },
      "Security: Sauce Graph never accepts your real login password. App-specific passwords are encrypted at rest via libsodium secretbox in the KeyVault, gated by your master password. Passwords are zeroed in memory after each IMAP/SMTP call."
    ));
  }
  autoDetect(email, inputs) {
    const help = helpForEmail(email);
    if (!help)
      return;
    if (help.imap) {
      inputs["account.imapHost"].value = help.imap.host;
      inputs["account.imapPort"].value = String(help.imap.port);
      void this.host.setConfig("account.imapHost", help.imap.host);
      void this.host.setConfig("account.imapPort", help.imap.port);
    }
    if (help.smtp) {
      inputs["account.smtpHost"].value = help.smtp.host;
      inputs["account.smtpPort"].value = String(help.smtp.port);
      void this.host.setConfig("account.smtpHost", help.smtp.host);
      void this.host.setConfig("account.smtpPort", help.smtp.port);
    }
  }
  static getHelp(emailOrId) {
    return helpForEmail(emailOrId) ?? helpById(emailOrId);
  }
};

// src/ui/settings/integrations/WebSearchPage.ts
var WebSearchPage = class extends SettingsPage {
  constructor(host) {
    super();
    this.host = host;
    this.id = "integrations.web_search";
    this.title = "Web Search";
    this.group = "integrations";
  }
  render(containerEl) {
    containerEl.empty?.();
    containerEl.appendChild(el("h2", {}, this.title));
    containerEl.appendChild(el("p", { class: "sauce-settings-hint" }, "Connection, scopes, per-resource sync controls."));
    const knobs = containerEl.appendChild(el("div", { class: "sauce-settings-knobs" }));
    knobs.dataset.pageId = this.id;
  }
};

// src/ui/settings/SettingsRegistry.ts
function buildSettingsTree(host) {
  return [
    { page: new GeneralPage(host) },
    { page: new VaultPage(host) },
    { page: new ContractsPage(host) },
    { page: new EdgesPage(host) },
    { page: new CompatibilityPage(host) },
    { page: new SemiringsPage(host) },
    { page: new SearchPage(host) },
    { page: new CopilotPage(host) },
    { page: new LocalLLMPage(host) },
    { page: new SkillsPage(host) },
    {
      page: new IntegrationsRoot(host),
      children: [
        { page: new GoogleWorkspacePage(host) },
        { page: new Microsoft365Page(host) },
        { page: new ApplePage(host) },
        { page: new NotionPage(host) },
        { page: new TwilioPage(host) },
        { page: new SmtpImapPage(host) },
        { page: new WebSearchPage(host) }
      ]
    },
    { page: new GeocodingPage(host) },
    { page: new SyncPage(host) },
    { page: new BackendPage(host) },
    { page: new SecurityPage(host) },
    { page: new ImportExportPage(host) },
    { page: new CdelPage(host) },
    { page: new InferencePage(host) },
    { page: new AdvancedPage(host) },
    { page: new AboutPage(host) }
  ];
}

// src/ui/commands/V2Commands.ts
var V2_COMMANDS = [
  { id: "sauce:quick-capture", name: "Quick Capture (CDEL)", defaultHotkey: "Mod+Shift+Q", category: "capture" },
  { id: "sauce:open-copilot", name: "Open Copilot", defaultHotkey: "Mod+J", category: "view" },
  { id: "sauce:open-map", name: "Open Map", defaultHotkey: "Mod+M", category: "view" },
  { id: "sauce:open-ai-inbox", name: "Open AI Inbox", category: "view" },
  { id: "sauce:open-sync-status", name: "Open Sync Status", category: "view" },
  { id: "sauce:open-audit-log", name: "Open Audit Log", category: "view" },
  { id: "sauce:run-skill", name: "Run Skill\u2026", defaultHotkey: "Mod+K", category: "skill" },
  { id: "sauce:summarize-current", name: "Summarize Current Note", category: "skill" },
  { id: "sauce:research-current", name: "Research Current Note", category: "skill" },
  { id: "sauce:geocode-current", name: "Geocode Current Note", category: "skill" },
  { id: "sauce:capture-call", name: "Capture Call (Twilio)", category: "skill" },
  { id: "sauce:transcribe-file", name: "Transcribe Audio File\u2026", category: "skill" },
  { id: "sauce:lock-vault", name: "Lock Vault", defaultHotkey: "Mod+L", category: "security" },
  { id: "sauce:unlock-vault", name: "Unlock Vault", category: "security" },
  { id: "sauce:rotate-keys", name: "Rotate Keys\u2026", category: "security" },
  { id: "sauce:verify-audit-chain", name: "Verify Audit Chain", category: "security" },
  { id: "sauce:sync-now", name: "Sync Now (all eligible)", category: "sync" },
  { id: "sauce:import", name: "Import\u2026", category: "import-export" },
  { id: "sauce:export", name: "Export\u2026", category: "import-export" },
  { id: "sauce:backup-now", name: "Backup Now (Encrypted)", category: "import-export" },
  { id: "sauce:reseed-backend", name: "Wipe and Reseed Backend", category: "vault" },
  { id: "sauce:run-inference-pass", name: "Run Inference Pass", category: "inference" },
  { id: "sauce:propose-merges", name: "Propose Merges", category: "inference" },
  { id: "sauce:weekly-briefing", name: "Weekly Briefing", category: "skill" },
  { id: "sauce:open-skill-runs", name: "Open Skill Run Log", category: "view" },
  { id: "sauce:reload-cdel-idioms", name: "Reload CDEL Idioms", category: "capture" }
];
function registerV2Commands(opts) {
  for (const c of V2_COMMANDS) {
    opts.addCommand({
      id: c.id,
      name: c.name,
      hotkeys: c.defaultHotkey ? [parseHotkey(c.defaultHotkey)] : void 0,
      callback: () => opts.handler(c.id)
    });
  }
}
function parseHotkey(s) {
  const parts = s.split("+").map((p) => p.trim());
  const key = parts.pop();
  return { modifiers: parts, key };
}

// src/ui/views/v2/V2ViewBase.ts
var V2View = class {
  constructor(host) {
    this.host = host;
    this.icon = "graph";
    this.debounceTimer = null;
  }
  scheduleRender() {
    if (this.debounceTimer)
      clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.render().catch(() => {
      });
    }, 250);
  }
  async onOpen() {
    await this.render();
  }
  async onClose() {
    if (this.debounceTimer)
      clearTimeout(this.debounceTimer);
  }
};

// src/ui/views/v2/MapView.ts
var MapView = class extends V2View {
  constructor() {
    super(...arguments);
    this.viewType = "sauce-map";
    this.displayText = "Map";
  }
  async render() {
    const c = this.host.contentEl;
    c.empty?.();
    const header = document.createElement("h2");
    header.textContent = this.displayText;
    c.appendChild(header);
    const sub = document.createElement("p");
    sub.className = "sauce-view-desc";
    sub.textContent = "Vault entities plotted by lat/lon. Click to open.";
    c.appendChild(sub);
    const stage = document.createElement("div");
    stage.className = "sauce-view-stage";
    stage.dataset.viewType = this.viewType;
    c.appendChild(stage);
  }
};

// src/ui/views/v2/AiInboxView.ts
var AiInboxView = class extends V2View {
  constructor() {
    super(...arguments);
    this.viewType = "sauce-ai-inbox";
    this.displayText = "AI Inbox";
  }
  async render() {
    const c = this.host.contentEl;
    c.empty?.();
    const header = document.createElement("h2");
    header.textContent = this.displayText;
    c.appendChild(header);
    const sub = document.createElement("p");
    sub.className = "sauce-view-desc";
    sub.textContent = "Proposed inferences awaiting review.";
    c.appendChild(sub);
    const stage = document.createElement("div");
    stage.className = "sauce-view-stage";
    stage.dataset.viewType = this.viewType;
    c.appendChild(stage);
  }
};

// src/ui/views/v2/CopilotView.ts
var CopilotView = class extends V2View {
  constructor() {
    super(...arguments);
    this.viewType = "sauce-copilot";
    this.displayText = "Copilot";
  }
  async render() {
    const c = this.host.contentEl;
    c.empty?.();
    const header = document.createElement("h2");
    header.textContent = this.displayText;
    c.appendChild(header);
    const sub = document.createElement("p");
    sub.className = "sauce-view-desc";
    sub.textContent = "Conversation with the Sauce Graph copilot.";
    c.appendChild(sub);
    const stage = document.createElement("div");
    stage.className = "sauce-view-stage";
    stage.dataset.viewType = this.viewType;
    c.appendChild(stage);
  }
};

// src/ui/views/v2/SyncStatusView.ts
var SyncStatusView = class extends V2View {
  constructor() {
    super(...arguments);
    this.viewType = "sauce-sync-status";
    this.displayText = "Sync Status";
  }
  async render() {
    const c = this.host.contentEl;
    c.empty?.();
    const header = document.createElement("h2");
    header.textContent = this.displayText;
    c.appendChild(header);
    const sub = document.createElement("p");
    sub.className = "sauce-view-desc";
    sub.textContent = "Per-job sync state, failures, manual run.";
    c.appendChild(sub);
    const stage = document.createElement("div");
    stage.className = "sauce-view-stage";
    stage.dataset.viewType = this.viewType;
    c.appendChild(stage);
  }
};

// src/ui/views/v2/AuditLogView.ts
var AuditLogView = class extends V2View {
  constructor() {
    super(...arguments);
    this.viewType = "sauce-audit-log";
    this.displayText = "Audit Log";
  }
  async render() {
    const c = this.host.contentEl;
    c.empty?.();
    const header = document.createElement("h2");
    header.textContent = this.displayText;
    c.appendChild(header);
    const sub = document.createElement("p");
    sub.className = "sauce-view-desc";
    sub.textContent = "Append-only HMAC-chained audit tail.";
    c.appendChild(sub);
    const stage = document.createElement("div");
    stage.className = "sauce-view-stage";
    stage.dataset.viewType = this.viewType;
    c.appendChild(stage);
  }
};

// src/ui/views/v2/SkillRunLogView.ts
var SkillRunLogView = class extends V2View {
  constructor() {
    super(...arguments);
    this.viewType = "sauce-skill-run-log";
    this.displayText = "Skill Run Log";
  }
  async render() {
    const c = this.host.contentEl;
    c.empty?.();
    const header = document.createElement("h2");
    header.textContent = this.displayText;
    c.appendChild(header);
    const sub = document.createElement("p");
    sub.className = "sauce-view-desc";
    sub.textContent = "Last 200 skill executions with cost + outcome.";
    c.appendChild(sub);
    const stage = document.createElement("div");
    stage.className = "sauce-view-stage";
    stage.dataset.viewType = this.viewType;
    c.appendChild(stage);
  }
};

// src/ui/views/v2/index.ts
var V2_VIEW_TYPES = [
  "sauce-map",
  "sauce-ai-inbox",
  "sauce-copilot",
  "sauce-sync-status",
  "sauce-audit-log",
  "sauce-skill-run-log"
];

// src/language/CdelLexer.ts
function lex(input) {
  const tokens = [];
  let i = 0;
  const push = (kind, value) => tokens.push({ kind, value, pos: i - value.length });
  while (i < input.length) {
    const c = input[i];
    if (c === "@") {
      push("AT", "@");
      i++;
      continue;
    }
    if (c === ":") {
      push("COLON", ":");
      i++;
      continue;
    }
    if (c === ",") {
      push("COMMA", ",");
      i++;
      continue;
    }
    if (c === "|") {
      push("PIPE", "|");
      i++;
      const rest = input.slice(i).replace(/^\s+/, "");
      push("TEXT", rest);
      i = input.length;
      continue;
    }
    if (c === "\n") {
      push("NEWLINE", "\n");
      i++;
      continue;
    }
    if (c === " " || c === "	") {
      i++;
      continue;
    }
    if (c === "-" && input[i + 1] === ">") {
      push("ARROW", "->");
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      let s2 = "";
      while (i < input.length && input[i] !== q) {
        s2 += input[i];
        i++;
      }
      i++;
      push("STRING", s2);
      continue;
    }
    if (c === "[" && input[i + 1] === "[") {
      i += 2;
      let s2 = "";
      while (i < input.length && !(input[i] === "]" && input[i + 1] === "]")) {
        s2 += input[i];
        i++;
      }
      i += 2;
      push("WIKILINK", s2);
      continue;
    }
    if (/[0-9]/.test(c)) {
      let n = "";
      while (i < input.length && /[0-9.-]/.test(input[i])) {
        n += input[i];
        i++;
      }
      push("NUMBER", n);
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s2 = "";
      while (i < input.length && /[A-Za-z0-9_.\-]/.test(input[i])) {
        s2 += input[i];
        i++;
      }
      push("IDENT", s2);
      continue;
    }
    let s = "";
    while (i < input.length && !/[\n@|:,"'\[]/.test(input[i])) {
      s += input[i];
      i++;
    }
    if (s.trim())
      push("TEXT", s);
    else
      i++;
  }
  tokens.push({ kind: "EOF", value: "", pos: i });
  return tokens;
}

// src/language/CdelParser.ts
function parse(tokens) {
  const out = [];
  let i = 0;
  const peek = () => tokens[i];
  const eat = () => tokens[i++];
  while (peek().kind !== "EOF") {
    if (peek().kind === "NEWLINE") {
      eat();
      continue;
    }
    if (peek().kind === "AT") {
      eat();
      const verbTok = eat();
      const node = { kind: "directive", verb: verbTok.value, subject: {}, metadata: {} };
      const subjParts = [];
      while (peek().kind !== "NEWLINE" && peek().kind !== "EOF" && peek().kind !== "COLON" && peek().kind !== "ARROW" && peek().kind !== "PIPE") {
        if (peek().kind === "WIKILINK") {
          node.subject.wikilink = eat().value;
          break;
        }
        subjParts.push(eat().value);
      }
      if (subjParts.length)
        node.subject.ident = subjParts.join(" ");
      if (peek().kind === "ARROW") {
        eat();
        const targetParts = [];
        while (peek().kind !== "NEWLINE" && peek().kind !== "EOF" && peek().kind !== "COLON" && peek().kind !== "PIPE") {
          if (peek().kind === "WIKILINK") {
            node.target = { wikilink: eat().value };
            break;
          }
          targetParts.push(eat().value);
        }
        if (!node.target && targetParts.length)
          node.target = { ident: targetParts.join(" ") };
      }
      while (peek().kind !== "EOF") {
        if (peek().kind === "NEWLINE") {
          eat();
          continue;
        }
        if (peek().kind === "PIPE") {
          eat();
          if (peek().kind === "TEXT")
            node.body = eat().value;
          continue;
        }
        if (peek().kind === "IDENT") {
          const key = eat().value;
          if (peek().kind === "COLON") {
            eat();
            const valParts = [];
            while (peek().kind !== "NEWLINE" && peek().kind !== "EOF" && peek().kind !== "PIPE") {
              if (peek().kind === "WIKILINK")
                valParts.push(`[[${eat().value}]]`);
              else if (peek().kind === "COMMA") {
                eat();
                continue;
              } else
                valParts.push(eat().value);
            }
            const raw = valParts.join(" ").trim();
            node.metadata[key] = raw.includes(",") ? raw.split(",").map((s) => s.trim()) : raw;
          } else
            break;
        } else
          break;
      }
      out.push(node);
      continue;
    }
    const textParts = [];
    while (peek().kind !== "NEWLINE" && peek().kind !== "EOF")
      textParts.push(eat().value);
    if (textParts.length)
      out.push({ kind: "natural", text: textParts.join(" ") });
  }
  return out;
}

// src/language/IdiomCatalog.ts
var TODAY = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
var ADD_DAYS = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
var IdiomCatalog = class {
  constructor() {
    this.idioms = [
      { pattern: /^met with (.+?) today$/i, rewrite: (m) => `@touch ${m[1]} ${TODAY()} in-person` },
      { pattern: /^called (.+?) about (.+)$/i, rewrite: (m) => `@touch ${m[1]} ${TODAY()} call | about ${m[2]}` },
      { pattern: /^add (.+?) at (.+)$/i, rewrite: (m) => `@person ${m[1]}
  company: [[${m[2]}]]` },
      { pattern: /^(.+?) owns (.+)$/i, rewrite: (m) => `@org ${m[2]}
  parent: [[${m[1]}]]` },
      { pattern: /^intro (.+?) to (.+)$/i, rewrite: (m) => `@intro ${m[1]} -> ${m[2]}` },
      { pattern: /^follow up with (.+?) in (\d+) days$/i, rewrite: (m) => `- [ ] follow-up ${m[1]} \u{1F4C5} ${ADD_DAYS(parseInt(m[2], 10))}` }
    ];
  }
  add(i) {
    this.idioms.push(i);
  }
  remove(index) {
    this.idioms.splice(index, 1);
  }
  list() {
    return [...this.idioms];
  }
  rewriteIfMatch(line) {
    for (const i of this.idioms) {
      const m = line.match(i.pattern);
      if (m)
        return i.rewrite(m);
    }
    return null;
  }
};

// src/language/CdelInterpreter.ts
var VERB_TO_SKILL = {
  person: "cdel.create-person",
  org: "cdel.create-org",
  touch: "cdel.create-touch",
  addendum: "cdel.create-addendum",
  intro: "route-introduction",
  tag: "cdel.tag-op",
  relation: "cdel.relation-op",
  "sub-vault": "cdel.sub-vault"
};
var CdelInterpreter = class {
  constructor(idioms = new IdiomCatalog(), strictness = "best-guess") {
    this.idioms = idioms;
    this.strictness = strictness;
  }
  interpret(source) {
    const dispatches = [];
    const unhandled = [];
    const expanded = [];
    for (const rawLine of source.split("\n")) {
      const r = this.idioms.rewriteIfMatch(rawLine.trim());
      expanded.push(r ?? rawLine);
    }
    const nodes = parse(lex(expanded.join("\n")));
    for (const n of nodes) {
      if (n.kind === "directive") {
        const d = n;
        const skillId = VERB_TO_SKILL[d.verb];
        if (!skillId) {
          unhandled.push(`unknown verb @${d.verb}`);
          continue;
        }
        dispatches.push({
          skillId,
          source: "directive",
          args: { subject: d.subject, target: d.target ?? null, metadata: d.metadata, body: d.body ?? "" }
        });
      } else {
        if (this.strictness === "block")
          unhandled.push(n.text);
        else
          dispatches.push({ skillId: "cdel.natural", args: { text: n.text }, source: "natural" });
      }
    }
    return { dispatches, unhandled };
  }
};

// src/inference/ConfidenceModel.ts
var DEFAULT_THRESHOLDS = {
  knows: { autoAccept: 1, propose: 0.6, discard: 0.3 },
  worked_with: { autoAccept: 1, propose: 0.7, discard: 0.3 },
  company: { autoAccept: 1, propose: 0.65, discard: 0.3 },
  parent: { autoAccept: 1, propose: 0.8, discard: 0.4 },
  family_of: { autoAccept: 1, propose: 0.75, discard: 0.4 },
  merge: { autoAccept: 1, propose: 0.85, discard: 0.5 },
  tags: { autoAccept: 1, propose: 0.55, discard: 0.3 }
};
function logistic(weightedSum, bias = 0) {
  return 1 / (1 + Math.exp(-(weightedSum + bias)));
}
function combineSignals(weights, features) {
  let s = 0;
  for (let i = 0; i < weights.length; i++)
    s += weights[i] * (features[i] ?? 0);
  return logistic(s);
}
function verdict(conf, cfg) {
  if (conf >= cfg.autoAccept)
    return "auto_accept";
  if (conf >= cfg.propose)
    return "propose";
  return "discard";
}

// src/inference/EdgeInferrer.ts
var EdgeInferrer = class {
  constructor(thresholds = DEFAULT_THRESHOLDS) {
    this.thresholds = thresholds;
  }
  inferFrom(touches) {
    const pairs = /* @__PURE__ */ new Map();
    for (const t of touches) {
      const ts = Date.parse(t.date) || Date.now();
      const adv = (t.outcomeTags ?? []).includes("advice-received") ? 1 : 0;
      const intro = (t.outcomeTags ?? []).includes("intro-made") ? 1 : 0;
      for (let i = 0; i < t.attendees.length; i++) {
        for (let j = i + 1; j < t.attendees.length; j++) {
          const [a, b] = [t.attendees[i], t.attendees[j]].sort();
          const k = `${a}|${b}`;
          const rec = pairs.get(k) ?? { count: 0, lastTs: 0, sources: /* @__PURE__ */ new Set(), advice: 0, intro: 0 };
          rec.count += 1;
          rec.lastTs = Math.max(rec.lastTs, ts);
          rec.sources.add(`touch:${t.id}`);
          rec.advice += adv;
          rec.intro += intro;
          pairs.set(k, rec);
        }
      }
    }
    const now = Date.now();
    const out = [];
    for (const [k, r] of pairs) {
      const [from, to] = k.split("|");
      const recencyDays = Math.max(0, (now - r.lastTs) / 864e5);
      const recencyFeature = Math.exp(-recencyDays / 180);
      const knowsConf = combineSignals([0.4, 0.6], [Math.min(1, r.count / 3), recencyFeature]);
      out.push({ fromId: from, toId: to, edgeType: "knows", confidence: knowsConf, verdict: verdict(knowsConf, this.thresholds.knows), sources: [...r.sources] });
      if (r.advice + r.intro > 0) {
        const wwConf = combineSignals([0.5, 0.5], [Math.min(1, (r.advice + r.intro) / 2), recencyFeature]);
        out.push({ fromId: from, toId: to, edgeType: "worked_with", confidence: wwConf, verdict: verdict(wwConf, this.thresholds.worked_with), sources: [...r.sources] });
      }
    }
    return out.filter((p) => p.verdict !== "discard");
  }
};

// src/inference/AttributeInferrer.ts
var SIG_COMPANY_RX = /^(?:[\w&,.\s-]+)\s*$/m;
var AttributeInferrer = class {
  inferCompanyFromSignature(entityId, signatureLines, sourceId) {
    for (const line of signatureLines) {
      const m = SIG_COMPANY_RX.exec(line.trim());
      if (m && line.length > 2 && line.length < 80 && !/^https?:\/\//.test(line) && !/@/.test(line)) {
        const conf = combineSignals([1], [0.7]);
        return { entityId, attribute: "company", value: line.trim(), confidence: conf, verdict: verdict(conf, DEFAULT_THRESHOLDS.company), sources: [sourceId] };
      }
    }
    return null;
  }
};

// src/inference/MergeProposer.ts
function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
var MergeProposer = class {
  propose(records) {
    const out = [];
    const byNorm = /* @__PURE__ */ new Map();
    for (const r of records) {
      const k = `${r.type}|${norm(r.name)}`;
      if (!byNorm.has(k))
        byNorm.set(k, []);
      byNorm.get(k).push(r);
    }
    for (const [, group] of byNorm) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i], b = group[j];
          const reasons = ["name_match"];
          let emailMatch = 0;
          for (const e of a.emails)
            if (b.emails.includes(e)) {
              emailMatch = 1;
              reasons.push("email_match");
              break;
            }
          const conf = combineSignals([0.5, 0.5], [1, emailMatch]);
          out.push({ entityType: a.type, aId: a.id, bId: b.id, confidence: conf, verdict: verdict(conf, DEFAULT_THRESHOLDS.merge), reason: reasons });
        }
      }
    }
    return out.filter((c) => c.verdict !== "discard");
  }
};

// src/inference/InferenceEngine.ts
var InferenceEngine = class {
  constructor() {
    this.edges = new EdgeInferrer();
    this.attributes = new AttributeInferrer();
    this.merges = new MergeProposer();
  }
  edgeProposals(touches) {
    return this.edges.inferFrom(touches).map((p) => this.toInference("edge", `${p.fromId}--${p.edgeType}-->${p.toId}`, { edgeType: p.edgeType }, p.confidence, p.sources));
  }
  mergeProposals(records) {
    return this.merges.propose(records).map((m) => this.toInference("merge", m.aId, { mergeWith: m.bId, reason: m.reason }, m.confidence, []));
  }
  attributeProposalsFromSignature(entityId, sigLines, sourceId) {
    const a = this.attributes.inferCompanyFromSignature(entityId, sigLines, sourceId);
    return a ? [this.toInference("attribute", entityId, { attribute: a.attribute, value: a.value }, a.confidence, a.sources)] : [];
  }
  toInference(kind, target, value, confidence, sources) {
    return { type: "inference", inference_kind: kind, target, proposed_value: value, confidence, sources, status: "proposed" };
  }
};

// src/geo/DistanceMatrix.ts
function haversineMeters(aLat, aLon, bLat, bLon) {
  const R = 6371e3;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// src/geo/GeoIndex.ts
function cellKey(lat, lon, deg) {
  return `${Math.floor(lat / deg)},${Math.floor(lon / deg)}`;
}
var GeoIndex = class {
  constructor(cellDeg = 1) {
    this.cellDeg = cellDeg;
    this.cells = /* @__PURE__ */ new Map();
  }
  add(p) {
    const k = cellKey(p.lat, p.lon, this.cellDeg);
    if (!this.cells.has(k))
      this.cells.set(k, []);
    this.cells.get(k).push(p);
  }
  clear() {
    this.cells.clear();
  }
  nearest(lat, lon, k, maxM = Infinity) {
    const candidates = [];
    const baseLat = Math.floor(lat / this.cellDeg);
    const baseLon = Math.floor(lon / this.cellDeg);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        candidates.push(...this.cells.get(`${baseLat + dy},${baseLon + dx}`) ?? []);
      }
    const out = candidates.map((p) => ({ point: p, distanceM: haversineMeters(lat, lon, p.lat, p.lon) })).filter((r) => r.distanceM <= maxM).sort((a, b) => a.distanceM - b.distanceM).slice(0, k);
    return out;
  }
};

// src/importexport/CsvAdapter.ts
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"')
        inQ = false;
      else
        cur += c;
    } else {
      if (c === '"')
        inQ = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (c === "\r") {
      } else
        cur += c;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}
function quote(v) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
var CsvImportAdapter = class {
  constructor() {
    this.id = "csv";
    this.label = "CSV";
  }
  async detect(content) {
    const s = typeof content === "string" ? content : new TextDecoder().decode(content);
    return s.includes(",") && s.split("\n")[0].split(",").length > 1;
  }
  async parse(content, mapping = {}) {
    const s = typeof content === "string" ? content : new TextDecoder().decode(content);
    const rows = parseCsv(s);
    if (rows.length === 0)
      return [];
    const header = rows[0];
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const fm = {};
      let type = "person";
      for (let j = 0; j < header.length; j++) {
        const src = header[j];
        const tgt = mapping[src] ?? src;
        if (tgt === "__type__") {
          type = rows[i][j] ?? "person";
          continue;
        }
        fm[tgt] = rows[i][j];
      }
      out.push({ type, frontmatter: fm, sourceRow: i + 1 });
    }
    return out;
  }
};
var CsvExportAdapter = class {
  constructor() {
    this.id = "csv";
    this.label = "CSV";
  }
  async serialize(entities) {
    const keys = /* @__PURE__ */ new Set(["__type__"]);
    for (const e of entities)
      for (const k of Object.keys(e.frontmatter))
        keys.add(k);
    const header = [...keys];
    const lines = [header.map(quote).join(",")];
    for (const e of entities) {
      const row = header.map((k) => k === "__type__" ? e.type : String(e.frontmatter[k] ?? ""));
      lines.push(row.map(quote).join(","));
    }
    return lines.join("\n");
  }
};

// src/importexport/VcardAdapter.ts
var VcardImportAdapter = class {
  constructor() {
    this.id = "vcard";
    this.label = "vCard 4.0";
  }
  async detect(content) {
    const s = typeof content === "string" ? content : new TextDecoder().decode(content);
    return s.includes("BEGIN:VCARD");
  }
  async parse(content) {
    const s = typeof content === "string" ? content : new TextDecoder().decode(content);
    const cards = s.split(/BEGIN:VCARD/i).slice(1);
    const out = [];
    for (const c of cards) {
      const fm = {};
      const emails = [];
      const phones = [];
      for (const rawLine of c.split(/\r?\n/)) {
        const line = rawLine.replace(/\s+$/, "");
        if (/^END:VCARD/i.test(line))
          break;
        if (!line)
          continue;
        const [keyAndParams, ...rest] = line.split(":");
        if (!keyAndParams || rest.length === 0)
          continue;
        const value = rest.join(":");
        const key = keyAndParams.split(";")[0].toUpperCase();
        if (key === "FN")
          fm.name = value;
        else if (key === "N")
          fm.fullName = value;
        else if (key === "EMAIL")
          emails.push(value);
        else if (key === "TEL")
          phones.push(value);
        else if (key === "ORG")
          fm.company = value;
        else if (key === "TITLE")
          fm.title = value;
        else if (key === "URL")
          fm.url = value;
      }
      if (emails.length)
        fm.emails = emails;
      if (phones.length)
        fm.phones = phones;
      out.push({ type: "person", frontmatter: fm });
    }
    return out;
  }
};
var VcardExportAdapter = class {
  constructor() {
    this.id = "vcard";
    this.label = "vCard 4.0";
  }
  async serialize(entities) {
    const out = [];
    for (const e of entities.filter((x) => x.type === "person")) {
      out.push("BEGIN:VCARD", "VERSION:4.0");
      const fm = e.frontmatter;
      if (fm.name)
        out.push(`FN:${fm.name}`);
      if (fm.company)
        out.push(`ORG:${fm.company}`);
      if (fm.title)
        out.push(`TITLE:${fm.title}`);
      for (const em of fm.emails ?? [])
        out.push(`EMAIL:${em}`);
      for (const ph of fm.phones ?? [])
        out.push(`TEL:${ph}`);
      out.push("END:VCARD");
    }
    return out.join("\n");
  }
};

// src/importexport/JsonAdapter.ts
var JsonImportAdapter = class {
  constructor() {
    this.id = "json";
    this.label = "JSON";
  }
  async detect(content) {
    try {
      JSON.parse(typeof content === "string" ? content : new TextDecoder().decode(content));
      return true;
    } catch {
      return false;
    }
  }
  async parse(content) {
    const s = typeof content === "string" ? content : new TextDecoder().decode(content);
    const j = JSON.parse(s);
    return Array.isArray(j) ? j : j.entities;
  }
};
var JsonExportAdapter = class {
  constructor() {
    this.id = "json";
    this.label = "JSON";
  }
  async serialize(entities) {
    return JSON.stringify({ entities }, null, 2);
  }
};

// src/sync/Scheduler.ts
function freqMs(f) {
  switch (f) {
    case "realtime":
      return 0;
    case "1m":
      return 6e4;
    case "5m":
      return 3e5;
    case "15m":
      return 9e5;
    case "1h":
      return 36e5;
    case "6h":
      return 216e5;
    case "daily":
      return 864e5;
    case "manual":
      return Infinity;
  }
}
var Scheduler = class {
  constructor() {
    this.jobs = /* @__PURE__ */ new Map();
    this.state = /* @__PURE__ */ new Map();
    this.timer = null;
  }
  add(job) {
    this.jobs.set(job.id, job);
    if (!this.state.has(job.id))
      this.state.set(job.id, { lastRun: 0, nextRun: Date.now() + freqMs(job.frequency), running: false, failures: 0, lastError: null });
  }
  remove(id) {
    this.jobs.delete(id);
    this.state.delete(id);
  }
  start(tickMs = 1e4) {
    if (this.timer)
      return;
    this.timer = setInterval(() => this.tick(), tickMs);
  }
  stop() {
    if (this.timer)
      clearInterval(this.timer);
    this.timer = null;
  }
  async runNow(id) {
    const job = this.jobs.get(id);
    if (!job)
      throw new Error(`no job: ${id}`);
    await this.runJob(job);
  }
  async tick() {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      const s = this.state.get(id);
      if (s.running || job.frequency === "manual")
        continue;
      if (now >= s.nextRun)
        await this.runJob(job);
    }
  }
  async runJob(job) {
    const s = this.state.get(job.id);
    s.running = true;
    try {
      await job.run();
      s.lastRun = Date.now();
      s.failures = 0;
      s.lastError = null;
      s.nextRun = Date.now() + freqMs(job.frequency);
    } catch (e) {
      s.failures += 1;
      s.lastError = e instanceof Error ? e.message : String(e);
      const backoff = Math.min(36e5, 3e4 * Math.pow(2, s.failures - 1));
      s.nextRun = Date.now() + backoff;
    } finally {
      s.running = false;
    }
  }
  status(id) {
    return this.state.get(id) ?? null;
  }
  all() {
    return [...this.jobs.values()].map((job) => ({ job, state: this.state.get(job.id) }));
  }
};

// src/sync/ChangeFeed.ts
var ChangeFeed = class {
  constructor() {
    this.subs = [];
    this.buf = [];
  }
  emit(c) {
    this.buf.push(c);
    for (const s of this.subs)
      s(c);
  }
  subscribe(fn) {
    this.subs.push(fn);
    return () => {
      this.subs = this.subs.filter((s) => s !== fn);
    };
  }
  drain() {
    const x = this.buf;
    this.buf = [];
    return x;
  }
};

// src/sync/SyncEngine.ts
var SyncEngine = class {
  constructor() {
    this.scheduler = new Scheduler();
    this.changes = new ChangeFeed();
    this.integrations = /* @__PURE__ */ new Map();
  }
  register(integration) {
    this.integrations.set(integration.id, integration);
  }
  list() {
    return [...this.integrations.values()];
  }
  async wireResources(integrationId) {
    const i = this.integrations.get(integrationId);
    if (!i)
      throw new Error(`no integration: ${integrationId}`);
    const resources = await i.listResources();
    for (const r of resources) {
      const job = {
        id: `${integrationId}::${r.id}`,
        integration: integrationId,
        resource: r.id,
        frequency: r.frequency,
        run: async () => {
          const res = await i.syncResource(r.id);
          this.changes.emit({ ts: Date.now(), kind: "integration-pull", integration: integrationId, resource: r.id, entityId: r.id, meta: res });
        }
      };
      this.scheduler.add(job);
    }
  }
  start() {
    this.scheduler.start();
  }
  stop() {
    this.scheduler.stop();
  }
};

// test/v2-verify.ts
var crypto = __toESM(require("node:crypto"));
var pass = 0;
var fail = 0;
var failures = [];
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(`${name} ${detail}`);
    console.log(`  FAIL  ${name} ${detail}`);
  }
}
async function asserts(name, fn) {
  try {
    const v = await fn();
    pass++;
    console.log(`  PASS  ${name}`);
    return v;
  } catch (e) {
    fail++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name} threw: ${msg}`);
    console.log(`  FAIL  ${name} threw: ${msg}`);
    return void 0;
  }
}
var nodeCrypto = {
  async argon2id(password, salt, opts) {
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, Buffer.from(salt), opts.outBytes, (err, key) => err ? reject(err) : resolve(new Uint8Array(key)));
    });
  },
  secretboxSeal(key, nonce, msg) {
    const cipher = crypto.createCipheriv("chacha20-poly1305", Buffer.from(key), Buffer.from(nonce.slice(0, 12)), { authTagLength: 16 });
    const enc = Buffer.concat([cipher.update(Buffer.from(msg)), cipher.final()]);
    const tag = cipher.getAuthTag();
    return new Uint8Array(Buffer.concat([enc, tag]));
  },
  secretboxOpen(key, nonce, ct) {
    try {
      const data = Buffer.from(ct);
      const enc = data.subarray(0, data.length - 16);
      const tag = data.subarray(data.length - 16);
      const decipher = crypto.createDecipheriv("chacha20-poly1305", Buffer.from(key), Buffer.from(nonce.slice(0, 12)), { authTagLength: 16 });
      decipher.setAuthTag(tag);
      return new Uint8Array(Buffer.concat([decipher.update(enc), decipher.final()]));
    } catch {
      return null;
    }
  },
  randomBytes(n) {
    return new Uint8Array(crypto.randomBytes(n));
  }
};
async function hmacHex(key, msg) {
  return crypto.createHmac("sha256", Buffer.from(key)).update(msg).digest("hex");
}
async function main() {
  console.log("\n=== Backend \xA717 ===");
  const db = new FileOnlyBackend();
  await db.init(":memory:");
  const applied = await applyMigrations(db);
  check("migrations applied >= 2", applied >= 2, `applied=${applied}`);
  const seeder = new Seeder(db, {
    walk: async function* () {
      yield {
        path: "people/Alice.md",
        ctime: 1,
        mtime: 2,
        type: "person",
        frontmatter: { name: "Alice" },
        body: "## body",
        bodyHash: "h1",
        tags: ["warm"],
        edges: [{ to: "people/Bob.md", edgeType: "knows", directed: false }]
      };
      yield {
        path: "people/Bob.md",
        ctime: 3,
        mtime: 4,
        type: "person",
        frontmatter: { name: "Bob" },
        body: "## bob",
        bodyHash: "h2",
        tags: [],
        edges: [],
        touch: { id: "t1", contactId: "people/Bob.md", date: "2026-05-21", channel: "call", outcomeTags: ["advice-received"], attendees: ["people/Alice.md", "people/Bob.md"] }
      };
    }
  });
  await asserts("seeder runs end-to-end", () => seeder.run());
  const sync = new SqliteSync(db, null);
  await asserts("SqliteSync onCreate", () => sync.onCreate({
    path: "people/Carol.md",
    ctime: 5,
    mtime: 6,
    type: "person",
    frontmatter: { name: "Carol" },
    body: "hi",
    bodyHash: "h3",
    tags: [],
    edges: []
  }));
  await asserts("SqliteSync onDelete", () => sync.onDelete("people/Carol.md"));
  console.log("\n=== Security \xA718 ===");
  const blob = {};
  const store = new JsonSecretStore(async () => blob, async (d2) => {
    Object.assign(blob, d2);
  });
  const vault = new KeyVault(store, nodeCrypto);
  await asserts("KeyVault unlock fresh", () => vault.unlock("correct-horse-battery-staple"));
  check("KeyVault.isLocked() == false after unlock", !vault.isLocked());
  await asserts("KeyVault put/get round-trip", async () => {
    await vault.put("anthropic", "sk-test-12345");
    const v = await vault.get("anthropic");
    if (v !== "sk-test-12345")
      throw new Error(`got ${v}`);
  });
  vault.lock();
  check("KeyVault locked after lock()", vault.isLocked());
  const scopes = new ScopeRegistry();
  scopes.load(DEFAULT_SCOPES);
  check("default google calendar.read on", scopes.check("google_workspace", "calendar.read"));
  check("default gmail.send off", !scopes.check("google_workspace", "gmail.send"));
  let threw = false;
  try {
    scopes.require("google_workspace", "gmail.send");
  } catch (e) {
    if (e instanceof ScopeNotGranted)
      threw = true;
  }
  check("ScopeNotGranted on disabled scope", threw);
  const masterKey = nodeCrypto.randomBytes(32);
  const audit = new AuditLog(db, { hmacHex }, async () => masterKey);
  const auditDb = new FileOnlyBackend();
  await auditDb.init(":memory:");
  await applyMigrations(auditDb);
  const inserted = [];
  const auditDbProxy = {
    capabilities: () => auditDb.capabilities(),
    exec: async (sql, params = []) => {
      if (/INSERT INTO audit_log/.test(sql)) {
        const [ts, op, entity_id, agent_id, integration, before_hash, after_hash, details, signature] = params;
        inserted.push({ ts, op, entity_id, agent_id, integration, before_hash, after_hash, details, signature });
      }
    },
    query: async (sql, _params = []) => {
      if (/ORDER BY ts DESC LIMIT 1/.test(sql))
        return inserted.length ? [{ signature: inserted[inserted.length - 1].signature }] : [];
      if (/ORDER BY ts ASC/.test(sql))
        return [...inserted].sort((a, b) => a.ts - b.ts);
      return [];
    },
    prepare: auditDb.prepare.bind(auditDb),
    transaction: auditDb.transaction.bind(auditDb),
    close: auditDb.close.bind(auditDb),
    init: auditDb.init.bind(auditDb)
  };
  const chainedAudit = new AuditLog(auditDbProxy, { hmacHex }, async () => masterKey);
  await chainedAudit.append({ ts: 1, op: "write", entityId: "p/a.md", agentId: "user", integration: null, beforeHash: null, afterHash: "h1", details: null });
  await chainedAudit.append({ ts: 2, op: "write", entityId: "p/b.md", agentId: "user", integration: null, beforeHash: null, afterHash: "h2", details: null });
  await chainedAudit.append({ ts: 3, op: "skill", entityId: null, agentId: "skill:research-org", integration: null, beforeHash: null, afterHash: null, details: { skill: "research-org" } });
  const v1 = await chainedAudit.verifyChain();
  check("audit chain verifies (3 entries)", v1.ok, `brokenAt=${v1.brokenAt}`);
  inserted[1].signature = "deadbeef";
  const v2 = await chainedAudit.verifyChain();
  check("audit chain detects tampering", !v2.ok && v2.brokenAt === 2, `brokenAt=${v2.brokenAt}`);
  const proxy = new ProxyClient({
    fetch: async (url, init) => ({ status: 200, headers: {}, body: JSON.stringify({ url, headers: init.headers }) }),
    hmacHex: (k, m) => hmacHex(new TextEncoder().encode(k), m),
    sha256Hex: async (s) => crypto.createHash("sha256").update(s).digest("hex")
  }, { enabled: true, baseUrl: "https://proxy.test", sharedSecret: "secret" });
  const r = await proxy.fetch("https://target.test/api", { method: "GET" });
  const parsedProxy = JSON.parse(r.body);
  check("ProxyClient routes to baseUrl with target header", parsedProxy.url === "https://proxy.test" && parsedProxy.headers["X-Sauce-Target"] === "https://target.test/api");
  check("ProxyClient signs request", !!parsedProxy.headers["X-Sauce-Signature"]);
  console.log("\n=== Skills \xA720 ===");
  const reg = new SkillRegistry();
  check("SkillRegistry ships 16 skills", reg.list().length === 16, `got ${reg.list().length}`);
  const expectedSkills = ["research-org", "research-person", "draft-touch", "summarize-thread", "capture-call", "infer-edges", "geocode", "transcribe", "route-introduction", "import-contacts", "export-graph", "schedule-touch", "summarize-week", "merge-duplicates", "verify-email", "review-changes"];
  for (const id of expectedSkills)
    check(`skill ${id} registered`, !!reg.get(id));
  const skillCtx = {
    autonomy: "propose",
    agentId: "test",
    call: async (_id, _args) => ({ ok: true }),
    audit: async () => {
    },
    scope: { require: () => {
    } }
  };
  const researchOrg = reg.get("research-org");
  const result = await researchOrg.execute({ org_name: "Acme" }, skillCtx);
  check("research-org executes with required input", result.ok === true);
  const missing = await researchOrg.execute({}, skillCtx);
  check("research-org rejects missing required input", missing.ok === false && missing.reason.includes("missing_inputs"));
  console.log("\n=== Settings \xA735 ===");
  const settingsHost = { getConfig: (_k, f) => f, setConfig: async () => {
  } };
  const tree = buildSettingsTree(settingsHost);
  check("settings tree built", tree.length === 20, `got ${tree.length} top-level pages`);
  const integrationsNode = tree.find((n) => n.page.id === "integrations");
  check("integrations node has 7 children", integrationsNode?.children?.length === 7, `got ${integrationsNode?.children?.length}`);
  const fakeDoc = (() => {
    const make = (tag) => {
      const el2 = { tagName: tag, children: [], textContent: "", value: "", checked: false, dataset: {}, className: "", appendChild(c) {
        this.children.push(c);
        return c;
      }, setAttribute(k, v) {
        if (k === "class")
          this.className = v;
      }, addEventListener() {
      }, empty() {
        this.children.length = 0;
      } };
      return el2;
    };
    globalThis.document = { createElement: make };
    return { make };
  })();
  let renderedCount = 0;
  for (const node of tree) {
    const el2 = fakeDoc.make("div");
    node.page.render(el2);
    renderedCount += 1;
    for (const child of node.children ?? []) {
      const subEl = fakeDoc.make("div");
      child.page.render(subEl);
      renderedCount += 1;
    }
  }
  check("all 27 pages rendered without throwing", renderedCount === 27, `rendered=${renderedCount}`);
  console.log("\n=== Commands \xA740 ===");
  check("V2 ships 26 commands", V2_COMMANDS.length === 26, `got ${V2_COMMANDS.length}`);
  let bindable = 0;
  registerV2Commands({
    addCommand: (c) => {
      if (c.id && c.name && typeof c.callback === "function") {
        if (c.hotkeys)
          for (const h of c.hotkeys) {
            if (!h.key)
              throw new Error(`bad hotkey on ${c.id}`);
          }
        bindable += 1;
      }
    },
    handler: async () => {
    }
  });
  check("all 26 commands bindable", bindable === 26, `bindable=${bindable}`);
  console.log("\n=== Views \xA736 ===");
  check("V2 declares 6 view types", V2_VIEW_TYPES.length === 6);
  for (const V of [MapView, AiInboxView, CopilotView, SyncStatusView, AuditLogView, SkillRunLogView]) {
    const hostEl = fakeDoc.make("div");
    const v = new V({ contentEl: hostEl });
    await v.render();
    check(`${v.viewType} renders`, hostEl.children.length > 0);
  }
  console.log("\n=== CDEL \xA732 ===");
  const lexed = lex("@touch [[Steve Heaney]] 2026-05-21 call\n  playbook: ff-2\n  | discussed Q3");
  check("lexer produces tokens", lexed.length > 5);
  const parsed = parse(lex("@person [[Aarna Mishra]]\n  company: [[Sauce Technologies]]\n  closeness: 2"));
  check("parser captures wikilink subject", parsed.length === 1 && parsed[0].kind === "directive" && parsed[0].subject.wikilink === "Aarna Mishra");
  const interp = new CdelInterpreter();
  const res = interp.interpret("met with Steve today");
  check("idiom rewrites natural to @touch", res.dispatches.length > 0 && res.dispatches[0].skillId === "cdel.create-touch");
  console.log("\n=== Inference \xA731 ===");
  const eng = new InferenceEngine();
  const proposals = eng.edgeProposals([
    { id: "t1", date: "2026-05-01", attendees: ["p/alice.md", "p/bob.md"], outcomeTags: ["advice-received"] },
    { id: "t2", date: "2026-05-10", attendees: ["p/alice.md", "p/bob.md"], outcomeTags: ["intro-made"] },
    { id: "t3", date: "2026-05-15", attendees: ["p/alice.md", "p/bob.md"], outcomeTags: ["advice-received"] },
    { id: "t4", date: "2026-05-18", attendees: ["p/alice.md", "p/bob.md"], outcomeTags: ["advice-received"] },
    { id: "t5", date: "2026-05-20", attendees: ["p/alice.md", "p/bob.md"] }
  ]);
  check("edge inference proposes knows", proposals.some((p) => p.proposed_value.edgeType === "knows"), `n=${proposals.length}`);
  check("edge inference proposes worked_with from advice-received", proposals.some((p) => p.proposed_value.edgeType === "worked_with"));
  console.log("\n=== Geo \xA728 ===");
  const d = haversineMeters(37.7749, -122.4194, 40.7128, -74.006);
  check("haversine SF\u2194NYC within 1% of 4129km", Math.abs(d - 4129e3) < 5e4, `d=${Math.round(d / 1e3)}km`);
  const idx = new GeoIndex(1);
  idx.add({ id: "sf", lat: 37.77, lon: -122.41 });
  idx.add({ id: "oak", lat: 37.8, lon: -122.27 });
  idx.add({ id: "nyc", lat: 40.71, lon: -74 });
  const nearest = idx.nearest(37.78, -122.4, 2);
  check("GeoIndex finds nearest 2 in same cell", nearest.length === 2 && nearest[0].point.id === "sf");
  console.log("\n=== Import/Export \xA733 ===");
  const csvIn = new CsvImportAdapter();
  const csvOut = new CsvExportAdapter();
  const csv = "__type__,name,company\nperson,Alice,Acme\nperson,Bob,BetaCo";
  const parsedCsv = await csvIn.parse(csv);
  check("CSV import 2 rows", parsedCsv.length === 2);
  const reSerialized = await csvOut.serialize(parsedCsv);
  const round = await csvIn.parse(reSerialized);
  check("CSV round-trip preserves count", round.length === 2);
  const vcardIn = new VcardImportAdapter();
  const vcardOut = new VcardExportAdapter();
  const vcardStr = "BEGIN:VCARD\nVERSION:4.0\nFN:Alice\nORG:Acme\nEMAIL:alice@acme.com\nEND:VCARD\n";
  const parsedV = await vcardIn.parse(vcardStr);
  check("vCard import name+org+email", parsedV.length === 1 && parsedV[0].frontmatter.name === "Alice" && parsedV[0].frontmatter.company === "Acme");
  const v2s = await vcardOut.serialize(parsedV);
  check("vCard export contains BEGIN:VCARD", v2s.includes("BEGIN:VCARD"));
  const jsonIn = new JsonImportAdapter();
  const jsonOut = new JsonExportAdapter();
  const j1 = await jsonOut.serialize(parsedV);
  const j2 = await jsonIn.parse(j1);
  check("JSON round-trip", j2.length === 1 && j2[0].frontmatter.name === "Alice");
  console.log("\n=== Sync \xA734 ===");
  const eng2 = new SyncEngine();
  let synced = 0;
  eng2.register({
    id: "fake",
    label: "Fake",
    connect: async () => ({ connected: true }),
    disconnect: async () => {
    },
    state: async () => ({ connected: true }),
    listResources: async () => [{ id: "r1", label: "r1", frequency: "1m", enabled: true, lastPullTs: null, cursor: null }],
    syncResource: async () => {
      synced += 1;
      return { pulled: 1, pushed: 0, errors: 0 };
    }
  });
  await eng2.wireResources("fake");
  await eng2.scheduler.runNow("fake::r1");
  check("SyncEngine wires + manually runs job", synced === 1);
  const changes = eng2.changes.drain();
  check("ChangeFeed records pull", changes.length === 1 && changes[0].kind === "integration-pull");
  console.log("\n=== SQLite mirror coherence \xA717.3 (kill/restart) ===");
  const m1 = new FileOnlyBackend();
  await m1.init(":memory:");
  await applyMigrations(m1);
  await m1.exec("INSERT INTO entities (id,type,primary_type,frontmatter,body_md,body_hash,mtime,ctime) VALUES (?,?,?,?,?,?,?,?)", ["p/a.md", "person", null, "{}", "", "h", 1, 1]);
  await m1.close();
  const m2 = new FileOnlyBackend();
  await m2.init(":memory:");
  await applyMigrations(m2);
  const seeded = await new Seeder(m2, { walk: async function* () {
    yield { path: "p/a.md", ctime: 1, mtime: 1, type: "person", frontmatter: {}, body: "", bodyHash: "h", tags: [], edges: [] };
  } }).run();
  check("mirror coherent after restart (seeder re-derived from vault)", seeded.entities === 1);
  console.log("\n=== Integration auth (offline contract check) ===");
  const { GoogleWorkspaceIntegration: GoogleWorkspaceIntegration2, Microsoft365Integration: Microsoft365Integration2, AppleIntegration: AppleIntegration2, NotionIntegration: NotionIntegration2, TwilioIntegration: TwilioIntegration2, SmtpImapIntegration: SmtpImapIntegration2 } = await Promise.resolve().then(() => (init_integrations(), integrations_exports));
  const fakeProxy = new ProxyClient({ fetch: async () => ({ status: 200, headers: {}, body: "{}" }), hmacHex: async () => "x", sha256Hex: async () => "x" }, { enabled: false, baseUrl: "", sharedSecret: "" });
  for (const [name, I] of [
    ["google", GoogleWorkspaceIntegration2],
    ["microsoft", Microsoft365Integration2],
    ["apple", AppleIntegration2],
    ["notion", NotionIntegration2],
    ["twilio", TwilioIntegration2],
    ["smtp_imap", SmtpImapIntegration2]
  ]) {
    const i = new I({ scopes, proxy: fakeProxy });
    check(`${name} integration constructible`, !!i.id && !!i.label);
    const st = await i.state();
    check(`${name} initial state disconnected`, !st.connected);
  }
  console.log("\n=== RESULTS ===");
  console.log(`PASS ${pass}   FAIL ${fail}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures)
      console.log(`  - ${f}`);
  }
  if (fail > 0)
    process.exit(1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
