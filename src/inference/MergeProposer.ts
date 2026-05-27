// SPEC §31.1 — Duplicate detection by normalized name + email match.
import {
  combineSignals,
  verdict,
  DEFAULT_THRESHOLDS,
  getThreshold,
  type Verdict,
} from "./ConfidenceModel";

export interface MergeCandidate {
  entityType: "person" | "org";
  aId: string;
  bId: string;
  confidence: number;
  verdict: Verdict;
  reason: string[];
}
export interface CandidateRecord {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
  type: "person" | "org";
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export class MergeProposer {
  propose(records: CandidateRecord[]): MergeCandidate[] {
    const out: MergeCandidate[] = [];
    const byNorm = new Map<string, CandidateRecord[]>();
    for (const r of records) {
      const k = `${r.type}|${norm(r.name)}`;
      if (!byNorm.has(k)) byNorm.set(k, []);
      byNorm.get(k)!.push(r);
    }
    for (const [, group] of byNorm) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          // provably defined: i < group.length, j < group.length
          const a = group[i]!;
          const b = group[j]!;
          const reasons: string[] = ["name_match"];
          let emailMatch = 0;
          for (const e of a.emails)
            if (b.emails.includes(e)) {
              emailMatch = 1;
              reasons.push("email_match");
              break;
            }
          const conf = combineSignals([0.5, 0.5], [1, emailMatch]);
          out.push({
            entityType: a.type,
            aId: a.id,
            bId: b.id,
            confidence: conf,
            verdict: verdict(conf, getThreshold(DEFAULT_THRESHOLDS, "merge")),
            reason: reasons,
          });
        }
      }
    }
    return out.filter((c) => c.verdict !== "discard");
  }
}
