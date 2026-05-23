// CodeReviewerVoter — deterministic, LLM-free static checks over the
// diff text supplied in VoterContext. Used as a hard gate-eval voter:
// any signal of `any`-typing, missing await on a Promise call, or null
// dereference without a guard produces a nay with the specific line
// references.

import type { RoundtableProposal, Voter } from "../types";
import type { VoterAgent, VoterContext, VoterDecision } from "./types";

export interface CodeReviewerVoterConfig {
  voter?: Voter;
  weight?: number;
  // Patterns added by the caller. Each is checked against every "+" line.
  extraPatterns?: Array<{ name: string; re: RegExp }>;
}

const DEFAULT_VOTER: Voter = {
  id: "voter.codereviewer",
  name: "CodeReviewer",
};

interface Finding {
  line: number;
  rule: string;
  text: string;
}

const ANY_RE =
  // matches ": any", "as any", "<any>", "Array<any>", but skips "anything"/"company"
  /(?:\bas\s+any\b|:\s*any\b|<\s*any\s*>|<\s*any\s*,|,\s*any\s*>|\bany\[\])/;

// rough heuristic: a call whose name suggests a promise and is NOT awaited
// or chained with .then/.catch in the same line. Matches identifiers
// ending in Async, fetch(, fetch., await missing for known async patterns.
const MISSING_AWAIT_RES: RegExp[] = [
  // direct fetch(...) call not preceded by await/return/.then/yield
  /(?<![\w.])(?<!await\s)(?<!return\s)(?<!yield\s)fetch\s*\(/,
  // requestUrl(...) call not awaited
  /(?<![\w.])(?<!await\s)(?<!return\s)(?<!yield\s)requestUrl\s*\(/,
  // identifier ending Async()
  /(?<![\w.])(?<!await\s)(?<!return\s)(?<!yield\s)[A-Za-z_$][\w$]*Async\s*\(/,
];

// flag `.property` chained off a name where the chain owner has been
// nulled or typed as `... | null` in the same line and there's no `?.`
// guard. Heuristic but deterministic.
const NULL_GUARD_MISSING_RE =
  /(?:\|\s*null\b[^.]*\.[A-Za-z_$])|(?:= null\s*;[^?]*\.[A-Za-z_$])/;

export class CodeReviewerVoter implements VoterAgent {
  readonly voter: Voter;
  readonly weight: number;
  private readonly extra: Array<{ name: string; re: RegExp }>;

  constructor(cfg: CodeReviewerVoterConfig = {}) {
    this.voter = cfg.voter ?? DEFAULT_VOTER;
    this.weight = cfg.weight ?? 2;
    this.extra = cfg.extraPatterns ?? [];
  }

  async vote(
    _proposal: RoundtableProposal,
    ctx: VoterContext,
  ): Promise<VoterDecision> {
    const start = Date.now();
    const diff = ctx.diff ?? "";
    if (!diff.trim()) {
      return {
        voter: this.voter,
        vote: "abstain",
        rationale: "no diff supplied",
        latencyMs: Date.now() - start,
      };
    }
    const findings = scanDiff(diff, this.extra);
    if (findings.length === 0) {
      return {
        voter: this.voter,
        vote: "aye",
        rationale: "no deterministic issues found",
        latencyMs: Date.now() - start,
      };
    }
    const summary = findings
      .slice(0, 10)
      .map((f) => `[L${f.line}] ${f.rule}: ${f.text.trim()}`)
      .join("; ");
    return {
      voter: this.voter,
      vote: "nay",
      rationale: `${findings.length} issue(s): ${summary}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Exported pure scanner so tests can exercise the rules without going
 * through the VoterAgent interface.
 */
export function scanDiff(
  diff: string,
  extra: Array<{ name: string; re: RegExp }> = [],
): Finding[] {
  const findings: Finding[] = [];
  const lines = diff.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Only look at added lines in unified diff format. If the input is
    // not a unified diff at all (no +/- prefixes anywhere) we treat
    // every line as added so the scanner also works on raw code.
    const isUnified = diff.includes("\n+") || diff.startsWith("+");
    const isAdded = isUnified ? raw.startsWith("+") && !raw.startsWith("+++") : true;
    if (!isAdded) continue;
    const text = isUnified ? raw.slice(1) : raw;
    if (ANY_RE.test(text)) {
      findings.push({ line: i + 1, rule: "any-type", text });
    }
    for (const re of MISSING_AWAIT_RES) {
      if (re.test(text)) {
        findings.push({ line: i + 1, rule: "missing-await", text });
        break;
      }
    }
    if (NULL_GUARD_MISSING_RE.test(text)) {
      findings.push({ line: i + 1, rule: "missing-null-guard", text });
    }
    for (const p of extra) {
      if (p.re.test(text)) {
        findings.push({ line: i + 1, rule: p.name, text });
      }
    }
  }
  return findings;
}
