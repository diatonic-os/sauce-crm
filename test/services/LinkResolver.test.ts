import { describe, expect, it, vi } from "vitest";
import {
  LinkResolver,
  type LinkResolverHost,
  type EntityRef,
} from "../../src/services/LinkResolver";

function host(known: Record<string, EntityRef>): LinkResolverHost {
  return { resolve: (id) => known[id] ?? null };
}

describe("LinkResolver", () => {
  it("resolves linkedIds + relationship fields, stripping [[wikilink|alias]]", () => {
    const r = new LinkResolver(
      host({
        "people/Alice": {
          id: "person-1",
          path: "people/Alice.md",
          type: "warm-contact",
        },
        Acme: { id: "org-1", path: "orgs/Acme.md", type: "org" },
      }),
    );
    const res = r.resolveFrontmatter({
      linkedIds: ["[[people/Alice|Alice]]"],
      knows: ["[[Acme]]"],
      tags: ["ignored"], // not a link field
    });
    expect(res.resolved.map((x) => x.id).sort()).toEqual(["org-1", "person-1"]);
    expect(res.broken).toEqual([]);
  });

  it("logs broken edges and never throws — including when the resolver throws", () => {
    const warn = vi.fn();
    const throwingHost: LinkResolverHost = {
      resolve: (id) => {
        if (id === "boom") throw new Error("resolver exploded");
        return null; // everything else unresolved
      },
    };
    const r = new LinkResolver(throwingHost, { warn });
    let res!: ReturnType<LinkResolver["resolveFrontmatter"]>;
    expect(() => {
      res = r.resolveFrontmatter(
        { linkedIds: ["Ghost", "boom"] },
        "notes/N.md",
      );
    }).not.toThrow();
    expect(res.broken).toContain("Ghost");
    expect(warn).toHaveBeenCalled();
  });

  it("dedupes repeated links and ignores non-string values", () => {
    const r = new LinkResolver(host({}));
    const res = r.resolveFrontmatter({ linkedIds: ["X", "X", 42, null] });
    expect(res.broken).toEqual(["X"]); // once, and the 42/null are skipped
  });
});
