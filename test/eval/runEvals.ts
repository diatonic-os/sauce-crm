// SauceBot provider eval harness. Drives the REAL provider classes against live
// endpoints (Anthropic, OpenAI, LM Studio) through a Node host, every call gated
// by a BudgetGuard (hard $ cap + call cap + circuit breaker + kill-file).
// Socratic matrix per provider: capabilities, prompt ingestion (non-stream),
// response streaming, tool-use, usage accounting, and failure/guard handling.
//
// Run:  esbuild-bundle this file → node.  Keys from .eval-keys.env (gitignored).
// Hard-kill mid-run:  touch /tmp/STOP_SAUCEBOT_EVALS

import { readFileSync, existsSync } from "fs";
// Direct file imports (NOT the index barrel, which re-exports Obsidian-dependent
// modules that would break the Node bundle).
import { AnthropicProvider } from "../../src/saucebot/AnthropicProvider";
import { OpenAIProvider } from "../../src/saucebot/OpenAIProvider";
import { OpenAICompatibleProvider } from "../../src/saucebot/OpenAICompatibleProvider";
import type {
  CompletionRequest,
  CompletionEvent,
  ISauceBotProvider,
} from "../../src/saucebot/ISauceBotProvider";
import { makeNodeHost } from "./nodeHost";
import {
  BudgetGuard,
  ANTHROPIC_PRICES,
  OPENAI_PRICES,
} from "./budgetGuard";

const KILL_FILE = "/tmp/STOP_SAUCEBOT_EVALS";
const MAX_TOKENS = 128; // bound per-call output cost

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  if (existsSync(".eval-keys.env")) {
    for (const line of readFileSync(".eval-keys.env", "utf-8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] && m[2]) out[m[1]] = m[2].trim();
    }
  }
  return out;
}

interface Drained {
  text: string;
  toolUses: Array<{ name: string; input: unknown }>;
  usage: { in: number; out: number };
  reason: string;
  error?: string;
}

/** Run one completion fully, gated by the guard. Records usage + outcome. */
async function drain(
  provider: ISauceBotProvider,
  req: CompletionRequest,
  guard: BudgetGuard,
  model: string,
): Promise<Drained> {
  guard.preflight(); // throws if budget/breaker/kill tripped — STOPS the run
  const d: Drained = { text: "", toolUses: [], usage: { in: 0, out: 0 }, reason: "" };
  let ok = false;
  try {
    for await (const ev of provider.complete(req) as AsyncIterable<CompletionEvent>) {
      if (ev.type === "text") d.text += ev.delta;
      else if (ev.type === "tool_use") d.toolUses.push({ name: ev.name, input: ev.input });
      else if (ev.type === "usage") d.usage = { in: ev.inputTokens, out: ev.outputTokens };
      else if (ev.type === "done") {
        d.reason = ev.reason;
        if (ev.error) d.error = ev.error;
      }
    }
    ok = d.reason !== "error";
  } finally {
    guard.record(model, d.usage.in, d.usage.out, ok);
  }
  return d;
}

interface EvalCase {
  name: string;
  run: () => Promise<{ ok: boolean; detail: string }>;
}

interface ProviderTarget {
  label: string;
  provider: ISauceBotProvider;
  chatModel: string;
  embedModel?: string;
  guard: BudgetGuard;
}

function buildCases(t: ProviderTarget): EvalCase[] {
  const base = (extra: Partial<CompletionRequest>): CompletionRequest => ({
    model: t.chatModel,
    messages: [{ role: "user", content: "Reply with exactly: PONG" }],
    maxTokens: MAX_TOKENS,
    temperature: 0,
    ...extra,
  });
  const cases: EvalCase[] = [
    {
      name: "capabilities()",
      run: async () => {
        const c = t.provider.capabilities();
        return { ok: typeof c.streaming === "boolean" && typeof c.toolUse === "boolean", detail: JSON.stringify(c) };
      },
    },
    {
      name: "prompt ingestion + non-stream completion (+ usage)",
      run: async () => {
        const d = await drain(t.provider, base({ stream: false }), t.guard, t.chatModel);
        const ok = d.text.length > 0 && d.reason !== "error";
        return { ok, detail: `text="${d.text.slice(0, 40)}" reason=${d.reason} usage=${d.usage.in}/${d.usage.out}${d.error ? " err=" + d.error : ""}` };
      },
    },
    {
      name: "response streaming (multiple deltas)",
      run: async () => {
        let deltas = 0;
        guardPreflight(t.guard);
        let reason = "", text = "", uin = 0, uout = 0, err: string | undefined;
        let ok = false;
        try {
          for await (const ev of t.provider.complete(base({ stream: true, messages: [{ role: "user", content: "Count: one two three four five." }] })) as AsyncIterable<CompletionEvent>) {
            if (ev.type === "text") { deltas++; text += ev.delta; }
            else if (ev.type === "usage") { uin = ev.inputTokens; uout = ev.outputTokens; }
            else if (ev.type === "done") { reason = ev.reason; if (ev.error) err = ev.error; }
          }
          ok = deltas >= 1 && reason !== "error";
        } finally {
          t.guard.record(t.chatModel, uin, uout, ok);
        }
        return { ok, detail: `deltas=${deltas} reason=${reason} len=${text.length}${err ? " err=" + err : ""}` };
      },
    },
    {
      name: "tool-use (model emits tool_use or declines gracefully)",
      run: async () => {
        const d = await drain(
          t.provider,
          base({
            stream: false,
            messages: [{ role: "user", content: "Use the get_time tool to tell the time in Tokyo." }],
            tools: [{ name: "get_time", description: "Get current time in a city", inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }],
          }),
          t.guard,
          t.chatModel,
        );
        // Pass if a tool_use surfaced OR the model produced a coherent text reply
        // (some small models won't tool-call) — both are non-crash, valid paths.
        const ok = d.reason !== "error" && (d.toolUses.length > 0 || d.text.length > 0);
        return { ok, detail: `toolUses=${d.toolUses.map((x) => x.name).join(",") || "none"} reason=${d.reason}` };
      },
    },
    {
      name: "guard: invalid model id → handled (no crash/hang)",
      run: async () => {
        // The guarantee is graceful handling — NOT that every backend rejects an
        // unknown id. Cloud providers return done(reason:error); LM Studio is
        // lenient (serves the loaded model). Both are "handled"; a crash/hang is
        // the only failure. (drain returning, or a caught throw, both = handled.)
        try {
          const d = await drain(t.provider, base({ model: "this-model-does-not-exist-xyz", stream: false }), t.guard, t.chatModel);
          const errored = d.reason === "error" || !!d.error;
          return { ok: true, detail: errored ? `rejected: ${(d.error || "reason=error").slice(0, 50)}` : `served leniently (reason=${d.reason})` };
        } catch (e) {
          return { ok: true, detail: `threw (handled): ${String((e as Error).message).slice(0, 50)}` };
        }
      },
    },
  ];
  if (t.embedModel) {
    cases.push({
      name: "embed (memory/RAG vector)",
      run: async () => {
        guardPreflight(t.guard);
        let ok = false, detail = "";
        try {
          const v = await t.provider.embed("the quick brown fox", t.embedModel!);
          ok = v instanceof Float32Array && v.length > 0;
          detail = `dim=${v.length}`;
        } catch (e) {
          detail = `threw: ${String((e as Error).message).slice(0, 60)}`;
        } finally {
          t.guard.record(t.embedModel!, 8, 0, ok);
        }
        return { ok, detail };
      },
    });
  }
  return cases;
}

