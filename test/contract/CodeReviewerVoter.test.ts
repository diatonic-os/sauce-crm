import { describe, it, expect } from "vitest";
import {
  CodeReviewerVoter,
  scanDiff,
} from "../../src/contract/voters/CodeReviewerVoter";
import type { RoundtableProposal } from "../../src/contract/types";

const proposal: RoundtableProposal = {
  id: "p",
  sessionId: "s",
  proposal: "x",
};

describe("CodeReviewerVoter scanDiff", () => {
  it("flags `: any` typing on added lines", () => {
    const diff = ["+function f(x: any) { return x; }"].join("\n");
    const findings = scanDiff(diff);
    expect(findings.some((f) => f.rule === "any-type")).toBe(true);
  });

  it("flags `as any` cast", () => {
    const diff = "+const x = y as any;";
    const findings = scanDiff(diff);
    expect(findings.some((f) => f.rule === "any-type")).toBe(true);
  });

  it("flags missing await on requestUrl", () => {
    const diff = "+const r = requestUrl({ url: 'x' });";
    const findings = scanDiff(diff);
    expect(findings.some((f) => f.rule === "missing-await")).toBe(true);
  });

  it("does not flag awaited requestUrl", () => {
    const diff = "+const r = await requestUrl({ url: 'x' });";
    const findings = scanDiff(diff);
    expect(findings.some((f) => f.rule === "missing-await")).toBe(false);
  });

  it("ignores removed lines and headers", () => {
    const diff = ["+++ b/foo.ts", "-const x: any = 1;"].join("\n");
    const findings = scanDiff(diff);
    expect(findings).toEqual([]);
  });

  it("works on raw code (non-diff input)", () => {
    const code = "const x: any = 1;";
    const findings = scanDiff(code);
    expect(findings.some((f) => f.rule === "any-type")).toBe(true);
  });

  it("voter returns aye on clean diff", async () => {
    const v = new CodeReviewerVoter();
    const decision = await v.vote(proposal, { diff: "+const x: number = 1;" });
    expect(decision.vote).toBe("aye");
  });

  it("voter returns nay on dirty diff with rationale citing rules", async () => {
    const v = new CodeReviewerVoter();
    const decision = await v.vote(proposal, {
      diff: "+const x: any = requestUrl({ url: 'y' });",
    });
    expect(decision.vote).toBe("nay");
    expect(decision.rationale).toMatch(/any-type|missing-await/);
  });

  it("voter abstains on empty diff", async () => {
    const v = new CodeReviewerVoter();
    const decision = await v.vote(proposal, { diff: "" });
    expect(decision.vote).toBe("abstain");
    expect(decision.rationale).toMatch(/no diff/);
  });

  it("respects extraPatterns", async () => {
    const v = new CodeReviewerVoter({
      extraPatterns: [{ name: "no-todo", re: /TODO/ }],
    });
    const decision = await v.vote(proposal, { diff: "+// TODO: fix me" });
    expect(decision.vote).toBe("nay");
    expect(decision.rationale).toMatch(/no-todo/);
  });
});
