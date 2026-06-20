// Haversine — sufficient for ranking nearest contacts.
export function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  // Clamp the asin argument: floating-point error can push sqrt(s) marginally
  // above 1 for near-antipodal points, which would yield NaN.
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function distanceMatrix(
  points: { id: string; lat: number; lon: number }[],
): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!; // i < points.length — bounds-checked by loop condition
    const row = new Map<string, number>();
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const b = points[j]!; // j < points.length — bounds-checked by loop condition
      row.set(b.id, haversineMeters(a.lat, a.lon, b.lat, b.lon));
    }
    m.set(a.id, row); // a is provably defined (hoisted above)
  }
  return m;
}
