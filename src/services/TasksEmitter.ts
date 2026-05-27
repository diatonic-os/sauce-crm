// Tasks ↔ Tasks-community-plugin checkbox bridge (VAULT-WORKSPACE-SPEC W4).
//
// Per operator decision, Sauce emits tasks as Tasks-plugin-native checkbox lines
// in _Tasks notes, so that plugin's queries/UI own them — and Sauce reads the
// same lines back. This module is the pure, round-trippable encoder/decoder
// (no Obsidian deps). All regexes are linear / anchored (no ReDoS).

export type TaskStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface SauceTask {
  title: string;
  status: TaskStatus;
  due?: string; // YYYY-MM-DD
  priority?: TaskPriority;
  contact?: string; // bare name; rendered as [[contact]]
  tags?: string[]; // without leading '#'
}

// Status ⇄ checkbox char. `[/]`=in progress, `[!]`=blocked, `[-]`=cancelled are
// the de-facto Tasks-plugin / theme conventions.
const STATUS_TO_CHAR: Record<TaskStatus, string> = {
  todo: " ",
  in_progress: "/",
  blocked: "!",
  done: "x",
  cancelled: "-",
};
const CHAR_TO_STATUS: Record<string, TaskStatus> = {
  " ": "todo",
  "/": "in_progress",
  "!": "blocked",
  x: "done",
  X: "done",
  "-": "cancelled",
};

// Priority ⇄ Tasks-plugin emoji.
const PRIORITY_TO_EMOJI: Record<TaskPriority, string> = {
  urgent: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
};
const EMOJI_TO_PRIORITY: Record<string, TaskPriority> = {
  "🔺": "urgent",
  "⏫": "high",
  "🔼": "medium",
  "🔽": "low",
  "⏬": "low",
};

const CHECKBOX_RE = /^(\s*)[-*]\s+\[(.)\]\s+(.*)$/;
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const PRIORITY_RE = /(🔺|⏫|🔼|🔽|⏬)/;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/;
const TAG_RE = /(?:^|\s)#([A-Za-z0-9][\w/-]*)/g;

/** Render a Sauce task to a single Tasks-plugin checkbox line. */
export function toCheckbox(t: SauceTask, indent = ""): string {
  const parts = [t.title.trim()];
  if (t.contact) parts.push(`[[${t.contact}]]`);
  if (t.priority && PRIORITY_TO_EMOJI[t.priority])
    parts.push(PRIORITY_TO_EMOJI[t.priority]);
  if (t.due) parts.push(`📅 ${t.due}`);
  for (const tag of t.tags ?? []) parts.push(`#${tag.replace(/^#/, "")}`);
  return `${indent}- [${STATUS_TO_CHAR[t.status]}] ${parts.join(" ")}`;
}

/** Parse a checkbox line back to a Sauce task, or null if it isn't a task. */
export function parseCheckbox(line: string): SauceTask | null {
  const m = line.match(CHECKBOX_RE);
  if (!m) return null;
  // CHECKBOX_RE has 3 capture groups; all are defined when m is non-null.
  const charCap = m[2] ?? "";
  const status = CHAR_TO_STATUS[charCap] ?? "todo";
  let rest = m[3] ?? "";

  const due = rest.match(DUE_RE)?.[1];
  const pr = rest.match(PRIORITY_RE)?.[1];
  const priority = pr ? EMOJI_TO_PRIORITY[pr] : undefined;
  const contact = rest.match(WIKILINK_RE)?.[1]?.trim();
  const tags: string[] = [];
  for (const t of rest.matchAll(TAG_RE)) {
    const tag = t[1];
    if (tag !== undefined) tags.push(tag);
  }

  // Strip metadata to recover the title.
  rest = rest
    .replace(DUE_RE, "")
    .replace(PRIORITY_RE, "")
    .replace(WIKILINK_RE, "")
    .replace(TAG_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const task: SauceTask = { title: rest, status };
  if (due) task.due = due;
  if (priority) task.priority = priority;
  if (contact) task.contact = contact;
  if (tags.length) task.tags = tags;
  return task;
}

/** Swap the checkbox char on a task line to reflect a new status, preserving
 *  the rest of the line (metadata, indentation) exactly. No-op if not a task. */
export function setLineStatus(line: string, status: TaskStatus): string {
  if (!CHECKBOX_RE.test(line)) return line;
  return line.replace(/^(\s*[-*]\s+\[).(\])/, `$1${STATUS_TO_CHAR[status]}$2`);
}

/** Parse every task line in a block of markdown (with 1-based line numbers). */
export function parseTasksFromText(
  text: string,
): { task: SauceTask; line: number }[] {
  const out: { task: SauceTask; line: number }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineStr = lines[i];
    if (lineStr === undefined) continue; // in-bounds: for-loop over lines.length
    const task = parseCheckbox(lineStr);
    if (task) out.push({ task, line: i + 1 });
  }
  return out;
}
