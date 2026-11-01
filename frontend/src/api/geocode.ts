import { apiClient, GEOCODE_TIMEOUT_MS, USE_MOCKS } from './client'
import { isAppError } from './errors'
import type { GeocodeResult } from '../types'

export async function geocode(q: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  if (USE_MOCKS) {
    const { mockGeocode } = await import('../mocks/places')
    return mockGeocode(q)
  }
  try {
    const { data } = await apiClient.get<GeocodeResult[]>('/api/geocode', {
      params: { q },
      signal,
      timeout: GEOCODE_TIMEOUT_MS,
    })
    return data
  } catch (e) {
    if (isAppError(e) && e.code === 'no_results') return []
    throw e
  }
}
