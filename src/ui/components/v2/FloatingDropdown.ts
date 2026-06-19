// FloatingDropdown — a borderless, low-profile floating panel anchored to a
// trigger element. Used by the SauceBot chat icon control panel to surface the
// provider / model / embedding selectors as clean dropdowns instead of raw
// <select> bars.
//
// Design goals (match the Sauce visual language):
//   - borderless, subtle shadow, tasteful fade + scale-in
//   - dismiss on outside-click or Escape
//   - reuse the Sauce purple accent + the --sg-* scale (styled in styles.css)
//
// It is intentionally state-light: the caller supplies the option list lazily
// (so it can be rebuilt each open) and a pick handler. The backing <select> in
// the view remains the source of truth — this component just sets it + fires
// the existing onChange handlers.

export interface FloatingOption {
  /** Stable value (matches the backing <select> option value). */
  value: string;
  /** Primary label, rendered prominently. */
  label: string;
  /** Optional secondary text (e.g. context size / quantization / "needs key"). */
  detail?: string;
  /** Optional leading status glyph text (e.g. "●" for a loaded model). */
  badge?: string;
  /** When true, the row is shown but not selectable (group headers). */
  disabled?: boolean;
}

export interface FloatingDropdownConfig {
  /** Heading shown at the top of the panel. */
  title: string;
  /** Lazily produce the options each time the panel opens. */
  getOptions: () => FloatingOption[];
  /** Currently-selected value, used to mark the active row. */
  getSelected: () => string;
  /** Fired when the user picks a row. */
  onPick: (value: string) => void;
}

export class FloatingDropdown {
  private panel: HTMLElement | null = null;
  private onDocPointer: ((ev: MouseEvent) => void) | null = null;
  private onKey: ((ev: KeyboardEvent) => void) | null = null;
  private onReposition: (() => void) | null = null;

  constructor(private readonly cfg: FloatingDropdownConfig) {}

  /** True while the panel is mounted. */
  isOpen(): boolean {
    return this.panel != null;
  }

  /** Toggle relative to the trigger element. */
  toggle(trigger: HTMLElement): void {
    if (this.panel) this.close();
    else this.open(trigger);
  }

  open(trigger: HTMLElement): void {
    this.close();
    const panel = document.body.createDiv({ cls: "sauce-fd" });
    this.panel = panel;

    panel.createDiv({ cls: "sauce-fd-title", text: this.cfg.title });
    const list = panel.createDiv({ cls: "sauce-fd-list" });

    const selected = this.cfg.getSelected();
    const opts = this.cfg.getOptions();
    if (!opts.length) {
      list.createDiv({ cls: "sauce-fd-empty", text: "— none —" });
    }
    for (const o of opts) {
      const row = list.createDiv({
        cls: "sauce-fd-row" + (o.disabled ? " is-header" : ""),
      });
      if (!o.disabled && o.value === selected) row.addClass("is-active");
      if (o.badge) row.createSpan({ cls: "sauce-fd-badge", text: o.badge });
      const main = row.createDiv({ cls: "sauce-fd-main" });
      main.createDiv({ cls: "sauce-fd-label", text: o.label });
      if (o.detail) main.createDiv({ cls: "sauce-fd-detail", text: o.detail });
      if (!o.disabled) {
        row.onclick = () => {
          this.close();
          this.cfg.onPick(o.value);
        };
      }
    }

    this.position(trigger, panel);

    // Defer listener wiring so the click that opened us doesn't immediately
    // dismiss it.
    window.setTimeout(() => {
      this.onDocPointer = (ev: MouseEvent) => {
        if (!this.panel) return;
        const t = ev.target as Node;
        if (this.panel.contains(t) || trigger.contains(t)) return;
        this.close();
      };
      this.onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          this.close();
        }
      };
      document.addEventListener("mousedown", this.onDocPointer, true);
      document.addEventListener("keydown", this.onKey, true);
    }, 0);

    this.onReposition = () => {
      if (this.panel) this.position(trigger, this.panel);
    };
    window.addEventListener("resize", this.onReposition);
    window.addEventListener("scroll", this.onReposition, true);

    // Trigger the scale/fade-in on the next frame.
    window.requestAnimationFrame(() => panel.addClass("is-open"));
  }

  close(): void {
    if (this.onDocPointer)
      document.removeEventListener("mousedown", this.onDocPointer, true);
    if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
    if (this.onReposition) {
      window.removeEventListener("resize", this.onReposition);
      window.removeEventListener("scroll", this.onReposition, true);
    }
    this.onDocPointer = null;
    this.onKey = null;
    this.onReposition = null;
    this.panel?.remove();
    this.panel = null;
  }

  /** Anchor the panel under the trigger, clamped to the viewport. */
  private position(trigger: HTMLElement, panel: HTMLElement): void {
    const r = trigger.getBoundingClientRect();
    const gap = 6;
    // Measure after layout.
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.left;
    if (left + pw + gap > vw) left = Math.max(gap, vw - pw - gap);
    let top = r.bottom + gap;
    // Flip above the trigger if there isn't room below.
    if (top + ph + gap > vh && r.top - ph - gap > 0) top = r.top - ph - gap;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }
}
