import { describe, it, expect } from "vitest";
import {
  urgencyOf,
  importanceOf,
  quadrantOf,
  scoreTasks,
} from "@/services/tasks/EisenhowerEngine";

const now = new Date("2026-06-19T00:00:00Z");

describe("EisenhowerEngine", () => {
  it("overdue task is maximally urgent", () => {
    expect(urgencyOf({ due: "2026-06-10", status: "todo" } as any, now)).toBe(1);
  });

  it("urgency decays with horizon", () => {
    const u3 = urgencyOf({ due: "2026-06-22", status: "todo" } as any, now); // 3 days out
    const u14 = urgencyOf({ due: "2026-07-03", status: "todo" } as any, now);
    expect(u3).toBeGreaterThan(u14);
    expect(urgencyOf({ due: null, status: "todo" } as any, now)).toBeLessThan(0.3);
  });

  it("importance blends priority + closeness + blocking", () => {
    const hi = importanceOf({ priority: "urgent", contact: "A", blockedBy: 0 } as any, 5);
    const lo = importanceOf({ priority: "low", contact: null, blockedBy: 0 } as any, 3);
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThanOrEqual(1);
  });

  it("quadrant mapping", () => {
    expect(quadrantOf(0.9, 0.9)).toBe("do");
    expect(quadrantOf(0.1, 0.9)).toBe("schedule");
    expect(quadrantOf(0.9, 0.1)).toBe("delegate");
    expect(quadrantOf(0.1, 0.1)).toBe("eliminate");
  });

  it("done/cancelled tasks score urgency 0", () => {
    expect(urgencyOf({ due: "2026-06-10", status: "done" } as any, now)).toBe(0);
  });
});
