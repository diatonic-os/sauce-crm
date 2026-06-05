// @vitest-environment node
// Unit tests for the Settings → Data "last index" stats line — the
// reconciliation/drift display logic (FULL VAULT INDEX item 2 + 4). The DOM
// render path needs Obsidian's element extensions (createDiv/createEl), so the
// load-bearing string logic is extracted into pure functions and tested here.
import { describe, expect, it } from "vitest";
import {
  describeIndexState,
  formatWhen,
  type IndexStateView,
} from "../../../src/ui/settings/sections/data";

describe("describeIndexState", () => {
  it("reports 'not yet built' when there is no state", () => {
    const r = describeIndexState(undefined);
    expect(r.text).toContain("not yet built");
    expect(r.drift).toBe(false);
  });

  it("reports 'not yet built' for a zero-cursor, never-completed state", () => {
    const r = describeIndexState({ cursor: 0, total: 0 });
    expect(r.text).toContain("not yet built");
    expect(r.drift).toBe(false);
  });

  it("reports a resumable interruption when a cursor exists but no completion", () => {
    const idx: IndexStateView = { cursor: 120, total: 500 };
    const r = describeIndexState(idx);
    expect(r.text).toContain("interrupted at 120/500");
    expect(r.text).toContain("resume");
    expect(r.drift).toBe(false);
  });

  it("reports a clean reconciliation (no drift)", () => {
    const idx: IndexStateView = {
      cursor: 42,
      total: 42,
      synced: 42,
      completedAt: new Date().toISOString(),
      drift: 0,
      mirrorRows: 42,
    };
    const r = describeIndexState(idx);
    expect(r.text).toContain("42 entities");
    expect(r.text).toContain("no drift");
    expect(r.drift).toBe(false);
  });

  it("surfaces drift when vault entities diverge from mirror rows", () => {
    const idx: IndexStateView = {
      cursor: 10,
      total: 10,
      synced: 10,
      completedAt: new Date().toISOString(),
      drift: 3,
      mirrorRows: 7,
    };
    const r = describeIndexState(idx);
    expect(r.text).toContain("Drift 3");
    expect(r.text).toContain("10 vault vs 7 mirror rows");
    expect(r.drift).toBe(true);
  });

  it("singularizes a one-entity index", () => {
    const idx: IndexStateView = {
      cursor: 1,
      total: 1,
      synced: 1,
      completedAt: new Date().toISOString(),
    };
    const r = describeIndexState(idx);
    expect(r.text).toContain("1 entity,");
  });

  it("omits the drift clause when the mirror count was unavailable", () => {
    const idx: IndexStateView = {
      cursor: 5,
      total: 5,
      synced: 5,
      completedAt: new Date().toISOString(),
      drift: null,
      mirrorRows: null,
    };
    const r = describeIndexState(idx);
    expect(r.text).not.toContain("Drift");
    expect(r.text).not.toContain("reconciled");
    expect(r.drift).toBe(false);
  });
});

describe("formatWhen", () => {
  it("returns 'just now' for the current instant", () => {
    expect(formatWhen(new Date().toISOString())).toBe("just now");
  });

  it("renders minute/hour/day granularity", () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(formatWhen(ago(5 * 60_000))).toBe("5m ago");
    expect(formatWhen(ago(3 * 3_600_000))).toBe("3h ago");
    expect(formatWhen(ago(2 * 86_400_000))).toBe("2d ago");
  });

  it("falls back to a date for older timestamps", () => {
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    expect(formatWhen(old)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns the raw string for an unparseable input", () => {
    expect(formatWhen("not-a-date")).toBe("not-a-date");
  });
});
