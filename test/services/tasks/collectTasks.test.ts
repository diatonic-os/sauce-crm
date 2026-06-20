import { describe, it, expect } from "vitest";

// Minimal App stub — same pattern as the existing dashboard tests
function makeApp(files: Array<{ path: string; fm: Record<string, unknown> }>) {
  return {
    vault: {
      getMarkdownFiles: () =>
        files.map((f) => ({ path: f.path, basename: f.path.replace(/.*\//, "").replace(/\.md$/, "") })),
    },
    metadataCache: {
      getFileCache: (f: { path: string }) => {
        const found = files.find((x) => x.path === f.path);
        return found ? { frontmatter: found.fm } : undefined;
      },
    },
  };
}

import { collectTaskInputs } from "@/services/tasks/collectTasks";

describe("collectTaskInputs", () => {
  it("returns inputs for type:task files only", () => {
    const app = makeApp([
      { path: "tasks/foo.md", fm: { type: "task", title: "Foo", status: "todo" } },
      { path: "notes/bar.md", fm: { type: "note", title: "Bar" } },
    ]) as any;
    const result = collectTaskInputs(app);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe("tasks/foo.md");
  });

  it("normalizes status with whitespace/hyphen variants", () => {
    const app = makeApp([
      { path: "tasks/a.md", fm: { type: "task", title: "A", status: "in-progress" } },
      { path: "tasks/b.md", fm: { type: "task", title: "B", status: "in progress" } },
    ]) as any;
    const result = collectTaskInputs(app);
    expect(result[0]?.status).toBe("in_progress");
    expect(result[1]?.status).toBe("in_progress");
  });

  it("counts blockedBy from blocked_by array length", () => {
    const app = makeApp([
      {
        path: "tasks/c.md",
        fm: { type: "task", title: "C", status: "todo", blocked_by: ["x", "y"] },
      },
    ]) as any;
    const result = collectTaskInputs(app);
    expect(result[0]?.blockedBy).toBe(2);
  });
});
