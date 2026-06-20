import { describe, it, expect, vi } from "vitest";
import { AtlasController } from "../../../src/ui/atlas/AtlasController";

describe("AtlasController", () => {
  it("defaults to geo mode with an empty filter and no focus", () => {
    const c = new AtlasController();
    expect(c.mode).toBe("geo");
    expect(c.focusId).toBeNull();
    expect(c.filter.kinds.size).toBe(0);
  });

  it("emits the change kind on transitions", () => {
    const c = new AtlasController();
    const seen: string[] = [];
    c.on((change) => seen.push(change));
    c.setMode("network");
    c.setFocus("a");
    c.setFilter({ minWeight: 2 });
    c.notifyData();
    expect(seen).toEqual(["mode", "focus", "filter", "data"]);
  });

  it("is a no-op (no emit) when the value is unchanged", () => {
    const c = new AtlasController("network");
    const fn = vi.fn();
    c.on(fn);
    c.setMode("network"); // same
    c.setFocus(null); // same (already null)
    expect(fn).not.toHaveBeenCalled();
  });

  it("merges partial filter updates", () => {
    const c = new AtlasController();
    c.setFilter({ minWeight: 3 });
    c.setFilter({ withinDays: 30 });
    expect(c.filter.minWeight).toBe(3);
    expect(c.filter.withinDays).toBe(30);
    c.resetFilter();
    expect(c.filter.minWeight).toBe(0);
    expect(c.filter.withinDays).toBeNull();
  });

  it("unsubscribe stops delivery", () => {
    const c = new AtlasController();
    const fn = vi.fn();
    const off = c.on(fn);
    off();
    c.setFocus("x");
    expect(fn).not.toHaveBeenCalled();
  });
});
