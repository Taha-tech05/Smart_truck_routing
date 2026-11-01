/** Fake POST /api/analyze response (Dallas -> Denver), same shape as the real one. */
import type { AnalyzeResponse, Checkpoint, RouteResult, RouteStats } from '../types'
import { MILES_KEYS } from '../utils/risk'
import { MOCK_DEPARTURE, MOCK_LOAD_LB, MOCK_START } from './clock'
import { cumulative, densify, pointAt, type LngLat } from '../utils/geo'
import { assess, fakeWeather } from './riskModel'

const NAMES = ['Low', 'Moderate', 'High', 'Severe', 'No Travel']

const WAYPOINTS: Record<string, { speed: number; path: LngLat[] }> = {
  a: {
    speed: 56,
    path: [
      [-96.8, 32.78], [-98.49, 33.91], [-100.21, 34.43], [-101.83, 35.22], [-102.51, 36.06],
      [-104.44, 36.9], [-104.5, 37.17], [-104.61, 38.25], [-104.82, 38.83], [-104.99, 39.74],
    ],
  },
  b: {
    speed: 55,
    path: [
      [-96.8, 32.78], [-97.52, 35.47], [-99.39, 36.43], [-100.92, 37.04], [-102.62, 38.09],
      [-103.69, 39.26], [-104.99, 39.74],
    ],
  },
  c: {
    speed: 57,
    path: [
      [-96.8, 32.78], [-97.52, 35.47], [-97.34, 37.69], [-99.33, 38.88], [-101.71, 39.35],
      [-104.99, 39.74],
    ],
  },
}

const INTERVAL = 25
const VIA = ['Via Amarillo (I-27)', 'Via Oklahoma City (US-287)', 'Via Wichita (I-35 / US-34)']
const round2 = (n: number) => Math.round(n * 100) / 100
const r1 = (n: number) => Math.round(n * 10) / 10

interface Built {
  id: string
  coords: LngLat[]
  miles: number
  durationS: number
  checkpoints: Checkpoint[]
  stats: RouteStats
}

function buildRoute(key: string, id: string): Built {
  const { speed, path } = WAYPOINTS[key]
  const coords = densify(path)
  const cum = cumulative(coords)
  const total = cum[cum.length - 1]
  const durationS = (total / speed) * 3600

  const miles = [0]
  for (let m = INTERVAL; m < total - 1e-6; m += INTERVAL) miles.push(m)
  if (miles.length > 1 && total - miles[miles.length - 1] < 1) miles.pop()
  miles.push(total)

  const byLevel = [0, 0, 0, 0, 0]
  const checkpoints: Checkpoint[] = miles.map((mile, i) => {
    const start = i === 0 ? 0 : (miles[i - 1] + mile) / 2
    const end = i === miles.length - 1 ? total : (mile + miles[i + 1]) / 2
    const [lng, lat] = pointAt(coords, cum, mile)
    const eta = new Date(MOCK_DEPARTURE.getTime() + (mile / total) * durationS * 1000)
    const hour = Math.min(48, Math.max(0, Math.round((eta.getTime() - MOCK_START.getTime()) / 3600000)))
    const wx = fakeWeather(lat, lng, hour)
    const { level, reasons } = assess(wx, MOCK_LOAD_LB)
    byLevel[level] += end - start
    return {
      index: i,
      lat,
      lng,
      mile: r1(mile),
      eta: eta.toISOString(),
      covers_start: r1(start),
      covers_end: r1(end),
      weather: {
        wind_mph: r1(wx.wind),
        rain_in_hr: round2(wx.rain),
        snow_in_hr: round2(wx.snow),
      },
      risk: { level, level_name: NAMES[level], reasons },
      beyond_forecast: false,
    }
  })

  const covered = byLevel.reduce((a, b) => a + b, 0)
  const worst = Math.max(...checkpoints.map((c) => c.risk.level)) as 0 | 1 | 2 | 3 | 4
  const stats: RouteStats = {
    severe_miles: round2(byLevel[3]),
    high_miles: round2(byLevel[2]),
    no_travel_miles: round2(byLevel[4]),
    avg_risk: round2(byLevel.reduce((s, m, l) => s + m * l, 0) / covered),
    has_no_travel: byLevel[4] > 0,
    worst_level: worst,
    worst_level_name: NAMES[worst],
    miles_by_level: Object.fromEntries(
      MILES_KEYS.map((k, i) => [k, round2(byLevel[i])]),
    ) as RouteStats['miles_by_level'],
  }
  return { id, coords, miles: total, durationS, checkpoints, stats }
}

function rankKey(s: RouteStats, durationS: number): number[] {
  return [Number(s.has_no_travel), r1(s.severe_miles), r1(s.high_miles), r1(s.avg_risk), durationS]
}

export function buildMockAnalysis(): AnalyzeResponse {
  const built = Object.keys(WAYPOINTS).map((k, i) => buildRoute(k, `route-${i + 1}`))

  const ranked = [...built].sort((x, y) => {
    const kx = rankKey(x.stats, x.durationS)
    const ky = rankKey(y.stats, y.durationS)
    for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return kx[i] - ky[i]
    return 0
  })

  const routes: RouteResult[] = built.map((b, idx) => {
    const summary = VIA[idx]
    const rank = ranked.indexOf(b) + 1
    return {
      id: b.id,
      summary,
      distance_miles: round2(b.miles),
      duration_s: Math.round(b.durationS),
      geometry: { type: 'LineString', coordinates: b.coords },
      rank,
      recommended: rank === 1,
      stats: b.stats,
      checkpoints: b.checkpoints,
    }
  })

  const [win, run] = ranked
  const rn = `Route ${built.indexOf(run) + 1}`
  const w = win.stats
  const r = run.stats
  let explanation: string
  if (r1(w.severe_miles) !== r1(r.severe_miles))
    explanation = `${r1(w.severe_miles)} Severe miles vs ${r1(r.severe_miles)} on ${rn}`
  else if (r1(w.high_miles) !== r1(r.high_miles))
    explanation = `${r1(w.high_miles)} High-risk miles vs ${r1(r.high_miles)} on ${rn}`
  else if (r1(w.avg_risk) !== r1(r.avg_risk))
    explanation = `Lower average risk (${r1(w.avg_risk)} vs ${r1(r.avg_risk)} on ${rn})`
  else
    explanation = `Same weather risk as ${rn} but ${Math.round((run.durationS - win.durationS) / 60)} minutes faster`

  return {
    routes: routes.sort((a, b) => a.rank - b.rank),
    recommendation: { route_id: win.id, explanation, all_unsafe: false },
    warnings: ['Fewer alternatives found for this trip.'],
  }
}

export const MOCK_ANALYSIS: AnalyzeResponse = buildMockAnalysis()
