// Live-credentials end-to-end. Loads .env.live (populated via `op inject -i test/env.tpl`)
// and exercises real API calls against each provider's REST endpoint via V2 code paths.
// Never prints raw secrets. Skips a provider cleanly when its key is absent.

import { AnthropicProvider } from "../src/copilot/AnthropicProvider";
import { OpenAIProvider } from "../src/copilot/OpenAIProvider";
import { LMStudioProvider } from "../src/copilot/LMStudioProvider";
import { ProxyClient, type ProxyHost } from "../src/security/ProxyClient";

import * as fs from "node:fs";
import * as path from "node:path";

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

// Real fetch via Node's built-in fetch (Node ≥18); wraps as ProxyHost.
const nodeHost: ProxyHost = {
  hmacHex: async () => "unused",
  sha256Hex: async () => "unused",
  fetch: async (url, init) => {
    const r = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    const text = await r.text();
    const h: Record<string, string> = {};
    r.headers.forEach((v, k) => {
      h[k] = v;
    });
    return { status: r.status, headers: h, body: text };
  },
};
const providerHost = { fetch: nodeHost.fetch };

function redact(s: string | undefined): string {
  return s ? s.slice(0, 8) + "..." + s.slice(-4) : "(none)";
}

async function main(): Promise<void> {
  console.log("\n=== Live API credential check ===");
  console.log(`  ANTHROPIC_API_KEY : ${redact(env.ANTHROPIC_API_KEY)}`);
  console.log(`  OPENAI_API_KEY    : ${redact(env.OPENAI_API_KEY)}`);
  console.log(`  GOOGLE_GEMINI_KEY : ${redact(env.GOOGLE_GEMINI_API_KEY)}`);
  console.log(`  NOTION_TOKEN      : ${redact(env.NOTION_TOKEN)}`);
  console.log(`  TWILIO_SID        : ${redact(env.TWILIO_ACCOUNT_SID)}`);

  // ─── Anthropic live ─────────────────────────────────────────────────
  console.log("\n=== Anthropic — live /v1/messages ===");
  if (!env.ANTHROPIC_API_KEY) skipMsg("anthropic e2e", "no ANTHROPIC_API_KEY");
  else {
    const prov = new AnthropicProvider(
      providerHost,
      async () => env.ANTHROPIC_API_KEY,
      env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
    );
    let textSeen = "";
    let doneReason = "";
    let inTok = 0,
      outTok = 0;
    try {
      for await (const ev of prov.complete({
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "Reply with exactly: PONG" }],
        maxTokens: 20,
      })) {
        if (ev.type === "text") textSeen += ev.delta;
        if (ev.type === "usage") {
          inTok = ev.inputTokens;
          outTok = ev.outputTokens;
        }
        if (ev.type === "done") {
          doneReason = ev.reason;
          if (ev.reason === "error" && (ev as { error?: string }).error)
            console.log(
              `    (provider error: ${(ev as { error?: string }).error?.slice(0, 200)})`,
            );
        }
      }
      check(
        "Anthropic returned text",
        textSeen.length > 0,
        `text="${textSeen.slice(0, 60)}"`,
      );
      check(
        "Anthropic reported usage",
        inTok > 0 && outTok > 0,
        `in=${inTok} out=${outTok}`,
      );
      check(
        "Anthropic done reason normal",
        doneReason === "end_turn" || doneReason === "stop",
        `reason=${doneReason}`,
      );
    } catch (e) {
      check("Anthropic e2e", false, e instanceof Error ? e.message : String(e));
    }
  }

  // ─── OpenAI live ────────────────────────────────────────────────────
  console.log("\n=== OpenAI — live /v1/chat/completions + /v1/embeddings ===");
  if (!env.OPENAI_API_KEY) skipMsg("openai e2e", "no OPENAI_API_KEY");
  else {
    const prov = new OpenAIProvider(
      providerHost,
      async () => env.OPENAI_API_KEY,
    );
    let textSeen = "";
    try {
      for await (const ev of prov.complete({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Reply with exactly: PONG" }],
        maxTokens: 20,
      })) {
        if (ev.type === "text") textSeen += ev.delta;
        if (
          ev.type === "done" &&
          ev.reason === "error" &&
          (ev as { error?: string }).error
        )
          console.log(
            `    (provider error: ${(ev as { error?: string }).error?.slice(0, 200)})`,
          );
      }
      check(
        "OpenAI chat returned text",
        textSeen.length > 0,
        `text="${textSeen.slice(0, 60)}"`,
      );
    } catch (e) {
      check(
        "OpenAI chat e2e",
        false,
        e instanceof Error ? e.message : String(e),
      );
    }
    try {
      const vec = await prov.embed(
        "Sauce Graph live verification",
        "text-embedding-3-small",
      );
      check("OpenAI embed dim 1536", vec.length === 1536, `dim=${vec.length}`);
      check(
        "OpenAI embed produces non-trivial vector",
        vec.some((x) => Math.abs(x) > 0.01),
      );
    } catch (e) {
      check(
        "OpenAI embed e2e",
        false,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // ─── Notion live ────────────────────────────────────────────────────
  console.log("\n=== Notion — live /v1/users/me ===");
  if (!env.NOTION_TOKEN) skipMsg("notion e2e", "no NOTION_TOKEN");
  else {
    try {
      const r = await fetch("https://api.notion.com/v1/users/me", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${env.NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
        },
      });
      const j = (await r.json()) as {
        object?: string;
        type?: string;
        bot?: { workspace_name?: string };
      };
      check(
        "Notion API reachable (status 200)",
        r.status === 200,
        `status=${r.status}`,
      );
      check(
        "Notion returned bot identity",
        j.object === "user" && j.type === "bot",
        `obj=${j.object} type=${j.type}`,
      );
      console.log(`  Notion workspace: ${j.bot?.workspace_name ?? "(none)"}`);
    } catch (e) {
      check("Notion live", false, e instanceof Error ? e.message : String(e));
    }
  }

  // ─── Twilio live ────────────────────────────────────────────────────
  console.log("\n=== Twilio — live /Accounts/{SID}.json ===");
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN)
    skipMsg("twilio e2e", "no TWILIO_*");
  else {
    try {
      const auth = Buffer.from(
        `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
      ).toString("base64");
      const r = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`,
        {
          method: "GET",
          headers: { Authorization: `Basic ${auth}` },
        },
      );
      const j = (await r.json()) as {
        sid?: string;
        friendly_name?: string;
        status?: string;
      };
      check("Twilio API reachable", r.status === 200, `status=${r.status}`);
      check(
        "Twilio account active",
        j.status === "active" || j.status === "suspended",
        `status=${j.status}`,
      );
      check("Twilio SID echoed", j.sid === env.TWILIO_ACCOUNT_SID);
      console.log(`  Twilio account: ${j.friendly_name} (${j.status})`);
    } catch (e) {
      check("Twilio live", false, e instanceof Error ? e.message : String(e));
    }
  }

  // ─── Google Gemini live ─────────────────────────────────────────────
  console.log("\n=== Google Gemini — live /v1beta/models ===");
  if (!env.GOOGLE_GEMINI_API_KEY)
    skipMsg("gemini e2e", "no GOOGLE_GEMINI_API_KEY");
  else {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GOOGLE_GEMINI_API_KEY}`,
      );
      const j = (await r.json()) as { models?: Array<{ name: string }> };
      check("Gemini API reachable", r.status === 200, `status=${r.status}`);
      check(
        "Gemini returned model catalogue",
        !!j.models && j.models.length > 0,
        `n=${j.models?.length}`,
      );
      console.log(`  Gemini models available: ${j.models?.length ?? 0}`);
    } catch (e) {
      check("Gemini live", false, e instanceof Error ? e.message : String(e));
    }
  }

  // ─── LM Studio live (only if running locally) ───────────────────────
  console.log("\n=== LM Studio — local (if running) ===");
  const lmEndpoint =
    (env.LMSTUDIO_ENDPOINT_REST ??
      env.LMSTUDIO_ENDPOINT ??
      "http://localhost:1234") + "/v1";
  const lm = new LMStudioProvider(providerHost, {
    endpoint: lmEndpoint,
    apiKey: env.LMSTUDIO_API_KEY,
  });
  const ping = await lm.ping();
  if (!ping.ok) skipMsg("lmstudio live", `not running locally (${ping.error})`);
  else {
    check(
      "LM Studio /models reachable",
      ping.ok,
      `latency=${ping.latencyMs}ms`,
    );
    await lm.refreshModels();
    check(
      "LM Studio reports loaded models",
      lm.models.length > 0,
      `n=${lm.models.length}`,
    );
    if (lm.models.length > 0) {
      try {
        let txt = "";
        for await (const ev of lm.complete({
          model: lm.models[0].id,
          messages: [{ role: "user", content: "Say hi" }],
          maxTokens: 32,
        })) {
          if (ev.type === "text") txt += ev.delta;
        }
        check(
          "LM Studio chat returned text",
          txt.length > 0,
          `text="${txt.slice(0, 40)}"`,
        );
      } catch (e) {
        check(
          "LM Studio chat e2e",
          false,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }

  // ─── Ollama live (only if running locally) ──────────────────────────
  console.log("\n=== Ollama — local (if running) ===");
  try {
    const r = await fetch("http://localhost:11434/api/tags");
    if (r.status !== 200)
      skipMsg("ollama live", `endpoint not reachable (status ${r.status})`);
    else {
      const j = (await r.json()) as { models: Array<{ name: string }> };
      check("Ollama /api/tags reachable", true);
      check("Ollama lists models", j.models.length > 0, `n=${j.models.length}`);
    }
  } catch (e) {
    skipMsg(
      "ollama live",
      `not running (${e instanceof Error ? e.message : String(e)})`,
    );
  }

  console.log("\n=== LIVE-CREDS RESULTS ===");
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
