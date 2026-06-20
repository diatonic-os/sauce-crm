// Shared types for the Svelte dashboard family. Keeping them in a
// plain .ts file means TS sees them cleanly from both the .svelte
// component side and the host ItemView side without needing svelte
// type-shim plumbing.

import type { Quadrant } from "@/services/tasks/EisenhowerEngine";

export interface TaskRow {
  path: string;
  title: string;
  status: "todo" | "in_progress" | "blocked" | "done" | "cancelled" | string;
  due?: string;
  priority?: "low" | "medium" | "high" | "urgent" | string;
  contact?: string;
  tags?: string[];
  quadrant?: Quadrant;
}

export interface InboxRow {
  path: string;
  kind: "touch" | "followup";
  date: string; // YYYY-MM-DD
  contact: string;
  label: string;
  /** Days from today; negative = overdue, 0 = today, positive = future. */
  daysFromToday: number;
}
