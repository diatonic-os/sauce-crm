// absPluginDir DRY invariant: the absolute plugin dir handed to the native
// LanceDB resolver must be exactly `${vaultBase}/${pluginDir}`, where pluginDir
// is the normalized vault-relative `${configDir}/plugins/${id}`. Deriving
// absPluginDir from pluginDir (rather than re-composing the segment inline)
// guarantees the relative and absolute forms can never drift.

import { describe, it, expect, vi } from "vitest";
import { App, Plugin, normalizePath } from "obsidian";
import { initV2 } from "./v2-init";

// Capture the module-base candidate list so we can read the absPluginDir that
// initV2 derived. firstExistingModuleBase is called unconditionally with
// [lanceRuntimeDir(pe), absPluginDir] — the second element is absPluginDir.
const captured: { candidates: Array<string | undefined> } = { candidates: [] };
vi.mock("./services/platformPaths", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./services/platformPaths")>();
  return {
    ...actual,
    firstExistingModuleBase: (candidates: Array<string | undefined>) => {
      captured.candidates = candidates;
      // Return undefined so no native LanceDB init is attempted in test.
      return undefined;
    },
  };
});

// Guard: with no module base, the native backend must never be opened.
vi.mock("./backend/lance", () => ({
  initLanceBackend: vi.fn(async () => {
    throw new Error(
      "initLanceBackend MUST NOT be called without a module base",
    );
  }),
}));

function makeApp(base: string, configDir: string): App {
  const app = new App();
  (app.vault as unknown as { adapter: Record<string, unknown> }).adapter = {
    getBasePath: () => base,
    basePath: base,
  };
  (app.vault as unknown as { configDir: string }).configDir = configDir;
  return app;
}

describe("initV2 absPluginDir DRY invariant", () => {
  it("derives absPluginDir as `${vaultBase}/${pluginDir}`", async () => {
    captured.candidates = [];
    const vaultBase = "/home/op/Vault";
    const configDir = ".obsidian";
    const app = makeApp(vaultBase, configDir);
    const plugin = new (Plugin as unknown as new (a: App) => Plugin)(app);
    (plugin as unknown as { logger?: unknown }).logger = null;
    const pluginId = plugin.manifest.id;

    await initV2(app, plugin);

    const pluginDir = normalizePath(`${configDir}/plugins/${pluginId}`);
    const expectedAbs = `${vaultBase}/${pluginDir}`;
    expect(captured.candidates).toContain(expectedAbs);
    // And it composes from the vault-relative segment exactly once (no doubled
    // or mismatched configDir/plugins segment).
    expect(captured.candidates).toContain(
      `${vaultBase}/${configDir}/plugins/${pluginId}`,
    );
  });
});
