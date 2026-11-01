import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { Checkpoint, RouteResult } from '../types'
import { length as lineLength, lineSliceAlong } from '@turf/turf'

export const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

/**
 * Split a route into pieces coloured by risk: each checkpoint "covers" a stretch of road
 * (covers_start..covers_end miles) and that stretch takes the checkpoint's risk level.
 * Adjacent stretches with the same level are merged.
 */
/** A stretch of the route between two mile marks, via turf.lineSliceAlong (clamped to the line). */
function sliceMiles(line: Feature<LineString>, total: number, from: number, to: number) {
  const a = Math.min(Math.max(from, 0), total)
  const b = Math.min(Math.max(to, 0), total)
  if (b - a < 1e-6) return line.geometry.coordinates.slice(0, 2)
  return lineSliceAlong(line, a, b, { units: 'miles' }).geometry.coordinates
}

export function riskSegments(route: RouteResult): FeatureCollection<LineString> {
  const line: Feature<LineString> = { type: 'Feature', properties: {}, geometry: route.geometry }
  const total = lineLength(line, { units: 'miles' })
  const features: Feature<LineString>[] = []
  let current: { level: number; from: number; to: number } | null = null

  const flush = () => {
    if (!current) return
    features.push({
      type: 'Feature',
      properties: { level: current.level, routeId: route.id },
      geometry: { type: 'LineString', coordinates: sliceMiles(line, total, current.from, current.to) },
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
      id: c.index,
      properties: { level: c.risk.level, index: c.index, routeId: route.id },
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
    })),
  }
}
