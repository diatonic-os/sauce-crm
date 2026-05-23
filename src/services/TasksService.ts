// Reads/writes tasks as Tasks-plugin checkbox lines in the _Tasks note(s)
// (VAULT-WORKSPACE-SPEC W4). The Tasks community plugin owns querying/rendering;
// Sauce owns authoring + status changes. Encoding lives in TasksEmitter.

import type { App } from "obsidian";
import { toCheckbox, parseTasksFromText, setLineStatus, type SauceTask } from "./TasksEmitter";

export interface TaskRef {
  task: SauceTask;
  path: string;
  line: number; // 1-based
}

export class TasksService {
  constructor(private readonly app: App, private readonly tasksPath = "_TASKS.md") {}

  /** All tasks across the tasks note + any note under a _Tasks/ folder. */
  async listTasks(): Promise<TaskRef[]> {
    const out: TaskRef[] = [];
    for (const path of await this.taskFiles()) {
      const text = await this.read(path);
      if (text == null) continue;
      for (const { task, line } of parseTasksFromText(text)) out.push({ task, path, line });
    }
    return out;
  }

  /** Append a task as a Tasks-plugin checkbox to the tasks note (creates it). */
  async addTask(task: SauceTask): Promise<void> {
    const cur = (await this.read(this.tasksPath)) ?? "# Tasks\n";
    const sep = cur.endsWith("\n") ? "" : "\n";
    await this.write(this.tasksPath, `${cur}${sep}${toCheckbox(task)}\n`);
  }

  /** Flip a task line's status, preserving its other metadata. */
  async setStatus(path: string, line: number, status: SauceTask["status"]): Promise<void> {
    const text = await this.read(path);
    if (text == null) return;
    const lines = text.split("\n");
    if (line < 1 || line > lines.length) return;
    lines[line - 1] = setLineStatus(lines[line - 1], status);
    await this.write(path, lines.join("\n"));
  }

  private async taskFiles(): Promise<string[]> {
    const a = this.app.vault.adapter;
    const files = new Set<string>();
    if (await a.exists(this.tasksPath)) files.add(this.tasksPath);
    try {
      if (await a.exists("_Tasks")) {
        for (const f of (await a.list("_Tasks")).files) if (f.endsWith(".md")) files.add(f);
      }
    } catch { /* no _Tasks folder */ }
    return [...files];
  }

  private async read(path: string): Promise<string | null> {
    try {
      return (await this.app.vault.adapter.exists(path)) ? await this.app.vault.adapter.read(path) : null;
    } catch { return null; }
  }
  private async write(path: string, text: string): Promise<void> {
    await this.app.vault.adapter.write(path, text);
  }
}
