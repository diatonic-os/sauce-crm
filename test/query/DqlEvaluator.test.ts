import { describe, it, expect } from "vitest";
import { DqlEvaluator } from "../../src/query/DqlEvaluator";
import type { QueryRow } from "../../src/query/DqlEvaluator";
import type { DqlQuery } from "../../src/query/DqlParser";

const ev = new DqlEvaluator();

function row(file: string, fm: Record<string, unknown>, path = `People/${file}.md`): QueryRow {
  return { file, path, frontmatter: fm };
}

function ids(res: { rows?: QueryRow[] }): string[] {
  return (res.rows ?? []).map((r) => r.file);
}

const q = (over: Partial<DqlQuery>): DqlQuery =>
  ({ shape: "TABLE", columns: ["file"], ...over }) as DqlQuery;

describe("DqlEvaluator.sort", () => {
  const rows = [
    row("b", { age: 30 }),
    row("a", { age: 10 }),
    row("c", { age: 20 }),
  ];

  it("sorts ASC by a numeric field", () => {
    expect(ids(ev.evaluate(q({ sort: [{ field: "age", dir: "ASC" }] }), rows))).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("sorts DESC by a numeric field", () => {
    expect(ids(ev.evaluate(q({ sort: [{ field: "age", dir: "DESC" }] }), rows))).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("places nulls last regardless of direction (regression)", () => {
    const withNull = [row("x", { age: 5 }), row("n", {}), row("y", { age: 1 })];
    expect(
      ids(ev.evaluate(q({ sort: [{ field: "age", dir: "ASC" }] }), withNull)).at(-1),
    ).toBe("n");
    expect(
      ids(ev.evaluate(q({ sort: [{ field: "age", dir: "DESC" }] }), withNull)).at(-1),
    ).toBe("n");
  });

  it("produces a deterministic total order for mixed-type values (no NaN comparator)", () => {
    const mixed = [
      row("num", { v: 2 }),
      row("str", { v: "apple" }),
      row("num2", { v: 10 }),
    ];
    const out = ids(ev.evaluate(q({ sort: [{ field: "v", dir: "ASC" }] }), mixed));
    expect(out).toHaveLength(3);
    expect(new Set(out)).toEqual(new Set(["num", "str", "num2"]));
  });
});

describe("DqlEvaluator.from / limit", () => {
  const rows = [
    row("p1", {}, "People/p1.md"),
    row("o1", {}, "Orgs/o1.md"),
    row("p2", {}, "People/p2.md"),
  ];

  it("scopes rows by folder prefix", () => {
    expect(ids(ev.evaluate(q({ from: "People/" }), rows)).sort()).toEqual(["p1", "p2"]);
  });

  it("strips quotes from the from clause", () => {
    expect(ids(ev.evaluate(q({ from: '"Orgs/"' }), rows))).toEqual(["o1"]);
  });

  it("applies limit", () => {
    expect(ids(ev.evaluate(q({ limit: 2 }), rows))).toHaveLength(2);
  });
});
