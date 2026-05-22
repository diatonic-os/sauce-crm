import type { IGeocoder, Address } from './Geocoder';
export class ReverseGeocoder {
  constructor(private readonly geocoder: IGeocoder) {}
  reverse(lat: number, lon: number): Promise<Address[]> { return this.geocoder.reverse(lat, lon); }
}
