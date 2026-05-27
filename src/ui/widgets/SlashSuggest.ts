// CON-SAUCEBOT S4 — chat "/" skill/command picker.
//
// Obsidian has no inline-suggest for a plain <textarea>, so this is a custom
// popover: typing a leading "/" opens a scrollable, keyboard-navigable list of
// skills + slash-command macros sourced from the runtime. Picking one runs the
// chosen skill as a forced tool call (skills) or substitutes the macro
// (commands) — wired in SauceBotChatView.
//
// The filter + navigation logic is exported as pure functions so it can be
// unit-tested without a DOM. ReDoS-safe (the trigger regex is linear).

export interface SlashItem {
  id: string;
  label: string;
  detail?: string;
  kind: "skill" | "command";
}

// Anchored, linear regex: the whole input must be "/" followed by a run of
// non-whitespace. A space ends the trigger (the user is past the picker).
const SLASH_TRIGGER = /^\/(\S*)$/;

/** The active "/" query, or null when the text isn't a slash trigger. */
export function parseSlashQuery(text: string): string | null {
  const m = text.match(SLASH_TRIGGER);
  return m ? (m[1] ?? null) : null; // capture group 1 (\S*) always present when regex matches
}

/** Filter items by case-insensitive substring match on id OR label. */
export function filterSlashItems(
  query: string,
  items: SlashItem[],
): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice();
  return items.filter(
    (i) =>
      i.id.toLowerCase().includes(q) || i.label.toLowerCase().includes(q),
  );
}

/** Wrapping next-index for ↑/↓ navigation; clamps to 0 for an empty list. */
export function nextIndex(
  current: number,
  len: number,
  dir: "up" | "down",
): number {
  if (len <= 0) return 0;
  return dir === "down" ? (current + 1) % len : (current - 1 + len) % len;
}

export interface SlashSuggestOptions {
  getItems: () => SlashItem[];
  onSelect: (item: SlashItem) => void;
}

/**
 * Popover controller bound to a chat <textarea>. Best-effort DOM glue over the
 * pure functions above; all visual styling is via tokenized CSS classes
 * (`sauce-slash-*`) — no inline spacing styles (G-001).
 */
export class SlashSuggest {
  private popover: HTMLElement | null = null;
  private filtered: SlashItem[] = [];
  private active = 0;
  private readonly onInput = () => this.refresh();
  private readonly onKeydown = (e: KeyboardEvent) => this.handleKey(e);

  constructor(
    private readonly textarea: HTMLTextAreaElement,
    private readonly opts: SlashSuggestOptions,
  ) {}

  attach(): void {
    this.textarea.addEventListener("input", this.onInput);
    // Capture phase so ↑/↓/Enter/Esc are intercepted before the textarea.
    this.textarea.addEventListener("keydown", this.onKeydown, true);
  }

  detach(): void {
    this.textarea.removeEventListener("input", this.onInput);
    this.textarea.removeEventListener("keydown", this.onKeydown, true);
    this.hide();
  }

  get isOpen(): boolean {
    return this.popover != null;
  }

  private refresh(): void {
    const query = parseSlashQuery(this.textarea.value);
    if (query == null) {
      this.hide();
      return;
    }
    this.filtered = filterSlashItems(query, this.opts.getItems());
    if (this.filtered.length === 0) {
      this.hide();
      return;
    }
    this.active = 0;
    this.render();
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        this.active = nextIndex(this.active, this.filtered.length, "down");
        this.render();
        break;
      case "ArrowUp":
        e.preventDefault();
        this.active = nextIndex(this.active, this.filtered.length, "up");
        this.render();
        break;
      case "Enter":
        e.preventDefault();
        this.choose(this.active);
        break;
      case "Escape":
        e.preventDefault();
        this.hide();
        break;
      default:
        break;
    }
  }

  private choose(idx: number): void {
    const item = this.filtered[idx];
    if (!item) return;
    this.hide();
    this.opts.onSelect(item);
  }

  private render(): void {
    if (!this.popover) {
      this.popover = this.textarea.parentElement?.createDiv({
        cls: "sauce-slash-suggest",
      }) as HTMLElement | null;
      if (!this.popover) return;
    }
    this.popover.empty?.();
    this.filtered.forEach((item, i) => {
      const row = this.popover!.createDiv({
        cls:
          i === this.active ? "sauce-slash-item is-active" : "sauce-slash-item",
      });
      row.createSpan({
        cls: `sauce-slash-kind sauce-slash-${item.kind}`,
        text: item.kind === "skill" ? "skill" : "cmd",
      });
      row.createSpan({ cls: "sauce-slash-label", text: item.label });
      if (item.detail)
        row.createSpan({ cls: "sauce-slash-detail", text: item.detail });
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        this.choose(i);
      });
    });
  }

  private hide(): void {
    this.popover?.remove();
    this.popover = null;
    this.filtered = [];
    this.active = 0;
  }
}
