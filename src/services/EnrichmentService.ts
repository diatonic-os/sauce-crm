// Auto-enrichment pipeline (PLAN T5): three independently-toggleable stages —
// classify (primary_type/roles), tag (topics), graph (edges) — that run on
// content change and write results to BOTH the vault frontmatter and (via the
// vault "changed" event re-mirroring + provenance) LanceDB.
//
// Stages are injected so the heavy/LLM-backed implementations can be swapped in
// without touching the pipeline. The default heuristic stages need no model:
// tags from inline #hashtags, edges from [[wikilinks]]. Classification is left
// to an injected LLM stage (default no-op).
//
// Idempotency: merges are additive and de-duplicated, and the frontmatter write
// is skipped entirely when a run adds nothing new — so enrich() triggered by
// its own write does not loop.

export interface EnrichmentInput {
  path: string;
  type: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface ClassifyResult {
  primary_type?: string;
  roles?: string[];
}

export interface GraphEdge {
  field: string; // frontmatter edge field, e.g. "mentions" / "knows"
  to: string; // target basename or path (stored as [[to]])
}

export interface EnrichmentStages {
  classify?(input: EnrichmentInput): Promise<ClassifyResult | null>;
  tag?(input: EnrichmentInput): Promise<string[]>;
  graph?(input: EnrichmentInput): Promise<GraphEdge[]>;
}

/** Vault frontmatter writer. `mutate` receives the live frontmatter object. */
export interface EnrichmentHost {
  applyFrontmatter(
    path: string,
    mutate: (fm: Record<string, unknown>) => void,
  ): Promise<void>;
}

export interface EnrichmentToggles {
  enabled: boolean;
  classify: boolean;
  tag: boolean;
  graph: boolean;
}

export interface EnrichmentTraceSink {
  record(
    op: string,
    subject: string,
    kind: string,
    content: string,
    opts?: { meta?: Record<string, unknown> | null },
  ): Promise<unknown>;
}

export interface EnrichmentResult {
  applied: boolean;
  primaryTypeSet?: string;
  rolesAdded: string[];
  tagsAdded: string[];
  edgesAdded: GraphEdge[];
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v == null || v === "") return [];
  return [String(v)];
}

/** Returns [merged, addedItems] — additive union preserving order. */
function mergeUnique(
  existing: unknown,
  incoming: string[],
): [string[], string[]] {
  const cur = asArray(existing);
  const seen = new Set(cur);
  const added: string[] = [];
  for (const item of incoming) {
    if (!seen.has(item)) {
      seen.add(item);
      added.push(item);
    }
  }
  return [[...cur, ...added], added];
}

// ---- default heuristic stages (no LLM) ----

const HASHTAG_RE = /(?:^|\s)#([a-z0-9][\w/-]*)/gi;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export function defaultHeuristicStages(): EnrichmentStages {
  return {
    async tag(input) {
      const out = new Set<string>();
      for (const m of input.body.matchAll(HASHTAG_RE)) {
        const cap = m[1];
        if (cap !== undefined) out.add(cap.toLowerCase());
      }
      return [...out];
    },
    async graph(input) {
      const out: GraphEdge[] = [];
      const seen = new Set<string>();
      for (const m of input.body.matchAll(WIKILINK_RE)) {
        const to = (m[1] ?? "").trim();
        if (to && !seen.has(to)) {
          seen.add(to);
          out.push({ field: "mentions", to });
        }
      }
      return out;
    },
    // classify intentionally omitted — needs an LLM; inject separately.
  };
}

export class EnrichmentService {
  constructor(
    private readonly stages: EnrichmentStages,
    private readonly host: EnrichmentHost,
    private readonly toggles: () => EnrichmentToggles,
    private readonly trace: EnrichmentTraceSink | null = null,
  ) {}

  async enrich(input: EnrichmentInput): Promise<EnrichmentResult> {
    const empty: EnrichmentResult = {
      applied: false,
      rolesAdded: [],
      tagsAdded: [],
      edgesAdded: [],
    };
    const t = this.toggles();
    if (!t.enabled) return empty;

    const classify =
      t.classify && this.stages.classify
        ? await this.stages.classify(input)
        : null;
    const tags = t.tag && this.stages.tag ? await this.stages.tag(input) : [];
    const edges =
      t.graph && this.stages.graph ? await this.stages.graph(input) : [];

    // Compute additive diffs without mutating yet, so we can skip the write
    // (and avoid an event loop) when nothing is new.
    const fm = input.frontmatter;
    const result: EnrichmentResult = {
      applied: false,
      rolesAdded: [],
      tagsAdded: [],
      edgesAdded: [],
    };

    const setPrimary =
      classify?.primary_type && !fm["primary_type"]
        ? classify.primary_type
        : undefined;
    const [, rolesAdded] = classify?.roles
      ? mergeUnique(fm["roles"], classify.roles)
      : [[], []];
    const [, tagsAdded] = mergeUnique(fm["tags"], tags);
    const edgesAdded: GraphEdge[] = [];
    for (const e of edges) {
      const link = `[[${e.to}]]`;
      const [, added] = mergeUnique(fm[e.field], [link]);
      if (added.length) edgesAdded.push(e);
    }

    const nothingNew =
      !setPrimary &&
      rolesAdded.length === 0 &&
      tagsAdded.length === 0 &&
      edgesAdded.length === 0;
    if (nothingNew) return empty; // idempotent: no write, no event loop

    await this.host.applyFrontmatter(input.path, (live) => {
      if (setPrimary) live["primary_type"] = setPrimary;
      if (rolesAdded.length)
        live["roles"] = mergeUnique(live["roles"], rolesAdded)[0];
      if (tagsAdded.length)
        live["tags"] = mergeUnique(live["tags"], tagsAdded)[0];
      for (const e of edgesAdded)
        live[e.field] = mergeUnique(live[e.field], [`[[${e.to}]]`])[0];
    });

    result.applied = true;
    if (setPrimary !== undefined) result.primaryTypeSet = setPrimary;
    result.rolesAdded = rolesAdded;
    result.tagsAdded = tagsAdded;
    result.edgesAdded = edgesAdded;

    await this.trace
      ?.record(
        "enrich",
        input.path,
        "entity",
        JSON.stringify({ setPrimary, rolesAdded, tagsAdded, edgesAdded }),
        {
          meta: {
            stages: { classify: t.classify, tag: t.tag, graph: t.graph },
          },
        },
      )
      .catch?.(() => {});

    return result;
  }
}
