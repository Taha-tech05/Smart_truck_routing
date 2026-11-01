import { memo } from 'react'
import type { AnalyzeResponse } from '../types'
import RouteCard from './RouteCard'

interface Props {
  analysis: AnalyzeResponse
  selectedId: string | null
  onSelect: (id: string) => void
}

function RouteList({ analysis, selectedId, onSelect }: Props) {
  const winner = analysis.routes.find((r) => r.recommended)
  const fastestId = analysis.routes.reduce((a, b) => (b.duration_s < a.duration_s ? b : a)).id
  return (
    <section aria-label="Route options" className="flex flex-col gap-3">
      {analysis.warnings.length > 0 && (
        <div role="status" className="rounded-control border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
          {analysis.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
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
