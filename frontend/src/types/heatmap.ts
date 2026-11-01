/** Shape of the backend POST /api/heatmap response. */

export interface HeatmapSummaryRow {
  hour: number
  max_level: number
  counts: number[] // 5 ints, one per risk level
}

export interface HeatmapResponse {
  start_time: string // ISO UTC of hour 0
  hours: number // 49
  points: [number, number, number][] // [lat, lng, mile_along]
  levels: string[] // one 49-char digit string ("0"-"4") per point, same order as points
  level_names: string[]
  summary: HeatmapSummaryRow[]
  missing: number
  warnings: string[]
}
