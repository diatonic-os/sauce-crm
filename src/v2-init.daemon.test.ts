// Single-writer rule: when the daemon owns the Lance store, initV2 must NOT
// open it locally. With skipLance:true the backend stays null and backendKind
// is reported as "daemon".

import { describe, it, expect, vi } from "vitest";
import { App, Plugin } from "obsidian";
import { initV2 } from "./v2-init";

// Guard: initLanceBackend must never be invoked on the skip path.
vi.mock("./backend/lance", () => ({
  initLanceBackend: vi.fn(async () => {
    throw new Error(
      "initLanceBackend MUST NOT be called when skipLance is set",
    );
  }),
}));

function makeAppWithBase(base: string): App {
  const app = new App();
  // initV2 reads app.vault.adapter.getBasePath?.() ?? .basePath.
  (app.vault as unknown as { adapter: Record<string, unknown> }).adapter = {
    getBasePath: () => base,
    basePath: base,
  };
  return app;
}

describe("initV2 single-writer (daemon) skip", () => {
  it("reports backendKind 'daemon' and a null lance backend when skipLance", async () => {
    const app = makeAppWithBase("/home/op/Vault");
    // The vitest obsidian stub provides a concrete Plugin; cast past the real
    // (abstract) type for tsc.
    const plugin = new (Plugin as unknown as new (a: App) => Plugin)(app);
    (plugin as unknown as { logger?: unknown }).logger = null;

    const rt = await initV2(app, plugin, { skipLance: true });

    expect(rt.backendKind).toBe("daemon");
    expect(rt.lance).toBeNull();
    // KeyVault/AuditLog/Provenance require a local Lance handle; null in this mode.
    expect(rt.keyVault).toBeNull();
    expect(rt.auditLog).toBeNull();
    expect(rt.provenance).toBeNull();
  });

  it("does not report 'daemon' when skipLance is absent (no daemon)", async () => {
    const app = makeAppWithBase("/home/op/Vault");
    // The vitest obsidian stub provides a concrete Plugin; cast past the real
    // (abstract) type for tsc.
    const plugin = new (Plugin as unknown as new (a: App) => Plugin)(app);
    (plugin as unknown as { logger?: unknown }).logger = null;

    const rt = await initV2(app, plugin);
    // Without the native module installed in test, the local path yields
    // "uninitialized" — crucially NOT "daemon".
    expect(rt.backendKind).not.toBe("daemon");
  });
});
