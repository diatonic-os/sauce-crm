/**
 * Information-density threshold ρ_adm. A compatible pair clears the threshold
 * when V(A) > ρ_adm AND V(B) > ρ_adm, where V is the representativity value
 * of each entity's characteristic vector.
 */
export function representativity(entity: Record<string, any>, fields: string[]): number {
  let filled = 0;
  for (const f of fields) {
    const v = entity[f];
    if (v != null && !(Array.isArray(v) && v.length === 0) && v !== "") filled++;
  }
  return fields.length === 0 ? 0 : filled / fields.length;
}

export function clearsThreshold(
  a: Record<string, any>,
  b: Record<string, any>,
  fields: string[],
  rhoAdm: number,
): boolean {
  return representativity(a, fields) > rhoAdm && representativity(b, fields) > rhoAdm;
}
