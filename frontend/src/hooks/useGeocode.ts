import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { geocode } from '../api/geocode'
import { useDebounced } from './useDebounced'

/**
 * Autocomplete suggestions: debounced 250 ms, only for 3+ characters, stale requests are aborted
 * (react-query aborts via the signal when the key changes), results cached, previous list kept.
 */
export function useGeocode(query: string, enabled = true) {
  const q = useDebounced(query.trim(), 250)
  const result = useQuery({
    queryKey: ['geocode', q.toLowerCase()],
    queryFn: ({ signal }) => geocode(q, signal),
    enabled: enabled && q.length >= 3,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  })
  // typing but the debounce has not fired yet counts as loading too
  const pending = enabled && query.trim().length >= 3 && query.trim() !== q
  return { ...result, isSearching: pending || result.isFetching, settled: !pending && result.isSuccess && !result.isFetching }
}
