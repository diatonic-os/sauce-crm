// VaultContextProvider — link/backlink index tests (F2 / CON-SAUCEBOT S2).

import { describe, expect, it } from "vitest";
import { VaultContextProvider } from "../../src/saucebot/VaultContextProvider";
import type { MetadataCacheHost } from "../../src/saucebot/VaultContextProvider";

function makeCache(
  links: Record<string, Record<string, number>>,
): MetadataCacheHost {
  return { resolvedLinks: links };
}

describe("VaultContextProvider.rebuild + getLinks/getBacklinks", () => {
  it("getLinks returns outgoing links for a note", () => {
    const cache = makeCache({
      "contacts/Alice.md": { "contacts/Bob.md": 1, "contacts/Carol.md": 2 },
    });
    const vcp = new VaultContextProvider(cache);
    vcp.rebuild();
    expect(vcp.getLinks("contacts/Alice.md")).toEqual(
      expect.arrayContaining(["contacts/Bob.md", "contacts/Carol.md"]),
    );
  });

  it("getBacklinks returns inverted links", () => {
    const cache = makeCache({
      "contacts/Alice.md": { "contacts/Bob.md": 1 },
      "contacts/Carol.md": { "contacts/Bob.md": 1 },
    });
    const vcp = new VaultContextProvider(cache);
    vcp.rebuild();
    const bl = vcp.getBacklinks("contacts/Bob.md");
    expect(bl).toEqual(
      expect.arrayContaining(["contacts/Alice.md", "contacts/Carol.md"]),
    );
  });

  it("getLinks returns [] for an unknown path", () => {
    const vcp = new VaultContextProvider(makeCache({}));
    vcp.rebuild();
    expect(vcp.getLinks("nonexistent.md")).toEqual([]);
  });

  it("getBacklinks returns [] for a note with no inbound links", () => {
    const cache = makeCache({ "a.md": { "b.md": 1 } });
    const vcp = new VaultContextProvider(cache);
    vcp.rebuild();
    expect(vcp.getBacklinks("a.md")).toEqual([]);
  });

  it("oneHop returns union of links + backlinks excluding self", () => {
    const cache = makeCache({
      "a.md": { "b.md": 1 },
      "c.md": { "a.md": 1 },
    });
    const vcp = new VaultContextProvider(cache);
    vcp.rebuild();
    const hop = vcp.oneHop("a.md");
    expect(hop).toEqual(expect.arrayContaining(["b.md", "c.md"]));
    expect(hop).not.toContain("a.md");
  });

  it("rebuild resets stale data", () => {
    const links: Record<string, Record<string, number>> = {
      "a.md": { "b.md": 1 },
    };
    const cache = makeCache(links);
    const vcp = new VaultContextProvider(cache);
    vcp.rebuild();
    expect(vcp.getLinks("a.md")).toContain("b.md");

    // Simulate vault mutation: remove the link.
    delete links["a.md"];
    vcp.rebuild();
    expect(vcp.getLinks("a.md")).toEqual([]);
  });
});

describe("VaultContextProvider.asSkill", () => {
  it("returns a SkillLike with id 'get_links' and risk 'low'", () => {
    const vcp = new VaultContextProvider(makeCache({}));
    const skill = vcp.asSkill();
    expect(skill.id).toBe("get_links");
    expect(skill.risk).toBe("low");
    expect(skill.contract.inputs).toHaveLength(1);
    expect(skill.contract.inputs[0].name).toBe("path");
  });

  it("execute returns links and backlinks", async () => {
    const cache = makeCache({
      "a.md": { "b.md": 1 },
      "c.md": { "a.md": 1 },
    });
    const vcp = new VaultContextProvider(cache);
    vcp.rebuild();
    const skill = vcp.asSkill();
    const result = await skill.execute({ path: "a.md" }, null);
    expect(result).toEqual({
      links: expect.arrayContaining(["b.md"]),
      backlinks: expect.arrayContaining(["c.md"]),
    });
  });
});
