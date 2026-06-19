// Local-model tool-call parsing hardening.
//
// Cloud models (Anthropic/OpenAI) emit clean OpenAI `tool_calls` with valid
// JSON arguments. Small local models served by LM Studio / Ollama frequently:
//   1. wrap their JSON args in a ```json fence,
//   2. emit the call as prose/text instead of a structured tool_calls block
//      (e.g. `read_note({"path":"x"})` or a JSON object on its own line),
//   3. produce slightly-malformed JSON (trailing commas, single quotes,
//      partial/truncated args).
// Failing the whole turn on any of these is the dominant source of the
// local-vs-cloud tool-use quality gap. The helpers here recover a usable call
// from all three shapes so the multi-turn loop keeps progressing. They are pure
// and unit-testable, and never throw.

/** Strip a ```json / ```toon / ``` fence wrapper a model may add around args. */
function stripFences(s: string): string {
  const m = s.match(/```(?:json|toon|yaml|js|javascript)?\s*([\s\S]*?)```/i);
  return (m?.[1] ?? s).trim();
}

/** Best-effort repair of near-JSON: trailing commas, smart quotes, single
 *  quotes around keys/values. Conservative — only touches well-known LM slop. */
function repairJsonish(s: string): string {
  return s
    .replace(/[‘’]/g, "'") // smart single quotes → straight
    .replace(/[“”]/g, '"') // smart double quotes → straight
    .replace(/,\s*([}\]])/g, "$1") // trailing commas before } or ]
    .trim();
}

/** Extract the first balanced {...} object substring (handles strings/escapes
 *  so braces inside string values don't fool the matcher). null if none. */
export function firstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Tolerant parse of a tool-call `arguments` string into an object.
 * Order: direct JSON → fence-stripped JSON → repaired JSON → first balanced
 * object substring (repaired). Empty/whitespace ⇒ {} (a zero-arg call). On
 * total failure returns `{ _raw: original }` so the call still dispatches and
 * the model can be told its args were unparseable (rather than silently lost).
 */
export function parseToolArgs(raw: string | undefined | null): unknown {
  const original = (raw ?? "").trim();
  if (!original) return {};
  const candidates = [
    original,
    stripFences(original),
    repairJsonish(stripFences(original)),
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object") return v;
    } catch {
      /* try next candidate */
    }
  }
  const obj = firstJsonObject(stripFences(original));
  if (obj) {
    try {
      return JSON.parse(repairJsonish(obj));
    } catch {
      /* fall through */
    }
  }
  return { _raw: original };
}

export interface ExtractedTextCall {
  name: string;
  input: unknown;
}

/**
 * Recover tool calls that a local model emitted as TEXT content rather than as
 * a structured `tool_calls` block. Only matches names from `knownTools` so we
 * never mistake ordinary prose for a call. Recognizes two common shapes:
 *   - `toolName({...json...})` / `toolName {...}` (function-call style)
 *   - a bare/fenced JSON object like {"tool":"toolName","arguments":{...}} or
 *     {"name":"toolName","parameters":{...}}
 * Returns [] when nothing tool-shaped is found (the normal text path wins).
 */
export function extractTextToolCalls(
  text: string,
  knownTools: string[],
): ExtractedTextCall[] {
  if (!text || knownTools.length === 0) return [];
  const out: ExtractedTextCall[] = [];

  // Shape A: name(args) or name {args} anywhere in the text.
  for (const name of knownTools) {
    const re = new RegExp(
      `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`,
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const rest = text.slice(m.index + m[0].length - 1); // include "("→ find {}
      const obj = firstJsonObject(rest);
      if (obj) out.push({ name, input: parseToolArgs(obj) });
      else out.push({ name, input: {} });
    }
  }
  if (out.length > 0) return out;

  // Shape B: a JSON envelope naming the tool.
  const objStr = firstJsonObject(stripFences(text));
  if (objStr) {
    try {
      const env = JSON.parse(repairJsonish(objStr)) as Record<string, unknown>;
      const name =
        (typeof env.tool === "string" && env.tool) ||
        (typeof env.name === "string" && env.name) ||
        (typeof env.tool_name === "string" && env.tool_name) ||
        "";
      if (name && knownTools.includes(name)) {
        const args =
          (env.arguments as unknown) ??
          (env.parameters as unknown) ??
          (env.args as unknown) ??
          (env.input as unknown) ??
          {};
        const input =
          typeof args === "string" ? parseToolArgs(args) : (args ?? {});
        out.push({ name, input });
      }
    } catch {
      /* not an envelope → no text call */
    }
  }
  return out;
}
