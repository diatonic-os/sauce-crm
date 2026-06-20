import { describe, it, expect, vi } from "vitest";
import { VaultEventBus } from "../../src/services/VaultEventBus";
import type { VaultEventKind } from "../../src/services/VaultEventBus";

const ALL = new Set<VaultEventKind>(["changed", "deleted", "renamed"]);

describe("VaultEventBus", () => {
  it("dispatches in subscriber order regardless of subscribe order", () => {
    const bus = new VaultEventBus();
    const seen: string[] = [];
    bus.subscribe({ name: "views", order: 50, kinds: ALL, handle: () => void seen.push("views") });
    bus.subscribe({ name: "edges", order: 10, kinds: ALL, handle: () => void seen.push("edges") });
    bus.subscribe({ name: "mirror", order: 20, kinds: ALL, handle: () => void seen.push("mirror") });
    bus.publish({ kind: "changed", path: "a.md", isMarkdown: true });
    expect(seen).toEqual(["edges", "mirror", "views"]);
    expect(bus.order).toEqual(["edges", "mirror", "views"]);
  });

  it("routes only to subscribers that handle the event kind", () => {
    const bus = new VaultEventBus();
    const changedOnly = vi.fn();
    const all = vi.fn();
    bus.subscribe({ name: "enrich", order: 1, kinds: new Set(["changed"]), handle: changedOnly });
    bus.subscribe({ name: "views", order: 2, kinds: ALL, handle: all });
    bus.publish({ kind: "deleted", path: "x.md", isMarkdown: true });
    expect(changedOnly).not.toHaveBeenCalled();
    expect(all).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing/rejecting subscriber so siblings still run", () => {
    const bus = new VaultEventBus();
    const after = vi.fn();
    bus.subscribe({ name: "boom", order: 1, kinds: ALL, handle: () => { throw new Error("boom"); } });
    bus.subscribe({ name: "rej", order: 2, kinds: ALL, handle: () => Promise.reject(new Error("rej")) });
    bus.subscribe({ name: "after", order: 3, kinds: ALL, handle: after });
    expect(() => bus.publish({ kind: "changed", path: "a.md", isMarkdown: true })).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops delivery", () => {
    const bus = new VaultEventBus();
    const fn = vi.fn();
    const off = bus.subscribe({ name: "s", order: 1, kinds: ALL, handle: fn });
    off();
    bus.publish({ kind: "changed", path: "a.md", isMarkdown: true });
    expect(fn).not.toHaveBeenCalled();
  });
});
