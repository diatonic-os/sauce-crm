import { Semiring } from "./Semiring";

export const MinPlus: Semiring<number> = {
  zero: Infinity,
  one: 0,
  add: (a, b) => Math.min(a, b),
  mul: (a, b) => (a === Infinity || b === Infinity ? Infinity : a + b),
  eq: (a, b) => a === b,
};
