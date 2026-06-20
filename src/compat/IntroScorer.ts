import { computeCompatibleSet } from "./CompatibleSet";
import { clearsThreshold, isFilled } from "./InfoDensity";

export interface IntroScore {
  score: number; // 0..1 — plain Jaccard density (|shared| / |union|), unweighted
  passes_threshold: boolean;
  missing_for_threshold: string[]; // fields to fill to raise representativity
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
    // Fields unfilled on either side — filling them raises representativity
    // toward rhoAdm. Uses the same "filled" predicate as representativity().
    for (const f of fields) {
      if (!isFilled(a[f]) || !isFilled(b[f])) missing.push(f);
    }
  }
  return {
    score: cms.density,
    passes_threshold: passes,
    missing_for_threshold: missing,
  };
}
