/**
 * Fake POST /api/heatmap response. The grid is corridor-shaped like the real one: it follows the
 * Dallas -> Denver routes (centre line plus +/-15 and +/-30 miles), de-duplicated, with 49 hours of
 * levels per point as digit strings.
 */
import type { HeatmapResponse } from '../types'
import { MOCK_LOAD_LB, MOCK_START } from './clock'
import { MOCK_ANALYSIS } from './analyze'
import { assess, fakeWeather } from './riskModel'
import { cumulative, type LngLat } from '../utils/geo'

const OFFSETS_MI = [-30, -15, 0, 15, 30]
const STEP_MI = 25
const DEDUPE_MI = 14

function build(): HeatmapResponse {
  const points: [number, number, number][] = []
  const seen = new Set<string>()
  const cell = (lat: number, lng: number) => `${Math.round(lat / (DEDUPE_MI / 69))}:${Math.round(lng / (DEDUPE_MI / 53))}`

  for (const route of MOCK_ANALYSIS.routes) {
    const coords = route.geometry.coordinates as LngLat[]
    const cum = cumulative(coords)
    let i = 1
    for (let mile = 0; mile <= cum[cum.length - 1]; mile += STEP_MI) {
      while (i < cum.length - 1 && cum[i] < mile) i++
      const a = coords[Math.max(0, i - 4)]
      const b = coords[Math.min(coords.length - 1, i + 3)]
      const cosLat = Math.cos((coords[i][1] * Math.PI) / 180)
      // direction in miles, then its left-hand normal
      const dx = (b[0] - a[0]) * 69.17 * cosLat
      const dy = (b[1] - a[1]) * 69.17
      const len = Math.hypot(dx, dy) || 1
      for (const off of OFFSETS_MI) {
        const lng = coords[i][0] + ((-dy / len) * off) / (69.17 * cosLat)
        const lat = coords[i][1] + ((dx / len) * off) / 69.17
        const key = cell(lat, lng)
        if (seen.has(key)) continue
        seen.add(key)
        points.push([Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4, Math.round(mile)])
      }
    }
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
