// Round-trip tests for the new skill/schedule fields added to TaskFrontmatter (F3).
import { describe, expect, it } from "vitest";
import {
  TaskSchema,
  type TaskFrontmatter,
} from "../../src/domain/schemas/index";

function validBase(): TaskFrontmatter {
  return { type: "task", title: "Do thing", status: "todo" };
}

describe("TaskFrontmatter — skill/schedule fields", () => {
  it("validates a plain task without the new fields (backwards compat)", () => {
    const r = TaskSchema.validate(validBase());
    expect(r.passed).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("validates a task with all new skill fields set", () => {
    const fm: TaskFrontmatter = {
      ...validBase(),
      skill_id: "summarize-week",
      skill_args: { depth: 2, tag: "q3" },
      schedule: "interval:1h",
      last_run: "2026-01-01T00:00:00.000Z",
      next_run: "2026-01-01T01:00:00.000Z",
      autonomy: "autonomous",
    };
    const r = TaskSchema.validate(fm);
    expect(r.passed).toBe(true);
  });

  it("parse returns the task including new fields when valid", () => {
    const fm: TaskFrontmatter = {
      ...validBase(),
      skill_id: "research-person",
      schedule: "cron:0 9 * * 1",
      autonomy: "propose",
    };
    const parsed = TaskSchema.parse(fm);
    expect(parsed).not.toBeNull();
    expect(parsed!.skill_id).toBe("research-person");
    expect(parsed!.schedule).toBe("cron:0 9 * * 1");
    expect(parsed!.autonomy).toBe("propose");
  });

  it("parse still returns null when a required field is missing", () => {
    const bad = { type: "task", status: "todo" } as unknown as TaskFrontmatter;
    expect(TaskSchema.parse(bad)).toBeNull();
  });

  it("round-trips a task with skill_args containing nested objects", () => {
    const fm: TaskFrontmatter = {
      ...validBase(),
      skill_id: "export-graph",
      skill_args: { format: "json", options: { pretty: true } },
    };
    const parsed = TaskSchema.parse(fm);
    expect(parsed!.skill_args).toEqual({
      format: "json",
      options: { pretty: true },
    });
  });
});
