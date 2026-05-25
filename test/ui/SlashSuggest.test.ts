// SlashSuggest — the chat "/" skill/command picker. The pure filtering +
// keyboard-navigation logic is exported so it's testable without a live
// textarea/popover; the DOM glue is a thin layer over it.

import { describe, expect, it } from "vitest";
import {
  filterSlashItems,
  nextIndex,
  parseSlashQuery,
  type SlashItem,
} from "../../src/ui/widgets/SlashSuggest";

const ITEMS: SlashItem[] = [
  { id: "research-person", label: "Research Person", kind: "skill" },
  { id: "summarize-week", label: "Summarize Week", kind: "skill" },
  { id: "draft-touch", label: "Draft Touch", kind: "skill" },
  { id: "rewrite", label: "Rewrite", kind: "command" },
];

describe("parseSlashQuery", () => {
  it("returns the query when the text is a leading-slash token", () => {
    expect(parseSlashQuery("/sum")).toBe("sum");
    expect(parseSlashQuery("/")).toBe("");
  });
  it("returns null when not a slash trigger", () => {
    expect(parseSlashQuery("hello")).toBeNull();
    expect(parseSlashQuery("a /sum")).toBeNull(); // only leading slash triggers
    expect(parseSlashQuery("/sum more words")).toBeNull(); // space ends the trigger
  });
});

describe("filterSlashItems", () => {
  it("returns all items for an empty query", () => {
    expect(filterSlashItems("", ITEMS)).toHaveLength(4);
  });
  it("matches against id and label, case-insensitively", () => {
    const r = filterSlashItems("sum", ITEMS);
    expect(r.map((i) => i.id)).toEqual(["summarize-week"]);
    expect(filterSlashItems("RESEARCH", ITEMS).map((i) => i.id)).toEqual([
      "research-person",
    ]);
  });
  it("matches a substring in the middle of the id", () => {
    expect(filterSlashItems("touch", ITEMS).map((i) => i.id)).toEqual([
      "draft-touch",
    ]);
  });
  it("returns empty when nothing matches", () => {
    expect(filterSlashItems("zzz", ITEMS)).toEqual([]);
  });
});

describe("nextIndex (keyboard navigation, wrapping)", () => {
  it("moves down and wraps to the top", () => {
    expect(nextIndex(0, 3, "down")).toBe(1);
    expect(nextIndex(2, 3, "down")).toBe(0);
  });
  it("moves up and wraps to the bottom", () => {
    expect(nextIndex(0, 3, "up")).toBe(2);
    expect(nextIndex(1, 3, "up")).toBe(0);
  });
  it("clamps to 0 when the list is empty", () => {
    expect(nextIndex(0, 0, "down")).toBe(0);
  });
});
