import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { Checkpoint, RouteResult } from '../types'
import { cumulative, slice, type LngLat } from './geo'

export const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

/**
 * Split a route into pieces coloured by risk: each checkpoint "covers" a stretch of road
 * (covers_start..covers_end miles) and that stretch takes the checkpoint's risk level.
 * Adjacent stretches with the same level are merged.
 */
export function riskSegments(route: RouteResult): FeatureCollection<LineString> {
  const coords = route.geometry.coordinates as LngLat[]
  const cum = cumulative(coords)
  const features: Feature<LineString>[] = []
  let current: { level: number; from: number; to: number } | null = null

  const flush = () => {
    if (!current) return
    features.push({
      type: 'Feature',
      properties: { level: current.level, routeId: route.id },
      geometry: { type: 'LineString', coordinates: slice(coords, cum, current.from, current.to) },
    })
  }

  for (const c of route.checkpoints) {
    if (c.covers_end <= c.covers_start) continue
    if (current && current.level === c.risk.level) current.to = c.covers_end
    else {
      flush()
      current = { level: c.risk.level, from: c.covers_start, to: c.covers_end }
    }
  }
  flush()
  return { type: 'FeatureCollection', features }
}

export function checkpointPoints(route: RouteResult): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: route.checkpoints.map((c: Checkpoint) => ({
      type: 'Feature',
      properties: { level: c.risk.level, index: c.index, routeId: route.id },
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
    })),
  }
}
