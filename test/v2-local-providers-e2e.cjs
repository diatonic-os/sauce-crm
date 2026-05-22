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

// src/copilot/OllamaProvider.ts
var OllamaProvider = class {
  constructor(host, cfgOrBaseUrl = {}) {
    this.host = host;
    this.name = "ollama";
    this.models = [];
    const cfg = typeof cfgOrBaseUrl === "string" ? { endpoint: cfgOrBaseUrl } : cfgOrBaseUrl;
    this.cfg = { endpoint: cfg.endpoint ?? "http://localhost:11434", apiKey: cfg.apiKey, defaultModel: cfg.defaultModel };
  }
  setConfig(cfg) {
    this.cfg = { ...this.cfg, ...cfg };
    if (!this.cfg.endpoint)
      this.cfg.endpoint = "http://localhost:11434";
  }
  getConfig() {
    return { ...this.cfg };
  }
  capabilities() {
    return { toolUse: false, streaming: true, vision: false, maxContext: 32768 };
  }
  authHeaders() {
    return this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {};
  }
  async refreshModels() {
    const r = await this.host.fetch(`${this.cfg.endpoint}/api/tags`, { method: "GET", headers: this.authHeaders() }).catch(() => null);
    if (!r || r.status >= 400)
      return;
    const j = JSON.parse(r.body);
    this.models = j.models.map((m) => ({ id: m.name, label: m.name, contextTokens: 32768 }));
  }
  async ping() {
    const start = Date.now();
    try {
      const r = await this.host.fetch(`${this.cfg.endpoint}/api/tags`, { method: "GET", headers: this.authHeaders() });
      return { ok: r.status < 400, latencyMs: Date.now() - start, error: r.status >= 400 ? `HTTP ${r.status}` : void 0 };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    }
  }
  async *complete(req) {
    const messages = req.systemPrompt ? [{ role: "system", content: req.systemPrompt }, ...req.messages] : req.messages;
    const body = {
      model: req.model || this.cfg.defaultModel || "llama3",
      messages: messages.map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) })),
      options: { temperature: req.temperature ?? 0.7, num_predict: req.maxTokens ?? 4096 },
      stream: false
    };
    const resp = await this.host.fetch(`${this.cfg.endpoint}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.authHeaders() },
      body: JSON.stringify(body)
    });
    if (resp.status >= 400) {
      yield { type: "done", reason: "error", error: resp.body };
      return;
    }
    const j = JSON.parse(resp.body);
    if (j.message?.content)
      yield { type: "text", delta: j.message.content };
    yield { type: "usage", inputTokens: j.prompt_eval_count ?? 0, outputTokens: j.eval_count ?? 0 };
    yield { type: "done", reason: "end_turn" };
  }
  async embed(text, model) {
    const r = await this.host.fetch(`${this.cfg.endpoint}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({ model, prompt: text })
    });
    if (r.status >= 400)
      throw new Error(r.body);
    const j = JSON.parse(r.body);
    return new Float32Array(j.embedding);
  }
};

