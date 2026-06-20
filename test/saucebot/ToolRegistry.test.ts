// ─────────────────────────────────────────────────────────────────────────────
//  ToolRegistry.test.ts
// ─────────────────────────────────────────────────────────────────────────────
//
//  Per SAUCEOM_HARNESS_DIRECTIVE v0.1 @L3_execution:
//    "tool registry is the dispatch surface; hook bus is the observation rail"
//
//  Tests: register/get/list; execute fires pre_tool + post_tool in order;
//  dangerous tool blocked when approve=false, allowed when approve=true;
//  unknown tool throws.

import { describe, it, expect, vi } from "vitest";
import {
  HookBus,
  ToolRegistry,
  type ToolDef,
  type ToolCtx,
  type HookPoint,
} from "../../src/saucebot/harness/ToolRegistry";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeEchoTool(name = "echo"): ToolDef {
  return {
    name,
    description: "Echoes its input",
    inputSchema: { type: "object" },
    handler: async (input) => ({ echoed: input }),
  };
}

function makeDangerousTool(name = "nuke"): ToolDef {
  return {
    name,
    description: "Dangerous op",
    inputSchema: { type: "object" },
    handler: async () => "boom",
    dangerous: true,
  };
}

// ─── HookBus ──────────────────────────────────────────────────────────────────

describe("HookBus", () => {
  it("runs hooks sequentially in registration order", async () => {
    const bus = new HookBus();
    const calls: string[] = [];

    bus.on("pre_tool", async () => { calls.push("first"); });
    bus.on("pre_tool", () => { calls.push("second"); });

    await bus.emit("pre_tool", { foo: 1 });
    expect(calls).toEqual(["first", "second"]);
  });

  it("passes payload to hooks", async () => {
    const bus = new HookBus();
    const received: Record<string, unknown>[] = [];

    bus.on("post_tool", (p) => { received.push(p); });
    await bus.emit("post_tool", { result: 42 });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ result: 42 });
  });

  it("hooks on different points do not interfere", async () => {
    const bus = new HookBus();
    const calls: HookPoint[] = [];

    bus.on("pre_tool", () => { calls.push("pre_tool"); });
    bus.on("post_tool", () => { calls.push("post_tool"); });

    await bus.emit("pre_tool", {});
    expect(calls).toEqual(["pre_tool"]);
  });
});

// ─── ToolRegistry — registration ──────────────────────────────────────────────

describe("ToolRegistry registration", () => {
  it("register and get returns the same ToolDef", () => {
    const reg = new ToolRegistry();
    const tool = makeEchoTool();
    reg.register(tool);
    expect(reg.get("echo")).toBe(tool);
  });

  it("get returns undefined for unknown name", () => {
    const reg = new ToolRegistry();
    expect(reg.get("no-such-tool")).toBeUndefined();
  });

  it("list returns all registered tools", () => {
    const reg = new ToolRegistry();
    const a = makeEchoTool("a");
    const b = makeEchoTool("b");
    reg.register(a);
    reg.register(b);
    const names = reg.list().map((t) => t.name);
    expect(names).toContain("a");
    expect(names).toContain("b");
    expect(names).toHaveLength(2);
  });

  it("list returns empty array when nothing registered", () => {
    const reg = new ToolRegistry();
    expect(reg.list()).toEqual([]);
  });
});

// ─── ToolRegistry — execute ───────────────────────────────────────────────────

