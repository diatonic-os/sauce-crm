// Translate the runtime's canonical (Anthropic-ish content-block) ChatMessages
// into the OpenAI/LM Studio wire shape. This is the fix for multi-turn tool
// calling on LM Studio: the runtime emits assistant `tool_use` blocks and
// `tool`-role results, but OpenAI-compat endpoints require
//   assistant: { content, tool_calls:[{id,type:"function",function:{name,arguments}}] }
//   tool:      { role:"tool", tool_call_id, content:<string> }
// Passing the block array through verbatim made LM Studio drop the tool turn.

import type { ChatMessage } from "./ISauceBotProvider";

type Block = { type: string; [k: string]: unknown };

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
interface OpenAiMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

/** Coerce any message content into a plain string (for tool results / fallbacks). */
function contentToString(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const block = b as Block;
        if (block.type === "text") return String(block.text ?? "");
        if (block.type === "tool_result")
          return contentToString(block.content as ChatMessage["content"]);
        return JSON.stringify(block);
      })
      .join("");
  }
  return content == null ? "" : JSON.stringify(content);
}

/**
 * Build the OpenAI-shaped `messages` array. `systemPrompt`, when given, is
 * prepended as a system message.
 */
export function toOpenAiMessages(
  messages: ChatMessage[],
  systemPrompt?: string,
): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });

  for (const m of messages) {
    // Tool result → OpenAI tool message. tool_call_id ONLY here (never on
    // user/assistant/system, which OpenAI rejects).
    if (m.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId ?? "",
        content: contentToString(m.content),
      });
      continue;
    }

    if (Array.isArray(m.content)) {
      const textParts: string[] = [];
      const toolCalls: OpenAiToolCall[] = [];
      for (const raw of m.content) {
        const block = raw as Block;
        if (block.type === "text") {
          textParts.push(String(block.text ?? ""));
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: String(block.id ?? ""),
            type: "function",
            function: {
              name: String(block.name ?? ""),
              arguments: JSON.stringify(block.input ?? {}),
            },
          });
        } else if (block.type === "tool_result") {
          // A tool_result inside a non-tool message — fold into text.
          textParts.push(contentToString(block.content as ChatMessage["content"]));
        }
      }
      const text = textParts.join("");
      const msg: OpenAiMessage = {
        role: m.role,
        // OpenAI requires content:null (not "") when only tool_calls are present.
        content: text.length > 0 ? text : toolCalls.length > 0 ? null : "",
      };
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      out.push(msg);
      continue;
    }

    // Plain string content — pass through (no stray tool_call_id).
    out.push({ role: m.role, content: m.content });
  }

  return out;
}