// src/copilot/LMStudioProvider.ts
var LMStudioProvider = class {
  constructor(host, cfg = {}) {
    this.host = host;
    this.name = "lmstudio";
    this.models = [];
    this.cfg = {
      endpoint: cfg.endpoint ?? "http://localhost:1234/v1",
      apiKey: cfg.apiKey,
      defaultModel: cfg.defaultModel,
      toolUse: cfg.toolUse ?? false
    };
  }
  setConfig(cfg) {
    this.cfg = { ...this.cfg, ...cfg };
    if (!this.cfg.endpoint)
      this.cfg.endpoint = "http://localhost:1234/v1";
  }
  getConfig() {
    return { ...this.cfg };
  }
  capabilities() {
    return { toolUse: !!this.cfg.toolUse, streaming: true, vision: false, maxContext: 32768 };
  }
  headers() {
    const h = { "content-type": "application/json" };
    if (this.cfg.apiKey)
      h.authorization = `Bearer ${this.cfg.apiKey}`;
    return h;
  }
  async refreshModels() {
    const r = await this.host.fetch(`${this.cfg.endpoint.replace(/\/$/, "")}/models`, { method: "GET", headers: this.headers() }).catch(() => null);
    if (!r || r.status >= 400)
      return;
    try {
      const j = JSON.parse(r.body);
      this.models = j.data.map((m) => ({ id: m.id, label: m.id, contextTokens: 32768 }));
    } catch {
    }
  }
  async ping() {
    const start = Date.now();
    try {
      const r = await this.host.fetch(`${this.cfg.endpoint.replace(/\/$/, "")}/models`, { method: "GET", headers: this.headers() });
      return { ok: r.status < 400, latencyMs: Date.now() - start, error: r.status >= 400 ? `HTTP ${r.status}` : void 0 };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    }
  }
  async *complete(req) {
    const messages = req.systemPrompt ? [{ role: "system", content: req.systemPrompt }, ...req.messages] : req.messages;
    const body = {
      model: req.model || this.cfg.defaultModel || "local-model",
      messages: messages.map((m) => ({ role: m.role === "tool" ? "tool" : m.role, content: m.content, tool_call_id: m.toolCallId })),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096
    };
    if (this.cfg.toolUse && req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    }
    const resp = await this.host.fetch(`${this.cfg.endpoint.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body)
    });
    if (resp.status >= 400) {
      yield { type: "done", reason: "error", error: resp.body };
      return;
    }
    const j = JSON.parse(resp.body);
    const choice = j.choices[0];
    if (choice.message.content)
      yield { type: "text", delta: choice.message.content };
    for (const tc of choice.message.tool_calls ?? []) {
      try {
        yield { type: "tool_use", id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) };
      } catch {
        yield { type: "tool_use", id: tc.id, name: tc.function.name, input: { _raw: tc.function.arguments } };
      }
    }
    yield { type: "usage", inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 };
    yield { type: "done", reason: choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason === "stop" ? "end_turn" : "stop" };
  }
  async embed(text, model) {
    const r = await this.host.fetch(`${this.cfg.endpoint.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model, input: text })
    });
    if (r.status >= 400)
      throw new Error(r.body);
    const j = JSON.parse(r.body);
    return new Float32Array(j.data[0].embedding);
  }
};

