import { describe, expect, it, vi } from "vitest";
import {
  ContentService,
  type ContentHost,
  type PrivacyGate,
} from "../../../src/services/core/ContentService";

function host(): ContentHost {
  return {
    recordAudio: vi.fn(async () => "attachments/rec.webm"),
    readCanvas: vi.fn(async () => ({ nodes: [] })),
    outline: vi.fn(async () => [{ level: 1, text: "Title", line: 0 }]),
    preview: vi.fn(async () => "<p>x</p>"),
    footnotes: vi.fn(async () => ["[^1]: note"]),
    wordCount: vi.fn(async () => 42),
    present: vi.fn(async () => {}),
    fetchWeb: vi.fn(async () => "<html>fetched</html>"),
  };
}

describe("ContentService", () => {
  it("delegates the content capabilities", async () => {
    const h = host();
    const s = new ContentService(h, { allowWebFetch: () => true });
    expect(await s.wordCount("a.md")).toBe(42);
    expect(await s.outline("a.md")).toEqual([
      { level: 1, text: "Title", line: 0 },
    ]);
    expect(await s.preview("a.md")).toBe("<p>x</p>");
  });

  it("fetchWeb is allowed when privacy permits it", async () => {
    const h = host();
    const s = new ContentService(h, { allowWebFetch: () => true });
    expect(await s.fetchWeb("https://example.com")).toBe(
      "<html>fetched</html>",
    );
    expect(h.fetchWeb).toHaveBeenCalled();
  });

  it("fetchWeb is REFUSED when privacy disallows it (no outbound call)", async () => {
    const h = host();
    const gate: PrivacyGate = { allowWebFetch: () => false };
    const s = new ContentService(h, gate);
    await expect(s.fetchWeb("https://example.com")).rejects.toThrow(/privacy/i);
    expect(h.fetchWeb).not.toHaveBeenCalled();
  });
});
