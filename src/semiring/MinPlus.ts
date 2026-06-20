import { Semiring } from "./Semiring";

export const MinPlus: Semiring<number> = {
  zero: Infinity,
  one: 0,
  add: (a, b) => Math.min(a, b),
  mul: (a, b) => (a === Infinity || b === Infinity ? Infinity : a + b),
  // Match MaxPlus.eq: treat NaN as equal to NaN so a poisoned cell does not
  // prevent closure()'s eqMatrix convergence check from ever stabilizing.
  eq: (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b)),
};
