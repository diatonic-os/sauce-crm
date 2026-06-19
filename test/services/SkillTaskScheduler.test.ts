import { describe, expect, it, vi } from "vitest";
import {
  SkillTaskScheduler,
  computeNextRun,
  type SkillTask,
  type SkillTaskSource,
  type SkillTaskPersister,
} from "../../src/services/SkillTaskScheduler";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<SkillTask> = {}): SkillTask {
  return {
    id: "task-1",
    skill_id: "summarize-week",
    skill_args: { depth: 1 },
    schedule: "interval:1h",
    ...overrides,
  };
}

function makeSource(tasks: SkillTask[]): SkillTaskSource {
  return { listSkillTasks: async () => tasks };
}

function makePersister(): SkillTaskPersister & {
  calls: { taskId: string; patch: { last_run?: string; next_run?: string } }[];
} {
  const calls: {
    taskId: string;
    patch: { last_run?: string; next_run?: string };
  }[] = [];
  return {
    calls,
    updateScheduleState: async (taskId, patch) => {
      calls.push({ taskId, patch });
    },
  };
}

// ── computeNextRun unit tests ──────────────────────────────────────────────

describe("computeNextRun", () => {
  it("returns null for manual schedule", () => {
    expect(computeNextRun("manual", new Date())).toBeNull();
  });

  it("returns null for unknown interval", () => {
    expect(computeNextRun("interval:unknown", new Date())).toBeNull();
  });

  it("interval:1h → adds 3600 s", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const next = computeNextRun("interval:1h", from)!;
    expect(next.getTime() - from.getTime()).toBe(3_600_000);
  });

  it("interval:5m → adds 300 s", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const next = computeNextRun("interval:5m", from)!;
    expect(next.getTime() - from.getTime()).toBe(300_000);
  });

  it("cron:*/15 * * * * → returns a Date strictly after from", () => {
    const from = new Date("2026-01-01T14:00:00Z");
    const next = computeNextRun("cron:*/15 * * * *", from)!;
    expect(next > from).toBe(true);
    expect(next).toBeInstanceOf(Date);
  });

  it("returns null for unrecognised prefix", () => {
    expect(computeNextRun("weekly:monday", new Date())).toBeNull();
  });
});

// ── SkillTaskScheduler ────────────────────────────────────────────────────

describe("SkillTaskScheduler", () => {
  it("runs a due skill with {trigger:'scheduled', taskId}", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const past = new Date(now.getTime() - 1000).toISOString();

    const task = makeTask({ next_run: past });
    const source = makeSource([task]);
    const persister = makePersister();

    const runMock = vi.fn().mockResolvedValue({ ok: true, mutated: [] });
    const runtime = { run: runMock } as any;

    const scheduler = new SkillTaskScheduler(
      runtime,
      source,
      persister,
      () => now,
    );
    await scheduler.tick();

    expect(runMock).toHaveBeenCalledOnce();
    const [skillId, args, opts] = runMock.mock.calls[0];
    expect(skillId).toBe("summarize-week");
    expect(args).toEqual({ depth: 1 });
    // trigger and taskId are set (S3/S5 spec)
    expect(opts.trigger).toBe("scheduled");
    expect(opts.taskId).toBe("task-1");
    // agentId contains the task id
    expect(String(opts.agentId)).toContain("task-1");
  });

  it("calls runtime with trigger in agentId (scheduler prefix)", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const past = new Date(now.getTime() - 1000).toISOString();
    const task = makeTask({ next_run: past });

    const runMock = vi.fn().mockResolvedValue({ ok: true, mutated: [] });
    const scheduler = new SkillTaskScheduler(
      { run: runMock } as any,
      makeSource([task]),
      makePersister(),
      () => now,
    );
    await scheduler.tick();

    const [, , opts] = runMock.mock.calls[0];
    expect(opts.agentId).toMatch(/scheduler/);
  });

  it("does NOT run a task that is not yet due", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const future = new Date(now.getTime() + 60_000).toISOString();
    const task = makeTask({ next_run: future });

    const runMock = vi.fn();
    const scheduler = new SkillTaskScheduler(
      { run: runMock } as any,
      makeSource([task]),
      makePersister(),
      () => now,
    );
    await scheduler.tick();

    expect(runMock).not.toHaveBeenCalled();
  });

  it("skips manual tasks", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const task = makeTask({ schedule: "manual", next_run: undefined });

    const runMock = vi.fn();
    const scheduler = new SkillTaskScheduler(
      { run: runMock } as any,
      makeSource([task]),
      makePersister(),
      () => now,
    );
    await scheduler.tick();

    expect(runMock).not.toHaveBeenCalled();
  });

  it("persists last_run and next_run after a successful run", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const past = new Date(now.getTime() - 1000).toISOString();
    const task = makeTask({ schedule: "interval:1h", next_run: past });

    const persister = makePersister();
    const scheduler = new SkillTaskScheduler(
      { run: vi.fn().mockResolvedValue({ ok: true, mutated: [] }) } as any,
      makeSource([task]),
      persister,
      () => now,
    );
    await scheduler.tick();

    const runPersists = persister.calls.filter((c) => c.patch.last_run);
    expect(runPersists.length).toBeGreaterThan(0);
    const last = runPersists[runPersists.length - 1];
    expect(last.patch.last_run).toBe(now.toISOString());
    expect(last.patch.next_run).toBeDefined();

    // next_run should be 1h after now
    const nextRunMs = new Date(last.patch.next_run!).getTime();
    expect(nextRunMs - now.getTime()).toBe(3_600_000);
  });

  it("persists last_run even when the skill run fails", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const past = new Date(now.getTime() - 1000).toISOString();
    const task = makeTask({ next_run: past });

    const persister = makePersister();
    const scheduler = new SkillTaskScheduler(
      {
        run: vi.fn().mockRejectedValue(new Error("skill exploded")),
      } as any,
      makeSource([task]),
      persister,
      () => now,
    );
    await scheduler.tick();

    const runPersists = persister.calls.filter((c) => c.patch.last_run);
    expect(runPersists.length).toBeGreaterThan(0);
  });

  it("initialises next_run on first tick (no next_run set)", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const task = makeTask({ next_run: undefined });

    const runMock = vi.fn();
    const persister = makePersister();
    const scheduler = new SkillTaskScheduler(
      { run: runMock } as any,
      makeSource([task]),
      persister,
      () => now,
    );
    await scheduler.tick();

    // Should NOT run on first setup tick, but should persist next_run.
    expect(runMock).not.toHaveBeenCalled();
    const setupCalls = persister.calls.filter(
      (c) => c.patch.next_run && !c.patch.last_run,
    );
    expect(setupCalls.length).toBeGreaterThan(0);
  });

  it("passes autonomyOverride from task.autonomy", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const past = new Date(now.getTime() - 1000).toISOString();
    const task = makeTask({ next_run: past, autonomy: "autonomous" });

    const runMock = vi.fn().mockResolvedValue({ ok: true, mutated: [] });
    const scheduler = new SkillTaskScheduler(
      { run: runMock } as any,
      makeSource([task]),
      makePersister(),
      () => now,
    );
    await scheduler.tick();

    const [, , opts] = runMock.mock.calls[0];
    expect(opts.autonomyOverride).toBe("autonomous");
  });
});