describe("ToolRegistry.execute", () => {
  it("runs the handler and returns its result", async () => {
    const reg = new ToolRegistry();
    reg.register(makeEchoTool());
    const result = await reg.execute("echo", { msg: "hi" });
    expect(result).toMatchObject({ echoed: { msg: "hi" } });
  });

  it("throws for unknown tool", async () => {
    const reg = new ToolRegistry();
    await expect(reg.execute("ghost", {})).rejects.toThrow(/ghost/);
  });

  it("fires pre_tool before handler and post_tool after, in that order", async () => {
    const bus = new HookBus();
    const events: string[] = [];

    bus.on("pre_tool", () => { events.push("pre"); });
    bus.on("post_tool", () => { events.push("post"); });

    const reg = new ToolRegistry(bus);
    let handlerCalled = false;
    reg.register({
      name: "probe",
      description: "probe",
      inputSchema: {},
      handler: async () => {
        handlerCalled = true;
        // pre must already be recorded
        expect(events).toContain("pre");
        return "ok";
      },
    });

    await reg.execute("probe", {});
    expect(events).toEqual(["pre", "post"]);
    expect(handlerCalled).toBe(true);
  });

  it("post_tool payload includes tool name, input, and result", async () => {
    const bus = new HookBus();
    let captured: Record<string, unknown> = {};
    bus.on("post_tool", (p) => { captured = p; });

    const reg = new ToolRegistry(bus);
    reg.register(makeEchoTool());
    await reg.execute("echo", { x: 7 });

    expect((captured["tool"] as ToolDef).name).toBe("echo");
    expect(captured["input"]).toMatchObject({ x: 7 });
    expect(captured["result"]).toMatchObject({ echoed: { x: 7 } });
  });

  it("pre_tool payload includes tool name and input", async () => {
    const bus = new HookBus();
    let captured: Record<string, unknown> = {};
    bus.on("pre_tool", (p) => { captured = p; });

    const reg = new ToolRegistry(bus);
    reg.register(makeEchoTool());
    await reg.execute("echo", { y: 3 });

    expect((captured["tool"] as ToolDef).name).toBe("echo");
    expect(captured["input"]).toMatchObject({ y: 3 });
  });
});

// ─── ToolRegistry — dangerous tool gating ────────────────────────────────────

describe("ToolRegistry dangerous tool gating", () => {
  it("blocks dangerous tool when approve returns false", async () => {
    const reg = new ToolRegistry();
    reg.register(makeDangerousTool());

    const ctx: ToolCtx = { approve: () => false };
    await expect(reg.execute("nuke", {}, ctx)).rejects.toThrow(/not approved/i);
  });

  it("allows dangerous tool when approve returns true", async () => {
    const reg = new ToolRegistry();
    reg.register(makeDangerousTool());

    const ctx: ToolCtx = { approve: () => true };
    const result = await reg.execute("nuke", {}, ctx);
    expect(result).toBe("boom");
  });

  it("allows dangerous tool when no ctx provided (no gate = allow)", async () => {
    // Spec says: only blocked when approve explicitly returns false.
    // No ctx => no gate => tool runs.
    const reg = new ToolRegistry();
    reg.register(makeDangerousTool());
    const result = await reg.execute("nuke", {});
    expect(result).toBe("boom");
  });

  it("allows dangerous tool when ctx has no approve fn", async () => {
    const reg = new ToolRegistry();
    reg.register(makeDangerousTool());
    const ctx: ToolCtx = {};
    const result = await reg.execute("nuke", {}, ctx);
    expect(result).toBe("boom");
  });

  it("non-dangerous tool always runs regardless of approve", async () => {
    const reg = new ToolRegistry();
    reg.register(makeEchoTool());
    const ctx: ToolCtx = { approve: () => false };
    const result = await reg.execute("echo", { z: 1 }, ctx);
    expect(result).toMatchObject({ echoed: { z: 1 } });
  });

  it("approve receives the ToolDef and input", async () => {
    const reg = new ToolRegistry();
    const tool = makeDangerousTool();
    reg.register(tool);

    let capturedTool: ToolDef | undefined;
    let capturedInput: Record<string, unknown> | undefined;

    const ctx: ToolCtx = {
      approve: (t, i) => {
        capturedTool = t;
        capturedInput = i;
        return true;
      },
    };

    await reg.execute("nuke", { secret: "key" }, ctx);
    expect(capturedTool).toBe(tool);
    expect(capturedInput).toMatchObject({ secret: "key" });
  });
});

// ─── HookBus — hook point isolation for all five points ──────────────────────

describe("HookBus all hook points", () => {
  const points: HookPoint[] = [
    "pre_turn",
    "pre_tool",
    "post_tool",
    "on_collapse",
    "on_stage_complete",
  ];

  for (const point of points) {
    it(`fires hooks registered on ${point}`, async () => {
      const bus = new HookBus();
      const called = vi.fn();
      bus.on(point, called);
      await bus.emit(point, { point });
      expect(called).toHaveBeenCalledOnce();
    });
  }
});
