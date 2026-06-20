import { describe, it, expect } from "vitest";
import { haversineMeters, distanceMatrix } from "../../src/geo/DistanceMatrix";
import { GeoIndex } from "../../src/geo/GeoIndex";

describe("haversineMeters()", () => {
  it("is zero for identical points", () => {
    expect(haversineMeters(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it("is symmetric: d(a,b) === d(b,a)", () => {
    const ab = haversineMeters(40.7128, -74.006, 34.0522, -118.2437);
    const ba = haversineMeters(34.0522, -118.2437, 40.7128, -74.006);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it("matches a known city-pair distance (NYC↔LA ≈ 3936 km)", () => {
    const d = haversineMeters(40.7128, -74.006, 34.0522, -118.2437);
    expect(d / 1000).toBeGreaterThan(3900);
    expect(d / 1000).toBeLessThan(3970);
  });

  it("handles the antimeridian (179.9 vs -179.9 is a short hop)", () => {
    const d = haversineMeters(0, 179.9, 0, -179.9);
    expect(d / 1000).toBeLessThan(30); // ~22 km, not half the globe
  });

  it("does not return NaN for antipodal points (asin clamp)", () => {
    const d = haversineMeters(0, 0, 0, 180);
    expect(Number.isNaN(d)).toBe(false);
    expect(d / 1000).toBeGreaterThan(20000); // ~half circumference
  });
});

describe("distanceMatrix()", () => {
  it("skips the diagonal and is symmetric", () => {
    const m = distanceMatrix([
      { id: "a", lat: 0, lon: 0 },
      { id: "b", lat: 0, lon: 1 },
    ]);
    expect(m.get("a")!.has("a")).toBe(false);
    expect(m.get("a")!.get("b")).toBeCloseTo(m.get("b")!.get("a")!, 6);
  });
});

describe("GeoIndex.nearest()", () => {
  it("finds candidates more than one cell away when maxM allows (ring sizing)", () => {
    const idx = new GeoIndex(1); // ~111 km cells
    idx.add({ id: "far", lat: 2.5, lon: 0 }); // ~278 km north, 2 cells away
    // Old fixed 3×3 window (±1 cell) would miss it; ring derived from maxM finds it.
    const within = idx.nearest(0, 0, 5, 300_000);
    expect(within.map((r) => r.point.id)).toContain("far");
  });

  it("respects maxM (excludes points beyond the radius)", () => {
    const idx = new GeoIndex(1);
    idx.add({ id: "far", lat: 2.5, lon: 0 }); // ~278 km
    const within = idx.nearest(0, 0, 5, 100_000); // 100 km
    expect(within.map((r) => r.point.id)).not.toContain("far");
  });

  it("returns nearest-first, limited to k", () => {
    const idx = new GeoIndex(1);
    idx.add({ id: "near", lat: 0.1, lon: 0 });
    idx.add({ id: "mid", lat: 0.5, lon: 0 });
    idx.add({ id: "far", lat: 0.9, lon: 0 });
    const res = idx.nearest(0, 0, 2);
    expect(res.map((r) => r.point.id)).toEqual(["near", "mid"]);
  });

  it("unbounded maxM scans all cells", () => {
    const idx = new GeoIndex(1);
    idx.add({ id: "p", lat: 80, lon: 170 }); // far from query, no maxM bound
    const res = idx.nearest(0, 0, 5);
    expect(res.map((r) => r.point.id)).toContain("p");
  });
});
