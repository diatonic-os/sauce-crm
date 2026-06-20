// Shared task-collection logic. Scans the vault for `type:task`
// frontmatter and returns TaskInput[] suitable for EisenhowerEngine.
// Mirrors the status-normalisation in TasksView.collectTaskRows.

import type { App } from "obsidian";
import type { TaskInput } from "./EisenhowerEngine";

export function collectTaskInputs(app: App): TaskInput[] {
  const out: TaskInput[] = [];
  const cache = app.metadataCache;
  for (const f of app.vault.getMarkdownFiles()) {
    const fm = cache.getFileCache(f)?.frontmatter as
      | Record<string, unknown>
      | undefined;
    if (!fm || fm["type"] !== "task") continue;
    const rawStatus = fm["status"];
    const status =
      typeof rawStatus === "string"
        ? rawStatus
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, "_") || "todo"
        : "todo";
    const due =
      typeof fm["due"] === "string"
        ? fm["due"]
        : fm["due"] instanceof Date
          ? fm["due"].toISOString().slice(0, 10)
          : null;
    const priority =
      typeof fm["priority"] === "string" ? fm["priority"] : null;
    const contact =
      typeof fm["contact"] === "string" ? fm["contact"] : null;
    const blockedBy = Array.isArray(fm["blocked_by"])
      ? fm["blocked_by"].length
      : 0;
    const title =
      typeof fm["title"] === "string" ? fm["title"] : f.basename;
    out.push({ path: f.path, title, status, due, priority, contact, blockedBy });
  }
  return out;
}
