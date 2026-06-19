import { afterEach, describe, expect, it } from "vitest";
import {
  MOBILE_CSS,
  MOBILE_STYLE_ID,
  injectMobileStyles,
} from "../../src/ui/MobileStyles";

// R-002: assert the mobile stylesheet's structural contract (selectors/tokens),
// not pixel values. These guard the CON-OBS-UI-RESPONSIVE-001 mobile fixes:
// scroll retargeted to .modal-content, tokenized field rhythm, safe-area footer.

describe("MobileStyles — CSS contract", () => {
  it("scrolls .modal-content (not just the absent .sauce-section)", () => {
    // The field modals render into .modal-content with no .sauce-section, so
    // the scroll region must target .modal-content.
    expect(MOBILE_CSS).toContain(".sauce-modal .modal-content");
  });

  it("gives modal field rows a tokenized rhythm that out-specifies core", () => {
    expect(MOBILE_CSS).toContain("body.is-mobile .sauce-modal .setting-item");
    expect(MOBILE_CSS).toContain("var(--sg-row-gap)");
    expect(MOBILE_CSS).toContain("var(--sg-field-gap)");
  });

  it("pins a safe-area-aware modal footer with a divider", () => {
    expect(MOBILE_CSS).toContain(".sauce-modal .sauce-modal-footer");
    expect(MOBILE_CSS).toContain("var(--sg-mobile-bottom)");
    expect(MOBILE_CSS).toContain(
      "border-top: 1px solid var(--background-modifier-border)",
    );
  });

  it("derives the safe-area bottom token from env(safe-area-inset-bottom)", () => {
    expect(MOBILE_CSS).toContain(
      "--sg-mobile-bottom: env(safe-area-inset-bottom, 0px)",
    );
  });

  it("keeps the settings scroll surface clear of the home indicator", () => {
    expect(MOBILE_CSS).toContain("body.is-mobile .sauce-settings");
  });
});

describe("injectMobileStyles — DOM injection", () => {
  afterEach(() => {
    document.getElementById(MOBILE_STYLE_ID)?.remove();
  });

  it("injects exactly one <style> with the mobile CSS", () => {
    injectMobileStyles(document);
    const els = document.querySelectorAll(`#${MOBILE_STYLE_ID}`);
    expect(els.length).toBe(1);
    expect((els[0] as HTMLStyleElement).textContent).toBe(MOBILE_CSS);
  });

  it("is idempotent — a second call reuses the same element", () => {
    injectMobileStyles(document);
    injectMobileStyles(document);
    expect(document.querySelectorAll(`#${MOBILE_STYLE_ID}`).length).toBe(1);
  });

  it("returns a cleanup that removes the injected element", () => {
    const cleanup = injectMobileStyles(document);
    expect(document.getElementById(MOBILE_STYLE_ID)).not.toBeNull();
    cleanup();
    expect(document.getElementById(MOBILE_STYLE_ID)).toBeNull();
  });
});
