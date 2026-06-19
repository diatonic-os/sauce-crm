// Local provider end-to-end: OllamaProvider + LMStudioProvider against mock HTTP,
// plus LocalProviderCredentials round-trip via KeyVault and settings-page render.
import { OllamaProvider } from "../src/copilot/OllamaProvider";
import { LMStudioProvider } from "../src/copilot/LMStudioProvider";
import { LocalProviderCredentials } from "../src/copilot/LocalProviderCredentials";
import {
  KeyVault,
  JsonSecretStore,
  type CryptoBackend,
} from "../src/security/KeyVault";
import { LocalLLMPage } from "../src/ui/settings/LocalLLMPage";
import { buildSettingsTree } from "../src/ui/settings";
import * as crypto from "node:crypto";

let pass = 0,
  fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(`${name} ${detail}`);
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

const nodeCrypto: CryptoBackend = {
  async argon2id(password, salt, opts) {
    return new Promise((res, rej) =>
      crypto.scrypt(password, Buffer.from(salt), opts.outBytes, (e, k) =>
        e ? rej(e) : res(new Uint8Array(k)),
      ),
    );
  },
  secretboxSeal(key, nonce, msg) {
    const c = crypto.createCipheriv(
      "chacha20-poly1305",
      Buffer.from(key),
      Buffer.from(nonce.slice(0, 12)),
      { authTagLength: 16 },
    );
    const e = Buffer.concat([c.update(Buffer.from(msg)), c.final()]);
    return new Uint8Array(Buffer.concat([e, c.getAuthTag()]));
  },
  secretboxOpen(key, nonce, ct) {
    try {
      const d = Buffer.from(ct);
      const e = d.subarray(0, d.length - 16);
      const t = d.subarray(d.length - 16);
      const dec = crypto.createDecipheriv(
        "chacha20-poly1305",
        Buffer.from(key),
        Buffer.from(nonce.slice(0, 12)),
        { authTagLength: 16 },
      );
      dec.setAuthTag(t);
      return new Uint8Array(Buffer.concat([dec.update(e), dec.final()]));
    } catch {
      return null;
    }
  },
  randomBytes(n) {
    return new Uint8Array(crypto.randomBytes(n));
  },
};

// In-process fake HTTP — exercises the provider code paths exhaustively.
type HttpRecord = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};
function makeHttp(
  routes: Record<string, (req: HttpRecord) => { status: number; body: string }>,
) {
  const log: HttpRecord[] = [];
  return {
    log,
    fetch: async (
      url: string,
      init: { method: string; headers: Record<string, string>; body?: string },
    ) => {
      const rec = {
        url,
        method: init.method,
        headers: init.headers,
        body: init.body,
      };
      log.push(rec);
      for (const [k, h] of Object.entries(routes)) {
        if (url.includes(k)) return { ...h(rec), headers: {} };
      }
      return { status: 404, headers: {}, body: "not found" };
    },
  };
}

