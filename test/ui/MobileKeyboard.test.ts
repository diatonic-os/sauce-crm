import { describe, expect, it } from "vitest";
import { computeKeyboardInset } from "../../src/ui/MobileKeyboard";

describe("computeKeyboardInset", () => {
  it("is 0 when the visual viewport equals the layout viewport (no keyboard)", () => {
    expect(computeKeyboardInset(800, 800, 0)).toBe(0);
  });

  it("equals the height the keyboard occupies when it opens", () => {
    // Layout 800, visual viewport shrank to 400 → ~400px keyboard.
    expect(computeKeyboardInset(400, 800, 0)).toBe(400);
  });

  it("accounts for a scrolled visual viewport (offsetTop)", () => {
    expect(computeKeyboardInset(300, 800, 100)).toBe(400);
  });

  it("never returns a negative inset", () => {
    expect(computeKeyboardInset(900, 800, 0)).toBe(0);
  });
});
