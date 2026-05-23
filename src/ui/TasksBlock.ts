// Fallback renderer + author modal for Sauce tasks (Tasks-plugin checkbox model,
// W4). When the Tasks community plugin is installed it owns rendering; this block
// is the no-dependency fallback and the authoring surface. Reuses sauce-cp-*
// styles (no new CSS).

import { Modal, Notice, Setting } from "obsidian";
import type SauceGraphPlugin from "../main";
import type {
  SauceTask,
  TaskStatus,
  TaskPriority,
} from "../services/TasksEmitter";

const STATUS_ORDER: TaskStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
];
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

export async function renderTasksBlock(
  el: HTMLElement,
  plugin: SauceGraphPlugin,
): Promise<void> {
  el.empty();
  el.addClass("sauce-cp-suggestions");
  const svc = plugin.tasks;
  if (!svc) {
    el.createEl("p", {
      cls: "sauce-cp-empty",
      text: "Tasks service not initialized.",
    });
    return;
  }

  const head = el.createDiv({ cls: "sauce-cp-sec" });
  const addBtn = head.createEl("button", {
    cls: "sauce-button",
    text: "+ Add task",
  });
  addBtn.onclick = () =>
    openAddTaskModal(plugin, () => void renderTasksBlock(el, plugin));

  const rows = await svc.listTasks();
  const byStatus = new Map<TaskStatus, typeof rows>();
  for (const r of rows) {
    const s = (
      r.task.status in STATUS_LABEL ? r.task.status : "todo"
    ) as TaskStatus;
    (byStatus.get(s) ?? byStatus.set(s, []).get(s)!).push(r);
  }
  if (!rows.length) {
    el.createEl("p", {
      cls: "sauce-cp-empty",
      text: "No tasks yet — add one above.",
    });
    return;
  }

  for (const status of STATUS_ORDER) {
    const group = byStatus.get(status);
    if (!group?.length) continue;
    const sec = el.createDiv({ cls: "sauce-cp-sec" });
    sec.createEl("h4", {
      cls: "sauce-cp-sec-title",
      text: `${STATUS_LABEL[status]} (${group.length})`,
    });
    for (const r of group) {
      const card = sec.createDiv({ cls: "sauce-cp-card" });
      const main = card.createDiv({ cls: "sauce-cp-card-main" });
      main.createEl("div", { cls: "sauce-cp-card-title", text: r.task.title });
      const meta = [
        r.task.contact ? `↔ ${r.task.contact}` : "",
        r.task.due ? `📅 ${r.task.due}` : "",
        r.task.priority ?? "",
      ]
        .filter(Boolean)
        .join("  ·  ");
      if (meta) main.createEl("div", { cls: "sauce-cp-card-sub", text: meta });
      const done = status !== "done" && status !== "cancelled";
      const btn = card.createEl("button", {
        cls: "sauce-button sauce-button-secondary",
        text: done ? "Done" : "Reopen",
      });
      btn.onclick = async () => {
        await svc.setStatus(r.path, r.line, done ? "done" : "todo");
        await renderTasksBlock(el, plugin);
      };
    }
  }
}

export function openAddTaskModal(
  plugin: SauceGraphPlugin,
  onAdded?: () => void,
): void {
  const draft: SauceTask = { title: "", status: "todo" };
  const m = new Modal(plugin.app);
  m.modalEl.addClass("sauce-modal");
  m.titleEl.setText("Add task");
  const c = m.contentEl.createDiv({ cls: "sauce-section" });

  new Setting(c).setName("Task").addText((t) =>
    t.setPlaceholder("What needs doing?").onChange((v) => {
      draft.title = v;
    }),
  );
  new Setting(c).setName("Due (YYYY-MM-DD)").addText((t) =>
    t.setPlaceholder("optional").onChange((v) => {
      draft.due = v || undefined;
    }),
  );
  new Setting(c).setName("Priority").addDropdown((d) => {
    d.addOption("", "(none)");
    for (const p of ["low", "medium", "high", "urgent"]) d.addOption(p, p);
    d.onChange((v) => {
      draft.priority = (v || undefined) as TaskPriority | undefined;
    });
  });
  new Setting(c)
    .setName("Contact")
    .setDesc("Linked as [[contact]].")
    .addText((t) =>
      t.setPlaceholder("optional").onChange((v) => {
        draft.contact = v || undefined;
      }),
    );

  new Setting(c).addButton((b) =>
    b
      .setButtonText("Add")
      .setCta()
      .onClick(async () => {
        if (!draft.title.trim()) {
          new Notice("Task text is required");
          return;
        }
        try {
          await plugin.tasks?.addTask(draft);
          new Notice("Task added to _TASKS.md");
        } catch (e) {
          new Notice(
            `Add failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        m.close();
        onAdded?.();
      }),
  );
  m.open();
}
