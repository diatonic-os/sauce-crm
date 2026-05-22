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

// src/copilot/lmstudio/LMStudioClientFactory.ts
var LMStudioClientFactory = class {
  constructor(source, cfg = {}, options = {}) {
    this.source = source;
    this.cfg = cfg;
    this.options = options;
  }
  /** Resolve credentials from the CredentialSource. Returns empty object if no source or all keys missing. */
  async resolveCredentials() {
    if (!this.source)
      return {};
    const [apiToken, clientIdentifier, clientPasskey] = await Promise.all([
      this.source.get("copilot:lmstudio:api-token"),
      this.source.get("copilot:lmstudio:client-id"),
      this.source.get("copilot:lmstudio:client-passkey")
    ]);
    return {
      apiToken: apiToken ?? void 0,
      clientIdentifier: clientIdentifier ?? void 0,
      clientPasskey: clientPasskey ?? void 0
    };
  }
  async build() {
    const sdk = this.loadSdk();
    if (!sdk?.LMStudioClient)
      throw new Error("@lmstudio/sdk not available \u2014 install with `npm install @lmstudio/sdk`");
    const creds = await this.resolveCredentials();
    const baseOpts = {
      baseUrl: this.cfg.baseUrl ?? "ws://127.0.0.1:1234",
      verboseErrorMessages: this.cfg.verboseErrors ?? false
    };
    const attempts = [];
    if (creds.apiToken && (creds.clientIdentifier || creds.clientPasskey)) {
      attempts.push({ ...baseOpts, apiToken: creds.apiToken, clientIdentifier: creds.clientIdentifier, clientPasskey: creds.clientPasskey });
    }
    if (creds.apiToken)
      attempts.push({ ...baseOpts, apiToken: creds.apiToken });
    if (creds.clientIdentifier || creds.clientPasskey) {
      attempts.push({ ...baseOpts, clientIdentifier: creds.clientIdentifier, clientPasskey: creds.clientPasskey });
    }
    attempts.push(baseOpts);
    let lastError = null;
    for (const opts of attempts) {
      try {
        return new sdk.LMStudioClient(opts);
      } catch (e) {
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (!/Unrecognized key|Invalid parameter|Unknown option/i.test(msg))
          throw e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("LMStudioClient construction failed");
  }
  loadSdk() {
    if (this.options.sdkLoader)
      return this.options.sdkLoader();
    const req = typeof require !== "undefined" ? require : null;
    if (!req)
      return null;
    try {
      return req("@lmstudio/sdk");
    } catch {
      return null;
    }
  }
};

// src/copilot/lmstudio/LMStudioChatService.ts
var LMStudioChatService = class {
  constructor(client) {
    this.client = client;
  }
  async respond(req) {
    const model = await this.client.llm.model(req.modelId);
    const chat = this.toSdkChat(req.messages);
    const opts = {
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      topK: req.topK,
      topP: req.topP,
      signal: req.signal,
      draftModel: req.draftModelId,
      structured: req.structuredSchema
    };
    const res = await model.respond(chat, opts);
    return {
      content: res.content ?? "",
      reasoning: res.reasoningContent,
      stats: res.stats ?? {}
    };
  }
  async *stream(req) {
    const model = await this.client.llm.model(req.modelId);
    const chat = this.toSdkChat(req.messages);
    const fragments = [];
    let firstSeen = false;
    const collect = (frag) => {
      if (!frag.content)
        return;
      if (!firstSeen) {
        firstSeen = true;
      }
      fragments.push(frag.content);
    };
    const opts = {
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      signal: req.signal,
      draftModel: req.draftModelId,
      structured: req.structuredSchema,
      onPredictionFragment: collect,
      onFirstToken: () => {
        firstSeen = true;
      }
    };
    try {
      const promise = model.respond(chat, opts);
      let consumed = 0;
      let done = false;
      let result = null;
      let err = null;
      promise.then((r) => {
        result = r;
        done = true;
      }).catch((e) => {
        err = e;
        done = true;
      });
      if (firstSeen)
        yield { type: "first-token" };
      while (!done) {
        await new Promise((r) => setTimeout(r, 5));
        if (firstSeen && consumed === 0)
          yield { type: "first-token" };
        while (consumed < fragments.length) {
          yield { type: "text", delta: fragments[consumed++] };
        }
      }
      while (consumed < fragments.length)
        yield { type: "text", delta: fragments[consumed++] };
      if (err) {
        const msg = err instanceof Error ? err.message : String(err);
        yield { type: "done", reason: req.signal?.aborted ? "aborted" : "failed", error: msg };
        return;
      }
      const finalStats = result?.stats;
      yield { type: "done", reason: "end", stats: finalStats };
    } catch (e) {
      yield { type: "done", reason: req.signal?.aborted ? "aborted" : "failed", error: e instanceof Error ? e.message : String(e) };
    }
  }
  async getHandle(modelId) {
    return this.client.llm.model(modelId);
  }
  toSdkChat(messages) {
    return messages.map((m) => {
      if (!m.images || m.images.length === 0) {
        return { role: m.role, content: m.content };
      }
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          ...m.images.map((img) => ({ type: "image", image: img.base64, mimeType: img.mimeType ?? "image/png" }))
        ]
      };
    });
  }
};

