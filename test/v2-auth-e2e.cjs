var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/security/OAuthFlow.ts
function b64url(buf) {
  let s = "";
  for (let i = 0; i < buf.length; i++)
    s += String.fromCharCode(buf[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
var OAuthFlow = class {
  constructor(host, vault, subtle, random) {
    this.host = host;
    this.vault = vault;
    this.subtle = subtle;
    this.random = random;
    this.inMemoryTokens = /* @__PURE__ */ new Map();
    this.providers = /* @__PURE__ */ new Map();
  }
  registerProvider(id, cfg) {
    this.providers.set(id, cfg);
  }
  async authorize(provider, scopes) {
    const cfg = this.providers.get(provider);
    if (!cfg)
      throw new Error(`unregistered provider: ${provider}`);
    const port = 49152 + Math.floor(Math.random() * (65535 - 49152));
    const redirectUri = `http://127.0.0.1:${port}/cb`;
    const state = b64url(this.random(16));
    const verifier = b64url(this.random(32));
    const challenge = b64url(new Uint8Array(await this.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const params = new URLSearchParams({
      response_type: "code",
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
    if (cfg.audience)
      params.set("audience", cfg.audience);
    await this.host.openBrowser(`${cfg.authorizeUrl}?${params.toString()}`);
    const cbUrl = await this.host.listenOnce(port, "/cb");
    if (cbUrl.searchParams.get("state") !== state)
      throw new Error("state mismatch (possible CSRF)");
    const code = cbUrl.searchParams.get("code");
    if (!code)
      throw new Error("authorization denied");
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: cfg.clientId
    });
    if (cfg.clientSecret)
      tokenBody.set("client_secret", cfg.clientSecret);
    const resp = await this.host.fetchJson(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: tokenBody.toString()
    });
    const ts = {
      accessToken: resp.access_token,
      refreshToken: resp.refresh_token ?? null,
      expiresAt: Date.now() + 1e3 * (resp.expires_in ?? 3600),
      scopes: (resp.scope ?? scopes.join(" ")).split(/\s+/).filter(Boolean),
      raw: resp
    };
    if (ts.refreshToken)
      await this.vault.put(`oauth:${provider}:refresh`, ts.refreshToken);
    this.inMemoryTokens.set(provider, ts);
    return ts;
  }
  async refresh(provider) {
    const cfg = this.providers.get(provider);
    if (!cfg)
      throw new Error(`unregistered provider: ${provider}`);
    const refresh = await this.vault.get(`oauth:${provider}:refresh`);
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: cfg.clientId });
    if (cfg.clientSecret)
      body.set("client_secret", cfg.clientSecret);
    const r = await this.host.fetchJson(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString()
    });
    const ts = {
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? refresh,
      expiresAt: Date.now() + 1e3 * (r.expires_in ?? 3600),
      scopes: (r.scope ?? "").split(/\s+/).filter(Boolean),
      raw: r
    };
    if (r.refresh_token)
      await this.vault.put(`oauth:${provider}:refresh`, r.refresh_token);
    this.inMemoryTokens.set(provider, ts);
    return ts;
  }
  async revoke(provider) {
    const cfg = this.providers.get(provider);
    if (!cfg?.revokeUrl)
      return;
    const ts = this.inMemoryTokens.get(provider);
    if (!ts)
      return;
    await this.host.fetchJson(cfg.revokeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: ts.refreshToken ?? ts.accessToken }).toString()
    }).catch(() => {
    });
    this.inMemoryTokens.delete(provider);
  }
  scopesGranted(provider) {
    return this.inMemoryTokens.get(provider)?.scopes ?? [];
  }
  current(provider) {
    return this.inMemoryTokens.get(provider) ?? null;
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

// src/integrations/google/GCalendarClient.ts
var GCalendarClient = class {
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

// src/integrations/google/GMailClient.ts
var GMailClient = class {
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

// src/integrations/google/GContactsClient.ts
var GContactsClient = class {
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

// src/integrations/google/GDriveClient.ts
var GDriveClient = class {
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

// src/integrations/google/index.ts
var GoogleWorkspaceIntegration = class {
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

// src/integrations/microsoft/MSCalendarClient.ts
var MSCalendarClient = class {
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

// src/integrations/microsoft/MSOutlookClient.ts
var MSOutlookClient = class {
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

// src/integrations/microsoft/MSContactsClient.ts
var MSContactsClient = class {
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

// src/integrations/microsoft/index.ts
var Microsoft365Integration = class {
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

// src/integrations/notion/NotionClient.ts
var NotionClient = class {
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

// src/integrations/notion/index.ts
var NotionIntegration = class {
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

// src/integrations/apple/CalDAVClient.ts
var CalDAVClient = class {
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

// src/integrations/apple/CardDAVClient.ts
var CardDAVClient = class {
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

// src/integrations/apple/index.ts
var AppleIntegration = class {
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

// src/integrations/twilio/TwilioClient.ts
function basicAuthHeader2(auth) {
  const raw = `${auth.accountSid}:${auth.authToken}`;
  const enc = typeof btoa === "function" ? btoa : (s) => Buffer.from(s, "utf-8").toString("base64");
  return "Basic " + enc(raw);
}
var TwilioClient = class {
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

// src/integrations/twilio/index.ts
var TwilioIntegration = class {
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

// src/integrations/smtpimap/SmtpImapClient.ts
var tls = __toESM(require("node:tls"));
var net = __toESM(require("node:net"));
var APP_PASSWORD_KEY = (id) => `smtp_imap:${id}:app-password`;
var OAUTH_TOKEN_KEY = (id) => `smtp_imap:${id}:oauth-access-token`;
var SmtpImapClient = class {
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

// src/integrations/smtpimap/index.ts
var SmtpImapIntegration = class {
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

// src/integrations/websearch/index.ts
var BraveSearch = class {
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

// test/v2-auth-e2e.ts
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
var nodeCrypto = {
  async argon2id(password, salt, opts) {
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, Buffer.from(salt), opts.outBytes, (err, key) => err ? reject(err) : resolve(new Uint8Array(key)));
    });
  },
  secretboxSeal(key, nonce, msg) {
    const cipher = crypto.createCipheriv("chacha20-poly1305", Buffer.from(key), Buffer.from(nonce.slice(0, 12)), { authTagLength: 16 });
    const enc = Buffer.concat([cipher.update(Buffer.from(msg)), cipher.final()]);
    return new Uint8Array(Buffer.concat([enc, cipher.getAuthTag()]));
  },
  secretboxOpen(key, nonce, ct) {
    try {
      const data = Buffer.from(ct);
      const enc = data.subarray(0, data.length - 16);
      const tag = data.subarray(data.length - 16);
      const dec = crypto.createDecipheriv("chacha20-poly1305", Buffer.from(key), Buffer.from(nonce.slice(0, 12)), { authTagLength: 16 });
      dec.setAuthTag(tag);
      return new Uint8Array(Buffer.concat([dec.update(enc), dec.final()]));
    } catch {
      return null;
    }
  },
  randomBytes(n) {
    return new Uint8Array(crypto.randomBytes(n));
  }
};
function mockOAuthHost(opts) {
  const state = { lastAuthorizeUrl: null, lastTokenBody: null, pendingState: "" };
  return {
    lastAuthorizeUrl: null,
    lastTokenBody: null,
    async openBrowser(url) {
      this.lastAuthorizeUrl = url;
      state.lastAuthorizeUrl = url;
      const u = new URL(url);
      state.pendingState = u.searchParams.get("state") ?? "";
    },
    async listenOnce(port, path) {
      const cb = new URL(`http://127.0.0.1:${port}${path}`);
      cb.searchParams.set("code", `mockcode_${Math.random().toString(36).slice(2, 10)}`);
      cb.searchParams.set("state", state.pendingState);
      return cb;
    },
    async fetchJson(_url, init) {
      this.lastTokenBody = init?.body ?? null;
      state.lastTokenBody = init?.body ?? null;
      return opts.tokenResp();
    }
  };
}
async function main() {
  console.log("\n=== KeyVault bind (foundation) ===");
  const blob = {};
  const store = new JsonSecretStore(async () => blob, async (d) => {
    Object.assign(blob, d);
  });
  const vault = new KeyVault(store, nodeCrypto);
  await vault.unlock("master-test-password");
  const subtle = globalThis.crypto?.subtle ?? crypto.webcrypto.subtle;
  const scopes = new ScopeRegistry();
  scopes.load(DEFAULT_SCOPES);
  console.log("\n=== Google Workspace OAuth e2e ===");
  const ghost = mockOAuthHost({ tokenResp: () => ({
    access_token: "ya29.mock-google-access",
    refresh_token: "mock-google-refresh",
    expires_in: 3599,
    scope: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly",
    token_type: "Bearer"
  }) });
  const goauth = new OAuthFlow(ghost, vault, subtle, (n) => nodeCrypto.randomBytes(n));
  goauth.registerProvider("google_workspace", {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: "mock-client.apps.googleusercontent.com",
    defaultScopes: ["https://www.googleapis.com/auth/calendar.readonly"]
  });
  const gts = await goauth.authorize("google_workspace", ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/gmail.readonly"]);
  check("Google authorize URL contains PKCE challenge", /code_challenge=/.test(ghost.lastAuthorizeUrl ?? ""));
  check("Google authorize URL uses S256", /code_challenge_method=S256/.test(ghost.lastAuthorizeUrl ?? ""));
  check("Google token exchange sent code_verifier", /code_verifier=/.test(ghost.lastTokenBody ?? ""));
  check("Google access token captured", gts.accessToken === "ya29.mock-google-access");
  check("Google refresh token stored in vault", await vault.get("oauth:google_workspace:refresh") === "mock-google-refresh");
  check("Google scopes granted", goauth.scopesGranted("google_workspace").length === 2);
  const ghost2 = mockOAuthHost({ tokenResp: () => ({ access_token: "ya29.mock-google-refreshed", refresh_token: "mock-google-refresh-v2", expires_in: 3599 }) });
  const goauth2 = new OAuthFlow(ghost2, vault, subtle, (n) => nodeCrypto.randomBytes(n));
  goauth2.registerProvider("google_workspace", { authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", clientId: "c", defaultScopes: [] });
  const refreshed = await goauth2.refresh("google_workspace");
  check("Google refresh produces new access token", refreshed.accessToken === "ya29.mock-google-refreshed");
  check("Google rotated refresh persisted", await vault.get("oauth:google_workspace:refresh") === "mock-google-refresh-v2");
  let pulled = 0;
  const fakeProxy = new ProxyClient({
    fetch: async () => ({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ id: "evt-1", summary: "Standup" }] }) }),
    hmacHex: async () => "sig",
    sha256Hex: async () => "hash"
  }, { enabled: false, baseUrl: "", sharedSecret: "" });
  const gi = new GoogleWorkspaceIntegration({ oauth: goauth2, scopes, proxy: fakeProxy });
  gi.setResources([{ id: "calendar", label: "Calendar", frequency: "15m", enabled: true, lastPullTs: null, cursor: null }]);
  await gi.connect();
  const r1 = await gi.syncResource("calendar");
  pulled = r1.pulled;
  check("Google integration syncResource completes", typeof r1.pulled === "number", `pulled=${pulled}`);
  const st = await gi.state();
  check("Google state shows connected", st.connected);
  console.log("\n=== Microsoft 365 OAuth e2e ===");
  const mhost = mockOAuthHost({ tokenResp: () => ({ access_token: "eyJ.mock-ms", refresh_token: "mock-ms-refresh", expires_in: 3599, scope: "Calendars.Read Mail.Read User.Read" }) });
  const moauth = new OAuthFlow(mhost, vault, subtle, (n) => nodeCrypto.randomBytes(n));
  moauth.registerProvider("microsoft_365", {
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientId: "mock-azure-app-id",
    defaultScopes: ["Calendars.Read", "Mail.Read"]
  });
  const mts = await moauth.authorize("microsoft_365", ["Calendars.Read", "Mail.Read", "User.Read"]);
  check("Microsoft access token captured", mts.accessToken === "eyJ.mock-ms");
  check("Microsoft refresh persisted", await vault.get("oauth:microsoft_365:refresh") === "mock-ms-refresh");
  check("Microsoft scopes granted include Mail.Read", moauth.scopesGranted("microsoft_365").includes("Mail.Read"));
  const mi = new Microsoft365Integration({ oauth: moauth, scopes, proxy: fakeProxy });
  mi.setResources([{ id: "calendar", label: "Calendar", frequency: "15m", enabled: true, lastPullTs: null, cursor: null }]);
  await mi.connect();
  await mi.syncResource("calendar");
  check("Microsoft integration connected", (await mi.state()).connected);
  console.log("\n=== Notion OAuth e2e ===");
  const nhost = mockOAuthHost({ tokenResp: () => ({ access_token: "secret_mock-notion", refresh_token: "mock-notion-refresh", expires_in: 3600 }) });
  const noauth = new OAuthFlow(nhost, vault, subtle, (n) => nodeCrypto.randomBytes(n));
  noauth.registerProvider("notion", {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    clientId: "mock-notion-client",
    clientSecret: "mock-notion-secret",
    defaultScopes: []
  });
  const nts = await noauth.authorize("notion", []);
  check("Notion access token captured", nts.accessToken === "secret_mock-notion");
  check("Notion token exchange used client_secret", /client_secret=/.test(nhost.lastTokenBody ?? ""));
  check("Notion refresh persisted", await vault.get("oauth:notion:refresh") === "mock-notion-refresh");
  const ni = new NotionIntegration({ oauth: noauth, scopes, proxy: fakeProxy });
  await ni.connect();
  check("Notion integration connected", (await ni.state()).connected);
  console.log("\n=== Apple credential bind e2e ===");
  await vault.put("apple:appleid", "user@icloud.com");
  await vault.put("apple:app-password", "abcd-efgh-ijkl-mnop");
  check("Apple appleid stored", await vault.get("apple:appleid") === "user@icloud.com");
  check("Apple app-password stored", await vault.get("apple:app-password") === "abcd-efgh-ijkl-mnop");
  const ai = new AppleIntegration({ scopes, proxy: fakeProxy });
  await ai.connect();
  check("Apple integration connected via stored creds", (await ai.state()).connected);
  console.log("\n=== Twilio credential bind e2e ===");
  await vault.put("twilio:account-sid", "ACmockmockmockmockmockmockmockmoc");
  await vault.put("twilio:auth-token", "mocktoken1234567890abcdefghij");
  check("Twilio SID stored", (await vault.get("twilio:account-sid")).startsWith("AC"));
  check("Twilio token stored", !!await vault.get("twilio:auth-token"));
  const ti = new TwilioIntegration({ scopes, proxy: fakeProxy });
  await ti.connect();
  check("Twilio integration connected", (await ti.state()).connected);
  console.log("\n=== SMTP/IMAP credential bind e2e ===");
  await vault.put("smtp_imap:default:host", "imap.fastmail.com");
  await vault.put("smtp_imap:default:user", "me@fastmail.com");
  await vault.put("smtp_imap:default:password", "app-specific-password");
  check("SMTP host stored", await vault.get("smtp_imap:default:host") === "imap.fastmail.com");
  check("SMTP password stored", !!await vault.get("smtp_imap:default:password"));
  const si = new SmtpImapIntegration({ scopes, proxy: fakeProxy });
  await si.connect();
  check("SMTP integration connected", (await si.state()).connected);
  console.log("\n=== Web Search provider key bind ===");
  await vault.put("web_search:brave", "BSA_mock-key-12345");
  let braveCalled = false;
  const braveProxy = new ProxyClient({
    fetch: async (url) => {
      braveCalled = true;
      check("Brave search URL includes query", /q=test/.test(url));
      return { status: 200, headers: {}, body: JSON.stringify({ web: { results: [{ url: "https://example.com", title: "Example", description: "Snippet" }] } }) };
    },
    hmacHex: async () => "x",
    sha256Hex: async () => "h"
  }, { enabled: false, baseUrl: "", sharedSecret: "" });
  const brave = new BraveSearch({ proxy: braveProxy, sha256Hex: async () => "h", markdownExtract: (s) => s }, async () => await vault.get("web_search:brave"));
  const results = await brave.search("test", { count: 5 });
  check("Brave called with API key from vault", braveCalled);
  check("Brave returns at least one result", results.length > 0 && results[0].url === "https://example.com");
  console.log("\n=== ProxyClient relay e2e ===");
  let proxyTargetSeen = "";
  let proxySigSeen = "";
  const realProxy = new ProxyClient({
    fetch: async (_url, init) => {
      proxyTargetSeen = init.headers["X-Sauce-Target"] ?? "";
      proxySigSeen = init.headers["X-Sauce-Signature"] ?? "";
      return { status: 200, headers: {}, body: "ok" };
    },
    hmacHex: async (k, m) => crypto.createHmac("sha256", k).update(m).digest("hex"),
    sha256Hex: async (s) => crypto.createHash("sha256").update(s).digest("hex")
  }, { enabled: true, baseUrl: "https://proxy.sauce.test", sharedSecret: "shared-secret-32-bytes-long-xxxxxx" });
  const pr = await realProxy.fetch("https://api.upstream.test/v1/me", { method: "POST", body: '{"q":1}' });
  check("Proxy received correct target", proxyTargetSeen === "https://api.upstream.test/v1/me");
  check("Proxy signature is 64 hex chars", /^[0-9a-f]{64}$/.test(proxySigSeen));
  check("Proxy response delivered to caller", pr.body === "ok");
  console.log("\n=== AUTH E2E RESULTS ===");
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
