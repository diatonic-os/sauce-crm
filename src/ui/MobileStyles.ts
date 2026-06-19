// Apple-native mobile optimization, injected at runtime only on mobile
// (Platform.isMobile). Kept OUT of styles.css on purpose: it ships as a scoped
// <style> element so it never collides with the desktop design-system CSS and
// can only ever affect mobile (every rule is under `body.is-mobile`).
//
// Organized into component-ID groups (Tokens · Layout · Inputs · Buttons ·
// Settings · Modals · Copilot · Cards/Dashboards · Tasks/Config · Toolbar).
// Heuristics: 44px tap targets (Apple HIG), 16px input font (prevents iOS
// focus-zoom), env(safe-area-inset-*) for notch/home-indicator, single-column
// reflow, clamp()/min() self-adjusting field sizes, bottom-sheet modals.

export const MOBILE_STYLE_ID = "sauce-mobile-styles";

export const MOBILE_CSS = `
/* ===== Sauce CRM — mobile (Apple-native) ===== */

/* --- Tokens: bigger tap targets, safe areas, fluid type --- */
body.is-mobile {
  --sg-tap-min: 44px;                 /* Apple HIG minimum */
  --sg-mobile-pad: max(var(--sg-gap-13), env(safe-area-inset-left));
  --sg-mobile-bottom: env(safe-area-inset-bottom, 0px);
  --sg-mobile-font: clamp(15px, 4.2vw, 17px);
}

/* --- Layout: single column, momentum scroll, safe-area gutters --- */
body.is-mobile .sauce-view,
body.is-mobile .sauce-copilot {
  padding: var(--sg-gap-8) var(--sg-mobile-pad);
  padding-bottom: calc(var(--sg-gap-8) + var(--sg-mobile-bottom));
  gap: var(--sg-gap-8);
  -webkit-overflow-scrolling: touch;
  font-size: var(--sg-mobile-font);
}
body.is-mobile .sauce-card-grid,
body.is-mobile .sauce-field-grid,
body.is-mobile .sauce-kpi-grid { grid-template-columns: 1fr !important; }

/* --- Inputs: full-width, 16px+ (no iOS focus-zoom), comfortable height --- */
body.is-mobile input,
body.is-mobile textarea,
body.is-mobile select,
body.is-mobile .sauce-cp-select,
body.is-mobile .dropdown {
  font-size: max(16px, 1em) !important;
  min-height: var(--sg-tap-min);
  width: 100%;
  box-sizing: border-box;
}
body.is-mobile .setting-item { display: block; padding: var(--sg-gap-8) 0; }
body.is-mobile .setting-item-control { width: 100%; justify-content: flex-start; margin-top: var(--sg-gap-5); }
body.is-mobile .setting-item-control input[type="text"],
body.is-mobile .setting-item-control input[type="password"],
body.is-mobile .setting-item-control textarea { flex: 1 1 100%; }

/* --- Buttons: full-width-friendly, tall enough to tap --- */
body.is-mobile .sauce-button,
body.is-mobile .sauce-button-secondary,
body.is-mobile .sauce-button-danger {
  min-height: var(--sg-tap-min);
  padding-inline: var(--sg-gap-13);
  flex: 1 1 auto;
}
body.is-mobile .sauce-button-row,
body.is-mobile .sauce-buttons { flex-wrap: wrap; gap: var(--sg-gap-8); }

/* --- Settings: stacked rows, full-width controls --- */
body.is-mobile .sauce-section { padding: var(--sg-gap-8); }
body.is-mobile .sauce-settings-section-title { font-size: 1.05em; }
body.is-mobile .sauce-card { padding: var(--sg-gap-8); }
body.is-mobile .sauce-card-foot { flex-direction: column; align-items: stretch; }
/* Safe-area gutter so the last settings row clears the home indicator. */
body.is-mobile .sauce-settings { padding-bottom: calc(var(--sg-gap-21) + var(--sg-mobile-bottom)); }
/* Integration rail entries get a full tap target when the rail goes horizontal
   (the column→row stack itself is handled by the width media query). */
body.is-mobile .sg-rail-btn { min-height: var(--sg-tap-min); }

/* --- Modals: full-width content + safe-area + scroll (Obsidian already
   near-fullscreens modals on phone; we avoid repositioning its container and
   just optimize the content + a thumb-reachable footer). The field modals
   (Person/Org/QuickCapture) render directly into .modal-content with NO
   .sauce-section wrapper, so we scroll .modal-content itself — the previous
   rule targeted only .sauce-section and was dead for those modals. --- */
body.is-mobile .sauce-modal {
  padding-bottom: calc(var(--sg-gap-13) + var(--sg-mobile-bottom));
}
body.is-mobile .sauce-modal .modal-content,
body.is-mobile .sauce-modal .sauce-section {
  max-height: 80vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
/* Field rows: tokenized rhythm that out-specifies Obsidian core's
   .is-mobile .setting-item rule (which otherwise dictates the spacing). Label
   stacks above a full-width control with a consistent label-to-control gap. */
body.is-mobile .sauce-modal .setting-item {
  display: block;
  padding: var(--sg-row-gap) 0;
}
body.is-mobile .sauce-modal .setting-item-info { margin-bottom: var(--sg-field-gap); }
body.is-mobile .sauce-modal .setting-item-control {
  width: 100%;
  justify-content: flex-start;
  margin-top: var(--sg-field-gap);
}
/* Sticky footer: a divider + safe-area bottom so the action row stays
   reachable and clears the home indicator instead of overlapping content. */
body.is-mobile .sauce-modal .sauce-button-row,
body.is-mobile .sauce-modal .sauce-buttons,
body.is-mobile .sauce-modal .sauce-modal-footer {
  position: sticky;
  bottom: 0;
  background: var(--background-primary);
  padding-top: var(--sg-gap-8);
  padding-bottom: calc(var(--sg-gap-5) + var(--sg-mobile-bottom));
  border-top: 1px solid var(--background-modifier-border);
}

/* --- Copilot view: stacked model picker, big composer above the home bar --- */
body.is-mobile .sauce-copilot-bar { flex-direction: column; align-items: stretch; gap: var(--sg-gap-5); }
/* The icon control panel wraps to fit narrow screens (replaces the old
   .sauce-cp-models/.sauce-cp-field select bars removed in the redesign). */
body.is-mobile .sauce-cp-config { flex-wrap: wrap; }
body.is-mobile .sauce-copilot-actions { justify-content: space-between; }
body.is-mobile .sauce-copilot-input {
  flex-direction: row;
  align-items: flex-end;
  gap: var(--sg-gap-5);
  position: sticky;
  bottom: 0;
  background: var(--background-primary);
  padding-bottom: var(--sg-mobile-bottom);
}
body.is-mobile .sauce-copilot-textarea { width: 100%; min-height: var(--sg-h-55); }
body.is-mobile .sauce-cp-icon { width: var(--sg-tap-min); height: var(--sg-tap-min); }
body.is-mobile .sauce-copilot-transcript { padding: var(--sg-gap-5); }

/* --- Cards / dashboards / suggestions: one column, tappable rows --- */
body.is-mobile .sauce-cp-card { padding: var(--sg-gap-8); }
body.is-mobile .sauce-cp-card .sauce-button,
body.is-mobile .sauce-cp-card .sauce-button-secondary { min-width: var(--sg-tap-min); }
body.is-mobile .sauce-table { font-size: 0.9em; display: block; overflow-x: auto; }

/* --- Quick-capture: prominent on mobile (the on-the-go record surface) --- */
body.is-mobile .sauce-quick-capture .sauce-section { gap: var(--sg-gap-13); }
body.is-mobile .sauce-quick-capture input,
body.is-mobile .sauce-quick-capture textarea { min-height: var(--sg-tap-min); }

/* --- Toolbar icons: spaced for thumbs --- */
body.is-mobile .sauce-copilot-actions .sauce-cp-icon { margin: 0 var(--sg-gap-2); }
`;

/** Inject the mobile stylesheet into <head>. Returns a cleanup that removes it
 *  (pass to plugin.register so it's torn down on unload). Idempotent. */
export function injectMobileStyles(doc: Document = document): () => void {
  let el = doc.getElementById(MOBILE_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement("style");
    el.id = MOBILE_STYLE_ID;
    doc.head.appendChild(el);
  }
  el.textContent = MOBILE_CSS;
  return () => {
    el?.remove();
  };
}
