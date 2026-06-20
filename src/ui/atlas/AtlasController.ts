// Shared interaction state for the Sauce Atlas: current mode, focused node, and
// cross-section filters. Renderers subscribe and react to the *kind* of change
// so they can do a cheap GPU/style update (focus, filter) instead of a rebuild.
// Pure state machine — no DOM, no renderer references.
import type { AtlasMode, AtlasFilterState } from "./AtlasTypes";
import { emptyFilter } from "./AtlasTypes";

export type AtlasChange = "mode" | "focus" | "filter" | "data";
export type AtlasListener = (change: AtlasChange) => void;

export class AtlasController {
  private _mode: AtlasMode;
  private _focusId: string | null = null;
  private _filter: AtlasFilterState;
  private listeners = new Set<AtlasListener>();

  constructor(mode: AtlasMode = "geo") {
    this._mode = mode;
    this._filter = emptyFilter();
  }

  get mode(): AtlasMode {
    return this._mode;
  }
  get focusId(): string | null {
    return this._focusId;
  }
  get filter(): AtlasFilterState {
    return this._filter;
  }

  setMode(mode: AtlasMode): void {
    if (mode === this._mode) return;
    this._mode = mode;
    this.emit("mode");
  }

  /** Set (or clear, with null) the focused node. No-op if unchanged. */
  setFocus(id: string | null): void {
    if (id === this._focusId) return;
    this._focusId = id;
    this.emit("focus");
  }

  /** Merge a partial filter update; always notifies (callers debounce input). */
  setFilter(partial: Partial<AtlasFilterState>): void {
    this._filter = { ...this._filter, ...partial };
    this.emit("filter");
  }

  resetFilter(): void {
    this._filter = emptyFilter();
    this.emit("filter");
  }

  /** Signal that the underlying data was rebuilt (renderers should re-source). */
  notifyData(): void {
    this.emit("data");
  }

  on(listener: AtlasListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: AtlasChange): void {
    for (const l of this.listeners) l(change);
  }
}