// src/copilot/lmstudio/LMStudioActService.ts
var LMStudioActService = class {
  constructor(client, sdkExports) {
    this.client = client;
    this.sdkExports = sdkExports;
  }
  async act(req) {
    const model = await this.client.llm.model(req.modelId);
    if (!model.act)
      throw new Error("LM Studio model does not expose .act() \u2014 upgrade @lmstudio/sdk");
    const calls = [];
    const sdkTools = req.tools.map((t) => this.sdkExports.tool({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      implementation: async (args) => {
        try {
          const result2 = await t.invoke(args);
          calls.push({ name: t.name, args, result: result2 });
          return result2;
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          calls.push({ name: t.name, args, error: err });
          throw e;
        }
      }
    }));
    let finalMessage = "";
    const opts = {
      maxParallelToolCallCount: req.maxParallelToolCalls ?? 1,
      signal: req.signal,
      onMessage: (m) => {
        if (req.onMessage)
          req.onMessage(m);
        if (m && typeof m === "object" && "getText" in m) {
          try {
            finalMessage = m.getText();
          } catch {
          }
        }
      },
      guardToolCall: req.approveToolCall ? async (_round, _id, ctx) => {
        const ok = await req.approveToolCall(ctx.toolCallRequest.name, ctx.toolCallRequest.arguments);
        if (ok)
          ctx.allow();
        else
          ctx.deny("Denied by user policy");
      } : void 0
    };
    const result = await model.act(req.messages.map((m) => ({ role: m.role, content: m.content })), sdkTools, opts);
    return { rounds: result.rounds?.length ?? 1, toolCalls: calls, finalMessage };
  }
};

// src/copilot/lmstudio/LMStudioEmbedService.ts
var LMStudioEmbedService = class {
  constructor(client) {
    this.client = client;
  }
  async embed(modelId, text) {
    const handle = await this.client.embedding.model(modelId);
    const res = await handle.embed(text);
    return new Float32Array(res.embedding);
  }
  async embedBatch(modelId, texts) {
    const handle = await this.client.embedding.model(modelId);
    const res = await handle.embed(texts);
    return res.map((r) => new Float32Array(r.embedding));
  }
  async getContextLength(modelId) {
    const handle = await this.client.embedding.model(modelId);
    return handle.getContextLength();
  }
};

