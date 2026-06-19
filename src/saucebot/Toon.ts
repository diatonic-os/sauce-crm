// TOON — Token-Oriented Object Notation.
//
// A compact, indentation-based serialization for LLM I/O that costs far fewer
// tokens than JSON: object keys are written once, arrays of uniform objects
// collapse to a tabular header + comma rows, and scalars carry no quotes unless
// ambiguous. It is the transport format every distilled chunk ends in, so the
// model receives maximal signal per token.
//
// Shape (by example):
//   name: Alice
//   roles[2]: lead,advisor
//   people[2]{name,company,opt_in}:
//     Alice,Acme,true
//     Bob,Globex,false
//
// This is a faithful, dependency-free encoder for the subset we emit (objects,
// scalar arrays, uniform-object arrays, and a list fallback for the rest).

type Json = null | string | number | boolean | Json[] | { [k: string]: Json };

const pad = (n: number): string => "  ".repeat(n);

function isPlainObject(v: unknown): v is Record<string, Json> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isScalar(v: unknown): boolean {
  return (
    v === null ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    typeof v === "string"
  );
}

/** A scalar needs quoting when it could be misread as structure, a keyword, or
 *  a number, or carries delimiter/whitespace that would break a row. */
function formatScalar(v: Json): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  if (
    s === "" ||
    /[,:{}[\]"\n]/.test(s) ||
    /^\s|\s$/.test(s) ||
    /^(true|false|null)$/i.test(s) ||
    /^-?\d/.test(s)
  ) {
    return JSON.stringify(s);
  }
  return s;
}

/** The shared key set if `arr` is a non-empty array of objects that all carry
 *  exactly the same keys with scalar values — otherwise null (not tabular). */
function uniformKeys(arr: Json[]): string[] | null {
  if (arr.length === 0 || !arr.every(isPlainObject)) return null;
  const keys = Object.keys(arr[0] as Record<string, Json>);
  if (keys.length === 0) return null;
  for (const item of arr) {
    const obj = item as Record<string, Json>;
    const k = Object.keys(obj);
    if (k.length !== keys.length) return null;
    for (const key of keys) {
      if (!(key in obj) || !isScalar(obj[key])) return null;
    }
  }
  return keys;
}

function encodeArray(key: string, arr: Json[], level: number): string[] {
  const p = pad(level);
  if (arr.length === 0) return [`${p}${key}[0]:`];

  if (arr.every(isScalar)) {
    return [`${p}${key}[${arr.length}]: ${arr.map(formatScalar).join(",")}`];
  }

  const keys = uniformKeys(arr);
  if (keys) {
    const lines = [`${p}${key}[${arr.length}]{${keys.join(",")}}:`];
    for (const item of arr) {
      const obj = item as Record<string, Json>;
      lines.push(
        `${pad(level + 1)}${keys.map((k) => formatScalar(obj[k] ?? null)).join(",")}`,
      );
    }
    return lines;
  }

  // Non-uniform / nested → list fallback.
  const lines = [`${p}${key}[${arr.length}]:`];
  for (const item of arr) {
    if (isScalar(item)) {
      lines.push(`${pad(level + 1)}- ${formatScalar(item)}`);
    } else if (isPlainObject(item)) {
      lines.push(`${pad(level + 1)}-`);
      lines.push(...encodeObject(item, level + 2));
    } else if (Array.isArray(item)) {
      lines.push(...encodeArray("-", item, level + 1));
    }
  }
  return lines;
}

function encodeObject(obj: Record<string, Json>, level: number): string[] {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      lines.push(...encodeArray(k, v, level));
    } else if (isPlainObject(v)) {
      lines.push(`${pad(level)}${k}:`);
      lines.push(...encodeObject(v, level + 1));
    } else {
      lines.push(`${pad(level)}${k}: ${formatScalar(v)}`);
    }
  }
  return lines;
}

/** Encode any JSON-ish value to TOON. */
export function encodeToon(value: Json): string {
  if (Array.isArray(value)) return encodeArray("items", value, 0).join("\n");
  if (isPlainObject(value)) return encodeObject(value, 0).join("\n");
  return formatScalar(value);
}

/** Cheap 4-char/token estimate, matching the rest of the runtime's budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
