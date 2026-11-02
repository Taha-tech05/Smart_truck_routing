/** Shapes of the backend POST /api/analyze response. */

export type RiskLevelValue = 0 | 1 | 2 | 3 | 4;

export interface CheckpointWeather {
  wind_mph: number
  rain_in_hr: number
  snow_in_hr: number
}

export interface CheckpointRisk {
  level: RiskLevelValue
  level_name: string
  reasons: string[]
}

export interface Checkpoint {
  index: number
  lat: number
  lng: number
  mile: number
  eta: string // ISO 8601
  covers_start: number
  covers_end: number
  weather: CheckpointWeather
  risk: CheckpointRisk
  beyond_forecast: boolean
}

export interface RouteStats {
  severe_miles: number
  high_miles: number
  no_travel_miles: number
  avg_risk: number
  has_no_travel: boolean
  worst_level: RiskLevelValue
  worst_level_name: string
  miles_by_level: Record<'low' | 'moderate' | 'high' | 'severe' | 'no_travel', number>
}

export interface LineStringGeometry {
  type: 'LineString'
  coordinates: [number, number][] // [lng, lat]
}

export interface RouteResult {
  id: string
  /** Descriptive title from the backend, e.g. "Via Amarillo, TX" ("Route N" when unnamed). */
  summary: string
  /** "Fastest" or "+1 h 14 min vs fastest". */
  delta_label: string
  /** Not sent by the current backend; shown as a small tag when present. */
  provider?: string
  distance_miles: number
  duration_s: number
  geometry: LineStringGeometry
  rank: number
  recommended: boolean
  stats: RouteStats
  checkpoints: Checkpoint[]
}

export interface Recommendation {
  route_id: string | null
  explanation: string
  all_unsafe: boolean
}

export interface AnalyzeResponse {
  routes: RouteResult[]
  recommendation: Recommendation
  warnings: string[]
}
