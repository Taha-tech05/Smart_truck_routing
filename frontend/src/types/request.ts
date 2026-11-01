import type { Place } from './geocode'

export interface AnalyzeRequest {
  origin: Place
  destination: Place
  /** ISO 8601 including the UTC offset, e.g. 2026-11-02T08:00:00-06:00 */
  departure_time: string
  load_weight_lb: number
  interval_miles: 10 | 25 | 50
}

export interface HeatmapRequest {
  route_coordinates: [number, number][] // [lng, lat]
  load_weight_lb: number
  corridor_miles?: number
  spacing_miles?: 10 | 25 | 50
}
