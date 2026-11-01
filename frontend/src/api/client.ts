import axios from 'axios'
import { normalizeError } from './errors'

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

export const ANALYZE_TIMEOUT_MS = 15_000
export const HEATMAP_TIMEOUT_MS = 20_000
export const GEOCODE_TIMEOUT_MS = 8_000

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
  timeout: 10_000,
})

// Every failure leaves this module as an AppError.
apiClient.interceptors.response.use(undefined, (e) => Promise.reject(normalizeError(e)))
