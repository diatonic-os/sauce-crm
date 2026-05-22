import { Semiring } from "./Semiring";

export const BooleanSR: Semiring<boolean> = {
  zero: false,
  one: true,
  add: (a, b) => a || b,
  mul: (a, b) => a && b,
  eq: (a, b) => a === b,
};
