// Boot-timing instrumentation (Phase-A boot optimization).
//
// A near-zero-overhead stopwatch that records named segments of the plugin
// boot path (onload + initV2 + the post-layout block). It only stores a few
// `performance.now()` timestamps and computes durations on demand. The report
// is logged once at onload end and once after the onLayoutReady block, and is
// also surfaceable via the "Sauce CRM: Show boot timing" command.

export interface BootSegment {
  name: string;
  ms: number;
}

export interface BootReport {
  segments: BootSegment[];
  totalMs: number;
  /** Phase the report was captured at: "onload" or "post-layout". */
  phase: string;
}

/** Monotonic clock. Falls back to Date.now() if performance is unavailable
 *  (e.g. a minimal test runtime). */
function nowMs(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf?.now ? perf.now() : Date.now();
}

export class BootTimer {
  private readonly t0: number;
  private last: number;
  private readonly segments: BootSegment[] = [];
  private lastReport: BootReport | null = null;

  constructor() {
    this.t0 = nowMs();
    this.last = this.t0;
  }

  /** Close the current segment under `name`, measuring from the previous mark
   *  (or boot start for the first call). */
  mark(name: string): void {
    const t = nowMs();
    this.segments.push({ name, ms: round(t - this.last) });
    this.last = t;
  }

  /** Build (and remember) a report snapshot for the given phase. Does not
   *  reset the accumulated segments — post-layout marks append to the same
   *  list so the final report is cumulative. */
  report(phase: string): BootReport {
    const r: BootReport = {
      segments: this.segments.map((s) => ({ ...s })),
      totalMs: round(nowMs() - this.t0),
      phase,
    };
    this.lastReport = r;
    return r;
  }

  /** The most recent report produced by report(), or null if none yet. */
  getLastReport(): BootReport | null {
    return this.lastReport;
  }

  /** One-line human summary, e.g. "post-layout 842ms | settings-load 12, v2-init 410, …". */
  static format(r: BootReport): string {
    const parts = r.segments.map((s) => `${s.name} ${s.ms}`).join(", ");
    return `${r.phase} ${r.totalMs}ms | ${parts}`;
  }
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}
