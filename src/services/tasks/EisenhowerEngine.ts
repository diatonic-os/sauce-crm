// Pure Eisenhower Matrix scoring engine — no Obsidian dependencies.
// Urgency comes from due-date proximity; Importance from priority enum ×
// linked-contact closeness × whether this task is blocking others.

export type Quadrant = "do" | "schedule" | "delegate" | "eliminate";

export interface TaskInput {
  path: string;
  title: string;
  status: string;
  due: string | null;
  priority: string | null;
  contact: string | null;
  blockedBy: number;
}

export interface Scored {
  input: TaskInput;
  urgency: number;
  importance: number;
  quadrant: Quadrant;
  score: number;
}

export const URGENT_THRESHOLD = 0.5;
export const IMPORTANT_THRESHOLD = 0.5;

const DONE = new Set(["done", "cancelled"]);

export function urgencyOf(t: TaskInput, now: Date): number {
  if (DONE.has(t.status)) return 0;
  if (!t.due) return 0.2; // undated → mild background urgency
  const days = Math.floor(
    (Date.parse(t.due + "T00:00:00Z") - now.getTime()) / 86_400_000,
  );
  if (days <= 0) return 1; // due today or overdue
  return Math.max(0, Math.min(1, 1 - days / 14)); // linear decay over 2-week horizon
}

const PRIO: Record<string, number> = {
  urgent: 1,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
};

export function importanceOf(t: TaskInput, closeness: number): number {
  if (DONE.has(t.status)) return 0;
  const p = PRIO[t.priority ?? "medium"] ?? 0.5; // 0.25..1
  const c = Math.max(0, Math.min(1, closeness / 5)); // 0..1
  const blocker = t.blockedBy > 0 ? 0.15 : 0; // a task blocking others matters more
  return Math.max(0, Math.min(1, 0.6 * p + 0.25 * c + blocker));
}

export function quadrantOf(u: number, i: number): Quadrant {
  const U = u >= URGENT_THRESHOLD;
  const I = i >= IMPORTANT_THRESHOLD;
  return U && I ? "do" : !U && I ? "schedule" : U && !I ? "delegate" : "eliminate";
}

export function scoreTasks(
  tasks: TaskInput[],
  closenessOf: (c: string | null) => number,
  now: Date,
): Scored[] {
  return tasks
    .filter((t) => !DONE.has(t.status))
    .map((t) => {
      const u = urgencyOf(t, now);
      const i = importanceOf(t, closenessOf(t.contact));
      return {
        input: t,
        urgency: u,
        importance: i,
        quadrant: quadrantOf(u, i),
        score: 0.6 * u + 0.4 * i,
      };
    })
    .sort((a, b) => b.score - a.score);
}
