// Crystallized brain cache — deterministic digest builder + hash-validated
// matrix. Pins: (1) digests carry CRM signal and stay under the char cap,
// (2) the cache self-invalidates on a body-hash change, (3) JSON round-trips.

import { describe, expect, it } from "vitest";
import {
  buildEntityDigest,
  BrainCrystalCache,
  hashBody,
} from "../../src/saucebot/BrainCrystal";

describe("buildEntityDigest", () => {
  const body = `# Alice Chen

Alice is a staff ML engineer at Acme who leads the ranking team. Met at the 2026 offsite.

## Context
Warm intro via [[Bob Lee]]. See also [[Acme]] and [[Ranking Project]].
`;
  const fm = {
    type: "person",
    title: "Staff ML Engineer",
    company: "Acme",
    expertise: ["ranking", "embeddings"],
    intro_opt_in: true,
    closeness: 4,
    last_touch: "2026-05-01",
    irrelevant: "should be dropped",
  };

  it("carries key frontmatter, headings, lead, and outgoing links", () => {
    const d = buildEntityDigest("people/Alice.md", fm, body);
    expect(d).toContain("people/Alice.md");
    expect(d).toContain("title: Staff ML Engineer");
    expect(d).toContain("intro_opt_in: true");
    expect(d).toContain("expertise: ranking, embeddings");
    expect(d).toContain("staff ML engineer"); // lead paragraph
    expect(d).toContain("Bob Lee"); // outgoing link
    expect(d).not.toContain("should be dropped"); // non-key frontmatter excluded
  });

  it("respects the char cap (compaction)", () => {
    const huge = "x ".repeat(5000);
    const d = buildEntityDigest("notes/big.md", { type: "note" }, huge, {
      maxChars: 600,
    });
    expect(d.length).toBeLessThanOrEqual(601); // 600 + ellipsis trim
  });

  it("is deterministic", () => {
    expect(buildEntityDigest("p.md", fm, body)).toBe(
      buildEntityDigest("p.md", fm, body),
    );
  });
});

describe("BrainCrystalCache", () => {
  it("returns a digest only when the body hash still matches", () => {
    const c = new BrainCrystalCache();
    const h1 = hashBody("body one");
    c.set("p.md", h1, "digest one");
    expect(c.get("p.md", h1)).toBe("digest one");
    // Body changed → different hash → stale, cache miss (self-invalidation).
    expect(c.get("p.md", hashBody("body two"))).toBeNull();
  });

  it("tracks dirty state and round-trips through JSON", () => {
    const c = new BrainCrystalCache();
    c.set("a.md", "h1", "da");
    c.set("b.md", "h2", "db", true);
    expect(c.dirty).toBe(true);
    const json = c.toJSON();
    const restored = BrainCrystalCache.fromJSON(json);
    expect(restored.size).toBe(2);
    expect(restored.get("a.md", "h1")).toBe("da");
    expect(restored.dirty).toBe(false); // freshly loaded ⇒ clean
  });

  it("retain() drops entries for paths no longer present", () => {
    const c = new BrainCrystalCache();
    c.set("keep.md", "h", "d");
    c.set("gone.md", "h", "d");
    c.retain(new Set(["keep.md"]));
    expect(c.size).toBe(1);
    expect(c.get("keep.md", "h")).toBe("d");
  });

  it("recovers from a corrupt cache file by starting empty", () => {
    const c = BrainCrystalCache.fromJSON("{not valid json");
    expect(c.size).toBe(0);
  });
});
