import { describe, expect, it } from "vitest";
import { InlineStatus } from "../../src/ui/components/v2/InlineStatus";

describe("InlineStatus", () => {
  it("starts idle and empty", () => {
    const root = document.createElement("div");
    const s = new InlineStatus(root);
    expect(s.state).toBe("idle");
    expect(root.querySelector(".sg-inline-status")).not.toBeNull();
    expect(s.el.textContent).toBe("");
  });

  it("renders pending with an icon + message and a state class", () => {
    const s = new InlineStatus(document.createElement("div"));
    s.pending("Testing…");
    expect(s.state).toBe("pending");
    expect(s.el.classList.contains("sg-inline-status--pending")).toBe(true);
    expect(s.el.querySelector(".sg-inline-status-text")?.textContent).toBe(
      "Testing…",
    );
    expect(s.el.querySelector(".sg-inline-status-icon")).not.toBeNull();
  });

  it("renders success and error states distinctly", () => {
    const s = new InlineStatus(document.createElement("div"));
    s.success("Connected · 30 models");
    expect(s.el.classList.contains("sg-inline-status--success")).toBe(true);
    expect(s.el.textContent).toContain("30 models");
    s.error("invalid password");
    expect(s.el.classList.contains("sg-inline-status--error")).toBe(true);
    expect(s.el.classList.contains("sg-inline-status--success")).toBe(false);
    expect(s.el.textContent).toContain("invalid password");
  });

  it("clear() returns to an empty idle state", () => {
    const s = new InlineStatus(document.createElement("div"));
    s.success("ok");
    s.clear();
    expect(s.state).toBe("idle");
    expect(s.el.textContent).toBe("");
  });
});
