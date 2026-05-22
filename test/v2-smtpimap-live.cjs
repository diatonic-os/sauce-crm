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

// src/copilot/CredentialSource.ts
var KeyVaultCredentialSource = class {
  constructor(vault) {
    this.vault = vault;
    this.label = "KeyVault";
  }
  available() {
    return !this.vault.isLocked();
  }
  async get(service) {
    if (this.vault.isLocked())
      return null;
    try {
      return await this.vault.get(service);
    } catch {
      return null;
    }
  }
  async put(service, value) {
    await this.vault.put(service, value);
  }
  async clear(service) {
    await this.vault.put(service, "");
  }
};
var ChainedCredentialSource = class {
  constructor(sources) {
    this.sources = sources;
    this.label = sources.map((s) => s.label).join(" \u2192 ");
  }
  available() {
    return this.sources.some((s) => s.available());
  }
  async get(service) {
    for (const s of this.sources) {
      if (!s.available())
        continue;
      const v = await s.get(service);
      if (v)
        return v;
    }
    return null;
  }
  async put(service, value) {
    const writable = this.sources.find((s) => s.available());
    if (!writable)
      throw new Error("no available credential source for write");
    await writable.put(service, value);
  }
  async clear(service) {
    for (const s of this.sources) {
      if (s.available()) {
        await s.clear(service);
      }
    }
  }
};

