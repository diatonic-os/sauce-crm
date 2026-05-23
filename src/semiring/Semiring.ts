export interface Semiring<T> {
  readonly zero: T; // ⊕ identity (absorbs ⊙)
  readonly one: T; // ⊙ identity
  add(a: T, b: T): T; // ⊕
  mul(a: T, b: T): T; // ⊙
  eq(a: T, b: T): boolean;
}
