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
    if (!Number.isFinite(maxM)) {
      // Unbounded radius: a fixed cell window could miss far points, so scan all.
      for (const arr of this.cells.values()) candidates.push(...arr);
    } else {
      // Size the cell-ring from maxM instead of a fixed 3×3 window, which only
      // covered ~one cell (~111 km at cellDeg=1) and silently missed farther
      // candidates. Longitude cells shrink toward the poles, so widen the lon
      // ring by 1/cos(lat).
      const baseLat = Math.floor(lat / this.cellDeg);
      const baseLon = Math.floor(lon / this.cellDeg);
      const metersPerDeg = 111_320;
      const cellM = this.cellDeg * metersPerDeg;
      const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
      const latRing = Math.max(1, Math.ceil(maxM / cellM));
      const lonRing = Math.max(1, Math.ceil(maxM / (cellM * cosLat)));
      for (let dy = -latRing; dy <= latRing; dy++)
        for (let dx = -lonRing; dx <= lonRing; dx++) {
          candidates.push(
            ...(this.cells.get(`${baseLat + dy},${baseLon + dx}`) ?? []),
          );
        }
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
