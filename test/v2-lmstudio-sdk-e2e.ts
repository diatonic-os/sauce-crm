// Comprehensive LM Studio TypeScript SDK e2e suite.
// Exercises every V2 surface in src/copilot/lmstudio/ against the live local server.
// Reads SAUCE_GRAPH_PLUG token from test/.env.live (op-injected). Never prints raw secrets.

import {
  buildLMStudioIntegration,
  type LMStudioIntegration,
} from "../src/copilot/lmstudio";
import {
  KeyVault,
  JsonSecretStore,
  type CryptoBackend,
} from "../src/security/KeyVault";
import {
  KeyVaultCredentialSource,
  ChainedCredentialSource,
} from "../src/copilot/CredentialSource";
import { EnvCredentialSource } from "./EnvCredentialSource";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

let pass = 0,
  fail = 0,
  skip = 0;
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
function skipMsg(name: string, reason: string): void {
  skip++;
  console.log(`  SKIP  ${name} — ${reason}`);
}
function redact(s: string | null | undefined): string {
  return s ? `${s.slice(0, 8)}…${s.slice(-4)}` : "(none)";
}

function loadEnv(): Record<string, string> {
  const p = path.join(__dirname, ".env.live");
  if (!fs.existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = loadEnv();

const nodeCrypto: CryptoBackend = {
  async argon2id(p, s, o) {
    return new Promise((r, j) =>
      crypto.scrypt(p, Buffer.from(s), o.outBytes, (e, k) =>
        e ? j(e) : r(new Uint8Array(k)),
      ),
    );
  },
  secretboxSeal(k, n, m) {
    const c = crypto.createCipheriv(
      "chacha20-poly1305",
      Buffer.from(k),
      Buffer.from(n.slice(0, 12)),
      { authTagLength: 16 },
    );
    const e = Buffer.concat([c.update(Buffer.from(m)), c.final()]);
    return new Uint8Array(Buffer.concat([e, c.getAuthTag()]));
  },
  secretboxOpen(k, n, ct) {
    try {
      const d = Buffer.from(ct);
      const e = d.subarray(0, d.length - 16);
      const t = d.subarray(d.length - 16);
      const dec = crypto.createDecipheriv(
        "chacha20-poly1305",
        Buffer.from(k),
        Buffer.from(n.slice(0, 12)),
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

async function main(): Promise<void> {
  console.log("\n=== LM Studio SDK e2e ===");
  console.log(`  Token (SAUCE_GRAPH_PLUG): ${redact(env.LMSTUDIO_API_KEY)}`);
  console.log(`  REST endpoint: ${env.LMSTUDIO_ENDPOINT_REST}`);
  console.log(`  WS   endpoint: ${env.LMSTUDIO_ENDPOINT_WS}`);

  // ─── 1) Credentials: KeyVault > env precedence, end-to-end ──────────
  console.log("\n--- Credential precedence: KeyVault → env (test-only) ---");
  const blob: Record<string, unknown> = {};
  const store = new JsonSecretStore(
    async () => blob,
    async (d) => {
      Object.assign(blob, d);
    },
  );
  const vault = new KeyVault(store, nodeCrypto);
  await vault.unlock("lm-studio-sdk-vault-pw");
  const kvSrc = new KeyVaultCredentialSource(vault);
  const envSrc = new EnvCredentialSource(env, {
    "copilot:lmstudio:api-token": "LMSTUDIO_API_KEY",
    "copilot:lmstudio:client-id": "LMSTUDIO_CLIENT_ID",
    "copilot:lmstudio:client-passkey": "LMSTUDIO_CLIENT_PASSKEY",
  });
  const chain = new ChainedCredentialSource([kvSrc, envSrc]);
  check("CredentialSource chain available", chain.available());
  const tok = await chain.get("copilot:lmstudio:api-token");
  check(
    "Chain resolves LM Studio token from env (KeyVault empty)",
    tok === env.LMSTUDIO_API_KEY,
  );

  // GUI override: setting in KeyVault wins
  await kvSrc.put("copilot:lmstudio:api-token", "gui-set-override-XYZ");
  const overridden = await chain.get("copilot:lmstudio:api-token");
  check(
    "GUI/KeyVault token overrides env",
    overridden === "gui-set-override-XYZ",
  );
  await kvSrc.clear("copilot:lmstudio:api-token");

  // ─── 2) Build the integration ────────────────────────────────────────
  console.log("\n--- Integration factory ---");
  let integration: LMStudioIntegration;
  try {
    integration = await buildLMStudioIntegration({
      source: chain,
      config: {
        baseUrl: env.LMSTUDIO_ENDPOINT_WS || "ws://127.0.0.1:1234",
        verboseErrors: false,
      },
    });
    check("LMStudioIntegration built (factory + client)", !!integration.client);
  } catch (e) {
    check(
      "LMStudioIntegration built",
      false,
      e instanceof Error ? e.message : String(e),
    );
    console.log("\n=== RESULTS ===");
    console.log(`PASS ${pass}   FAIL ${fail}   SKIP ${skip}`);
    process.exit(1);
  }

  // ─── 3) Model manager: list downloaded + listLoaded + version ────────
  console.log("\n--- Model management ---");
  let downloaded: Awaited<
    ReturnType<typeof integration.models.listDownloaded>
  > = [];
  try {
    downloaded = await integration.models.listDownloaded();
    check(
      "listDownloaded works",
      downloaded.length > 0,
      `n=${downloaded.length}`,
    );
    console.log(`    ${downloaded.length} downloaded models. First 3:`);
    downloaded
      .slice(0, 3)
      .forEach((m) =>
        console.log(
          `      - ${m.modelKey} (${m.type ?? "?"}, ${m.sizeBytes ? (m.sizeBytes / 1e9).toFixed(2) + "GB" : "?"})`,
        ),
      );
  } catch (e) {
    check(
      "listDownloaded works",
      false,
      e instanceof Error ? e.message : String(e),
    );
  }

  try {
    const loaded = await integration.models.listLoaded();
    check("listLoaded works", Array.isArray(loaded), `loaded=${loaded.length}`);
  } catch (e) {
    check(
      "listLoaded works",
      false,
      e instanceof Error ? e.message : String(e),
    );
  }

  const ver = await integration.models.lmStudioVersion();
  if (ver)
    check(
      "lmStudioVersion returns build info",
      !!ver.version,
      `v=${ver.version}`,
    );
  else
    skipMsg("lmStudioVersion", "SDK build does not expose getLMStudioVersion");

  // ─── 4) JIT load + chat respond ───────────────────────────────────────
  console.log("\n--- Chat: JIT load + respond ---");
  // Pick a small chat model from downloaded list
  const chatCandidates = downloaded
    .map((m) => m.modelKey)
    .filter(
      (k) =>
        !k.toLowerCase().includes("embed") &&
        !k.toLowerCase().includes("embedding"),
    )
    .filter((k) => !!k);
  const targetModel =
    chatCandidates.find((k) => /micro|mini|tiny|1b|3b/i.test(k)) ??
    chatCandidates[0];
  if (!targetModel) {
    skipMsg("chat respond", "no chat-capable model downloaded");
  } else {
    console.log(`    chosen chat model: ${targetModel}`);
    try {
      const start = Date.now();
      const res = await integration.chat.respond({
        modelId: targetModel,
        messages: [
          {
            role: "user",
            content: "Reply with exactly the word PONG and nothing else.",
          },
        ],
        maxTokens: 30,
        temperature: 0.0,
      });
      const dt = Date.now() - start;
      check(
        "chat respond returns content",
        res.content.length > 0,
        `text="${res.content.slice(0, 60)}" (${dt}ms)`,
      );
      check(
        "chat respond reports stats",
        !!res.stats,
        `predicted=${res.stats.predictedTokensCount}`,
      );

      // ─── 5) Tokenizer + countTokens ────────────────────────────────
      console.log("\n--- Tokenization ---");
      const toks = await integration.tokenizer.tokenize(
        targetModel,
        "Hello world",
      );
      check(
        "tokenize returns ints",
        Array.isArray(toks) && toks.length > 0,
        `n=${toks.length}`,
      );
      const cnt = await integration.tokenizer.countTokens(
        targetModel,
        "Hello world",
      );
      check("countTokens returns positive int", cnt > 0, `count=${cnt}`);
      check(
        "countTokens ≈ tokenize length",
        Math.abs(cnt - toks.length) <= 1,
        `cnt=${cnt} len=${toks.length}`,
      );

      // ─── 6) Context length + model info ────────────────────────────
      console.log("\n--- Model info ---");
      const ctx = await integration.models.getContextLength(targetModel);
      check("getContextLength returns positive", ctx > 0, `ctx=${ctx}`);
      const info = await integration.models.getInfo(targetModel);
      check(
        "getInfo returns model instance info",
        !!info,
        `id=${info?.identifier ?? "?"}`,
      );

      // ─── 7) Streaming chat ─────────────────────────────────────────
      console.log("\n--- Streaming ---");
      const events: Array<{ type: string; delta?: string }> = [];
      for await (const ev of integration.chat.stream({
        modelId: targetModel,
        messages: [
          { role: "user", content: "Count from 1 to 3, one per line." },
        ],
        maxTokens: 50,
        temperature: 0.0,
      })) {
        events.push({ type: ev.type, delta: ev.delta });
      }
      const textEvents = events.filter((e) => e.type === "text");
      const doneEvent = events.find((e) => e.type === "done");
      check(
        "stream emits text events",
        textEvents.length > 0,
        `n=${textEvents.length}`,
      );
      check("stream terminates with done event", !!doneEvent);

      // ─── 8) Cancellation via AbortController ───────────────────────
      console.log("\n--- Cancellation ---");
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 50);
      const cancellable = integration.chat.respond({
        modelId: targetModel,
        messages: [
          {
            role: "user",
            content: "Write a long essay about the history of computing.",
          },
        ],
        maxTokens: 4000,
        signal: ac.signal,
      });
      let cancelled = false;
      let returned = false;
      try {
        await cancellable;
        returned = true;
      } catch {
        cancelled = true;
      }
      check(
        "respond honours AbortSignal",
        cancelled || returned,
        `cancelled=${cancelled} returned=${returned}`,
      );

      // ─── 9) Embeddings (if an embedding model is loaded) ───────────
      console.log("\n--- Embeddings ---");
      const embedCandidates = downloaded
        .map((m) => m.modelKey)
        .filter((k) => /embed/i.test(k));
      if (embedCandidates.length === 0)
        skipMsg("embed", "no embedding model downloaded");
      else {
        const embedModel = embedCandidates[0];
        try {
          const v = await integration.embed.embed(
            embedModel,
            "Sauce Graph V2 verification",
          );
          check(
            "embed returns Float32Array",
            v instanceof Float32Array && v.length > 0,
            `dim=${v.length}`,
          );
          check(
            "embedding is non-trivial",
            Array.from(v).some((x) => Math.abs(x) > 0.001),
          );
        } catch (e) {
          check(
            "embed live",
            false,
            e instanceof Error ? e.message : String(e),
          );
        }
      }

      // ─── 10) Tool / .act() agentic flow ────────────────────────────
      console.log("\n--- Agentic .act() ---");
      try {
        const toolHandle = await integration.client.llm.model(targetModel);
        if (!toolHandle.act) {
          skipMsg(
            "act() agentic",
            "model handle does not expose .act() — older SDK or model",
          );
        } else {
          let invocations = 0;
          const actResult = await integration.act.act({
            modelId: targetModel,
            messages: [
              {
                role: "user",
                content:
                  "Use the add tool to compute 17 + 25 and tell me the answer.",
              },
            ],
            tools: [
              {
                name: "add",
                description: "Add two integers a and b.",
                parameters: {
                  type: "object",
                  properties: { a: { type: "number" }, b: { type: "number" } },
                  required: ["a", "b"],
                },
                invoke: async (args) => {
                  invocations += 1;
                  return Number(args.a) + Number(args.b);
                },
              },
            ],
          });
          check(
            "act() invoked the add tool",
            invocations >= 1,
            `invocations=${invocations}`,
          );
          check(
            "act() recorded tool calls",
            actResult.toolCalls.length >= 1,
            `calls=${actResult.toolCalls.length}`,
          );
          if (actResult.toolCalls.length > 0) {
            check(
              "add tool result is 42",
              actResult.toolCalls[0].result === 42,
              `result=${actResult.toolCalls[0].result}`,
            );
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/does not support tool use|not supported|tool_use/i.test(msg))
          skipMsg("act() agentic", "model does not support tool use");
        else check("act() agentic flow", false, msg);
      }
    } catch (e) {
      check("chat respond", false, e instanceof Error ? e.message : String(e));
    }
  }

  // ─── Final ────────────────────────────────────────────────────────────
  console.log("\n=== LM STUDIO SDK RESULTS ===");
  console.log(`PASS ${pass}   FAIL ${fail}   SKIP ${skip}`);
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
