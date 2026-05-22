import { computeCompatibleSet } from "./CompatibleSet";
import { clearsThreshold } from "./InfoDensity";

export interface IntroScore {
  score: number;             // 0..1
  passes_threshold: boolean;
  missing_for_threshold: string[];
}

export function scoreIntro(
  a: Record<string, any>,
  b: Record<string, any>,
  fields: string[],
  rhoAdm: number,
): IntroScore {
  const cms = computeCompatibleSet(a, b, fields);
  const passes = clearsThreshold(a, b, fields, rhoAdm);
  const missing: string[] = [];
  if (!passes) {
    for (const f of fields) {
      if (a[f] == null || b[f] == null) missing.push(f);
    }
  }
  return {
    score: cms.density,
    passes_threshold: passes,
    missing_for_threshold: missing,
  };
}
