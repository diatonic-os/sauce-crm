import { Semiring } from "./Semiring";

export const MaxPlus: Semiring<number> = {
  zero: -Infinity,
  one: 0,
  add: (a, b) => Math.max(a, b),
  mul: (a, b) => (a === -Infinity || b === -Infinity ? -Infinity : a + b),
  eq: (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b)),
};
