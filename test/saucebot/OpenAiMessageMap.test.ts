import { describe, expect, it } from "vitest";
import { toOpenAiMessages } from "../../src/saucebot/OpenAiMessageMap";
import type { ChatMessage } from "../../src/saucebot/ISauceBotProvider";

describe("toOpenAiMessages", () => {
  it("prepends the system prompt", () => {
    const out = toOpenAiMessages([{ role: "user", content: "hi" }], "sys");
    expect(out[0]).toEqual({ role: "system", content: "sys" });
    expect(out[1]).toEqual({ role: "user", content: "hi" });
  });

  it("passes plain string messages through unchanged", () => {
    const msgs: ChatMessage[] = [{ role: "user", content: "hello" }];
    expect(toOpenAiMessages(msgs)).toEqual([{ role: "user", content: "hello" }]);
  });

  it("converts an assistant tool_use block to OpenAI tool_calls", () => {
    const msgs: ChatMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling" },
          { type: "tool_use", id: "t1", name: "search", input: { q: "x" } },
        ],
      },
    ];
    const out = toOpenAiMessages(msgs);
    expect(out[0]).toEqual({
      role: "assistant",
      content: "calling",
      tool_calls: [
        {
          id: "t1",
          type: "function",
          function: { name: "search", arguments: JSON.stringify({ q: "x" }) },
        },
      ],
    });
  });

  it("emits content:null when an assistant turn is pure tool_use (no text)", () => {
    const msgs: ChatMessage[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "f", input: {} }],
      },
    ];
    const out = toOpenAiMessages(msgs);
    expect((out[0] as { content: unknown }).content).toBeNull();
    expect((out[0] as { tool_calls: unknown[] }).tool_calls).toHaveLength(1);
  });

  it("maps a tool-role message to {role:tool, tool_call_id, content:string}", () => {
    const msgs: ChatMessage[] = [
      { role: "tool", toolCallId: "t1", content: "result text" },
    ];
    expect(toOpenAiMessages(msgs)[0]).toEqual({
      role: "tool",
      tool_call_id: "t1",
      content: "result text",
    });
  });

  it("never attaches tool_call_id to non-tool messages", () => {
    const out = toOpenAiMessages([{ role: "user", content: "hi", toolCallId: "x" }]);
    expect("tool_call_id" in (out[0] as object)).toBe(false);
  });

  it("stringifies object tool content", () => {
    const msgs: ChatMessage[] = [
      {
        role: "tool",
        toolCallId: "t1",
        content: [{ type: "text", text: "a" }] as unknown as string,
      },
    ];
    const c = (toOpenAiMessages(msgs)[0] as { content: string }).content;
    expect(typeof c).toBe("string");
    expect(c).toContain("a");
  });
});
