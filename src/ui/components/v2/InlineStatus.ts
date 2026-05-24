// CON-OBS-WIZARD — reusable inline success/failure status line.
// One small, dependency-light helper so every modal can show a transient
// "testing… → ok / error" state instead of a fire-and-forget Notice() toast.
// Uses plain DOM (no Obsidian createEl) so it is trivially jsdom-testable, and
// the tokenized .sg-inline-status* classes in styles.css for theming.

export type InlineStatusState = "idle" | "pending" | "success" | "error";

const ICON: Record<InlineStatusState, string> = {
  idle: "",
  pending: "…",
  success: "✓",
  error: "✕",
};

export class InlineStatus {
  readonly el: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.setAttribute("role", "status");
    this.el.setAttribute("aria-live", "polite");
    parent.appendChild(this.el);
    this.set("idle");
  }

  /** Set the visible state + message. `idle` with no message renders empty. */
  set(state: InlineStatusState, message = ""): void {
    this.el.dataset.state = state;
    this.el.className = `sg-inline-status sg-inline-status--${state}`;
    this.el.textContent = "";
    if (state === "idle" && !message) return;

    const glyph = ICON[state];
    if (glyph) {
      const icon = document.createElement("span");
      icon.className = "sg-inline-status-icon";
      icon.textContent = glyph;
      icon.setAttribute("aria-hidden", "true");
      this.el.appendChild(icon);
    }
    const text = document.createElement("span");
    text.className = "sg-inline-status-text";
    text.textContent = message;
    this.el.appendChild(text);
  }

  /** Convenience wrappers. */
  pending(message = "Testing…"): void {
    this.set("pending", message);
  }
  success(message: string): void {
    this.set("success", message);
  }
  error(message: string): void {
    this.set("error", message);
  }
  clear(): void {
    this.set("idle");
  }

  /** Current state, for callers/tests that need to assert. */
  get state(): InlineStatusState {
    return (this.el.dataset.state as InlineStatusState) ?? "idle";
  }
}
