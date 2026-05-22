import type { DataAdapter } from "obsidian";
import { LogEvent, TelemetryEvent } from "./types";

const DEFAULT_SINK_PATH = ".sauce/memory/TRACE-LOG.jsonl";
const RING_BUFFER_SIZE = 1000;

type AnyEvent = LogEvent | TelemetryEvent;

/**
 * JSONL telemetry sink. Tries the Obsidian DataAdapter first (durable, lands
 * in the vault). Falls back to an in-memory ring buffer when the adapter is
 * missing or throws (e.g. unit tests under jsdom). Buffer survives in memory
 * until process exit and is queryable via `drain()`.
 */
export class TelemetrySink {
  private readonly adapter: DataAdapter | null;
  private readonly sinkPath: string;
  private readonly ring: AnyEvent[] = [];
  private writeChain: Promise<void> = Promise.resolve();
  private ensured = false;

  constructor(adapter: DataAdapter | null | undefined, sinkPath: string = DEFAULT_SINK_PATH) {
    this.adapter = adapter ?? null;
    this.sinkPath = sinkPath;
  }

  emit(event: AnyEvent): void {
    // Always update the in-memory ring (single source of truth for tests).
    this.ring.push(event);
    if (this.ring.length > RING_BUFFER_SIZE) this.ring.shift();
    if (!this.adapter) return;
    // Serialize disk writes; emit() stays sync from the caller's POV.
    this.writeChain = this.writeChain.then(() => this.appendOne(event)).catch(() => undefined);
  }

  private async appendOne(event: AnyEvent): Promise<void> {
    if (!this.adapter) return;
    try {
      if (!this.ensured) {
        const dir = this.sinkPath.replace(/\/[^/]*$/, "");
        if (dir && !(await this.adapter.exists(dir))) {
          await this.adapter.mkdir(dir);
        }
        this.ensured = true;
      }
      const line = JSON.stringify(event) + "\n";
      const existed = await this.adapter.exists(this.sinkPath);
      const prior = existed ? await this.adapter.read(this.sinkPath) : "";
      await this.adapter.write(this.sinkPath, prior + line);
    } catch {
      // Stay silent on disk failure — ring buffer already captured the event.
    }
  }

  /** Test helper. Returns a copy of the in-memory ring. */
  drain(): AnyEvent[] {
    return this.ring.slice();
  }

  /** Wait for any pending disk writes to settle. */
  async flush(): Promise<void> {
    await this.writeChain;
  }
}
