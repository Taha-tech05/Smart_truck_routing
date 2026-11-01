import { memo } from 'react'
import type { RouteResult } from '../types'
import { formatDuration, formatEta, formatMiles } from '../utils/format'
import { LEVEL_NAMES, MILES_KEYS, riskCssVar } from '../utils/risk'

interface Props {
  route: RouteResult
  selected: boolean
  explanation: string
  fastest: boolean
  onSelect: (id: string) => void
}

function RiskBar({ route }: { route: RouteResult }) {
  const m = route.stats.miles_by_level
  const total = MILES_KEYS.reduce((s, k) => s + m[k], 0) || 1
  const parts = MILES_KEYS.map((k, level) => ({ level, miles: m[k], pct: (m[k] / total) * 100 })).filter(
    (p) => p.miles > 0,
  )
  const label = parts.map((p) => `${LEVEL_NAMES[p.level]} ${Math.round(p.pct)}%`).join(', ')
  return (
    <div
      role="img"
      aria-label={`Share of route by risk: ${label}`}
      className="flex h-2.5 w-full gap-px overflow-hidden rounded-badge bg-surface-2"
    >
      {parts.map((p) => (
        <div key={p.level} style={{ width: `${p.pct}%`, background: riskCssVar(p.level) }} />
      ))}
    </div>
  )
}

function Miles({ level, miles }: { level: number; miles: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: riskCssVar(level) }} />
      <span className="text-muted">{LEVEL_NAMES[level]}</span>
      <span className="font-semibold text-fg">{Math.round(miles)} mi</span>
    </span>
  )
}

function RouteCard({ route, selected, explanation, fastest, onSelect }: Props) {
  const m = route.stats.miles_by_level
  const arrival = route.checkpoints[route.checkpoints.length - 1]?.eta
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(route.id)}
      className={`block w-full cursor-pointer rounded-card bg-surface p-4 text-left transition-colors hover:bg-surface-2 ${
        selected ? 'border-2 border-primary' : 'border border-line'
      }`}
      style={selected ? { padding: 'calc(16px - 1px)' } : undefined}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-bg"
        >
          {route.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold leading-snug text-fg">{route.summary}</div>
          <div className="text-sm text-muted">
            {formatMiles(route.distance_miles)} · {formatDuration(route.duration_s)}
          </div>
          {(route.recommended || fastest) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {route.recommended && (
                <span className="inline-flex h-6 items-center rounded-badge bg-accent px-2.5 text-xs font-semibold text-on-accent">
                  Recommended
                </span>
              )}
              {fastest && (
                <span className="inline-flex h-6 items-center rounded-badge border border-line bg-surface-2 px-2.5 text-xs font-semibold text-fg">
                  Fastest
                </span>
              )}
            </div>
          )}

          <div className="mt-3">
            <RiskBar route={route} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <Miles level={3} miles={route.stats.severe_miles} />
            <Miles level={2} miles={route.stats.high_miles} />
          </div>

          {selected && (
            <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm">
              <p className="text-fg">{explanation}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {MILES_KEYS.map((k, level) => (
                  <Miles key={k} level={level} miles={m[k]} />
                ))}
              </div>
              {arrival && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">ETA at destination</span>
                  <span className="font-semibold text-fg">{formatEta(arrival)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

export default memo(RouteCard)
