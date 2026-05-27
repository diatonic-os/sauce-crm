const WIKILINK_RE = /^\[\[([^\]]+)\]\]$/;

export function isWikilink(s: unknown): s is string {
  return typeof s === "string" && WIKILINK_RE.test(s);
}

export function parseWikilink(s: string): string | null {
  const m = s.match(WIKILINK_RE);
  if (!m) return null;
  return m[1]!.split("|")[0]!.trim(); // m[1]: capture group always present; [0]: split always ≥1 element
}

export function wrapWikilink(target: string): string {
  if (!target) return "";
  if (target.startsWith("[[") && target.endsWith("]]")) return target;
  return `[[${target}]]`;
}

export function basenameFromLink(link: string): string {
  const target = parseWikilink(link) ?? link;
  const slash = target.lastIndexOf("/");
  return slash >= 0 ? target.slice(slash + 1) : target;
}
