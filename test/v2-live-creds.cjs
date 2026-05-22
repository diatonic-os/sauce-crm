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

// src/copilot/OpenAIProvider.ts
var MODELS2 = [
  { id: "gpt-4o", label: "GPT-4o", contextTokens: 128e3, vision: true },
  { id: "gpt-4o-mini", label: "GPT-4o mini", contextTokens: 128e3, vision: true }
];
var OpenAIProvider = class {
  constructor(host, apiKey, baseUrl = "https://api.openai.com/v1") {
    this.host = host;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.name = "openai";
    this.models = MODELS2;
  }
  capabilities() {
    return { toolUse: true, streaming: true, vision: true, maxContext: 128e3 };
  }
  async *complete(req) {
    const key = await this.apiKey();
    const messages = req.systemPrompt ? [{ role: "system", content: req.systemPrompt }, ...req.messages] : req.messages;
    const body = {
      model: req.model,
      messages: messages.map((m) => ({ role: m.role === "tool" ? "tool" : m.role, content: m.content, tool_call_id: m.toolCallId })),
      tools: req.tools?.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096
    };
    const resp = await this.host.fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (resp.status >= 400) {
      yield { type: "done", reason: "error", error: resp.body };
      return;
    }
    const json = JSON.parse(resp.body);
    const choice = json.choices[0];
    if (choice.message.content)
      yield { type: "text", delta: choice.message.content };
    for (const tc of choice.message.tool_calls ?? []) {
      yield { type: "tool_use", id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) };
    }
    yield { type: "usage", inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens };
    yield { type: "done", reason: choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason === "stop" ? "end_turn" : "stop" };
  }
  async embed(text, model) {
    const key = await this.apiKey();
    const resp = await this.host.fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, input: text })
    });
    if (resp.status >= 400)
      throw new Error(resp.body);
    const j = JSON.parse(resp.body);
    return new Float32Array(j.data[0].embedding);
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

