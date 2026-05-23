// MOB-BRIDGE-001 · T-F — CaptureQueue.
//
// Offline quick-capture that rides Obsidian Sync. When mobile is offline (or
// always, since this path is cheap and deterministic) a quick-capture is:
//
//   1. written as markdown to the vault immediately — Obsidian Sync propagates
//      it to the desktop, which ingests it and back-fills embeddings;
//   2. recorded in a small queue (synced:false) for observability.
//
// `reconcile()` is a *bookkeeping* hook, NOT a network call: desktop ingest is
// fire-and-forget via Sync. If the captured file still exists in the vault we
// treat the capture as delivered (synced:true) and prune synced items older
// than a retention window.
//
// Mobile-safe: NO node builtins. The vault writer and queue store are injected.

/** Minimal vault surface. Prod binds this to Obsidian's vault adapter. */
export interface VaultWriter {
  write(path: string, contents: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** A single offline capture record. */
export interface QueuedCapture {
  id: string;
  path: string;
  markdown: string;
  /** unix-ms when the capture was enqueued. */
  ts: number;
  /** true once reconcile() has observed the file present (delivered via Sync). */
  synced: boolean;
}

/** Persistence for the queue. Prod binds this to a synced JSON / localStorage. */
export interface QueueStore {
  load(): Promise<QueuedCapture[]>;
  save(q: QueuedCapture[]): Promise<void>;
}

export interface CaptureQueueDeps {
  vault: VaultWriter;
  store: QueueStore;
  /** prune synced items older than this many ms; default 7 days. */
  retentionMs?: number;
  /** injectable clock for tests; default Date.now. */
  now?: () => number;
  /** injectable id generator for tests; default ts+random. */
  genId?: () => string;
}

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class CaptureQueue {
  private readonly vault: VaultWriter;
  private readonly store: QueueStore;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private readonly genId: () => string;

  constructor(deps: CaptureQueueDeps) {
    this.vault = deps.vault;
    this.store = deps.store;
    this.retentionMs = deps.retentionMs ?? DEFAULT_RETENTION_MS;
    this.now = deps.now ?? (() => Date.now());
    this.genId =
      deps.genId ??
      (() => `${this.now()}-${Math.random().toString(36).slice(2, 10)}`);
  }

  /** Write the markdown to the vault path immediately (Obsidian Sync delivers it
   *  to the desktop) AND record a pending QueuedCapture. Returns the record. */
  async enqueue(path: string, markdown: string): Promise<QueuedCapture> {
    // Write first: if Sync delivery is going to happen, the file is the payload.
    await this.vault.write(path, markdown);

    const record: QueuedCapture = {
      id: this.genId(),
      path,
      markdown,
      ts: this.now(),
      synced: false,
    };

    const queue = await this.store.load();
    queue.push(record);
    await this.store.save(queue);

    return record;
  }

  /** Bookkeeping pass (no network): mark still-present captures as synced, then
   *  prune synced items older than the retention window. Returns the pruned,
   *  persisted queue. */
  async reconcile(): Promise<QueuedCapture[]> {
    const queue = await this.store.load();

    for (const item of queue) {
      if (!item.synced) {
        const present = await this.vault.exists(item.path);
        if (present) {
          item.synced = true;
        }
      }
    }

    const cutoff = this.now() - this.retentionMs;
    const kept = queue.filter((item) => !(item.synced && item.ts < cutoff));

    await this.store.save(kept);
    return kept;
  }

  /** Queued items not yet observed as delivered. */
  async pending(): Promise<QueuedCapture[]> {
    const queue = await this.store.load();
    return queue.filter((item) => !item.synced);
  }
}