async function main(): Promise<void> {
  console.log("\n=== Ollama provider e2e ===");
  const ollamaHttp = makeHttp({
    "/api/tags": () => ({
      status: 200,
      body: JSON.stringify({
        models: [{ name: "llama3:8b" }, { name: "qwen2.5-coder:7b" }],
      }),
    }),
    "/api/chat": () => ({
      status: 200,
      body: JSON.stringify({
        message: { content: "hello from ollama" },
        prompt_eval_count: 12,
        eval_count: 5,
      }),
    }),
    "/api/embeddings": () => ({
      status: 200,
      body: JSON.stringify({ embedding: [0.1, 0.2, 0.3] }),
    }),
  });
  const ollama = new OllamaProvider(ollamaHttp, {
    endpoint: "http://localhost:11434",
  });
  await ollama.refreshModels();
  check(
    "Ollama refreshes models from /api/tags",
    ollama.models.length === 2 && ollama.models[0].id === "llama3:8b",
  );
  const ping = await ollama.ping();
  check("Ollama ping OK", ping.ok);

  // Custom endpoint
  ollama.setConfig({ endpoint: "https://ollama.internal:8443" });
  check(
    "Ollama setConfig switches endpoint",
    ollama.getConfig().endpoint === "https://ollama.internal:8443",
  );
  // Reset for chat
  ollama.setConfig({ endpoint: "http://localhost:11434" });

  // API key threading
  ollama.setConfig({ apiKey: "ollama-bearer-xyz" });
  const chatEvents: unknown[] = [];
  for await (const ev of ollama.complete({
    model: "llama3:8b",
    messages: [{ role: "user", content: "hi" }],
  })) {
    chatEvents.push(ev);
  }
  check(
    "Ollama chat yields a text event",
    chatEvents.some((e) => (e as { type: string }).type === "text"),
  );
  check(
    "Ollama chat yields a usage event",
    chatEvents.some((e) => (e as { type: string }).type === "usage"),
  );
  const lastChat = ollamaHttp.log[ollamaHttp.log.length - 1];
  check(
    "Ollama bearer header sent",
    lastChat.headers.authorization === "Bearer ollama-bearer-xyz",
  );

  const vec = await ollama.embed("hello", "nomic-embed-text");
  check(
    "Ollama embed returns Float32Array dim 3",
    vec.length === 3 && Math.abs(vec[0] - 0.1) < 1e-6,
  );

  console.log("\n=== LM Studio provider e2e ===");
  const lmHttp = makeHttp({
    "/models": () => ({
      status: 200,
      body: JSON.stringify({
        data: [{ id: "qwen2.5-32b-instruct-q4_k_m" }, { id: "gemma-2-9b-it" }],
      }),
    }),
    "/chat/completions": () => ({
      status: 200,
      body: JSON.stringify({
        choices: [
          { message: { content: "hi from lm studio" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 4 },
      }),
    }),
    "/embeddings": () => ({
      status: 200,
      body: JSON.stringify({ data: [{ embedding: [0.4, 0.5, 0.6, 0.7] }] }),
    }),
  });
  const lm = new LMStudioProvider(lmHttp, {
    endpoint: "http://localhost:1234/v1",
  });
  await lm.refreshModels();
  check(
    "LM Studio refreshes models from /models",
    lm.models.length === 2 && lm.models[0].id.includes("qwen2.5"),
  );
  const lmPing = await lm.ping();
  check("LM Studio ping OK", lmPing.ok);
  check(
    "LM Studio capabilities reflects toolUse=false by default",
    lm.capabilities().toolUse === false,
  );

  lm.setConfig({ toolUse: true, apiKey: "lmstudio-key-abc" });
  check(
    "LM Studio toolUse toggle reflected in capabilities",
    lm.capabilities().toolUse === true,
  );
  const lmEvents: unknown[] = [];
  for await (const ev of lm.complete({
    model: "qwen2.5-32b-instruct-q4_k_m",
    messages: [{ role: "user", content: "hello" }],
    tools: [
      { name: "echo", description: "echo it", inputSchema: { type: "object" } },
    ],
  }))
    lmEvents.push(ev);
  check("LM Studio chat yields text + usage + done", lmEvents.length >= 3);
  const lastLm = lmHttp.log[lmHttp.log.length - 1];
  check(
    "LM Studio bearer key sent",
    lastLm.headers.authorization === "Bearer lmstudio-key-abc",
  );
  // tools serialized in the body
  const sentBody = JSON.parse(lastLm.body ?? "{}") as { tools?: unknown[] };
  check(
    "LM Studio sent tools array when toolUse enabled",
    Array.isArray(sentBody.tools) && sentBody.tools.length === 1,
  );

  const lmVec = await lm.embed("hi", "nomic-embed-text-v1.5");
  check("LM Studio embed returns Float32Array dim 4", lmVec.length === 4);

  // Custom endpoint
  lm.setConfig({ endpoint: "https://lmstudio.internal/v2" });
  check(
    "LM Studio setConfig switches endpoint",
    lm.getConfig().endpoint === "https://lmstudio.internal/v2",
  );

  console.log("\n=== LocalProviderCredentials e2e ===");
  const blob: Record<string, unknown> = {};
  const store = new JsonSecretStore(
    async () => blob,
    async (d) => {
      Object.assign(blob, d);
    },
  );
  const vault = new KeyVault(store, nodeCrypto);
  await vault.unlock("local-llm-vault-pw");
  const creds = new LocalProviderCredentials(vault);
  await creds.setOllamaKey("stored-ollama-key");
  await creds.setLMStudioKey("stored-lmstudio-key");
  check(
    "Ollama key persisted to KeyVault",
    (await creds.getOllamaKey()) === "stored-ollama-key",
  );
  check(
    "LM Studio key persisted to KeyVault",
    (await creds.getLMStudioKey()) === "stored-lmstudio-key",
  );
  // Lock + unlock: keys must survive
  vault.lock();
  await vault.unlock("local-llm-vault-pw");
  check(
    "Keys survive lock/unlock cycle",
    (await creds.getOllamaKey()) === "stored-ollama-key" &&
      (await creds.getLMStudioKey()) === "stored-lmstudio-key",
  );

  console.log("\n=== Settings page render ===");
  type FakeEl = {
    tagName: string;
    children: FakeEl[];
    textContent: string;
    value: string;
    checked: boolean;
    type: string;
    dataset: Record<string, string>;
    className: string;
    appendChild: (c: FakeEl) => FakeEl;
    setAttribute: (k: string, v: string) => void;
    addEventListener: (e: string, fn: () => void) => void;
    empty?: () => void;
  };
  const make = (tag: string): FakeEl => ({
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
      if (k === "class") this.className = v;
      if (k === "type") this.type = v;
    },
    addEventListener() {
      /* not exercised */
    },
    empty() {
      this.children.length = 0;
    },
  });
  (
    globalThis as unknown as {
      document: { createElement: (t: string) => FakeEl };
    }
  ).document = { createElement: make };

  const settingsBlob: Record<string, unknown> = {
    "copilot.ollama.endpoint": "http://localhost:11434",
    "copilot.ollama.defaultModel": "llama3",
    "copilot.lmstudio.endpoint": "http://localhost:1234/v1",
    "copilot.lmstudio.defaultModel": "local-model",
    "copilot.lmstudio.toolUse": true,
  };
  const settingsHost = {
    getConfig: <T>(k: string, f: T) => (settingsBlob[k] ?? f) as T,
    setConfig: async <T>(k: string, v: T) => {
      settingsBlob[k] = v;
    },
  };
  const page = new LocalLLMPage(settingsHost);
  const root = make("div");
  page.render(root as unknown as HTMLElement);
  check("LocalLLMPage rendered something", root.children.length > 0);
  check(
    "LocalLLMPage shows Ollama + LM Studio sections",
    root.children.some((c) => c.textContent === "Ollama") &&
      root.children.some((c) => c.textContent === "LM Studio"),
  );

  // Tree integration
  const tree = buildSettingsTree(settingsHost);
  check(
    "Settings tree now includes LocalLLMPage",
    tree.some((n) => n.page.id === "copilot.local"),
  );
  check("Settings tree total = 20 top-level (was 19)", tree.length === 20);

  console.log("\n=== LOCAL PROVIDER RESULTS ===");
  console.log(`PASS ${pass}   FAIL ${fail}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
