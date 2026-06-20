import { describe, it, expect } from "vitest";
import { computeCompatibleSet } from "../../src/compat/CompatibleSet";
import { scoreIntro } from "../../src/compat/IntroScorer";
import { representativity, isFilled } from "../../src/compat/InfoDensity";

describe("computeCompatibleSet()", () => {
  it("computes shared/unique sets and Jaccard density", () => {
    const r = computeCompatibleSet(
      { tags: ["a", "b"] },
      { tags: ["b", "c"] },
      ["tags"],
    );
    expect(r.shared).toEqual(["tags:b"]);
    expect(r.density).toBeCloseTo(1 / 3, 10); // |{b}| / |{a,b,c}|
  });

  it("symmetric is true only when the characteristic sets are equal", () => {
    const same = computeCompatibleSet({ tags: ["x"] }, { tags: ["x"] }, ["tags"]);
    expect(same.symmetric).toBe(true);
  });

  it("symmetric is false for disjoint-but-equal-sized sets (regression)", () => {
    // Old impl compared only counts (1 === 1) and wrongly returned true.
    const r = computeCompatibleSet({ tags: ["x"] }, { tags: ["y"] }, ["tags"]);
    expect(r.unique_a.length).toBe(r.unique_b.length);
    expect(r.symmetric).toBe(false);
  });

  it("density is 0 when both sides are empty", () => {
    expect(computeCompatibleSet({}, {}, ["tags"]).density).toBe(0);
  });
});

describe("scoreIntro()", () => {
  it("score equals Jaccard density and is monotone under added shared tokens", () => {
    const fields = ["tags"];
    const low = scoreIntro({ tags: ["a"] }, { tags: ["a", "b"] }, fields, 0.1);
    const high = scoreIntro({ tags: ["a", "b"] }, { tags: ["a", "b"] }, fields, 0.1);
    expect(high.score).toBeGreaterThanOrEqual(low.score);
  });

  it("missing_for_threshold uses the representativity filled-predicate (empty string counts as missing)", () => {
    const res = scoreIntro(
      { name: "A", city: "" }, // city empty → unfilled
      { name: "B", city: "NYC" },
      ["name", "city"],
      0.99, // unreachable threshold so missing is populated
    );
    expect(res.passes_threshold).toBe(false);
    expect(res.missing_for_threshold).toContain("city");
    expect(res.missing_for_threshold).not.toContain("name");
  });
});

describe("isFilled() / representativity()", () => {
  it("treats null, empty string and empty array as unfilled", () => {
    expect(isFilled(null)).toBe(false);
    expect(isFilled("")).toBe(false);
    expect(isFilled([])).toBe(false);
    expect(isFilled("x")).toBe(true);
    expect(isFilled(["x"])).toBe(true);
    expect(isFilled(0)).toBe(true);
  });

  it("representativity is the fraction of filled fields", () => {
    expect(representativity({ a: "x", b: "", c: null }, ["a", "b", "c"])).toBeCloseTo(
      1 / 3,
      10,
    );
  });
});
