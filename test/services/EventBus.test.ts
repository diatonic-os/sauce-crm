import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/services/EventBus";

describe("EventBus", () => {
  it("on/emit delivers payloads; off + unsubscribe stop delivery", () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on<number>("tick", fn);
    bus.emit("tick", 1);
    off();
    bus.emit("tick", 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it("once fires exactly once", () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.once("x", fn);
    bus.emit("x", "a");
    bus.emit("x", "b");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("subscribe is an alias for on", () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.subscribe("e", fn);
    bus.emit("e", 42);
    expect(fn).toHaveBeenCalledWith(42);
  });

  it("correlate tags emissions and filters by correlationId", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    const c = bus.correlate("req-1");
    c.on<string>("step", (env) => seen.push(env));
    c.emit("step", "hello"); // matches
    bus.emit("step", { correlationId: "other", payload: "ignored" }); // filtered out
    expect(seen).toEqual([{ correlationId: "req-1", payload: "hello" }]);
  });

  it("a handler that unsubscribes mid-dispatch does not corrupt iteration", () => {
    const bus = new EventBus();
    const calls: string[] = [];
    const offA = bus.on("e", () => {
      calls.push("a");
      offA();
    });
    bus.on("e", () => calls.push("b"));
    bus.emit("e", null);
    expect(calls.sort()).toEqual(["a", "b"]);
  });
});
