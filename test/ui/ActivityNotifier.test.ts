// ActivityNotifier — the realtime top-right toast lifecycle (start → update →
// succeed/fail → fade). Notice is mocked so we assert the message transitions
// and the auto-hide without a live Obsidian.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ctor = vi.fn();
const setMessage = vi.fn();
const hide = vi.fn();

vi.mock("obsidian", () => ({
  Notice: class {
    constructor(msg: string, timeout?: number) {
      ctor(msg, timeout);
    }
    setMessage(m: string): void {
      setMessage(m);
    }
    hide(): void {
      hide();
    }
  },
}));

import { activity } from "../../src/ui/ActivityNotifier";

describe("ActivityNotifier", () => {
  beforeEach(() => {
    ctor.mockClear();
    setMessage.mockClear();
    hide.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("start() opens a persistent (timeout 0) in-progress toast", () => {
    activity.start("indexing");
    expect(ctor).toHaveBeenCalledWith("⏳ indexing", 0);
  });

  it("update() rewrites the in-progress message", () => {
    const h = activity.start("a");
    h.update("b");
    expect(setMessage).toHaveBeenCalledWith("⏳ b");
  });

  it("succeed() switches to ✓ then auto-hides after the delay", () => {
    const h = activity.start("build");
    h.succeed("done", 4000);
    expect(setMessage).toHaveBeenLastCalledWith("✓ done");
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("fail() switches to ⚠ and auto-hides", () => {
    const h = activity.start("build");
    h.fail("boom", 6000);
    expect(setMessage).toHaveBeenLastCalledWith("⚠ boom");
    vi.advanceTimersByTime(6000);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("update()/succeed() are no-ops once settled (no late message clobber)", () => {
    const h = activity.start("x");
    h.succeed("first");
    setMessage.mockClear();
    h.update("late");
    h.succeed("second");
    expect(setMessage).not.toHaveBeenCalled();
  });

  it("info() is a one-shot toast with a finite timeout", () => {
    activity.info("hello", 3000);
    expect(ctor).toHaveBeenCalledWith("hello", 3000);
  });
});
