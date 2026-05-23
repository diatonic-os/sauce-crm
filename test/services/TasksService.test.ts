import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { TasksService } from "../../src/services/TasksService";

function fakeApp(files: Record<string, string> = {}) {
  const store = { ...files };
  const app = {
    vault: { adapter: {
      // a path "exists" if it's a stored file or a folder prefix of one
      exists: async (p: string) => p in store || Object.keys(store).some((k) => k.startsWith(`${p}/`)),
      read: async (p: string) => store[p],
      write: async (p: string, d: string) => { store[p] = d; },
      list: async (_p: string) => ({ files: Object.keys(store).filter((k) => k.startsWith("_Tasks/")), folders: [] }),
    } },
  } as unknown as App;
  return { app, store };
}

describe("TasksService", () => {
  it("adds a task as a checkbox and lists it back", async () => {
    const { app, store } = fakeApp();
    const svc = new TasksService(app, "_TASKS.md");
    await svc.addTask({ title: "Email Bob", status: "todo", contact: "Bob", priority: "high", due: "2026-06-01" });
    expect(store["_TASKS.md"]).toContain("- [ ] Email Bob [[Bob]] ⏫ 📅 2026-06-01");
    const rows = await svc.listTasks();
    expect(rows).toHaveLength(1);
    expect(rows[0].task.title).toBe("Email Bob");
    expect(rows[0].path).toBe("_TASKS.md");
  });

  it("aggregates tasks from the _Tasks folder too", async () => {
    const { app } = fakeApp({ "_TASKS.md": "- [ ] root task\n", "_Tasks/work.md": "- [x] folder task\n" });
    const rows = await new TasksService(app, "_TASKS.md").listTasks();
    expect(rows.map((r) => r.task.title).sort()).toEqual(["folder task", "root task"]);
  });

  it("flips a task's status in place, preserving metadata", async () => {
    const { app, store } = fakeApp({ "_TASKS.md": "# Tasks\n- [ ] Call [[Acme]] 📅 2026-07-01 #x\n" });
    const svc = new TasksService(app, "_TASKS.md");
    await svc.setStatus("_TASKS.md", 2, "done");
    expect(store["_TASKS.md"]).toContain("- [x] Call [[Acme]] 📅 2026-07-01 #x");
  });
});
