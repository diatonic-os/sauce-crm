// CON-OBS-INTEG-001 · SVC-events — a tiny typed event bus.
//
// Created as part of SH-G because the svcV1 `events` facade needs it (the TOON
// names src/services/EventBus.ts as the SVC-events module). on/off/once/emit/
// subscribe/correlate. No Obsidian dependency — pure + unit-testable. Also
// satisfies the MutationContract's `emitEvent` shape via `emit`.

export type EventHandler<T = unknown> = (payload: T) => void;

/** A correlated sub-emitter: every emit carries a fixed correlationId. */
export interface CorrelatedBus {
  correlationId: string;
  emit<T>(event: string, payload: T): void;
  on<T>(
    event: string,
    handler: EventHandler<{ correlationId: string; payload: T }>,
  ): () => void;
}

export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  /** Subscribe. Returns an unsubscribe function. */
  on<T>(event: string, handler: EventHandler<T>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler);
    return () => this.off(event, handler);
  }

  /** Alias for on() — reads better at downstream registration sites. */
  subscribe<T>(event: string, handler: EventHandler<T>): () => void {
    return this.on(event, handler);
  }

  off<T>(event: string, handler: EventHandler<T>): void {
    this.handlers.get(event)?.delete(handler as EventHandler);
  }

  /** Subscribe for exactly one emission, then auto-unsubscribe. */
  once<T>(event: string, handler: EventHandler<T>): () => void {
    const off = this.on<T>(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  emit<T>(event: string, payload: T): void {
    // Snapshot to tolerate handlers that unsubscribe during dispatch.
    for (const h of [...(this.handlers.get(event) ?? [])])
      (h as EventHandler<T>)(payload);
  }

  /** A sub-emitter whose emissions are tagged with a correlationId. */
  correlate(correlationId: string): CorrelatedBus {
    return {
      correlationId,
      emit: <T>(event: string, payload: T) =>
        this.emit(event, { correlationId, payload }),
      on: <T>(
        event: string,
        handler: EventHandler<{ correlationId: string; payload: T }>,
      ) =>
        this.on<{ correlationId: string; payload: T }>(event, (env) => {
          if (env.correlationId === correlationId) handler(env);
        }),
    };
  }
}
