import { ANALYZE_TIMEOUT_MS, apiClient, USE_MOCKS } from './client'
import type { AnalyzeRequest, AnalyzeResponse } from '../types'

export async function analyze(req: AnalyzeRequest, signal?: AbortSignal): Promise<AnalyzeResponse> {
  if (USE_MOCKS) {
    const { MOCK_ANALYSIS } = await import('../mocks/analyze')
    await new Promise((r) => setTimeout(r, 2500))
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return MOCK_ANALYSIS
  }
  const { data } = await apiClient.post<AnalyzeResponse>('/api/analyze', req, {
    signal,
    timeout: ANALYZE_TIMEOUT_MS,
  })
  return data
}