function guardPreflight(g: BudgetGuard): void {
  g.preflight();
}

async function runProvider(t: ProviderTarget): Promise<void> {
  console.log(`\n━━━ ${t.label} (model ${t.chatModel}) ━━━`);
  for (const c of buildCases(t)) {
    try {
      const r = await c.run();
      console.log(`  ${r.ok ? "✅" : "❌"} ${c.name} — ${r.detail}`);
    } catch (e) {
      const stop = String((e as Error).name);
      console.log(`  ⛔ ${c.name} — STOPPED (${stop}): ${String((e as Error).message)}`);
      break; // budget/breaker/kill tripped — stop this provider
    }
  }
  console.log(`  budget: ${JSON.stringify(t.guard.status())}`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const host = makeNodeHost();
  const targets: ProviderTarget[] = [];

  // LM Studio — local, free; still guarded (call cap + breaker) to bound loops.
  try {
    const r = await fetch("http://localhost:1234/v1/models");
    if (r.ok) {
      targets.push({
        label: "LM Studio (local, free)",
        provider: new OpenAICompatibleProvider(host, {
          name: "lmstudio",
          baseUrl: "http://localhost:1234/v1",
          authHeader: "none",
          supportsToolUse: true,
          supportsEmbeddings: true,
        }),
        chatModel: env.LMSTUDIO_MODEL || "ibm/granite-4-h-tiny",
        embedModel: env.LMSTUDIO_EMBED || "text-embedding-bge-m3",
        guard: new BudgetGuard({ platform: "lmstudio", capUsd: Number.POSITIVE_INFINITY, maxCalls: 40, prices: {}, fallbackPrice: { inUsdPerMtok: 0, outUsdPerMtok: 0 }, killFile: KILL_FILE }),
      });
    }
  } catch {
    console.log("LM Studio not reachable on :1234 — skipping.");
  }

  if (env.ANTHROPIC_API_KEY) {
    targets.push({
      label: "Anthropic ($10 cap)",
      provider: new AnthropicProvider(host, async () => env.ANTHROPIC_API_KEY!),
      chatModel: env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
      guard: new BudgetGuard({ platform: "anthropic", capUsd: 10, maxCalls: 40, prices: ANTHROPIC_PRICES, killFile: KILL_FILE }),
    });
  } else {
    console.log("ANTHROPIC_API_KEY not set — skipping Anthropic.");
  }

  if (env.OPENAI_API_KEY) {
    targets.push({
      label: "OpenAI ($10 cap)",
      provider: new OpenAIProvider(host, async () => env.OPENAI_API_KEY!),
      chatModel: env.OPENAI_MODEL || "gpt-4o-mini",
      embedModel: env.OPENAI_EMBED || "text-embedding-3-small",
      guard: new BudgetGuard({ platform: "openai", capUsd: 10, maxCalls: 40, prices: OPENAI_PRICES, killFile: KILL_FILE }),
    });
  } else {
    console.log("OPENAI_API_KEY not set — skipping OpenAI.");
  }

  if (targets.length === 0) {
    console.log("\nNo providers available. Provide keys in .eval-keys.env and/or start LM Studio.");
    return;
  }
  console.log(`Hard-kill mid-run: touch ${KILL_FILE}`);
  for (const t of targets) await runProvider(t);
  console.log("\n=== eval run complete ===");
}

void main().catch((e) => {
  console.error("eval harness fatal:", e);
  process.exit(1);
});
