import { memo, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type { AnalyzeResponse } from '../types'
import RouteCard from './RouteCard'

interface Props {
  analysis: AnalyzeResponse
  selectedId: string | null
  onSelect: (id: string) => void
}

function RouteList({ analysis, selectedId, onSelect }: Props) {
  const [dismissed, setDismissed] = useState<string[]>([])
  const warnings = analysis.warnings.filter((w) => !dismissed.includes(w))
  const winner = analysis.routes.find((r) => r.recommended)
  const fastestId = analysis.routes.reduce((a, b) => (b.duration_s < a.duration_s ? b : a)).id
  return (
    <section aria-label="Route options" className="flex flex-col gap-4">
      {warnings.map((w) => (
        <div
          key={w}
          role="status"
          className="flex h-8 max-w-full items-center gap-2 self-start rounded-badge border border-line bg-surface-2 pl-3 pr-1 text-xs text-muted"
        >
          <AlertTriangle size={14} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 truncate" title={w}>
            {w}
          </span>
          <button
            type="button"
            aria-label="Dismiss warning"
            onClick={() => setDismissed((d) => [...d, w])}
            className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-surface"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      {analysis.routes.map((r) => {
        const explanation = r.recommended
          ? analysis.recommendation.explanation
          : winner
            ? `Compared with the recommended route: ${diff(r.stats.severe_miles - winner.stats.severe_miles, 'Severe')}, ${diff(
                r.stats.high_miles - winner.stats.high_miles,
                'High-risk',
              )}, ${minutes(r.duration_s - winner.duration_s)}.`
            : ''
        return (
          <RouteCard
            key={r.id}
            route={r}
            selected={r.id === selectedId}
            explanation={explanation}
            fastest={r.id === fastestId}
            onSelect={onSelect}
          />
        )
      })}
    </section>
  )
}

function diff(delta: number, label: string): string {
  const d = Math.round(delta)
  return `${d >= 0 ? '+' : '−'}${Math.abs(d)} ${label} mi`
}

function minutes(deltaS: number): string {
  const m = Math.round(deltaS / 60)
  return `${m >= 0 ? '+' : '−'}${Math.abs(m)} min`
}

export default memo(RouteList)
