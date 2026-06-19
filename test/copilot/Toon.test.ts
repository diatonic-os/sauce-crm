// TOON encoder — the compact transport for distilled chunks. Pins the three
// token-saving shapes (scalar, scalar-array inline, uniform-object table) plus
// quoting and the cheaper-than-JSON guarantee.

import { describe, expect, it } from "vitest";
import { encodeToon, estimateTokens } from "../../src/saucebot/Toon";

describe("encodeToon", () => {
  it("encodes a flat object as key: value lines", () => {
    expect(encodeToon({ name: "Alice", closeness: 4, opt_in: true })).toBe(
      "name: Alice\ncloseness: 4\nopt_in: true",
    );
  });

  it("inlines scalar arrays with a count prefix", () => {
    expect(encodeToon({ roles: ["lead", "advisor"] })).toBe(
      "roles[2]: lead,advisor",
    );
  });

  it("collapses uniform object arrays into a tabular header + rows", () => {
    const toon = encodeToon({
      people: [
        { name: "Alice", company: "Acme", opt_in: true },
        { name: "Bob", company: "Globex", opt_in: false },
      ],
    });
    expect(toon).toBe(
      "people[2]{name,company,opt_in}:\n  Alice,Acme,true\n  Bob,Globex,false",
    );
  });

  it("quotes scalars that carry delimiters, whitespace, or keyword/number shapes", () => {
    const toon = encodeToon({
      a: "has, comma",
      b: "true",
      c: "123",
      d: "plain",
    });
    expect(toon).toContain('a: "has, comma"');
    expect(toon).toContain('b: "true"');
    expect(toon).toContain('c: "123"');
    expect(toon).toContain("d: plain");
  });

  it("nests objects with indentation", () => {
    expect(encodeToon({ outer: { inner: "x" } })).toBe("outer:\n  inner: x");
  });

  it("handles empty arrays and nested/non-uniform arrays via list fallback", () => {
    expect(encodeToon({ empty: [] })).toBe("empty[0]:");
    const mixed = encodeToon({ xs: [1, { a: 1 }] });
    expect(mixed.startsWith("xs[2]:")).toBe(true);
  });

  it("is materially cheaper than JSON for tabular data", () => {
    const data = {
      people: Array.from({ length: 20 }, (_, i) => ({
        name: `Person${i}`,
        company: "Acme",
        opt_in: i % 2 === 0,
      })),
    };
    const toon = encodeToon(data);
    const json = JSON.stringify(data);
    expect(estimateTokens(toon)).toBeLessThan(estimateTokens(json));
  });
});
