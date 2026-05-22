import { Semiring } from "./Semiring";

// (R ∪ {-∞}, max, min) — widest-path / max-bottleneck semiring.
export const WidthSR: Semiring<number> = {
  zero: -Infinity,
  one: Infinity,
  add: (a, b) => Math.max(a, b),
  mul: (a, b) => Math.min(a, b),
  eq: (a, b) => a === b,
};
