import { describe, expect, it, vi } from "vitest";
import { wireSvcV1 } from "../../../src/integrations/obsidian/wireSvcV1";
import type { App } from "obsidian";

// Minimal fake App with just the surface wireSvcV1 touches at construction time.
function fakeApp(): App {
  return {
    vault: {
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      read: async () => "",
      create: async () => ({}),
      modify: async () => {},
      trash: async () => {},
    },
    metadataCache: {
      getFileCache: () => null,
      resolvedLinks: {},
      unresolvedLinks: {},
    },
    fileManager: {
      processFrontMatter: async () => {},
      renameFile: async () => {},
    },
    workspace: { onLayoutReady: (cb: () => void) => cb() },
    plugins: {
      plugins: {},
      enabledPlugins: new Set<string>(),
      on: vi.fn(() => ({})),
      offref: vi.fn(),
    },
    internalPlugins: { getPluginById: () => null },
    commands: { executeCommandById: vi.fn() },
  } as unknown as App;
}

const sha256Hex = async (s: string) => `h${s.length}`;

describe("wireSvcV1", () => {
  it("mounts a frozen svcV1 (0.3.0) on the plugin instance with the full surface", () => {
    const plugin: Record<string, unknown> = {};
    const wired = wireSvcV1(plugin, fakeApp(), { sha256Hex });
    expect(wired.svcV1.version).toBe("0.3.0");
    expect(plugin.svcV1).toBe(wired.svcV1);
    for (const k of [
      "entities",
      "touches",
      "pipelines",
      "graph",
      "canon",
      "events",
      "tasks",
      "files",
      "search",
      "content",
      "meta",
    ]) {
      expect(wired.svcV1).toHaveProperty(k);
    }
    expect(Object.isFrozen(wired.svcV1)).toBe(true);
  });

  it("registers all 6 community adapters and attaches to the app", () => {
    const app = fakeApp();
    const wired = wireSvcV1({}, app, { sha256Hex });
    const ids = wired.registry
      .list()
      .map((a) => a.pluginId)
      .sort();
    expect(ids).toEqual(
      [
        "dataview",
        "obsidian-kanban",
        "obsidian-meta-bind-plugin",
        "obsidian-tasks-plugin",
        "obsidian42-brat",
        "quickadd",
      ].sort(),
    );
    expect(
      (app.plugins as unknown as { on: ReturnType<typeof vi.fn> }).on,
    ).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("dispose() tears down the registry and unmounts svcV1", () => {
    const plugin: Record<string, unknown> = {};
    const wired = wireSvcV1(plugin, fakeApp(), { sha256Hex });
    expect(plugin.svcV1).toBeDefined();
    wired.dispose();
    expect(plugin.svcV1).toBeUndefined();
    expect(wired.registry.list()).toEqual([]);
  });

  it("KanbanAdapter projects boards into the shared GraphService (svcV1.graph)", () => {
    const wired = wireSvcV1({}, fakeApp(), { sha256Hex });
    // The kanban adapter's sink IS the wired graph — project a board and see it.
    expect(wired.graph.hasPipelineFor("Projects/Sales.md")).toBe(false);
    const id = wired.graph.upsertPipelineNode({
      path: "Projects/Sales.md",
      name: "Sales",
    });
    wired.graph.upsertEdge("Projects/Sales.md", id, "kanbanBoard");
    expect(wired.svcV1.pipelines.list().map((n) => n.id)).toContain(id);
  });
});
