// SPEC §34.2 — Cron-ish wall-clock + reactive scheduler. Coalesces overlap; backoff on failure.
import type { SyncFrequency } from "../integrations/IIntegration";

export interface ScheduledJob {
  id: string;
  integration: string;
  resource: string;
  frequency: SyncFrequency;
  run: () => Promise<void>;
}

function freqMs(f: SyncFrequency): number {
  switch (f) {
    case "realtime":
      return 0;
    case "1m":
      return 60_000;
    case "5m":
      return 300_000;
    case "15m":
      return 900_000;
    case "1h":
      return 3_600_000;
    case "6h":
      return 21_600_000;
    case "daily":
      return 86_400_000;
    case "manual":
      return Infinity;
  }
}

interface RunState {
  lastRun: number;
  nextRun: number;
  running: boolean;
  failures: number;
  lastError: string | null;
}

export class Scheduler {
  private jobs = new Map<string, ScheduledJob>();
  private state = new Map<string, RunState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  add(job: ScheduledJob): void {
    this.jobs.set(job.id, job);
    if (!this.state.has(job.id))
      this.state.set(job.id, {
        lastRun: 0,
        nextRun: Date.now() + freqMs(job.frequency),
        running: false,
        failures: 0,
        lastError: null,
      });
  }
  remove(id: string): void {
    this.jobs.delete(id);
    this.state.delete(id);
  }

  start(tickMs = 10_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), tickMs);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runNow(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`no job: ${id}`);
    await this.runJob(job);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      const s = this.state.get(id)!;
      if (s.running || job.frequency === "manual") continue;
      if (now >= s.nextRun) await this.runJob(job);
    }
  }

  private async runJob(job: ScheduledJob): Promise<void> {
    const s = this.state.get(job.id)!;
    s.running = true;
    try {
      await job.run();
      s.lastRun = Date.now();
      s.failures = 0;
      s.lastError = null;
      s.nextRun = Date.now() + freqMs(job.frequency);
    } catch (e) {
      s.failures += 1;
      s.lastError = e instanceof Error ? e.message : String(e);
      const backoff = Math.min(3_600_000, 30_000 * Math.pow(2, s.failures - 1));
      s.nextRun = Date.now() + backoff;
    } finally {
      s.running = false;
    }
  }

  status(id: string): RunState | null {
    return this.state.get(id) ?? null;
  }
  all(): { job: ScheduledJob; state: RunState }[] {
    return [...this.jobs.values()].map((job) => ({
      job,
      state: this.state.get(job.id)!,
    }));
  }
}