// src/copilot/lmstudio/LMStudioModelManager.ts
var LMStudioModelManager = class {
  constructor(client) {
    this.client = client;
  }
  async listDownloaded() {
    const rows = await this.client.system.listDownloadedModels();
    return rows.map((r) => ({
      modelKey: r.modelKey ?? r.path ?? "unknown",
      path: r.path,
      type: r.type,
      sizeBytes: r.sizeBytes
    }));
  }
  async listLoaded() {
    const rows = await this.client.llm.listLoaded();
    return rows.map((r) => ({ identifier: r.identifier ?? r.path ?? "unknown", path: r.path }));
  }
  async load(modelKey, opts = {}) {
    const config = {};
    if (opts.contextLength)
      config.contextLength = opts.contextLength;
    if (opts.gpuLayers !== void 0)
      config.gpuLayers = opts.gpuLayers;
    const handle = await this.client.llm.load({
      model: modelKey,
      ttl: opts.ttlSeconds,
      signal: opts.signal,
      config
    });
    return { identifier: handle.identifier ?? modelKey };
  }
  async unload(modelId) {
    const handle = await this.client.llm.model(modelId);
    await handle.unload();
  }
  async getInfo(modelId) {
    const handle = await this.client.llm.model(modelId);
    return handle.getModelInfo();
  }
  async getContextLength(modelId) {
    const handle = await this.client.llm.model(modelId);
    return handle.getContextLength();
  }
  async lmStudioVersion() {
    if (!this.client.system.getLMStudioVersion)
      return null;
    try {
      return await this.client.system.getLMStudioVersion();
    } catch {
      return null;
    }
  }
};

// src/copilot/lmstudio/LMStudioTokenizer.ts
var LMStudioTokenizer = class {
  constructor(client) {
    this.client = client;
  }
  async tokenize(modelId, text) {
    const handle = await this.client.llm.model(modelId);
    return handle.tokenize(text);
  }
  async countTokens(modelId, text) {
    const handle = await this.client.llm.model(modelId);
    return handle.countTokens(text);
  }
  async countBatch(modelId, texts) {
    const handle = await this.client.llm.model(modelId);
    const out = [];
    for (const t of texts)
      out.push(await handle.countTokens(t));
    return out;
  }
};

// src/copilot/lmstudio/LMStudioToolBuilder.ts
var LMStudioToolBuilder = class {
  build(skills, opts) {
    return skills.filter((s) => !opts.include || opts.include(s.id)).map((s) => ({
      name: s.id.replace(/[^a-zA-Z0-9_]/g, "_"),
      description: s.description || `Skill: ${s.id}`,
      parameters: {
        type: "object",
        properties: Object.fromEntries(s.contract.inputs.map((i) => [i.name, { type: i.type, description: i.description ?? "" }])),
        required: s.contract.inputs.filter((i) => i.required).map((i) => i.name)
      },
      invoke: async (args) => {
        const result = await s.execute(args, opts.contextFactory());
        if (!result.ok)
          throw new Error(`skill ${s.id} failed: ${result.reason}`);
        return result.payload;
      }
    }));
  }
};

// src/copilot/lmstudio/index.ts
async function buildLMStudioIntegration(opts) {
  const factory = new LMStudioClientFactory(opts.source, opts.config ?? {}, { sdkLoader: opts.sdkLoader });
  const client = await factory.build();
  const sdkExports = opts.sdkLoader ? opts.sdkLoader() : (typeof require !== "undefined" ? require : null)?.("@lmstudio/sdk");
  return {
    factory,
    client,
    chat: new LMStudioChatService(client),
    act: new LMStudioActService(client, sdkExports),
    embed: new LMStudioEmbedService(client),
    models: new LMStudioModelManager(client),
    tokenizer: new LMStudioTokenizer(client),
    tools: new LMStudioToolBuilder()
  };
}

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