// src/copilot/LocalProviderCredentials.ts
var LocalProviderCredentials = class {
  constructor(vault) {
    this.vault = vault;
  }
  async setOllamaKey(key) {
    await this.vault.put("copilot:ollama:api-key", key);
  }
  async getOllamaKey() {
    try {
      return await this.vault.get("copilot:ollama:api-key");
    } catch {
      return null;
    }
  }
  async clearOllamaKey() {
    try {
      await this.vault.put("copilot:ollama:api-key", "");
    } catch {
    }
  }
  async setLMStudioKey(key) {
    await this.vault.put("copilot:lmstudio:api-key", key);
  }
  async getLMStudioKey() {
    try {
      return await this.vault.get("copilot:lmstudio:api-key");
    } catch {
      return null;
    }
  }
  async clearLMStudioKey() {
    try {
      await this.vault.put("copilot:lmstudio:api-key", "");
    } catch {
    }
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

// test/v2-local-providers-e2e.ts
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
    return new Promise((res, rej) => crypto.scrypt(password, Buffer.from(salt), opts.outBytes, (e, k) => e ? rej(e) : res(new Uint8Array(k))));
  },
  secretboxSeal(key, nonce, msg) {
    const c = crypto.createCipheriv("chacha20-poly1305", Buffer.from(key), Buffer.from(nonce.slice(0, 12)), { authTagLength: 16 });
    const e = Buffer.concat([c.update(Buffer.from(msg)), c.final()]);
    return new Uint8Array(Buffer.concat([e, c.getAuthTag()]));
  },
  secretboxOpen(key, nonce, ct) {
    try {
      const d = Buffer.from(ct);
      const e = d.subarray(0, d.length - 16);
      const t = d.subarray(d.length - 16);
      const dec = crypto.createDecipheriv("chacha20-poly1305", Buffer.from(key), Buffer.from(nonce.slice(0, 12)), { authTagLength: 16 });
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
function makeHttp(routes) {
  const log = [];
  return {
    log,
    fetch: async (url, init) => {
      const rec = { url, method: init.method, headers: init.headers, body: init.body };
      log.push(rec);
      for (const [k, h] of Object.entries(routes)) {
        if (url.includes(k))
          return { ...h(rec), headers: {} };
      }
      return { status: 404, headers: {}, body: "not found" };
    }
  };
}
async function main() {
  console.log("\n=== Ollama provider e2e ===");
  const ollamaHttp = makeHttp({
    "/api/tags": () => ({ status: 200, body: JSON.stringify({ models: [{ name: "llama3:8b" }, { name: "qwen2.5-coder:7b" }] }) }),
    "/api/chat": () => ({ status: 200, body: JSON.stringify({ message: { content: "hello from ollama" }, prompt_eval_count: 12, eval_count: 5 }) }),
    "/api/embeddings": () => ({ status: 200, body: JSON.stringify({ embedding: [0.1, 0.2, 0.3] }) })
  });
  const ollama = new OllamaProvider(ollamaHttp, { endpoint: "http://localhost:11434" });
  await ollama.refreshModels();
  check("Ollama refreshes models from /api/tags", ollama.models.length === 2 && ollama.models[0].id === "llama3:8b");
  const ping = await ollama.ping();
  check("Ollama ping OK", ping.ok);
  ollama.setConfig({ endpoint: "https://ollama.internal:8443" });
  check("Ollama setConfig switches endpoint", ollama.getConfig().endpoint === "https://ollama.internal:8443");
  ollama.setConfig({ endpoint: "http://localhost:11434" });
  ollama.setConfig({ apiKey: "ollama-bearer-xyz" });
  const chatEvents = [];
  for await (const ev of ollama.complete({ model: "llama3:8b", messages: [{ role: "user", content: "hi" }] })) {
    chatEvents.push(ev);
  }
  check("Ollama chat yields a text event", chatEvents.some((e) => e.type === "text"));
  check("Ollama chat yields a usage event", chatEvents.some((e) => e.type === "usage"));
  const lastChat = ollamaHttp.log[ollamaHttp.log.length - 1];
  check("Ollama bearer header sent", lastChat.headers.authorization === "Bearer ollama-bearer-xyz");
  const vec = await ollama.embed("hello", "nomic-embed-text");
  check("Ollama embed returns Float32Array dim 3", vec.length === 3 && Math.abs(vec[0] - 0.1) < 1e-6);
  console.log("\n=== LM Studio provider e2e ===");
  const lmHttp = makeHttp({
    "/models": () => ({ status: 200, body: JSON.stringify({ data: [{ id: "qwen2.5-32b-instruct-q4_k_m" }, { id: "gemma-2-9b-it" }] }) }),
    "/chat/completions": () => ({ status: 200, body: JSON.stringify({
      choices: [{ message: { content: "hi from lm studio" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 7, completion_tokens: 4 }
    }) }),
    "/embeddings": () => ({ status: 200, body: JSON.stringify({ data: [{ embedding: [0.4, 0.5, 0.6, 0.7] }] }) })
  });
  const lm = new LMStudioProvider(lmHttp, { endpoint: "http://localhost:1234/v1" });
  await lm.refreshModels();
  check("LM Studio refreshes models from /models", lm.models.length === 2 && lm.models[0].id.includes("qwen2.5"));
  const lmPing = await lm.ping();
  check("LM Studio ping OK", lmPing.ok);
  check("LM Studio capabilities reflects toolUse=false by default", lm.capabilities().toolUse === false);
  lm.setConfig({ toolUse: true, apiKey: "lmstudio-key-abc" });
  check("LM Studio toolUse toggle reflected in capabilities", lm.capabilities().toolUse === true);
  const lmEvents = [];
  for await (const ev of lm.complete({
    model: "qwen2.5-32b-instruct-q4_k_m",
    messages: [{ role: "user", content: "hello" }],
    tools: [{ name: "echo", description: "echo it", inputSchema: { type: "object" } }]
  }))
    lmEvents.push(ev);
  check("LM Studio chat yields text + usage + done", lmEvents.length >= 3);
  const lastLm = lmHttp.log[lmHttp.log.length - 1];
  check("LM Studio bearer key sent", lastLm.headers.authorization === "Bearer lmstudio-key-abc");
  const sentBody = JSON.parse(lastLm.body ?? "{}");
  check("LM Studio sent tools array when toolUse enabled", Array.isArray(sentBody.tools) && sentBody.tools.length === 1);
  const lmVec = await lm.embed("hi", "nomic-embed-text-v1.5");
  check("LM Studio embed returns Float32Array dim 4", lmVec.length === 4);
  lm.setConfig({ endpoint: "https://lmstudio.internal/v2" });
  check("LM Studio setConfig switches endpoint", lm.getConfig().endpoint === "https://lmstudio.internal/v2");
  console.log("\n=== LocalProviderCredentials e2e ===");
  const blob = {};
  const store = new JsonSecretStore(async () => blob, async (d) => {
    Object.assign(blob, d);
  });
  const vault = new KeyVault(store, nodeCrypto);
  await vault.unlock("local-llm-vault-pw");
  const creds = new LocalProviderCredentials(vault);
  await creds.setOllamaKey("stored-ollama-key");
  await creds.setLMStudioKey("stored-lmstudio-key");
  check("Ollama key persisted to KeyVault", await creds.getOllamaKey() === "stored-ollama-key");
  check("LM Studio key persisted to KeyVault", await creds.getLMStudioKey() === "stored-lmstudio-key");
  vault.lock();
  await vault.unlock("local-llm-vault-pw");
  check("Keys survive lock/unlock cycle", await creds.getOllamaKey() === "stored-ollama-key" && await creds.getLMStudioKey() === "stored-lmstudio-key");
  console.log("\n=== Settings page render ===");
  const make = (tag) => ({
    tagName: tag,
    children: [],
    textContent: "",
    value: "",
    checked: false,
    type: "",
    dataset: {},
    className: "",
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    setAttribute(k, v) {
      if (k === "class")
        this.className = v;
      if (k === "type")
        this.type = v;
    },
    addEventListener() {
    },
    empty() {
      this.children.length = 0;
    }
  });
  globalThis.document = { createElement: make };
  const settingsBlob = {
    "copilot.ollama.endpoint": "http://localhost:11434",
    "copilot.ollama.defaultModel": "llama3",
    "copilot.lmstudio.endpoint": "http://localhost:1234/v1",
    "copilot.lmstudio.defaultModel": "local-model",
    "copilot.lmstudio.toolUse": true
  };
  const settingsHost = {
    getConfig: (k, f) => settingsBlob[k] ?? f,
    setConfig: async (k, v) => {
      settingsBlob[k] = v;
    }
  };
  const page = new LocalLLMPage(settingsHost);
  const root = make("div");
  page.render(root);
  check("LocalLLMPage rendered something", root.children.length > 0);
  check("LocalLLMPage shows Ollama + LM Studio sections", root.children.some((c) => c.textContent === "Ollama") && root.children.some((c) => c.textContent === "LM Studio"));
  const tree = buildSettingsTree(settingsHost);
  check("Settings tree now includes LocalLLMPage", tree.some((n) => n.page.id === "copilot.local"));
  check("Settings tree total = 20 top-level (was 19)", tree.length === 20);
  console.log("\n=== LOCAL PROVIDER RESULTS ===");
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
