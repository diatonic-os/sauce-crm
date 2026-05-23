import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  emitTasksModule,
  loadTasksSchema,
  type TasksSchema,
} from "./introspect-tasks";

const schema = loadTasksSchema(
  resolve(__dirname, "../../schemas/obsidian-tasks.json"),
);

describe("emitTasksModule (deterministic codegen)", () => {
  it("emits the apiV1 interface from the schema (A-006: the 3 documented methods)", () => {
    const src = emitTasksModule(schema);
    expect(src).toContain("createTaskLineModal(): Promise<string>;");
    expect(src).toContain(
      "editTaskLineModal(taskLine: string): Promise<string>;",
    );
    expect(src).toContain(
      "executeToggleTaskDoneCommand(line: string, path: string): string;",
    );
  });

  it("emits Filter/Sort/Group/Display union types from the Quick-Reference vocab", () => {
    const src = emitTasksModule(schema);
    expect(src).toContain("export type TasksFilter =");
    expect(src).toContain("export type TasksSort =");
    expect(src).toContain("export type TasksGroup =");
    expect(src).toContain("export type TasksDisplay =");
    expect(src).toContain('| "not done"');
  });

  it("is deterministic — identical input yields byte-identical output", () => {
    expect(emitTasksModule(schema)).toBe(emitTasksModule(schema));
  });

  it("sorts union members (stable regardless of schema array order)", () => {
    const shuffled: TasksSchema = {
      ...schema,
      sort: [...schema.sort].reverse(),
    };
    expect(emitTasksModule(shuffled)).toBe(emitTasksModule(schema));
  });

  it("the committed sdk/generated/tasks.ts matches emitTasksModule(schema) (sdk:check parity)", () => {
    const committed = readFileSync(
      resolve(__dirname, "../generated/tasks.ts"),
      "utf8",
    );
    expect(committed).toBe(emitTasksModule(schema));
  });
});
