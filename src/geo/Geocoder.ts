// SPEC §28.1 — Geocoder provider interface + OSM Nominatim default.
import type { ProxyClient } from "../security/ProxyClient";

export interface Geo {
  lat: number;
  lon: number;
  accuracyM: number;
  address: string;
  raw?: unknown;
}
export interface Address {
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  formatted: string;
}

export interface IGeocoder {
  id: string;
  geocode(addr: string): Promise<Geo[]>;
  reverse(lat: number, lon: number): Promise<Address[]>;
}

export class OSMNominatim implements IGeocoder {
  readonly id = "osm-nominatim";
  private lastCall = 0;
  constructor(
    private readonly proxy: ProxyClient,
    private readonly userAgent = "sauce-graph/0.1 (contact via plugin settings)",
  ) {}
  private async throttle(): Promise<void> {
    const dt = Date.now() - this.lastCall;
    if (dt < 1000) await new Promise((r) => setTimeout(r, 1000 - dt));
    this.lastCall = Date.now();
  }
  async geocode(addr: string): Promise<Geo[]> {
    await this.throttle();
    const r = await this.proxy.fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=5`,
      {
        headers: { "User-Agent": this.userAgent, Accept: "application/json" },
      },
    );
    if (r.status >= 400) return [];
    type N = Array<{
      lat: string;
      lon: string;
      display_name: string;
      importance?: number;
    }>;
    return (JSON.parse(r.body) as N).map((n) => ({
      lat: parseFloat(n.lat),
      lon: parseFloat(n.lon),
      accuracyM: 100,
      address: n.display_name,
      raw: n,
    }));
  }
  async reverse(lat: number, lon: number): Promise<Address[]> {
    await this.throttle();
    const r = await this.proxy.fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      {
        headers: { "User-Agent": this.userAgent, Accept: "application/json" },
      },
    );
    if (r.status >= 400) return [];
    type N = { display_name: string; address?: Record<string, string> };
    const n = JSON.parse(r.body) as N;
    const a = n.address ?? {};
    // exactOptionalPropertyTypes: only spread defined fields so optional
    // Address properties are absent (not undefined) when the geocoder omits them.
    const addr: Address = { formatted: n.display_name };
    if (a.road !== undefined) addr.street = a.road;
    const city = a.city ?? a.town ?? a.village;
    if (city !== undefined) addr.city = city;
    if (a.state !== undefined) addr.region = a.state;
    if (a.postcode !== undefined) addr.postalCode = a.postcode;
    if (a.country !== undefined) addr.country = a.country;
    return [addr];
  }
}

export class MapboxGeocoder implements IGeocoder {
  readonly id = "mapbox";
  constructor(
    private readonly proxy: ProxyClient,
    private readonly token: () => Promise<string>,
  ) {}
  async geocode(addr: string): Promise<Geo[]> {
    const tok = await this.token();
    const r = await this.proxy.fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addr)}.json?access_token=${tok}`,
      { headers: { Accept: "application/json" } },
    );
    if (r.status >= 400) return [];
    type M = {
      features: Array<{ center: [number, number]; place_name: string }>;
    };
    const j = JSON.parse(r.body) as M;
    return j.features.map((f) => ({
      lat: f.center[1],
      lon: f.center[0],
      accuracyM: 50,
      address: f.place_name,
      raw: f,
    }));
  }
  async reverse(lat: number, lon: number): Promise<Address[]> {
    const tok = await this.token();
    const r = await this.proxy.fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${tok}`,
      { headers: { Accept: "application/json" } },
    );
    if (r.status >= 400) return [];
    type M = { features: Array<{ place_name: string }> };
    const j = JSON.parse(r.body) as M;
    return j.features.slice(0, 1).map((f) => ({ formatted: f.place_name }));
  }
}
