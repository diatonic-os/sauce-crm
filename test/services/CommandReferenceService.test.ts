import { describe, it, expect } from "vitest";
import {
  categorizeCommand,
  buildCommandBlock,
  upsertCommandBlock,
} from "../../src/services/CommandReferenceService";

describe("categorizeCommand()", () => {
  it("buckets commands by purpose", () => {
    expect(categorizeCommand("new-person")).toBe("Capture");
    expect(categorizeCommand("log-touch")).toBe("Capture");
    expect(categorizeCommand("open-dashboard")).toBe("Open / Navigate");
    expect(categorizeCommand("build-brain")).toBe("AI & Brain");
    expect(categorizeCommand("sauceom-connect-gateway")).toBe("Providers");
    expect(categorizeCommand("run-backup")).toBe("Data & Sync");
    expect(categorizeCommand("lock-vault")).toBe("Security");
    expect(categorizeCommand("initialize-vault")).toBe("Vault & Diagnostics");
    expect(categorizeCommand("totally-unknown")).toBe("Other");
  });
});

describe("buildCommandBlock()", () => {
  const cmds = [
    { id: "sauce-crm:new-person", name: "SauceOM: New person" },
    { id: "sauce-crm:quick-capture", name: "Quick capture (CDEL)" },
    { id: "sauce-crm:open-dashboard", name: "Open Dashboard" },
  ];
  const block = buildCommandBlock(cmds, "sauce-crm", "2026-06-20T00:00:00Z");

  it("is wrapped in versioned managed-block sentinels", () => {
    expect(block.startsWith("<!-- sauce:commands:begin v1 -->")).toBe(true);
    expect(block.trimEnd().endsWith("<!-- sauce:commands:end -->")).toBe(true);
  });

  it("renders full prefixed IDs and cleans display names", () => {
    expect(block).toContain("`sauce-crm:new-person`");
    expect(block).toContain("| New person |"); // brand prefix stripped
  });

  it("includes a suggested (advisory) hotkey for high-traffic commands only", () => {
    expect(block).toContain("Ctrl/Cmd+Shift+C"); // quick-capture
    // a command without a suggestion has an empty hotkey cell
    expect(block).toMatch(/open-dashboard` \| Ctrl\/Cmd\+Shift\+D/);
  });

  it("groups by category headings", () => {
    expect(block).toContain("### Capture");
    expect(block).toContain("### Open / Navigate");
  });
});

describe("upsertCommandBlock()", () => {
  const block = buildCommandBlock(
    [{ id: "sauce-crm:new-person", name: "New person" }],
    "sauce-crm",
    "2026-06-20T00:00:00Z",
  );

  it("appends when no block present, preserving prose", () => {
    const doc = "# My notes\n\nuser prose here\n";
    const out = upsertCommandBlock(doc, block);
    expect(out).toContain("user prose here");
    expect(out).toContain("sauce:commands:begin");
  });

  it("replaces an existing block while preserving prose outside it", () => {
    const v0 = buildCommandBlock([], "sauce-crm", "old");
    const doc = `# Title\n\nkeep me\n\n${v0}\n\ntrailing prose\n`;
    const out = upsertCommandBlock(doc, block);
    expect(out).toContain("keep me");
    expect(out).toContain("trailing prose");
    expect(out).toContain("`sauce-crm:new-person`");
    // only one block remains
    expect(out.match(/sauce:commands:begin/g)?.length).toBe(1);
  });
});