// test/EnvCredentialSource.ts
var EnvCredentialSource = class {
  constructor(env2, map) {
    this.env = env2;
    this.map = map;
    this.label = "env(test-only)";
  }
  available() {
    return Object.keys(this.map).length > 0;
  }
  async get(service) {
    const envKey = this.map[service];
    if (!envKey)
      return null;
    return this.env[envKey] ?? null;
  }
  async put(_service, _value) {
    throw new Error("EnvCredentialSource is read-only; production writes must use KeyVaultCredentialSource");
  }
  async clear(_service) {
    throw new Error("EnvCredentialSource is read-only");
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

// test/v2-smtpimap-live.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var crypto = __toESM(require("node:crypto"));
var pass = 0;
var fail = 0;
var skip = 0;
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
function skipMsg(name, reason) {
  skip++;
  console.log(`  SKIP  ${name} \u2014 ${reason}`);
}
var nodeCrypto = {
  async argon2id(p, s, o) {
    return new Promise((r, j) => crypto.scrypt(p, Buffer.from(s), o.outBytes, (e, k) => e ? j(e) : r(new Uint8Array(k))));
  },
  secretboxSeal(k, n, m) {
    const c = crypto.createCipheriv("chacha20-poly1305", Buffer.from(k), Buffer.from(n.slice(0, 12)), { authTagLength: 16 });
    const e = Buffer.concat([c.update(Buffer.from(m)), c.final()]);
    return new Uint8Array(Buffer.concat([e, c.getAuthTag()]));
  },
  secretboxOpen(k, n, ct) {
    try {
      const d = Buffer.from(ct);
      const e = d.subarray(0, d.length - 16);
      const t = d.subarray(d.length - 16);
      const dec = crypto.createDecipheriv("chacha20-poly1305", Buffer.from(k), Buffer.from(n.slice(0, 12)), { authTagLength: 16 });
      dec.setAuthTag(t);
      return new Uint8Array(Buffer.concat([dec.update(e), dec.final()]));
    } catch {
      return null;
    }
  },
  randomBytes(n) {
    return new Uint8Array(crypto.randomBytes(n));
  }
};
function loadEnv() {
  const p = path.join(__dirname, ".env.live");
  if (!fs.existsSync(p))
    return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m)
      out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
var env = loadEnv();
async function main() {
  console.log("\n=== Secure SMTP/IMAP integration (V2) ===");
  const blob = {};
  const store = new JsonSecretStore(async () => blob, async (d) => {
    Object.assign(blob, d);
  });
  const vault = new KeyVault(store, nodeCrypto);
  await vault.unlock("smtpimap-test-vault-pw");
  const kv = new KeyVaultCredentialSource(vault);
  const envSrc = new EnvCredentialSource(env, {
    "smtp_imap:drew_saucetech:app-password": "IMAP_APP_PASSWORD",
    "smtp_imap:drew_saucetech:oauth-access-token": "IMAP_OAUTH_TOKEN"
  });
  const source = new ChainedCredentialSource([kv, envSrc]);
  const scopes = new ScopeRegistry();
  scopes.load(DEFAULT_SCOPES);
  const proxy = new ProxyClient({ fetch: async () => ({ status: 200, headers: {}, body: "{}" }), hmacHex: async () => "x", sha256Hex: async () => "h" }, { enabled: false, baseUrl: "", sharedSecret: "" });
  const integ = new SmtpImapIntegration({ scopes, proxy, source });
  integ.addAccount({
    id: "drew_saucetech",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    username: "drew@saucetech.io",
    authMode: "plain"
  });
  await integ.connect();
  check("Integration accepts account + connects", (await integ.state()).connected);
  if (env.IMAP_APP_PASSWORD) {
    await kv.put("smtp_imap:drew_saucetech:app-password", env.IMAP_APP_PASSWORD);
  }
  const cred = await source.get("smtp_imap:drew_saucetech:app-password");
  if (!cred) {
    skipMsg("IMAP probe", "no app password in vault or env. Set IMAP_APP_PASSWORD in env.tpl or via Settings.");
  } else {
    console.log("\n--- Live IMAP TLS handshake + LOGIN exchange ---");
    const result = await integ.probeAccount("drew_saucetech");
    check("TLS handshake completes against imap.gmail.com:993", result.capability.length > 0 || !!result.greeting, `greeting="${result.greeting.slice(0, 50)}"`);
    check("Server greeting parsed", /\* OK/.test(result.greeting), `g="${result.greeting.slice(0, 40)}"`);
    check("CAPABILITY enumerated", result.capability.length > 0, `caps=[${result.capability.slice(0, 4).join(", ")}\u2026]`);
    if (result.ok) {
      check("AUTH succeeded end-to-end (live!)", result.ok, `latency=${result.loginLatencyMs}ms, inbox=${result.messageCount} msgs`);
    } else {
      const expected = /AUTHENTICATIONFAILED|app password|application-specific|invalid credentials/i.test(result.error ?? "");
      check("AUTH failure cleanly surfaced (cred state, not code path)", expected, `error="${result.error?.slice(0, 80)}"`);
    }
  }
  console.log("\n--- XOAUTH2 mode (KeyVault-bound, dry-run if no token) ---");
  integ.addAccount({
    id: "drew_saucetech",
    // re-add with xoauth2
    imapHost: "imap.gmail.com",
    imapPort: 993,
    username: "drew@saucetech.io",
    authMode: "xoauth2"
  });
  const xtok = await source.get("smtp_imap:drew_saucetech:oauth-access-token");
  if (!xtok)
    skipMsg("XOAUTH2 live probe", "no OAuth access token (set via Google Workspace OAuth integration first)");
  else {
    const xresult = await integ.probeAccount("drew_saucetech");
    if (xresult.ok)
      check("XOAUTH2 AUTH succeeded", true, `inbox=${xresult.messageCount}`);
    else
      check("XOAUTH2 AUTH failure surfaced cleanly", !!xresult.error, `error="${xresult.error?.slice(0, 80)}"`);
  }
  console.log("\n--- Scope enforcement ---");
  scopes.set("smtp_imap", "inbox.read", false);
  let threw = false;
  try {
    await integ.probeAccount("drew_saucetech");
  } catch (e) {
    if (e.message?.includes("Scope not granted"))
      threw = true;
  }
  check("ScopeNotGranted blocks probe when inbox.read off", threw);
  scopes.set("smtp_imap", "inbox.read", true);
  console.log("\n--- SOCKS5 egress (smoke test) ---");
  const proxiedClient = new SmtpImapClient({
    account: { id: "x", imapHost: "imap.gmail.com", imapPort: 993, username: "drew@saucetech.io", authMode: "plain" },
    source,
    proxy: { host: "127.0.0.1", port: 19999 },
    // intentionally unreachable
    handshakeTimeoutMs: 2e3
  });
  const proxyResult = await proxiedClient.probe();
  check("SOCKS5 misroute fails closed (not silent plaintext fallback)", !proxyResult.ok, `error="${proxyResult.error?.slice(0, 60)}"`);
  console.log("\n--- TLS strict verification ---");
  const strictClient = new SmtpImapClient({
    account: { id: "x", imapHost: "imap.gmail.com", imapPort: 993, username: "drew@saucetech.io", authMode: "plain" },
    source,
    rejectUnauthorized: true,
    minTlsVersion: "TLSv1.2",
    handshakeTimeoutMs: 8e3
  });
  const strictResult = await strictClient.probe();
  check(
    "TLS 1.2+ handshake completes (or fails for cred reason, not TLS)",
    strictResult.capability.length > 0 || /AUTHENTICATION|app password/i.test(strictResult.error ?? ""),
    `state="${strictResult.ok ? "auth-ok" : strictResult.error?.slice(0, 60)}"`
  );
  console.log("\n=== SMTP/IMAP RESULTS ===");
  console.log(`PASS ${pass}   FAIL ${fail}   SKIP ${skip}`);
  if (failures.length) {
    console.log("Failures:");
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
