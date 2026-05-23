// CON-OBS-INTEG-001 · T-D-02 · G-005 — read-only enforcement for canonized files.
//
// When the active file is canonized, the editor is made non-editable
// (EditorView.editable.of(false)) and paste/drop/keydown mutations are blocked
// with a non-blocking toast. The decision logic is extracted into pure
// functions so it's unit-testable without constructing a live EditorView; the
// CodeMirror wiring is a thin factory around them.

import { EditorView } from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";

export const CANON_TOAST = "File is canonized — edit via Sauce";

/** Effect that flips the read-only state when the active file changes. */
export const setCanonReadOnly = StateEffect.define<boolean>();

/** StateField holding whether the current document is canonized (read-only). */
export const canonReadOnlyField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setCanonReadOnly)) value = e.value;
    return value;
  },
});

/** True iff an editing gesture should be blocked given the read-only state. */
export function shouldBlockEdit(readOnly: boolean): boolean {
  return readOnly === true;
}

export interface CanonGuardOpts {
  /** Whether the document currently in the editor is canonized. */
  isReadOnly: () => boolean;
  toast: (message: string) => void;
}

type DomHandler = (event: { preventDefault: () => void }) => boolean;

/**
 * Pure DOM-event handlers for paste/drop/keydown. Each returns true (handled)
 * and toasts when the file is read-only, suppressing the mutation; false
 * otherwise (lets CodeMirror handle it).
 */
export function makeCanonGuardHandlers(opts: CanonGuardOpts): {
  paste: DomHandler;
  drop: DomHandler;
  keydown: (event: {
    preventDefault: () => void;
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
  }) => boolean;
} {
  const block = (event: { preventDefault: () => void }): boolean => {
    if (!opts.isReadOnly()) return false;
    event.preventDefault();
    opts.toast(CANON_TOAST);
    return true;
  };
  return {
    paste: block,
    drop: block,
    keydown: (event) => {
      if (!opts.isReadOnly()) return false;
      // Allow navigation / copy / select-all; block anything that would mutate text.
      const isCopy =
        (event.metaKey || event.ctrlKey) &&
        (event.key === "c" || event.key === "a");
      const isNav = [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        "Escape",
        "Tab",
      ].includes(event.key);
      if (isCopy || isNav) return false;
      event.preventDefault();
      opts.toast(CANON_TOAST);
      return true;
    },
  };
}

/** Build the CodeMirror extension enforcing read-only + edit suppression. */
export function makeCanonReadOnlyExtension(opts: CanonGuardOpts): Extension {
  const handlers = makeCanonGuardHandlers(opts);
  return [
    canonReadOnlyField,
    EditorView.editable.of(false),
    EditorView.domEventHandlers({
      paste: (e) => handlers.paste(e),
      drop: (e) => handlers.drop(e),
      keydown: (e) => handlers.keydown(e),
    }),
  ];
}