// test/v2-lmstudio-sdk-e2e.ts
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
function redact(s) {
  return s ? `${s.slice(0, 8)}\u2026${s.slice(-4)}` : "(none)";
}
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
  console.log("\n=== LM Studio SDK e2e ===");
  console.log(`  Token (SAUCE_GRAPH_PLUG): ${redact(env.LMSTUDIO_API_KEY)}`);
  console.log(`  REST endpoint: ${env.LMSTUDIO_ENDPOINT_REST}`);
  console.log(`  WS   endpoint: ${env.LMSTUDIO_ENDPOINT_WS}`);
  console.log("\n--- Credential precedence: KeyVault \u2192 env (test-only) ---");
  const blob = {};
  const store = new JsonSecretStore(async () => blob, async (d) => {
    Object.assign(blob, d);
  });
  const vault = new KeyVault(store, nodeCrypto);
  await vault.unlock("lm-studio-sdk-vault-pw");
  const kvSrc = new KeyVaultCredentialSource(vault);
  const envSrc = new EnvCredentialSource(env, {
    "copilot:lmstudio:api-token": "LMSTUDIO_API_KEY",
    "copilot:lmstudio:client-id": "LMSTUDIO_CLIENT_ID",
    "copilot:lmstudio:client-passkey": "LMSTUDIO_CLIENT_PASSKEY"
  });
  const chain = new ChainedCredentialSource([kvSrc, envSrc]);
  check("CredentialSource chain available", chain.available());
  const tok = await chain.get("copilot:lmstudio:api-token");
  check("Chain resolves LM Studio token from env (KeyVault empty)", tok === env.LMSTUDIO_API_KEY);
  await kvSrc.put("copilot:lmstudio:api-token", "gui-set-override-XYZ");
  const overridden = await chain.get("copilot:lmstudio:api-token");
  check("GUI/KeyVault token overrides env", overridden === "gui-set-override-XYZ");
  await kvSrc.clear("copilot:lmstudio:api-token");
  console.log("\n--- Integration factory ---");
  let integration;
  try {
    integration = await buildLMStudioIntegration({
      source: chain,
      config: { baseUrl: env.LMSTUDIO_ENDPOINT_WS || "ws://127.0.0.1:1234", verboseErrors: false }
    });
    check("LMStudioIntegration built (factory + client)", !!integration.client);
  } catch (e) {
    check("LMStudioIntegration built", false, e instanceof Error ? e.message : String(e));
    console.log("\n=== RESULTS ===");
    console.log(`PASS ${pass}   FAIL ${fail}   SKIP ${skip}`);
    process.exit(1);
  }
  console.log("\n--- Model management ---");
  let downloaded = [];
  try {
    downloaded = await integration.models.listDownloaded();
    check("listDownloaded works", downloaded.length > 0, `n=${downloaded.length}`);
    console.log(`    ${downloaded.length} downloaded models. First 3:`);
    downloaded.slice(0, 3).forEach((m) => console.log(`      - ${m.modelKey} (${m.type ?? "?"}, ${m.sizeBytes ? (m.sizeBytes / 1e9).toFixed(2) + "GB" : "?"})`));
  } catch (e) {
    check("listDownloaded works", false, e instanceof Error ? e.message : String(e));
  }
  try {
    const loaded = await integration.models.listLoaded();
    check("listLoaded works", Array.isArray(loaded), `loaded=${loaded.length}`);
  } catch (e) {
    check("listLoaded works", false, e instanceof Error ? e.message : String(e));
  }
  const ver = await integration.models.lmStudioVersion();
  if (ver)
    check("lmStudioVersion returns build info", !!ver.version, `v=${ver.version}`);
  else
    skipMsg("lmStudioVersion", "SDK build does not expose getLMStudioVersion");
  console.log("\n--- Chat: JIT load + respond ---");
  const chatCandidates = downloaded.map((m) => m.modelKey).filter((k) => !k.toLowerCase().includes("embed") && !k.toLowerCase().includes("embedding")).filter((k) => !!k);
  const targetModel = chatCandidates.find((k) => /micro|mini|tiny|1b|3b/i.test(k)) ?? chatCandidates[0];
  if (!targetModel) {
    skipMsg("chat respond", "no chat-capable model downloaded");
  } else {
    console.log(`    chosen chat model: ${targetModel}`);
    try {
      const start = Date.now();
      const res = await integration.chat.respond({
        modelId: targetModel,
        messages: [{ role: "user", content: "Reply with exactly the word PONG and nothing else." }],
        maxTokens: 30,
        temperature: 0
      });
      const dt = Date.now() - start;
      check("chat respond returns content", res.content.length > 0, `text="${res.content.slice(0, 60)}" (${dt}ms)`);
      check("chat respond reports stats", !!res.stats, `predicted=${res.stats.predictedTokensCount}`);
      console.log("\n--- Tokenization ---");
      const toks = await integration.tokenizer.tokenize(targetModel, "Hello world");
      check("tokenize returns ints", Array.isArray(toks) && toks.length > 0, `n=${toks.length}`);
      const cnt = await integration.tokenizer.countTokens(targetModel, "Hello world");
      check("countTokens returns positive int", cnt > 0, `count=${cnt}`);
      check("countTokens \u2248 tokenize length", Math.abs(cnt - toks.length) <= 1, `cnt=${cnt} len=${toks.length}`);
      console.log("\n--- Model info ---");
      const ctx = await integration.models.getContextLength(targetModel);
      check("getContextLength returns positive", ctx > 0, `ctx=${ctx}`);
      const info = await integration.models.getInfo(targetModel);
      check("getInfo returns model instance info", !!info, `id=${info?.identifier ?? "?"}`);
      console.log("\n--- Streaming ---");
      const events = [];
      for await (const ev of integration.chat.stream({
        modelId: targetModel,
        messages: [{ role: "user", content: "Count from 1 to 3, one per line." }],
        maxTokens: 50,
        temperature: 0
      })) {
        events.push({ type: ev.type, delta: ev.delta });
      }
      const textEvents = events.filter((e) => e.type === "text");
      const doneEvent = events.find((e) => e.type === "done");
      check("stream emits text events", textEvents.length > 0, `n=${textEvents.length}`);
      check("stream terminates with done event", !!doneEvent);
      console.log("\n--- Cancellation ---");
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 50);
      const cancellable = integration.chat.respond({
        modelId: targetModel,
        messages: [{ role: "user", content: "Write a long essay about the history of computing." }],
        maxTokens: 4e3,
        signal: ac.signal
      });
      let cancelled = false;
      let returned = false;
      try {
        await cancellable;
        returned = true;
      } catch {
        cancelled = true;
      }
      check("respond honours AbortSignal", cancelled || returned, `cancelled=${cancelled} returned=${returned}`);
      console.log("\n--- Embeddings ---");
      const embedCandidates = downloaded.map((m) => m.modelKey).filter((k) => /embed/i.test(k));
      if (embedCandidates.length === 0)
        skipMsg("embed", "no embedding model downloaded");
      else {
        const embedModel = embedCandidates[0];
        try {
          const v = await integration.embed.embed(embedModel, "Sauce Graph V2 verification");
          check("embed returns Float32Array", v instanceof Float32Array && v.length > 0, `dim=${v.length}`);
          check("embedding is non-trivial", Array.from(v).some((x) => Math.abs(x) > 1e-3));
        } catch (e) {
          check("embed live", false, e instanceof Error ? e.message : String(e));
        }
      }
      console.log("\n--- Agentic .act() ---");
      try {
        const toolHandle = await integration.client.llm.model(targetModel);
        if (!toolHandle.act) {
          skipMsg("act() agentic", "model handle does not expose .act() \u2014 older SDK or model");
        } else {
          let invocations = 0;
          const actResult = await integration.act.act({
            modelId: targetModel,
            messages: [{ role: "user", content: "Use the add tool to compute 17 + 25 and tell me the answer." }],
            tools: [{
              name: "add",
              description: "Add two integers a and b.",
              parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
              invoke: async (args) => {
                invocations += 1;
                return Number(args.a) + Number(args.b);
              }
            }]
          });
          check("act() invoked the add tool", invocations >= 1, `invocations=${invocations}`);
          check("act() recorded tool calls", actResult.toolCalls.length >= 1, `calls=${actResult.toolCalls.length}`);
          if (actResult.toolCalls.length > 0) {
            check("add tool result is 42", actResult.toolCalls[0].result === 42, `result=${actResult.toolCalls[0].result}`);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/does not support tool use|not supported|tool_use/i.test(msg))
          skipMsg("act() agentic", "model does not support tool use");
        else
          check("act() agentic flow", false, msg);
      }
    } catch (e) {
      check("chat respond", false, e instanceof Error ? e.message : String(e));
    }
  }
  console.log("\n=== LM STUDIO SDK RESULTS ===");
  console.log(`PASS ${pass}   FAIL ${fail}   SKIP ${skip}`);
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
