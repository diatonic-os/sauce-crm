// ─────────────────────────────────────────────────────────────────────────────
//  Tests for SystemPromptLibrary — named, switchable system prompts
//  over an injected persistence host (PURE module)
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it, beforeEach } from "vitest";
import {
  SystemPromptLibrary,
  type SystemPrompt,
  type PromptHost,
} from "../../src/saucebot/harness/SystemPromptLibrary";

// ─── mock host ────────────────────────────────────────────────────────────────

class MockPromptHost implements PromptHost {
  private prompts: SystemPrompt[] = [];

  async read(): Promise<SystemPrompt[]> {
    return [...this.prompts];
  }

  async write(prompts: SystemPrompt[]): Promise<void> {
    this.prompts = [...prompts];
  }
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("SystemPromptLibrary", () => {
  let host: MockPromptHost;
  let lib: SystemPromptLibrary;

  beforeEach(() => {
    host = new MockPromptHost();
    lib = new SystemPromptLibrary(host, () => 12345);
  });

  describe("list", () => {
    it("returns empty array when no prompts exist", async () => {
      const result = await lib.list();
      expect(result).toEqual([]);
    });

    it("returns all prompts from host", async () => {
      await host.write([
        { id: "p1", title: "Prompt 1", body: "Body 1", updatedTs: 100 },
        { id: "p2", title: "Prompt 2", body: "Body 2", updatedTs: 200 },
      ]);
      const result = await lib.list();
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.id)).toEqual(["p1", "p2"]);
    });
  });

  describe("upsert", () => {
    it("creates a new prompt with generated id when id is absent", async () => {
      const created = await lib.upsert({ title: "My Prompt", body: "Content" });
      expect(created.id).toBeDefined();
      expect(created.title).toBe("My Prompt");
      expect(created.body).toBe("Content");
      expect(created.updatedTs).toBe(12345);
      expect(created.isDefault).toBeUndefined();
    });

    it("slugifies title to generate id", async () => {
      const created = await lib.upsert({ title: "Hello World!", body: "..." });
      expect(created.id).toBe("hello-world");
    });

    it("uses provided id if present", async () => {
      const created = await lib.upsert({
        id: "custom-id",
        title: "Title",
        body: "Body",
      });
      expect(created.id).toBe("custom-id");
    });

    it("replaces existing prompt with same id", async () => {
      await lib.upsert({ id: "p1", title: "First", body: "Body 1" });
      const updated = await lib.upsert({
        id: "p1",
        title: "Second",
        body: "Body 2",
      });
      expect(updated.title).toBe("Second");
      expect(updated.body).toBe("Body 2");

      const list = await lib.list();
      expect(list).toHaveLength(1);
      expect(list[0]?.title).toBe("Second");
    });

    it("updates timestamp on replacement", async () => {
      await lib.upsert({ id: "p1", title: "Title", body: "Body" });
      const updated = await lib.upsert({
        id: "p1",
        title: "Title",
        body: "Body",
      });
      expect(updated.updatedTs).toBe(12345);
    });

    it("persists to host after create", async () => {
      await lib.upsert({ id: "new", title: "Title", body: "Body" });
      const persisted = await host.read();
      expect(persisted).toHaveLength(1);
      expect(persisted[0]?.id).toBe("new");
    });

    it("persists to host after update", async () => {
      await lib.upsert({ id: "p1", title: "Title", body: "Body" });
      await lib.upsert({ id: "p1", title: "Updated", body: "New Body" });
      const persisted = await host.read();
      expect(persisted).toHaveLength(1);
      expect(persisted[0]?.title).toBe("Updated");
    });
  });

  describe("remove", () => {
    it("returns false when prompt does not exist", async () => {
      const removed = await lib.remove("nonexistent");
      expect(removed).toBe(false);
    });

    it("removes existing prompt and returns true", async () => {
      await lib.upsert({ id: "p1", title: "Title", body: "Body" });
      const removed = await lib.remove("p1");
      expect(removed).toBe(true);

      const list = await lib.list();
      expect(list).toHaveLength(0);
    });

    it("preserves other prompts when removing one", async () => {
      await lib.upsert({ id: "p1", title: "Title 1", body: "Body 1" });
      await lib.upsert({ id: "p2", title: "Title 2", body: "Body 2" });
      await lib.remove("p1");

      const list = await lib.list();
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe("p2");
    });

    it("persists removal to host", async () => {
      await lib.upsert({ id: "p1", title: "Title", body: "Body" });
      await lib.remove("p1");
      const persisted = await host.read();
      expect(persisted).toHaveLength(0);
    });

    it("clears isDefault flag if removed prompt was default", async () => {
      await lib.upsert({ id: "p1", title: "Title", body: "Body" });
      await lib.setDefault("p1");
      await lib.remove("p1");

      const defaultPrompt = await lib.getDefault();
      expect(defaultPrompt).toBeNull();
    });
  });

