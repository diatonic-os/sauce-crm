// Chat trace — replay-grade turn metadata; every layer id populated, no nulls.

import { describe, expect, it } from "vitest";
import { buildTurnTrace, type TurnContext } from "../../src/saucebot/ChatTrace";
import { isId } from "../../src/saucebot/Ids";

const ctx: TurnContext = {
  conversationId: "cnv_0000000000000000000000000A",
  chatId: "cht_0000000000000000000000000B",
  installId: "inst_000000000000000000000000C",
  agentId: "sauce-crm/lmstudio:qwen3.5-9b",
  index: 2,
};

describe("buildTurnTrace", () => {
  it("populates every layer id (no nulls) + fingerprints + usage", async () => {
    const t = await buildTurnTrace(
      ctx,
      "who do we know in ranking?",
      "Alice (people/alice.md:3).",
      { provider: "lmstudio", model: "qwen3.5-9b", inputTokens: 120, outputTokens: 18, latencyMs: 4200, reason: "end_turn", distilled: true, toolCalls: 1 },
      1700,
    );
    // Fresh, well-formed turn + response ids.
    expect(isId(t.turnId, "trn")).toBe(true);
    expect(isId(t.responseId, "rsp")).toBe(true);
    // Carried context ids — none null/empty.
    expect(t.conversationId).toBe(ctx.conversationId);
    expect(t.chatId).toBe(ctx.chatId);
    expect(t.installId).toBe(ctx.installId);
    expect(t.agentId).toBe(ctx.agentId);
    expect(t.index).toBe(2);
    expect(t.ts).toBe(1700);
    for (const v of Object.values(t)) expect(v == null).toBe(false);
    // Fingerprints distinguish input vs output.
    expect(t.inputFingerprint).not.toBe(t.outputFingerprint);
    // Usage carried verbatim.
    expect(t.usage.outputTokens).toBe(18);
    expect(t.usage.distilled).toBe(true);
  });

  it("gives distinct turn ids to successive turns", async () => {
    const a = await buildTurnTrace(ctx, "q1", "a1", { provider: "p", model: "m", inputTokens: 1, outputTokens: 1, latencyMs: 1 });
    const b = await buildTurnTrace(ctx, "q2", "a2", { provider: "p", model: "m", inputTokens: 1, outputTokens: 1, latencyMs: 1 });
    expect(a.turnId).not.toBe(b.turnId);
    expect(a.responseId).not.toBe(b.responseId);
  });
});
