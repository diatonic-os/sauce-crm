// CON-OBS-INTEG-001 · T-E-04 — resolve frontmatter linkedIds to entity refs.
//
// Reads the `linkedIds` (and other link-bearing) frontmatter fields, resolves
// each to a concrete entity ref via an injected resolver, and reports broken
// edges through a logger. It NEVER throws — a malformed link is logged and
// skipped so a single bad reference can't break graph hydration (G-graph
// "warns + logs broken edges; never throws").

export interface EntityRef {
  id: string;
  path: string;
  type?: string;
}

export interface LinkResolverHost {
  /** Resolve a wikilink/id to a concrete entity ref, or null when unresolved. */
  resolve(idOrLink: string): EntityRef | null;
}

export interface ResolveLog {
  warn(message: string, context?: Record<string, unknown>): void;
}

export interface ResolveResult {
  resolved: EntityRef[];
  broken: string[];
}

const LINK_FIELDS = [
  "linkedIds",
  "knows",
  "worked_with",
  "intro_via",
  "family_of",
  "related_contacts",
];

/** Strip `[[…]]` wikilink wrapper + alias, returning the bare target. */
function normalizeLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  const target = (m ? (m[1] ?? raw) : raw).trim();
  return target.length ? target : null;
}

export class LinkResolver {
  constructor(
    private readonly host: LinkResolverHost,
    private readonly log: ResolveLog = { warn: () => {} },
  ) {}

  /** Resolve every link-bearing field in a frontmatter block. Never throws. */
  resolveFrontmatter(
    frontmatter: Record<string, unknown>,
    sourcePath = "<unknown>",
  ): ResolveResult {
    const resolved: EntityRef[] = [];
    const broken: string[] = [];
    const seen = new Set<string>();

    const collect = (value: unknown): void => {
      const links = Array.isArray(value) ? value : [value];
      for (const raw of links) {
        const target = normalizeLink(raw);
        if (!target || seen.has(target)) continue;
        seen.add(target);
        let ref: EntityRef | null = null;
        try {
          ref = this.host.resolve(target);
        } catch (e) {
          // A throwing resolver must not break hydration.
          this.log.warn("LinkResolver: resolver threw", {
            sourcePath,
            target,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        if (ref) {
          resolved.push(ref);
        } else {
          broken.push(target);
          this.log.warn("LinkResolver: broken edge", { sourcePath, target });
        }
      }
    };

    for (const field of LINK_FIELDS) {
      if (field in frontmatter) collect(frontmatter[field]);
    }
    return { resolved, broken };
  }
}
