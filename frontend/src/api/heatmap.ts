import { apiClient, HEATMAP_TIMEOUT_MS, USE_MOCKS } from './client'
import type { HeatmapRequest, HeatmapResponse } from '../types'

const MAX_VERTICES = 50_000

export async function fetchHeatmap(req: HeatmapRequest, signal?: AbortSignal): Promise<HeatmapResponse> {
  if (USE_MOCKS) {
    const { MOCK_HEATMAP } = await import('../mocks/heatmap')
    await new Promise((r) => setTimeout(r, 900))
    return MOCK_HEATMAP
  }
  // The backend rejects bodies over 50,000 vertices: thin the line out evenly if it is larger.
  let coords = req.route_coordinates
  if (coords.length > MAX_VERTICES) {
    const step = Math.ceil(coords.length / MAX_VERTICES)
    coords = coords.filter((_, i) => i % step === 0 || i === coords.length - 1)
  }
  const { data } = await apiClient.post<HeatmapResponse>(
    '/api/heatmap',
    { ...req, route_coordinates: coords },
    { signal, timeout: HEATMAP_TIMEOUT_MS },
  )
  return data
}
