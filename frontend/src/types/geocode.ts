/** GET /api/geocode?q= -> GeocodeResult[] */
export interface GeocodeResult {
  label: string
  lat: number
  lng: number
}

/** A place the user has actually chosen from the suggestions. */
export type Place = GeocodeResult