// test/v2-live-creds.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
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
var nodeHost = {
  hmacHex: async () => "unused",
  sha256Hex: async () => "unused",
  fetch: async (url, init) => {
    const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
    const text = await r.text();
    const h = {};
    r.headers.forEach((v, k) => {
      h[k] = v;
    });
    return { status: r.status, headers: h, body: text };
  }
};
var providerHost = { fetch: nodeHost.fetch };
function redact(s) {
  return s ? s.slice(0, 8) + "..." + s.slice(-4) : "(none)";
}
async function main() {
  console.log("\n=== Live API credential check ===");
  console.log(`  ANTHROPIC_API_KEY : ${redact(env.ANTHROPIC_API_KEY)}`);
  console.log(`  OPENAI_API_KEY    : ${redact(env.OPENAI_API_KEY)}`);
  console.log(`  GOOGLE_GEMINI_KEY : ${redact(env.GOOGLE_GEMINI_API_KEY)}`);
  console.log(`  NOTION_TOKEN      : ${redact(env.NOTION_TOKEN)}`);
  console.log(`  TWILIO_SID        : ${redact(env.TWILIO_ACCOUNT_SID)}`);
  console.log("\n=== Anthropic \u2014 live /v1/messages ===");
  if (!env.ANTHROPIC_API_KEY)
    skipMsg("anthropic e2e", "no ANTHROPIC_API_KEY");
  else {
    const prov = new AnthropicProvider(providerHost, async () => env.ANTHROPIC_API_KEY, env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1");
    let textSeen = "";
    let doneReason = "";
    let inTok = 0, outTok = 0;
    try {
      for await (const ev of prov.complete({
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "Reply with exactly: PONG" }],
        maxTokens: 20
      })) {
        if (ev.type === "text")
          textSeen += ev.delta;
        if (ev.type === "usage") {
          inTok = ev.inputTokens;
          outTok = ev.outputTokens;
        }
        if (ev.type === "done") {
          doneReason = ev.reason;
          if (ev.reason === "error" && ev.error)
            console.log(`    (provider error: ${ev.error?.slice(0, 200)})`);
        }
      }
      check("Anthropic returned text", textSeen.length > 0, `text="${textSeen.slice(0, 60)}"`);
      check("Anthropic reported usage", inTok > 0 && outTok > 0, `in=${inTok} out=${outTok}`);
      check("Anthropic done reason normal", doneReason === "end_turn" || doneReason === "stop", `reason=${doneReason}`);
    } catch (e) {
      check("Anthropic e2e", false, e instanceof Error ? e.message : String(e));
    }
  }
  console.log("\n=== OpenAI \u2014 live /v1/chat/completions + /v1/embeddings ===");
  if (!env.OPENAI_API_KEY)
    skipMsg("openai e2e", "no OPENAI_API_KEY");
  else {
    const prov = new OpenAIProvider(providerHost, async () => env.OPENAI_API_KEY);
    let textSeen = "";
    try {
      for await (const ev of prov.complete({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Reply with exactly: PONG" }],
        maxTokens: 20
      })) {
        if (ev.type === "text")
          textSeen += ev.delta;
        if (ev.type === "done" && ev.reason === "error" && ev.error)
          console.log(`    (provider error: ${ev.error?.slice(0, 200)})`);
      }
      check("OpenAI chat returned text", textSeen.length > 0, `text="${textSeen.slice(0, 60)}"`);
    } catch (e) {
      check("OpenAI chat e2e", false, e instanceof Error ? e.message : String(e));
    }
    try {
      const vec = await prov.embed("Sauce Graph live verification", "text-embedding-3-small");
      check("OpenAI embed dim 1536", vec.length === 1536, `dim=${vec.length}`);
      check("OpenAI embed produces non-trivial vector", vec.some((x) => Math.abs(x) > 0.01));
    } catch (e) {
      check("OpenAI embed e2e", false, e instanceof Error ? e.message : String(e));
    }
  }
  console.log("\n=== Notion \u2014 live /v1/users/me ===");
  if (!env.NOTION_TOKEN)
    skipMsg("notion e2e", "no NOTION_TOKEN");
  else {
    try {
      const r = await fetch("https://api.notion.com/v1/users/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, "Notion-Version": "2022-06-28" }
      });
      const j = await r.json();
      check("Notion API reachable (status 200)", r.status === 200, `status=${r.status}`);
      check("Notion returned bot identity", j.object === "user" && j.type === "bot", `obj=${j.object} type=${j.type}`);
      console.log(`  Notion workspace: ${j.bot?.workspace_name ?? "(none)"}`);
    } catch (e) {
      check("Notion live", false, e instanceof Error ? e.message : String(e));
    }
  }
  console.log("\n=== Twilio \u2014 live /Accounts/{SID}.json ===");
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN)
    skipMsg("twilio e2e", "no TWILIO_*");
  else {
    try {
      const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`, {
        method: "GET",
        headers: { Authorization: `Basic ${auth}` }
      });
      const j = await r.json();
      check("Twilio API reachable", r.status === 200, `status=${r.status}`);
      check("Twilio account active", j.status === "active" || j.status === "suspended", `status=${j.status}`);
      check("Twilio SID echoed", j.sid === env.TWILIO_ACCOUNT_SID);
      console.log(`  Twilio account: ${j.friendly_name} (${j.status})`);
    } catch (e) {
      check("Twilio live", false, e instanceof Error ? e.message : String(e));
    }
  }
  console.log("\n=== Google Gemini \u2014 live /v1beta/models ===");
  if (!env.GOOGLE_GEMINI_API_KEY)
    skipMsg("gemini e2e", "no GOOGLE_GEMINI_API_KEY");
  else {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${env.GOOGLE_GEMINI_API_KEY}`);
      const j = await r.json();
      check("Gemini API reachable", r.status === 200, `status=${r.status}`);
      check("Gemini returned model catalogue", !!j.models && j.models.length > 0, `n=${j.models?.length}`);
      console.log(`  Gemini models available: ${j.models?.length ?? 0}`);
    } catch (e) {
      check("Gemini live", false, e instanceof Error ? e.message : String(e));
    }
  }
  console.log("\n=== LM Studio \u2014 local (if running) ===");
  const lmEndpoint = (env.LMSTUDIO_ENDPOINT_REST ?? env.LMSTUDIO_ENDPOINT ?? "http://localhost:1234") + "/v1";
  const lm = new LMStudioProvider(providerHost, { endpoint: lmEndpoint, apiKey: env.LMSTUDIO_API_KEY });
  const ping = await lm.ping();
  if (!ping.ok)
    skipMsg("lmstudio live", `not running locally (${ping.error})`);
  else {
    check("LM Studio /models reachable", ping.ok, `latency=${ping.latencyMs}ms`);
    await lm.refreshModels();
    check("LM Studio reports loaded models", lm.models.length > 0, `n=${lm.models.length}`);
    if (lm.models.length > 0) {
      try {
        let txt = "";
        for await (const ev of lm.complete({ model: lm.models[0].id, messages: [{ role: "user", content: "Say hi" }], maxTokens: 32 })) {
          if (ev.type === "text")
            txt += ev.delta;
        }
        check("LM Studio chat returned text", txt.length > 0, `text="${txt.slice(0, 40)}"`);
      } catch (e) {
        check("LM Studio chat e2e", false, e instanceof Error ? e.message : String(e));
      }
    }
  }
  console.log("\n=== Ollama \u2014 local (if running) ===");
  try {
    const r = await fetch("http://localhost:11434/api/tags");
    if (r.status !== 200)
      skipMsg("ollama live", `endpoint not reachable (status ${r.status})`);
    else {
      const j = await r.json();
      check("Ollama /api/tags reachable", true);
      check("Ollama lists models", j.models.length > 0, `n=${j.models.length}`);
    }
  } catch (e) {
    skipMsg("ollama live", `not running (${e instanceof Error ? e.message : String(e)})`);
  }
  console.log("\n=== LIVE-CREDS RESULTS ===");
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
