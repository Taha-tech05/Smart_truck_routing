import axios from 'axios'

/** The only error type the UI deals with. */
export interface AppError {
  code: string
  message: string
  retryable: boolean
  /** Shown to the user as-is (a backend validation message rather than a generic one). */
  userFacing: boolean
}

export const BUSY_MESSAGE = 'Weather or routing service is busy, try again in a moment.'
const RETRYABLE_STATUS = new Set([429, 502, 503, 504])

export function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'code' in e && 'retryable' in e && 'message' in e
}

/** Turns backend {error:{code,message}}, network failures and timeouts into one AppError. */
export function normalizeError(e: unknown): AppError {
  if (isAppError(e)) return e
  if (axios.isCancel(e)) return { code: 'aborted', message: 'Request cancelled.', retryable: false, userFacing: false }
  if (axios.isAxiosError(e)) {
    if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT')
      return { code: 'timeout', message: BUSY_MESSAGE, retryable: true, userFacing: true }
    const res = e.response
    if (!res)
      return {
        code: 'network',
        message: "Can't reach the server. Check your connection and try again.",
        retryable: true,
        userFacing: true,
      }
    const body = res.data?.error as { code?: string; message?: string } | undefined
    const retryable = RETRYABLE_STATUS.has(res.status)
    if (body?.code === 'routing_auth_failed')
      return {
        code: 'routing_auth_failed',
        message:
          'The routing service is not available right now (its API key was rejected or its daily quota is used up). Try again later.',
        retryable: false,
        userFacing: true,
      }
    if (body?.code === 'weather_unavailable' && /daily/i.test(body.message ?? ''))
      return {
        code: 'weather_unavailable',
        message: 'The weather service has reached its daily limit for this server. Please try again tomorrow.',
        retryable: false,
        userFacing: true,
      }
    if (body?.code === 'no_route')
      return {
        code: 'no_route',
        message:
          "We couldn't find a drivable road near one of these places. Pick a different suggestion or a more specific address.",
        retryable: false,
        userFacing: true,
      }
    return {
      code: body?.code ?? `http_${res.status}`,
      message: retryable ? BUSY_MESSAGE : (body?.message ?? 'Something went wrong. Please try again.'),
      retryable,
      userFacing: !retryable && !!body?.message,
    }
  }
  return { code: 'unknown', message: 'Something went wrong. Please try again.', retryable: false, userFacing: false }
}
