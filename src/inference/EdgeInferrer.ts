// SPEC §31.1 — knows/worked_with from co-attendance.
import {
  combineSignals,
  verdict,
  DEFAULT_THRESHOLDS,
  getThreshold,
  type Verdict,
} from "./ConfidenceModel";

export interface TouchRecord {
  id: string;
  date: string;
  attendees: string[];
  outcomeTags?: string[];
}
export interface EdgeProposal {
  fromId: string;
  toId: string;
  edgeType: "knows" | "worked_with";
  confidence: number;
  verdict: Verdict;
  sources: string[];
}

export class EdgeInferrer {
  constructor(private readonly thresholds = DEFAULT_THRESHOLDS) {}

  inferFrom(touches: TouchRecord[]): EdgeProposal[] {
    const pairs = new Map<
      string,
      {
        count: number;
        lastTs: number;
        sources: Set<string>;
        advice: number;
        intro: number;
      }
    >();
    for (const t of touches) {
      const ts = Date.parse(t.date) || Date.now();
      const adv = (t.outcomeTags ?? []).includes("advice-received") ? 1 : 0;
      const intro = (t.outcomeTags ?? []).includes("intro-made") ? 1 : 0;
      for (let i = 0; i < t.attendees.length; i++) {
        for (let j = i + 1; j < t.attendees.length; j++) {
          const [a, b] = [t.attendees[i], t.attendees[j]].sort();
          const k = `${a}|${b}`;
          const rec = pairs.get(k) ?? {
            count: 0,
            lastTs: 0,
            sources: new Set<string>(),
            advice: 0,
            intro: 0,
          };
          rec.count += 1;
          rec.lastTs = Math.max(rec.lastTs, ts);
          rec.sources.add(`touch:${t.id}`);
          rec.advice += adv;
          rec.intro += intro;
          pairs.set(k, rec);
        }
      }
    }
    const now = Date.now();
    const out: EdgeProposal[] = [];
    for (const [k, r] of pairs) {
      const parts = k.split("|");
      // provably defined: k was constructed as "${a}|${b}" so split yields exactly 2 elements
      const from = parts[0]!;
      const to = parts[1]!;
      const recencyDays = Math.max(0, (now - r.lastTs) / 86400000);
      const recencyFeature = Math.exp(-recencyDays / 180);
      const knowsConf = combineSignals(
        [0.4, 0.6],
        [Math.min(1, r.count / 3), recencyFeature],
      );
      out.push({
        fromId: from,
        toId: to,
        edgeType: "knows",
        confidence: knowsConf,
        verdict: verdict(knowsConf, getThreshold(this.thresholds, "knows")),
        sources: [...r.sources],
      });
      if (r.advice + r.intro > 0) {
        const wwConf = combineSignals(
          [0.5, 0.5],
          [Math.min(1, (r.advice + r.intro) / 2), recencyFeature],
        );
        out.push({
          fromId: from,
          toId: to,
          edgeType: "worked_with",
          confidence: wwConf,
          verdict: verdict(wwConf, getThreshold(this.thresholds, "worked_with")),
          sources: [...r.sources],
        });
      }
    }
    return out.filter((p) => p.verdict !== "discard");
  }
}
