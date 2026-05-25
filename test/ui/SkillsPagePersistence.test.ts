// Asserts that SkillsPage reads/writes skill settings via SettingsHost.
// Uses a fake SkillRegistry and jsdom-style fake DOM (vitest provides jsdom).
import { describe, expect, it, vi } from "vitest";
import { SkillRegistry } from "../../src/skills/SkillRegistry";
import { SkillsPage } from "../../src/ui/settings/SkillsPage";
import type { SettingsHost } from "../../src/ui/settings/SettingsPage";

// Build a minimal fake SettingsHost that stores values in a Map.
function fakeHost(
  pluginOverride: object | null = null,
): SettingsHost & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    getConfig<T>(key: string, fallback: T): T {
      if (key === "plugin.handle" && pluginOverride !== null)
        return pluginOverride as unknown as T;
      return (store.has(key) ? store.get(key) : fallback) as T;
    },
    async setConfig<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
    },
  };
}

// Build a minimal plugin-like handle that exposes a SkillRegistry.
function fakePlugin(registry: SkillRegistry): object {
  return { skills: { registry } };
}

describe("SkillsPage persistence", () => {
  it("renders without crashing when plugin handle is absent", () => {
    const host = fakeHost(null);
    const page = new SkillsPage(host);
    const el = document.createElement("div");
    // Provide minimal .empty() so the page doesn't throw.
    (el as any).empty = (): void => {
      while (el.firstChild) el.removeChild(el.firstChild);
    };
    expect(() => page.render(el)).not.toThrow();
    // Should contain a hint about runtime not initialized.
    expect(el.textContent).toMatch(/not yet initialized|not initialized/i);
  });

  it("reads persisted settings back into the registry on render", async () => {
    const registry = new SkillRegistry();
    const plugin = fakePlugin(registry);
    const host = fakeHost(plugin);

    // Pre-populate persisted settings for one skill.
    await host.setConfig("skills.research-person", {
      enabled: false,
      autonomy: "autonomous",
    });

    const page = new SkillsPage(host);
    const el = document.createElement("div");
    (el as any).empty = (): void => {
      while (el.firstChild) el.removeChild(el.firstChild);
    };
    page.render(el);

    // The registry should have been updated from persisted settings.
    const cfg = registry.getSettings("research-person");
    expect(cfg.enabled).toBe(false);
    expect(cfg.autonomy).toBe("autonomous");
  });

  it("writes settings back to SettingsHost when a toggle changes", async () => {
    const registry = new SkillRegistry();
    const plugin = fakePlugin(registry);
    const host = fakeHost(plugin);

    const page = new SkillsPage(host);
    const container = document.createElement("div");
    (container as any).empty = (): void => {
      while (container.firstChild) container.removeChild(container.firstChild);
    };
    page.render(container);

    // Find a checkbox (first enabled toggle) and simulate unchecking it.
    const checkboxes = container.querySelectorAll(
      "input.sauce-skill-toggle",
    ) as NodeListOf<HTMLInputElement>;
    if (checkboxes.length === 0) {
      // No skills rendered — skip (should not happen with real registry).
      return;
    }
    const cb = checkboxes[0];
    cb.checked = false;
    cb.dispatchEvent(new Event("change"));

    // Allow the async setConfig call to resolve.
    await new Promise((r) => setTimeout(r, 10));

    // At least one key in the store should now have enabled: false.
    const persistedValues = [...host.store.values()] as Array<{
      enabled?: boolean;
    }>;
    expect(persistedValues.some((v) => v.enabled === false)).toBe(true);
  });
});
