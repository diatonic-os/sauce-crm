import { stringifyYaml } from "obsidian";

export type ObsidianFrontmatterValue =
  | string
  | number
  | boolean
  | null
  | ObsidianFrontmatterValue[]
  | { [key: string]: ObsidianFrontmatterValue };

/** Convert arbitrary modal/import output into values Obsidian's frontmatter
 * API can safely stringify and round-trip. Undefined keys are omitted; dates
 * become ISO strings; non-finite numbers become null. */
export function normalizeObsidianFrontmatter(
  input: Record<string, unknown>,
): Record<string, ObsidianFrontmatterValue> {
  const out: Record<string, ObsidianFrontmatterValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "constrains" && Array.isArray(value)) {
      out[key] = value.map(formatInvariant).filter(Boolean);
      continue;
    }
    const normalized = normalizeValue(value);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out;
}

export function serializeObsidianFrontmatter(
  input: Record<string, unknown>,
): string {
  return `---\n${stringifyYaml(normalizeObsidianFrontmatter(input)).trimEnd()}\n---`;
}

export function formatInvariant(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const [name, predicate] =
      Object.entries(item as Record<string, unknown>)[0] ?? [];
    if (!name) return "";
    return `${name}: ${String(predicate ?? "")}`;
  }
  return "";
}

export function parseInvariantString(item: string): {
  name: string;
  predicate: string;
} {
  const ix = item.indexOf(":");
  if (ix < 0) return { name: item, predicate: item };
  const name = item.slice(0, ix).trim();
  const predicate = item.slice(ix + 1).trim();
  return { name: name || item, predicate: predicate || item };
}

function normalizeValue(value: unknown): ObsidianFrontmatterValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const arr = value
      .map(normalizeValue)
      .filter((v): v is ObsidianFrontmatterValue => v !== undefined);
    return arr;
  }
  if (typeof value === "object") {
    const obj: Record<string, ObsidianFrontmatterValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizeValue(v);
      if (normalized !== undefined) obj[k] = normalized;
    }
    return obj;
  }
  return String(value);
}
