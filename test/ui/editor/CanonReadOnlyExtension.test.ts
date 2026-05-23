import { describe, expect, it, vi } from "vitest";
import {
  makeCanonGuardHandlers,
  shouldBlockEdit,
  CANON_TOAST,
} from "../../../src/ui/editor/CanonReadOnlyExtension";

function ev() {
  return { preventDefault: vi.fn() };
}

describe("shouldBlockEdit", () => {
  it("blocks only when read-only", () => {
    expect(shouldBlockEdit(true)).toBe(true);
    expect(shouldBlockEdit(false)).toBe(false);
  });
});

describe("makeCanonGuardHandlers — canonized (read-only) file", () => {
  const setup = () => {
    const toast = vi.fn();
    const h = makeCanonGuardHandlers({ isReadOnly: () => true, toast });
    return { h, toast };
  };

  it("blocks paste + drop with preventDefault and a toast (G-005)", () => {
    const { h, toast } = setup();
    const p = ev();
    expect(h.paste(p)).toBe(true);
    expect(p.preventDefault).toHaveBeenCalled();
    const d = ev();
    expect(h.drop(d)).toBe(true);
    expect(toast).toHaveBeenCalledWith(CANON_TOAST);
  });

  it("blocks text-mutating keydown but allows copy/select-all/navigation", () => {
    const { h, toast } = setup();
    const typing = { preventDefault: vi.fn(), key: "a" };
    expect(h.keydown(typing)).toBe(true);
    expect(typing.preventDefault).toHaveBeenCalled();

    const copy = { preventDefault: vi.fn(), key: "c", metaKey: true };
    expect(h.keydown(copy)).toBe(false);
    expect(copy.preventDefault).not.toHaveBeenCalled();

    const nav = { preventDefault: vi.fn(), key: "ArrowDown" };
    expect(h.keydown(nav)).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1); // only the typing attempt toasted
  });
});

describe("makeCanonGuardHandlers — non-canonized file is untouched", () => {
  it("lets paste/drop/keydown through without blocking or toasting", () => {
    const toast = vi.fn();
    const h = makeCanonGuardHandlers({ isReadOnly: () => false, toast });
    const p = ev();
    expect(h.paste(p)).toBe(false);
    expect(p.preventDefault).not.toHaveBeenCalled();
    expect(h.keydown({ preventDefault: vi.fn(), key: "a" })).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });
});
