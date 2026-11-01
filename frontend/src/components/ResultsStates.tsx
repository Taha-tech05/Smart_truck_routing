import { useEffect, useState } from 'react'
import { AlertOctagon, CloudOff, Loader2, RotateCw } from 'lucide-react'
import type { AppError } from '../api/errors'

const STEPS = ['Finding routes', 'Checking weather', 'Scoring risk']
const STEP_AT_MS = [0, 3000, 7000]

/** Timed status text (no percentages) plus a Cancel button. */
export function AnalyzeProgress({ onCancel }: { onCancel: () => void }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const timers = STEP_AT_MS.map((ms, i) => window.setTimeout(() => setStep(i), ms))
    return () => timers.forEach(window.clearTimeout)
  }, [])
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 text-sm">
      <Loader2 size={16} className="shrink-0 animate-spin text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-semibold text-fg">{STEPS[step]}…</span>
      <button
        type="button"
        onClick={onCancel}
        className="h-8 cursor-pointer rounded-control border border-line px-3 text-xs font-semibold text-fg hover:bg-surface-2"
      >
        Cancel
      </button>
    </div>
  )
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="animate-pulse rounded-card border border-line p-4">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded-full bg-surface-2" />
            <div className="h-5 w-2/3 rounded bg-surface-2" />
          </div>
          <div className="mt-3 h-4 w-1/2 rounded bg-surface-2 pl-9" />
          <div className="mt-3 h-1.5 rounded-badge bg-surface-2" />
          <div className="mt-2 h-3 w-1/3 rounded bg-surface-2" />
        </div>
      ))}
    </div>
  )
}

export function ErrorCard({ error, onRetry }: { error: AppError; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex gap-3 rounded-card border border-line bg-surface-2 p-4">
      <CloudOff size={20} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-5 text-fg">{error.message}</p>
        {error.retryable && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex h-8 cursor-pointer items-center gap-2 rounded-control bg-primary px-3 text-xs font-semibold text-bg hover:opacity-90"
          >
            <RotateCw size={14} aria-hidden="true" />
            Retry
          </button>
        )}
      </div>
    </div>
  )
}

export function AllUnsafeBanner() {
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-card border border-risk-severe/50 p-4"
      style={{ background: 'color-mix(in srgb, var(--risk-severe) 12%, var(--surface))' }}
    >
      <AlertOctagon size={20} className="mt-0.5 shrink-0 text-risk-severe" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold leading-5 text-fg">No route is advisable at this departure time.</p>
        <p className="mt-1 text-xs text-muted">Every route has No Travel conditions. Try changing the departure time.</p>
      </div>
    </div>
  )
}
