// ─────────────────────────────────────────────────────────────────────────────
//  TOOL REGISTRY + HOOK BUS — L3 execution dispatch surface
// ─────────────────────────────────────────────────────────────────────────────
//
//  Per SAUCEOM_HARNESS_DIRECTIVE v0.1 @L3_execution:
//    "tool registry is the dispatch surface; hook bus is the observation rail"
//    "dangerous tools require explicit approval before execution"
//    "hooks fire sequentially in registration order; pre before handler,
//     post after; payload carries {tool, input, result}"
//
//  Design constraints:
//    • PURE module — no obsidian / lancedb imports, no process.env mutation.
//    • All side-effecting capabilities are injected (handler, approve fn).
//    • HookBus hooks run sequentially; async hooks are awaited in order.
//    • ToolRegistry.execute is the ONLY dispatch path; callers never
//      invoke handlers directly (so hooks always fire).

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A single tool definition registered in the ToolRegistry.
 * `handler` is the sole side-effecting entry point; all capabilities
 * must be closed over inside the handler or injected via `ToolCtx`.
 */
export interface ToolDef {
  /** Unique tool identifier used for dispatch. */
  name: string;
  /** Human-readable purpose of the tool. */
  description: string;
  /** JSON-schema-compatible shape of the expected input object. */
  inputSchema: Record<string, unknown>;
  /**
   * Executes the tool.  The promise resolves with an opaque result value
   * that callers (and hook payloads) receive verbatim.
   */
  handler: (
    input: Record<string, unknown>,
    ctx?: ToolCtx
  ) => Promise<unknown>;
  /**
   * When `true` the `ToolCtx.approve` gate is consulted before execution.
   * If approve returns `false`, execute throws "not approved".
   */
  dangerous?: boolean;
}

/**
 * Execution context threaded from the caller through to the handler.
 * All fields are optional — callers that do not care about approval gating
 * may omit `ctx` entirely.
 */
export interface ToolCtx {
  /**
   * Called before a dangerous tool executes.
   * Return `true` to allow, `false` to block.
   * When absent, dangerous tools are allowed to run.
   */
  approve?: (tool: ToolDef, input: Record<string, unknown>) => boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOOK BUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The five observable points in a harness turn / tool execution lifecycle.
 */
export type HookPoint =
  | "pre_turn"
  | "pre_tool"
  | "post_tool"
  | "on_collapse"
  | "on_stage_complete";

/**
 * A hook function.  May be synchronous or async; async hooks are awaited
 * before the next hook in the chain runs.
 */
export type Hook = (
  payload: Record<string, unknown>
) => Promise<void> | void;

/**
 * Minimal pub/sub bus for harness lifecycle events.
 *
 * Hooks are invoked **sequentially in registration order** — i.e. the bus
 * is not a concurrent fan-out.  This preserves determinism and makes
 * ordering guarantees trivial to reason about.
 */
export class HookBus {
  private readonly _hooks = new Map<HookPoint, Hook[]>();

  /**
   * Register a hook for `point`.  Registration is append-only; hooks fire
   * in the order they were registered.
   */
  on(point: HookPoint, hook: Hook): void {
    const list = this._hooks.get(point);
    if (list !== undefined) {
      list.push(hook);
    } else {
      this._hooks.set(point, [hook]);
    }
  }

  /**
   * Emit `point`, running every registered hook sequentially.
   * Awaits async hooks before advancing to the next one.
   */
  async emit(
    point: HookPoint,
    payload: Record<string, unknown>
  ): Promise<void> {
    const list = this._hooks.get(point);
    if (list === undefined) return;
    for (const hook of list) {
      await hook(payload);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  TOOL REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Central dispatch table for SauceOM harness tools.
 *
 * Callers register `ToolDef` objects, then invoke `execute()` to run a tool
 * by name.  The registry:
 *  1. Validates the tool exists (throws on unknown name).
 *  2. Consults `ctx.approve` for dangerous tools (throws "not approved"
 *     when the gate returns `false`).
 *  3. Emits `pre_tool` on the HookBus.
 *  4. Invokes the handler.
 *  5. Emits `post_tool` with `{tool, input, result}`.
 *  6. Returns the handler result.
 */
export class ToolRegistry {
  private readonly _tools = new Map<string, ToolDef>();
  private readonly _bus: HookBus | undefined;

  /**
   * @param hooks — optional HookBus; when omitted hooks are a no-op.
   */
  constructor(hooks?: HookBus) {
    this._bus = hooks;
  }

  /**
   * Add a tool to the registry.  Overwrites any previously registered
   * tool with the same name.
   */
  register(tool: ToolDef): void {
    this._tools.set(tool.name, tool);
  }

  /**
   * Look up a tool by name.  Returns `undefined` when not found.
   */
  get(name: string): ToolDef | undefined {
    return this._tools.get(name);
  }

  /**
   * Return a snapshot of all registered tools in registration order.
   */
  list(): ToolDef[] {
    return Array.from(this._tools.values());
  }

  /**
   * Dispatch a tool call.
   *
   * @throws when the tool name is unknown.
   * @throws "not approved" when `tool.dangerous` and `ctx.approve` returns `false`.
   */
  async execute(
    name: string,
    input: Record<string, unknown>,
    ctx?: ToolCtx
  ): Promise<unknown> {
    const tool = this._tools.get(name);
    if (tool === undefined) {
      throw new Error(`ToolRegistry: unknown tool "${name}"`);
    }

    // Dangerous-tool approval gate
    if (tool.dangerous === true && ctx?.approve !== undefined) {
      const allowed = ctx.approve(tool, input);
      if (!allowed) {
        throw new Error(
          `ToolRegistry: tool "${name}" was not approved by ctx.approve`
        );
      }
    }

    // pre_tool hook
    if (this._bus !== undefined) {
      await this._bus.emit("pre_tool", { tool, input });
    }

    // Dispatch
    const result = await tool.handler(input, ctx);

    // post_tool hook
    if (this._bus !== undefined) {
      await this._bus.emit("post_tool", { tool, input, result });
    }

    return result;
  }
}
