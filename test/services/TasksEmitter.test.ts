import { describe, expect, it } from "vitest";
import {
  toCheckbox,
  parseCheckbox,
  parseTasksFromText,
  type SauceTask,
} from "../../src/services/TasksEmitter";

describe("toCheckbox", () => {
  it("renders status, contact, priority, due, tags in Tasks-plugin format", () => {
    const t: SauceTask = {
      title: "Follow up",
      status: "todo",
      contact: "Bob Lee",
      priority: "high",
      due: "2026-06-01",
      tags: ["sauce/task", "vip"],
    };
    expect(toCheckbox(t)).toBe(
      "- [ ] Follow up [[Bob Lee]] ⏫ 📅 2026-06-01 #sauce/task #vip",
    );
  });

  it("maps each status to the right checkbox char", () => {
    const base: SauceTask = { title: "x", status: "todo" };
    expect(toCheckbox({ ...base, status: "todo" })).toContain("- [ ]");
    expect(toCheckbox({ ...base, status: "in_progress" })).toContain("- [/]");
    expect(toCheckbox({ ...base, status: "blocked" })).toContain("- [!]");
    expect(toCheckbox({ ...base, status: "done" })).toContain("- [x]");
    expect(toCheckbox({ ...base, status: "cancelled" })).toContain("- [-]");
  });
});

describe("parseCheckbox", () => {
  it("returns null for non-task lines", () => {
    expect(parseCheckbox("just a paragraph")).toBeNull();
    expect(parseCheckbox("## heading")).toBeNull();
  });

  it("parses status, due, priority, contact, tags", () => {
    const t = parseCheckbox(
      "- [/] Call [[Acme Corp]] 🔺 📅 2026-07-04 #followup",
    );
    expect(t).toEqual({
      title: "Call",
      status: "in_progress",
      due: "2026-07-04",
      priority: "urgent",
      contact: "Acme Corp",
      tags: ["followup"],
    });
  });

  it("maps checkbox chars back to status (x/X = done, - = cancelled, ! = blocked)", () => {
    expect(parseCheckbox("- [x] done it")?.status).toBe("done");
    expect(parseCheckbox("- [X] done it")?.status).toBe("done");
    expect(parseCheckbox("- [-] nope")?.status).toBe("cancelled");
    expect(parseCheckbox("- [!] stuck")?.status).toBe("blocked");
    expect(parseCheckbox("- [?] unknown")?.status).toBe("todo"); // unknown char → todo
  });

  it("round-trips a full task", () => {
    const t: SauceTask = {
      title: "Draft memo",
      status: "todo",
      contact: "Jane",
      priority: "medium",
      due: "2026-05-30",
      tags: ["q3"],
    };
    expect(parseCheckbox(toCheckbox(t))).toEqual(t);
  });

  it("handles a bare task with no metadata", () => {
    expect(parseCheckbox("- [ ] simple task")).toEqual({
      title: "simple task",
      status: "todo",
    });
  });
});

describe("parseTasksFromText", () => {
  it("extracts all task lines with 1-based line numbers", () => {
    const text = "# Tasks\n\n- [ ] one\nnot a task\n- [x] two 📅 2026-01-01\n";
    const rows = parseTasksFromText(text);
    expect(rows.map((r) => r.line)).toEqual([3, 5]);
    expect(rows[0].task.title).toBe("one");
    expect(rows[1].task.status).toBe("done");
    expect(rows[1].task.due).toBe("2026-01-01");
  });
});
