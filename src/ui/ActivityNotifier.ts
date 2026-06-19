// Realtime activity toasts — the top-right Obsidian Notices that tell the user
// what SauceOM is doing right now: an agent starting, an index/brain check, an
// incremental update, or any background task. A live task shows a persistent
// "⏳ …" toast that updates in place and resolves to "✓ …" / "⚠ …" then fades,
// so the user always has clear, honest feedback instead of silent background work.

import { Notice } from "obsidian";

/** A single live activity toast. Persistent until succeed()/fail(). */
export class ActivityHandle {
  private notice: Notice;
  private settled = false;

  constructor(label: string) {
    // timeout 0 ⇒ the toast stays until we hide it (the task is in progress).
    this.notice = new Notice(`⏳ ${label}`, 0);
  }

  /** Update the in-progress message in place (e.g. per-file progress). */
  update(label: string): void {
    if (!this.settled) this.notice.setMessage(`⏳ ${label}`);
  }

  /** Resolve as success; the toast switches to "✓ …" and fades after `ms`. */
  succeed(label: string, ms = 4000): void {
    this.finish(`✓ ${label}`, ms);
  }

  /** Resolve as failure; the toast switches to "⚠ …" and lingers longer. */
  fail(label: string, ms = 6000): void {
    this.finish(`⚠ ${label}`, ms);
  }

  private finish(text: string, ms: number): void {
    if (this.settled) return;
    this.settled = true;
    this.notice.setMessage(text);
    window.setTimeout(() => this.notice.hide(), ms);
  }
}

/**
 * The activity API. `start()` opens a live toast for an in-progress task;
 * `info()` is a one-shot toast for an instantaneous event. Both render in
 * Obsidian's top-right notice stack — the same surface as the plugin-reload
 * toast — so all background lifecycle events use one consistent channel.
 */
export const activity = {
  start(label: string): ActivityHandle {
    return new ActivityHandle(label);
  },
  info(message: string, ms = 4000): void {
    new Notice(message, ms);
  },
};
