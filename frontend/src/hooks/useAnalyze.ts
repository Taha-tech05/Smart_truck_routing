import { useCallback, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { analyze } from '../api/analyze'
import { type AppError, normalizeError } from '../api/errors'
import { heatmapKey, heatmapQueryOptions } from './useHeatmap'
import type { AnalyzeRequest, AnalyzeResponse } from '../types'

/**
 * Analyze mutation. Starting a new run aborts the previous one and ignores its result;
 * the caller keeps the last successful result itself, so nothing flashes to empty meanwhile.
 */
export function useAnalyze(onSuccess: (data: AnalyzeResponse, req: AnalyzeRequest) => void) {
  const qc = useQueryClient()
  const ctl = useRef<AbortController | null>(null)
  const seq = useRef(0)
  const [error, setError] = useState<AppError | null>(null)

  const mutation = useMutation({
    mutationFn: ({ req, signal }: { req: AnalyzeRequest; signal: AbortSignal }) => analyze(req, signal),
  })

  const run = useCallback(
    (req: AnalyzeRequest) => {
      ctl.current?.abort()
      const c = new AbortController()
      ctl.current = c
      const id = ++seq.current
      setError(null)
      mutation.mutate(
        { req, signal: c.signal },
        {
          onSuccess: (data) => {
            if (id !== seq.current) return // a newer run (or a cancel) superseded this one
            // warm the heatmap for the recommended route right away
            const rec = data.routes.find((r) => r.id === data.recommendation.route_id) ?? data.routes[0]
            if (rec) void qc.prefetchQuery(heatmapQueryOptions(rec, req.load_weight_lb, req.departure_time))
            onSuccess(data, req)
          },
          onError: (e) => {
            if (id !== seq.current) return
            const err = normalizeError(e)
            if (err.code !== 'aborted') setError(err)
          },
        },
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mutation.mutate, qc, onSuccess],
  )

  const cancel = useCallback(() => {
    seq.current++
    ctl.current?.abort()
    mutation.reset()
  }, [mutation])

  return { run, cancel, loading: mutation.isPending, error, clearError: () => setError(null) }
}

export { heatmapKey }
