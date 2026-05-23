// Lightweight grid index — buckets points into ~1° cells and answers radius queries.
import { haversineMeters } from "./DistanceMatrix";

export interface GeoPoint {
  id: string;
  lat: number;
  lon: number;
}

function cellKey(lat: number, lon: number, deg: number): string {
  return `${Math.floor(lat / deg)},${Math.floor(lon / deg)}`;
}

export class GeoIndex {
  private cells = new Map<string, GeoPoint[]>();
  constructor(private readonly cellDeg = 1) {}
  add(p: GeoPoint): void {
    const k = cellKey(p.lat, p.lon, this.cellDeg);
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k)!.push(p);
  }
  clear(): void {
    this.cells.clear();
  }
  nearest(
    lat: number,
    lon: number,
    k: number,
    maxM = Infinity,
  ): { point: GeoPoint; distanceM: number }[] {
    const candidates: GeoPoint[] = [];
    const baseLat = Math.floor(lat / this.cellDeg);
    const baseLon = Math.floor(lon / this.cellDeg);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        candidates.push(
          ...(this.cells.get(`${baseLat + dy},${baseLon + dx}`) ?? []),
        );
      }
    const out = candidates
      .map((p) => ({
        point: p,
        distanceM: haversineMeters(lat, lon, p.lat, p.lon),
      }))
      .filter((r) => r.distanceM <= maxM)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, k);
    return out;
  }
}
