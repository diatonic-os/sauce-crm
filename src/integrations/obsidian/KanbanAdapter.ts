// CON-OBS-INTEG-001 · T-B3-01 · INT-kanban — adapter for obsidian-kanban.
//
// Unlike the data.json adapters, kanban "optimization" projects each board into
// an ENT-pipelines graph node (pl-<id>) with a bidirectional edge. The graph is
// SH-E; to stay independent of it (both depend only on SH-A) the adapter writes
// through an injected PipelineGraphSink — SH-E's GraphService satisfies it later.
// The facade never returns the raw plugin handle (G-010 / R-003).

import type { App } from "obsidian";
import type {
  IObsidianPluginIntegration,
  PluginState,
  OptimizationPlan,
  OptimizationResult,
  OptimizationChange,
} from "./IObsidianPluginIntegration";

export const KANBAN_PLUGIN_ID = "obsidian-kanban";
const EDGE_KIND = "kanbanBoard";

export interface KanbanBoard {
  /** Vault path of the .md file carrying `kanban-plugin` frontmatter. */
  path: string;
  name: string;
}

export interface GraphEdgeSpec {
  src: string;
  dst: string;
  kind: string;
}

export interface PipelineProjection {
  board: KanbanBoard;
  /** The bidirectional board↔pipeline edges (materialized at write time, DEC-004). */
  edges: GraphEdgeSpec[];
}

/** Graph write surface (injected) — SH-E GraphService satisfies this. */
export interface PipelineGraphSink {
  hasPipelineFor(boardPath: string): boolean;
  /** Create/return the pl-<ulid> node id for a board. */
  upsertPipelineNode(board: KanbanBoard): string;
  upsertEdge(src: string, dst: string, kind: string): void;
}

export interface KanbanRuntimeHost {
  isInstalled(): boolean;
  isEnabled(): boolean;
  getVersion(): string | null;
  /** Scan the vault for .md files with `kanban-plugin` frontmatter. */
  listBoards(): KanbanBoard[];
}

export interface SauceKanbanFacade {
  isAvailable(): boolean;
  enumerateBoards(): KanbanBoard[];
  projectionFor(board: KanbanBoard): PipelineProjection;
}

export function buildKanbanRuntimeHost(
  app: App,
  listBoards: () => KanbanBoard[],
): KanbanRuntimeHost {
  // app.plugins is a real runtime API not exposed in Obsidian's public .d.ts.
  const get = () =>
    (
      app as unknown as {
        plugins?: {
          plugins?: Record<string, unknown>;
          enabledPlugins?: Set<string>;
        };
      }
    ).plugins;
  return {
    isInstalled: () => !!get()?.plugins?.[KANBAN_PLUGIN_ID],
    isEnabled: () => get()?.enabledPlugins?.has(KANBAN_PLUGIN_ID) ?? false,
    getVersion: () => {
      const p = get()?.plugins?.[KANBAN_PLUGIN_ID] as
        | { manifest?: { version?: string } }
        | undefined;
      return p?.manifest?.version ?? null;
    },
    listBoards,
  };
}

/** The two directed edges that materialize one board↔pipeline link. */
function edgesFor(boardPath: string, pipelineId: string): GraphEdgeSpec[] {
  return [
    { src: boardPath, dst: pipelineId, kind: EDGE_KIND },
    { src: pipelineId, dst: boardPath, kind: EDGE_KIND },
  ];
}

export class KanbanAdapter implements IObsidianPluginIntegration {
  readonly id = KANBAN_PLUGIN_ID;
  readonly label = "Kanban";
  readonly pluginId = KANBAN_PLUGIN_ID;
  readonly pluginClass = "community" as const;

  constructor(
    private readonly runtime: KanbanRuntimeHost,
    private readonly sink: PipelineGraphSink,
  ) {}

  async detect(): Promise<PluginState> {
    const boards = this.runtime.listBoards();
    const optimized = boards.every((b) => this.sink.hasPipelineFor(b.path));
    return {
      installed: this.runtime.isInstalled(),
      enabled: this.runtime.isEnabled(),
      version: this.runtime.getVersion(),
      optimized,
      compatible: true,
    };
  }

  async getOptimizationDiff(): Promise<OptimizationPlan> {
    const changes: OptimizationChange[] = this.runtime
      .listBoards()
      .filter((b) => !this.sink.hasPipelineFor(b.path))
      .map((b) => ({
        target: `graph:nodes`,
        key: b.path,
        from: null,
        to: "pl-<ulid>",
        reason: "Project kanban board → pipeline node",
      }));
    return { pluginId: this.pluginId, changes };
  }

  async optimize(): Promise<OptimizationResult> {
    try {
      const applied: OptimizationChange[] = [];
      for (const board of this.runtime.listBoards()) {
        if (this.sink.hasPipelineFor(board.path)) continue;
        const pid = this.sink.upsertPipelineNode(board);
        for (const e of edgesFor(board.path, pid))
          this.sink.upsertEdge(e.src, e.dst, e.kind);
        applied.push({
          target: "graph:nodes",
          key: board.path,
          from: null,
          to: pid,
          reason: "Project kanban board → pipeline node",
        });
      }
      return { ok: true, applied };
    } catch (e) {
      return {
        ok: false,
        applied: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  getServiceFacade<T>(): T {
    const facade: SauceKanbanFacade = {
      isAvailable: () => this.runtime.isEnabled(),
      enumerateBoards: () => this.runtime.listBoards(),
      projectionFor: (board: KanbanBoard) => ({
        board,
        edges: edgesFor(board.path, "pl-<ulid>"),
      }),
    };
    return facade as T;
  }

  supportsBeta(): boolean {
    return false;
  }

  async connect(): Promise<{ connected: boolean }> {
    return { connected: this.runtime.isEnabled() };
  }
  async disconnect(): Promise<void> {}
  async state(): Promise<{ connected: boolean }> {
    return { connected: this.runtime.isEnabled() };
  }
  async listResources(): Promise<[]> {
    return [];
  }
  async syncResource(): Promise<{
    pulled: number;
    pushed: number;
    errors: number;
  }> {
    return { pulled: 0, pushed: 0, errors: 0 };
  }
}
