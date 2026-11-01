import { useQuery } from '@tanstack/react-query'
import { fetchHeatmap } from '../api/heatmap'
import type { RouteResult } from '../types'

/** Cheap identity for a route's geometry: route ids ("route-1") repeat across analyses. */
function geometrySignature(r: RouteResult): string {
  const c = r.geometry.coordinates
  const f = c[0]
  const l = c[c.length - 1]
  return `${c.length}:${f[0].toFixed(3)},${f[1].toFixed(3)}:${l[0].toFixed(3)},${l[1].toFixed(3)}:${r.distance_miles}`
}

export function heatmapKey(route: RouteResult, loadLb: number, departure: string) {
  // keyed by route, load and the start DAY, so moving the departure within a day reuses the data
  return ['heatmap', route.id, geometrySignature(route), loadLb, departure.slice(0, 10)] as const
}

export function heatmapQueryOptions(route: RouteResult, loadLb: number, departure: string) {
  return {
    queryKey: heatmapKey(route, loadLb, departure),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      fetchHeatmap({ route_coordinates: route.geometry.coordinates, load_weight_lb: loadLb }, signal),
    staleTime: 20 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  }
}

/** Heatmap for the SELECTED route only. One request per route; slider moves never hit the network. */
export function useHeatmap(route: RouteResult | null, loadLb: number, departure: string, enabled: boolean) {
  return useQuery({
    ...heatmapQueryOptions(route ?? ({ id: '', geometry: { coordinates: [[0, 0]] }, distance_miles: 0 } as unknown as RouteResult), loadLb, departure),
    enabled: enabled && !!route,
  })
}
