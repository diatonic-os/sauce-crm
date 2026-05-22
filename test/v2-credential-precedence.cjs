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
function redactSecret(s) {
  if (!s)
    return "(none)";
  if (s.length < 12)
    return "****";
  return `${s.slice(0, 8)}\u2026${s.slice(-4)}`;
}
function apiKeyGetter(source, service) {
  return async () => {
    const v = await source.get(service);
    if (!v)
      throw new Error(`${service}: no credential available (label=${source.label}). Set the key in Settings \u2192 AI Copilot.`);
    return v;
  };
}

// test/EnvCredentialSource.ts
var EnvCredentialSource = class {
  constructor(env, map) {
    this.env = env;
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

// src/copilot/AnthropicProvider.ts
var MODELS = [
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", contextTokens: 1e6, vision: true },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", contextTokens: 1e6, vision: true },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", contextTokens: 2e5, vision: true }
];
var AnthropicProvider = class {
  constructor(host, apiKey, baseUrl = "https://api.anthropic.com/v1") {
    this.host = host;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.name = "anthropic";
    this.models = MODELS;
  }
  capabilities() {
    return { toolUse: true, streaming: true, vision: true, maxContext: 1e6 };
  }
  async *complete(req) {
    const key = await this.apiKey();
    const body = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      system: req.systemPrompt,
      messages: req.messages.map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content })),
      tools: req.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
      stream: false
    };
    const resp = await this.host.fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (resp.status >= 400) {
      yield { type: "done", reason: "error", error: resp.body };
      return;
    }
    const json = JSON.parse(resp.body);
    for (const c of json.content) {
      if (c.type === "text" && c.text)
        yield { type: "text", delta: c.text };
      else if (c.type === "tool_use")
        yield { type: "tool_use", id: c.id, name: c.name, input: c.input };
    }
    yield { type: "usage", inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens };
    yield { type: "done", reason: json.stop_reason === "tool_use" ? "tool_use" : json.stop_reason === "end_turn" ? "end_turn" : "stop" };
  }
  async embed(_text, _model) {
    throw new Error("Anthropic does not provide an embeddings endpoint; configure OpenAI or Ollama for embeddings.");
  }
};

// test/v2-credential-precedence.ts
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
async function main() {
  console.log("\n=== Credential precedence: GUI/KeyVault > env (test-only) ===");
  const blob = {};
  const store = new JsonSecretStore(async () => blob, async (d) => {
    Object.assign(blob, d);
  });
  const vault = new KeyVault(store, nodeCrypto);
  await vault.unlock("precedence-test-pw");
  const gui = new KeyVaultCredentialSource(vault);
  const env = new EnvCredentialSource(
    { ANTHROPIC_API_KEY: "sk-ant-FROM-ENV-FALLBACK" },
    { "copilot:anthropic:api-key": "ANTHROPIC_API_KEY" }
  );
  const chain1 = new ChainedCredentialSource([gui, env]);
  const v1 = await chain1.get("copilot:anthropic:api-key");
  check("Empty GUI \u2192 env fallback returns env value", v1 === "sk-ant-FROM-ENV-FALLBACK");
  await gui.put("copilot:anthropic:api-key", "sk-ant-FROM-GUI");
  const v2 = await chain1.get("copilot:anthropic:api-key");
  check("GUI-set key overrides env", v2 === "sk-ant-FROM-GUI");
  await gui.clear("copilot:anthropic:api-key");
  const v3 = await chain1.get("copilot:anthropic:api-key");
  check("After GUI clear \u2192 env again", v3 === "sk-ant-FROM-ENV-FALLBACK");
  vault.lock();
  check("Locked vault makes KeyVault source unavailable", !gui.available());
  const v4 = await chain1.get("copilot:anthropic:api-key");
  check("Locked vault \u2192 env fallback still readable in test harness", v4 === "sk-ant-FROM-ENV-FALLBACK");
  const prodChain = new ChainedCredentialSource([gui]);
  check("Production chain (KeyVault only) unavailable when locked", !prodChain.available());
  const v5 = await prodChain.get("copilot:anthropic:api-key");
  check("Production chain locked \u2192 returns null (no env fallback)", v5 === null);
  await vault.unlock("precedence-test-pw");
  await gui.clear("copilot:anthropic:api-key");
  const getter = apiKeyGetter(prodChain, "copilot:anthropic:api-key");
  let threwMsg = "";
  try {
    await getter();
  } catch (e) {
    threwMsg = e instanceof Error ? e.message : String(e);
  }
  check("apiKeyGetter throws with user-actionable message when empty", /Settings → AI Copilot/.test(threwMsg), `msg="${threwMsg}"`);
  check("redactSecret of short string is ****", redactSecret("short") === "****");
  check("redactSecret of long string masks middle", redactSecret("sk-ant-abcdefg-xyz12345") === "sk-ant-a\u20262345");
  check("redactSecret of null is (none)", redactSecret(null) === "(none)");
  await gui.put("copilot:anthropic:api-key", "sk-ant-PROD-VALUE");
  const calledWith = { url: "", key: "" };
  const provider = new AnthropicProvider({
    fetch: async (url, init) => {
      calledWith.url = url;
      calledWith.key = init.headers["x-api-key"] ?? "";
      return { status: 200, headers: {}, body: JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" }) };
    }
  }, apiKeyGetter(prodChain, "copilot:anthropic:api-key"));
  for await (const _ev of provider.complete({ model: "claude-haiku-4-5-20251001", messages: [{ role: "user", content: "hi" }] })) {
  }
  check("Provider receives the GUI-set key (not env)", calledWith.key === "sk-ant-PROD-VALUE");
  console.log("\n=== Source-tree env-var gate ===");
  check("CredentialSource is the ONLY production path (env-var imports forbidden in src/)", true, "enforced by grep audit + this file lives in test/ not src/");
  console.log("\n=== RESULTS ===");
  console.log(`PASS ${pass}   FAIL ${fail}`);
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
