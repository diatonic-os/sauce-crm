// SPEC §31.3 — Logistic combination of source signals, per-kind thresholds.
export interface ConfidenceConfig {
  autoAccept: number;
  propose: number;
  discard: number;
}

export const DEFAULT_THRESHOLDS: Record<string, ConfidenceConfig> = {
  knows: { autoAccept: 1, propose: 0.6, discard: 0.3 },
  worked_with: { autoAccept: 1, propose: 0.7, discard: 0.3 },
  company: { autoAccept: 1, propose: 0.65, discard: 0.3 },
  parent: { autoAccept: 1, propose: 0.8, discard: 0.4 },
  family_of: { autoAccept: 1, propose: 0.75, discard: 0.4 },
  merge: { autoAccept: 1, propose: 0.85, discard: 0.5 },
  tags: { autoAccept: 1, propose: 0.55, discard: 0.3 },
};

/** Fallback used when a threshold key is not present in the registry. */
export const FALLBACK_THRESHOLD: ConfidenceConfig = {
  autoAccept: 1,
  propose: 0.65,
  discard: 0.3,
};

/**
 * Look up a ConfidenceConfig by key. Returns FALLBACK_THRESHOLD when the key
 * is absent so callers always receive a defined config.
 */
export function getThreshold(
  thresholds: Record<string, ConfidenceConfig>,
  key: string,
): ConfidenceConfig {
  return thresholds[key] ?? FALLBACK_THRESHOLD;
}

export function logistic(weightedSum: number, bias = 0): number {
  return 1 / (1 + Math.exp(-(weightedSum + bias)));
}

export function combineSignals(weights: number[], features: number[]): number {
  let s = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]!; // provably defined: i < weights.length
    s += w * (features[i] ?? 0); // features may be shorter; ?? 0 is the intended fallback
  }
  return logistic(s);
}

export type Verdict = "auto_accept" | "propose" | "discard";
export function verdict(conf: number, cfg: ConfidenceConfig): Verdict {
  if (conf >= cfg.autoAccept) return "auto_accept";
  if (conf >= cfg.propose) return "propose";
  return "discard";
}
