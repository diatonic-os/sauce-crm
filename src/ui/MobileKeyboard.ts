// Mobile keyboard avoidance. CSS safe-area insets do NOT account for the soft
// keyboard, so on mobile the chat composer / modal inputs get hidden behind it
// and the user can't see what they're typing. This uses the VisualViewport API
// to measure the keyboard height, publish it as `--sg-kb-inset` on <body>, and
// keep the focused input scrolled into view. CSS (MobileStyles) consumes the var
// to lift the composer and pad scroll regions above the keyboard.
//
// The math is a pure, tested function; the DOM wiring is a thin install/dispose.

/**
 * Height (px) the soft keyboard currently occupies. The standard derivation:
 * how much shorter the VISUAL viewport is than the LAYOUT viewport, minus any
 * upward scroll of the visual viewport. Clamped to ≥0.
 */
export function computeKeyboardInset(
  visualViewportHeight: number,
  layoutViewportHeight: number,
  visualViewportOffsetTop: number,
): number {
  return Math.max(
    0,
    layoutViewportHeight - visualViewportHeight - visualViewportOffsetTop,
  );
}

export interface KeyboardController {
  dispose(): void;
}

interface VVLike {
  height: number;
  offsetTop: number;
  addEventListener(t: string, fn: () => void): void;
  removeEventListener(t: string, fn: () => void): void;
}

// Below this the "keyboard" is treated as closed (a small inset can come from
// browser chrome / toolbars, not a real keyboard).
const OPEN_THRESHOLD = 90;

/**
 * Install keyboard-avoidance for the lifetime of the plugin (mobile only).
 * Returns a disposer; the caller registers it for cleanup on unload. No-op when
 * VisualViewport is unavailable (older webviews / desktop).
 */
export function installMobileKeyboard(
  win: Window = window,
  doc: Document = document,
): KeyboardController {
  const vv = (win as unknown as { visualViewport?: VVLike }).visualViewport;
  if (!vv) return { dispose: () => {} };

  const apply = (): void => {
    const inset = computeKeyboardInset(vv.height, win.innerHeight, vv.offsetTop);
    doc.body.style.setProperty("--sg-kb-inset", `${inset}px`);
    const open = inset > OPEN_THRESHOLD;
    doc.body.classList.toggle("sg-kb-open", open);
    if (open) {
      const el = doc.activeElement as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
        // Keep the caret line visible above the keyboard.
        try {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch {
          el.scrollIntoView();
        }
      }
    }
  };

  // Re-run shortly after focus too: on iOS the viewport resize can lag the
  // focus event, so a focusin alone wouldn't have the right inset yet.
  const onFocusIn = (): void => {
    win.setTimeout(apply, 50);
    win.setTimeout(apply, 250);
  };

  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  doc.addEventListener("focusin", onFocusIn);
  apply();

  return {
    dispose: () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      doc.removeEventListener("focusin", onFocusIn);
      doc.body.style.removeProperty("--sg-kb-inset");
      doc.body.classList.remove("sg-kb-open");
    },
  };
}
