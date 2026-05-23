import { describe, expect, it } from "vitest";
import {
  EnrichmentService,
  defaultHeuristicStages,
  type EnrichmentHost,
  type EnrichmentToggles,
  type EnrichmentInput,
} from "../../src/services/EnrichmentService";

/** Fake host: applies the mutation to an in-memory frontmatter object and
 *  counts writes (to assert idempotency). */
function fakeHost(fm: Record<string, unknown>) {
  let writes = 0;
  const host: EnrichmentHost = {
    async applyFrontmatter(_path, mutate) { writes += 1; mutate(fm); },
  };
  return { host, fm, get writes() { return writes; } };
}

const allOn: EnrichmentToggles = { enabled: true, classify: true, tag: true, graph: true };
const input = (over: Partial<EnrichmentInput> = {}): EnrichmentInput => ({
  path: "people/A.md", type: "person", frontmatter: {}, body: "", ...over,
});

describe("EnrichmentService", () => {
  it("is a no-op when disabled", async () => {
    const f = fakeHost({});
    const svc = new EnrichmentService(defaultHeuristicStages(), f.host, () => ({ ...allOn, enabled: false }));
    const r = await svc.enrich(input({ body: "#vip [[Bob]]" }));
    expect(r.applied).toBe(false);
    expect(f.writes).toBe(0);
  });

  it("tags from #hashtags and edges from [[wikilinks]]", async () => {
    const fm: Record<string, unknown> = {};
    const f = fakeHost(fm);
    const svc = new EnrichmentService(defaultHeuristicStages(), f.host, () => allOn);
    const r = await svc.enrich(input({ frontmatter: fm, body: "Met #vip #founder — see [[Bob]] and [[Acme]]" }));

    expect(r.applied).toBe(true);
    expect(r.tagsAdded.sort()).toEqual(["founder", "vip"]);
    expect(fm["tags"]).toEqual(["vip", "founder"]);
    expect(fm["mentions"]).toEqual(["[[Bob]]", "[[Acme]]"]);
  });

  it("is idempotent — a second run adds nothing and does not write", async () => {
    const fm: Record<string, unknown> = {};
    const f = fakeHost(fm);
    const svc = new EnrichmentService(defaultHeuristicStages(), f.host, () => allOn);
    const body = "#vip [[Bob]]";
    await svc.enrich(input({ frontmatter: fm, body }));
    const r2 = await svc.enrich(input({ frontmatter: fm, body }));
    expect(r2.applied).toBe(false);
    expect(f.writes).toBe(1); // only the first run wrote
  });

  it("respects per-stage toggles (graph off ⇒ no edges)", async () => {
    const fm: Record<string, unknown> = {};
    const f = fakeHost(fm);
    const svc = new EnrichmentService(defaultHeuristicStages(), f.host, () => ({ ...allOn, graph: false }));
    await svc.enrich(input({ frontmatter: fm, body: "#vip [[Bob]]" }));
    expect(fm["tags"]).toEqual(["vip"]);
    expect(fm["mentions"]).toBeUndefined();
  });

  it("classify stage sets primary_type only when absent", async () => {
    const stages = { ...defaultHeuristicStages(), classify: async () => ({ primary_type: "advisor", roles: ["mentor"] }) };
    const fm: Record<string, unknown> = { primary_type: "founder" }; // already set
    const f = fakeHost(fm);
    const svc = new EnrichmentService(stages, f.host, () => allOn);
    await svc.enrich(input({ frontmatter: fm, body: "" }));
    expect(fm["primary_type"]).toBe("founder"); // not overwritten
    expect(fm["roles"]).toEqual(["mentor"]); // roles still merged
  });

  it("merges additively without clobbering existing frontmatter arrays", async () => {
    const fm: Record<string, unknown> = { tags: ["existing"] };
    const f = fakeHost(fm);
    const svc = new EnrichmentService(defaultHeuristicStages(), f.host, () => allOn);
    await svc.enrich(input({ frontmatter: fm, body: "#new" }));
    expect(fm["tags"]).toEqual(["existing", "new"]);
  });
});