  describe("setDefault", () => {
    it("returns false when prompt does not exist", async () => {
      const result = await lib.setDefault("nonexistent");
      expect(result).toBe(false);
    });

    it("sets isDefault flag on existing prompt and returns true", async () => {
      await lib.upsert({ id: "p1", title: "Title", body: "Body" });
      const result = await lib.setDefault("p1");
      expect(result).toBe(true);

      const list = await lib.list();
      expect(list[0]?.isDefault).toBe(true);
    });

    it("clears default flag from previous default when setting new default", async () => {
      await lib.upsert({ id: "p1", title: "Title 1", body: "Body 1" });
      await lib.upsert({ id: "p2", title: "Title 2", body: "Body 2" });

      await lib.setDefault("p1");
      await lib.setDefault("p2");

      const list = await lib.list();
      const p1 = list.find((p) => p.id === "p1");
      const p2 = list.find((p) => p.id === "p2");

      expect(p1?.isDefault).toBeUndefined();
      expect(p2?.isDefault).toBe(true);
    });

    it("enforces exactly one default across updates", async () => {
      await lib.upsert({ id: "p1", title: "Title 1", body: "Body 1" });
      await lib.upsert({ id: "p2", title: "Title 2", body: "Body 2" });
      await lib.upsert({ id: "p3", title: "Title 3", body: "Body 3" });

      await lib.setDefault("p2");
      const list = await lib.list();
      const defaultCount = list.filter((p) => p.isDefault).length;
      expect(defaultCount).toBe(1);
      expect(list.find((p) => p.id === "p2")?.isDefault).toBe(true);
    });

    it("persists default flag to host", async () => {
      await lib.upsert({ id: "p1", title: "Title", body: "Body" });
      await lib.setDefault("p1");

      const persisted = await host.read();
      expect(persisted[0]?.isDefault).toBe(true);
    });
  });

  describe("getDefault", () => {
    it("returns null when no default is set", async () => {
      const result = await lib.getDefault();
      expect(result).toBeNull();
    });

    it("returns the prompt marked as default", async () => {
      await lib.upsert({ id: "p1", title: "Title 1", body: "Body 1" });
      await lib.upsert({ id: "p2", title: "Title 2", body: "Body 2" });
      await lib.setDefault("p2");

      const result = await lib.getDefault();
      expect(result).not.toBeNull();
      expect(result?.id).toBe("p2");
      expect(result?.title).toBe("Title 2");
    });

    it("returns null if no prompt exists", async () => {
      const result = await lib.getDefault();
      expect(result).toBeNull();
    });
  });

  describe("resolve", () => {
    it("returns empty string when no id provided and no default set", async () => {
      const result = await lib.resolve();
      expect(result).toBe("");
    });

    it("returns body of prompt matching provided id", async () => {
      await lib.upsert({ id: "p1", title: "Title", body: "Prompt body" });
      const result = await lib.resolve("p1");
      expect(result).toBe("Prompt body");
    });

    it("returns empty string when id provided but not found", async () => {
      const result = await lib.resolve("nonexistent");
      expect(result).toBe("");
    });

    it("returns default body when no id provided but default exists", async () => {
      await lib.upsert({ id: "p1", title: "Title 1", body: "Body 1" });
      await lib.upsert({ id: "p2", title: "Title 2", body: "Default Body" });
      await lib.setDefault("p2");

      const result = await lib.resolve();
      expect(result).toBe("Default Body");
    });

    it("falls back to default when provided id not found", async () => {
      await lib.upsert({ id: "default", title: "Default", body: "Default Body" });
      await lib.upsert({ id: "p1", title: "Title", body: "Body 1" });
      await lib.setDefault("default");

      const result = await lib.resolve("nonexistent");
      expect(result).toBe("Default Body");
    });

    it("returns empty string when id not found and no default set", async () => {
      await lib.upsert({ id: "p1", title: "Title", body: "Body" });
      const result = await lib.resolve("nonexistent");
      expect(result).toBe("");
    });

    it("priority: explicit id > default > empty string", async () => {
      await lib.upsert({ id: "default", title: "Default", body: "Default" });
      await lib.upsert({ id: "p1", title: "Title 1", body: "Body 1" });
      await lib.setDefault("default");

      // Explicit id takes priority
      expect(await lib.resolve("p1")).toBe("Body 1");

      // Default when no id
      expect(await lib.resolve()).toBe("Default");

      // Empty string fallback when id not found and no default
      await lib.remove("default");
      expect(await lib.resolve("nonexistent")).toBe("");
    });
  });

  describe("slug generation", () => {
    it("converts title to lowercase slug", async () => {
      const p = await lib.upsert({ title: "Hello World", body: "Body" });
      expect(p.id).toBe("hello-world");
    });

    it("handles special characters in slug", async () => {
      const p = await lib.upsert({ title: "Test! @#$% Prompt", body: "Body" });
      expect(p.id).toMatch(/^test.*prompt$/);
    });

    it("handles multiple spaces in title", async () => {
      const p = await lib.upsert({ title: "Multiple   Spaces   Here", body: "Body" });
      expect(p.id).toBe("multiple-spaces-here");
    });

    it("handles unicode in title", async () => {
      const p = await lib.upsert({ title: "Café Société", body: "Body" });
      // slug should handle unicode gracefully
      expect(p.id).toBeDefined();
      expect(p.id.length).toBeGreaterThan(0);
    });
  });

  describe("integration", () => {
    it("supports full lifecycle: create, list, set default, resolve, update, remove", async () => {
      // Create
      const p1 = await lib.upsert({ title: "Prompt 1", body: "Body 1" });
      const p2 = await lib.upsert({ title: "Prompt 2", body: "Body 2" });

      // List
      let list = await lib.list();
      expect(list).toHaveLength(2);

      // Set default
      await lib.setDefault(p2.id);
      const defaultPrompt = await lib.getDefault();
      expect(defaultPrompt?.id).toBe(p2.id);

      // Resolve default
      expect(await lib.resolve()).toBe("Body 2");
      expect(await lib.resolve(p1.id)).toBe("Body 1");

      // Update
      await lib.upsert({ id: p1.id, title: "Updated", body: "Updated Body" });
      expect(await lib.resolve(p1.id)).toBe("Updated Body");

      // Remove
      await lib.remove(p1.id);
      list = await lib.list();
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(p2.id);
    });
  });
});
