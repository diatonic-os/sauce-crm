// SPEC §S3/§S5 — SkillTaskScheduler. Reads skill-bound tasks, computes
// next_run (via Cron.nextAfter or interval), and calls SkillRuntime.run()
// when due. Persists last_run/next_run back to the task source so state
// survives reload.
//
// Injected dependencies make this unit-testable without Obsidian.

import { nextAfter } from "../sync/Cron";
import type { SkillRuntime } from "../skills/SkillRuntime";
import type { SkillResult } from "../skills/index";

/** Minimum interface for a task with skill schedule fields. */
export interface SkillTask {
  id: string;
  skill_id: string;
  skill_args?: Record<string, unknown>;
  /** "manual" | "interval:<freq>" | "cron:<expr>" */
  schedule: string;
  last_run?: string; // ISO-8601
  next_run?: string; // ISO-8601
  autonomy?: "propose" | "confirm-each" | "confirm-bulk" | "autonomous";
}

/** Persist state back after a run (or on first scheduling). */
export interface SkillTaskPersister {
  updateScheduleState(
    taskId: string,
    patch: { last_run?: string; next_run?: string },
  ): Promise<void>;
}

/** Source of skill-bound tasks. */
export interface SkillTaskSource {
  listSkillTasks(): Promise<SkillTask[]>;
}

/** Clock abstraction — injected so tests can control time. */
export type ClockFn = () => Date;

/** Interval freq string → milliseconds map (mirrors Scheduler.freqMs). */
const FREQ_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "6h": 21_600_000,
  daily: 86_400_000,
};

/** Parse a schedule string and compute the next Date after `from`. */
export function computeNextRun(schedule: string, from: Date): Date | null {
  if (schedule === "manual") return null;

  if (schedule.startsWith("interval:")) {
    const freq = schedule.slice("interval:".length);
    const ms = FREQ_MS[freq];
    if (!ms) return null;
    return new Date(from.getTime() + ms);
  }

  if (schedule.startsWith("cron:")) {
    const expr = schedule.slice("cron:".length);
    return nextAfter(expr, from);
  }

  return null;
}

export class SkillTaskScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = new Set<string>();

  constructor(
    private readonly runtime: Pick<SkillRuntime, "run">,
    private readonly source: SkillTaskSource,
    private readonly persister: SkillTaskPersister,
    private readonly clock: ClockFn = () => new Date(),
  ) {}

  start(tickMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), tickMs);
    // Run once immediately on start so we don't wait a full tick.
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Exposed for tests and manual triggers. */
  async tick(): Promise<void> {
    const now = this.clock();
    let tasks: SkillTask[];
    try {
      tasks = await this.source.listSkillTasks();
    } catch {
      return; // source unavailable — skip tick silently
    }

    for (const task of tasks) {
      if (this.running.has(task.id)) continue;
      if (task.schedule === "manual") continue;

      // Compute or restore next_run.
      const nextRunStr = task.next_run;
      let nextRun: Date | null = nextRunStr ? new Date(nextRunStr) : null;

      if (!nextRun || isNaN(nextRun.getTime())) {
        // First scheduling — compute from now.
        nextRun = computeNextRun(task.schedule, now);
        if (nextRun) {
          await this.persister.updateScheduleState(task.id, {
            next_run: nextRun.toISOString(),
          });
        }
        continue; // Don't run on first setup tick.
      }

      if (now >= nextRun) {
        await this.runTask(task, now);
      }
    }
  }

  private async runTask(task: SkillTask, now: Date): Promise<void> {
    this.running.add(task.id);
    let result: SkillResult;
    try {
      result = await this.runtime.run(task.skill_id, task.skill_args ?? {}, {
        autonomyOverride: task.autonomy,
        agentId: `$scheduler/task-${task.id}`,
        trigger: "scheduled",
        taskId: task.id,
      });
    } catch (e) {
      result = {
        ok: false,
        reason: `scheduler threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    } finally {
      this.running.delete(task.id);
    }

    // Always persist last_run + advance next_run, even on failure.
    const lastRunIso = now.toISOString();
    const nextRun = computeNextRun(task.schedule, now);
    const patch: { last_run: string; next_run?: string } = {
      last_run: lastRunIso,
    };
    if (nextRun) patch.next_run = nextRun.toISOString();

    try {
      await this.persister.updateScheduleState(task.id, patch);
    } catch {
      /* persist failure is non-fatal */
    }

    void result; // result surfaced via SkillRuntime's ring buffer
  }
}
