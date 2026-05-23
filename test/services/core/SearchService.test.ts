import { describe, expect, it } from "vitest";
import {
  SearchService,
  type SearchHost,
} from "../../../src/services/core/SearchService";

const host: SearchHost = {
  search: (q, limit = 25) =>
    q ? [{ path: "A.md", score: 1 }].slice(0, limit) : [],
  searchContext: () => ["…match…"],
  backlinks: () => ["B.md"],
  outlinks: () => ["C.md"],
  unresolved: () => ["Ghost"],
  orphans: () => ["Lonely.md"],
  deadends: () => ["End.md"],
  tagCounts: () => ({ "#task": 3 }),
  random: () => "R.md",
};

describe("SearchService", () => {
  it("returns typed results across the CW-search capability surface", () => {
    const s = new SearchService(host);
    expect(s.search("alice")).toEqual([{ path: "A.md", score: 1 }]);
    expect(s.search("")).toEqual([]);
    expect(s.backlinks("A.md")).toEqual(["B.md"]);
    expect(s.outlinks("A.md")).toEqual(["C.md"]);
    expect(s.unresolved()).toEqual(["Ghost"]);
    expect(s.orphans()).toEqual(["Lonely.md"]);
    expect(s.deadends()).toEqual(["End.md"]);
    expect(s.tagCounts()).toEqual({ "#task": 3 });
    expect(s.random()).toBe("R.md");
    expect(s.searchContext("A.md", "x")).toEqual(["…match…"]);
  });

  it("honors the search limit", () => {
    const s = new SearchService(host);
    expect(s.search("alice", 0)).toEqual([]);
  });
});
