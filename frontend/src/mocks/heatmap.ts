/** Fake POST /api/heatmap response: hardcoded grid, 49 hours of levels as digit strings. */
import type { HeatmapResponse } from '../types'
import { MOCK_LOAD_LB, MOCK_START } from './clock'
import { assess, fakeWeather } from './riskModel'

function build(): HeatmapResponse {
  const points: [number, number, number][] = []
  for (let lat = 31; lat <= 41; lat += 1) {
    for (let lng = -109; lng <= -93; lng += 1.25) points.push([lat, lng, 0])
  }
  const levels = points.map(([lat, lng]) => {
    let s = ''
    for (let h = 0; h <= 48; h++) s += assess(fakeWeather(lat, lng, h), MOCK_LOAD_LB).level
    return s
  })
  const summary = Array.from({ length: 49 }, (_, hour) => {
    const counts = [0, 0, 0, 0, 0]
    levels.forEach((s) => counts[Number(s[hour])]++)
    const max = counts.reduce((m, c, i) => (c ? i : m), 0)
    return { hour, max_level: max, counts }
  })
  return {
    start_time: MOCK_START.toISOString(),
    hours: 49,
    points,
    levels,
    level_names: ['Low', 'Moderate', 'High', 'Severe', 'No Travel'],
    summary,
    missing: 0,
    warnings: [],
  }
}

export const MOCK_HEATMAP: HeatmapResponse = build()
