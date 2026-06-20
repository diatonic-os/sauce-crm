// VaultEventBus — the event-driven automation seam (audit EV-04). Every vault
// change/delete/rename is published once as a typed event and fanned out to
// ORDERED subscribers (edges → mirror → embeddings → brain → views), so a
// delete or rename gets the same relational fan-out a change does — closing the
// gap where delete/rename bypassed edge reciprocity (EV-01). Subscribers declare
// which event kinds they handle; a throwing subscriber never breaks the bus or
// blocks siblings (each handler is isolated + fire-and-forget).
export type VaultEventKind = "changed" | "deleted" | "renamed";

export interface VaultEvent {
  kind: VaultEventKind;
  /** Current vault path (the new path for a rename). */
  path: string;
  /** Previous path — present only for "renamed". */
  oldPath?: string;
  /** True for `.md` files (lets markdown-only subscribers like brain opt out). */
  isMarkdown: boolean;
}

export interface VaultEventSubscriber {
  /** Stable name for logging/diagnostics. */
  name: string;
  /** Lower runs earlier. Convention: edges 10, mirror 20, enrichment 30,
   *  brain 40, views 50 — so edges settle (are dispatched) before the mirror
   *  reads frontmatter, and views refresh last. */
  order: number;
  kinds: ReadonlySet<VaultEventKind>;
  handle(ev: VaultEvent): void | Promise<void>;
}

export class VaultEventBus {
  private subs: VaultEventSubscriber[] = [];

  subscribe(sub: VaultEventSubscriber): () => void {
    this.subs.push(sub);
    this.subs.sort((a, b) => a.order - b.order);
    return () => {
      this.subs = this.subs.filter((s) => s !== sub);
    };
  }

  /** Dispatch in subscriber order to every subscriber that handles this kind.
   *  Handlers are fire-and-forget and fully isolated: a synchronous throw or a
   *  rejected promise in one subscriber cannot stop the others. */
  publish(ev: VaultEvent): void {
    for (const s of this.subs) {
      if (!s.kinds.has(ev.kind)) continue;
      try {
        const r = s.handle(ev);
        if (r && typeof (r as Promise<void>).catch === "function") {
          (r as Promise<void>).catch(() => {});
        }
      } catch {
        /* a subscriber must never break the bus */
      }
    }
  }

  /** Subscriber names in dispatch order — for diagnostics/tests. */
  get order(): string[] {
    return this.subs.map((s) => s.name);
  }
}
