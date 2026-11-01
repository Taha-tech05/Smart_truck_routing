import { memo } from 'react'
import { Clock, Flag, Route as RouteIcon } from 'lucide-react'
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
      className="flex h-1.5 w-full overflow-hidden rounded-badge bg-surface-2"
    >
      {parts.map((p) => (
        <div key={p.level} style={{ width: `${p.pct}%`, background: riskCssVar(p.level) }} />
      ))}
    </div>
  )
}

/** Collapsible region: animates height with the grid 0fr -> 1fr trick. */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
      style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

function RouteCard({ route, selected, explanation, fastest, onSelect }: Props) {
  const m = route.stats.miles_by_level
  const total = MILES_KEYS.reduce((s, k) => s + m[k], 0) || 1
  const arrival = route.checkpoints[route.checkpoints.length - 1]?.eta
  const select = () => onSelect(route.id)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={select}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          select()
        }
      }}
      className={`block w-full cursor-pointer rounded-card border p-4 text-left transition-[background-color,box-shadow] duration-150 ${
        selected ? 'border-transparent' : 'border-line bg-surface hover:bg-surface-2'
      }`}
      style={
        selected
          ? {
              boxShadow: '0 0 0 1.5px var(--primary)',
              background: 'color-mix(in srgb, var(--primary) var(--tint), var(--surface))',
            }
          : undefined
      }
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-bg"
        >
          {route.rank}
        </span>
        <div className="min-w-0 flex-1 truncate text-base font-semibold leading-6 text-fg" title={route.summary}>
          {route.summary}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pl-9">
        <div className="inline-flex items-center gap-2 text-sm text-muted">
          <RouteIcon size={14} aria-hidden="true" />
          <span className="font-semibold text-fg">{formatMiles(route.distance_miles)}</span>
          <span aria-hidden="true">·</span>
          <Clock size={14} aria-hidden="true" />
          <span className="font-semibold text-fg">{formatDuration(route.duration_s)}</span>
        </div>
        {(route.recommended || fastest) && (
          <div className="flex gap-2">
            {route.recommended && (
              <span className="inline-flex h-5 items-center rounded-badge bg-accent px-2 text-xs font-semibold text-on-accent">
                Recommended
              </span>
            )}
            {fastest && (
              <span className="inline-flex h-5 items-center rounded-badge border border-line bg-surface-2 px-2 text-xs font-semibold text-muted">
                Fastest
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-3">
        <RiskBar route={route} />
      </div>

      {/* One-line summary while collapsed; replaced by the full breakdown when selected. */}
      <Collapse open={!selected}>
        <div className="pt-2 text-xs text-muted">
          Severe <span className="font-semibold text-fg">{Math.round(route.stats.severe_miles)} mi</span>
          <span aria-hidden="true"> · </span>
          High <span className="font-semibold text-fg">{Math.round(route.stats.high_miles)} mi</span>
        </div>
      </Collapse>

      <Collapse open={selected}>
        <div className="space-y-3 pt-3">
          <p className="text-sm leading-5 text-fg">{explanation}</p>
          <ul className="space-y-2" aria-label="Miles by risk level">
            {MILES_KEYS.map((k, level) => (
              <li key={k} className="grid grid-cols-[8px_72px_1fr_56px] items-center gap-2 text-xs">
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: riskCssVar(level) }} />
                <span className="text-muted">{LEVEL_NAMES[level]}</span>
                <span className="h-1 overflow-hidden rounded-badge bg-surface-2" aria-hidden="true">
                  <span
                    className="block h-full rounded-badge"
                    style={{ width: `${(m[k] / total) * 100}%`, background: riskCssVar(level) }}
                  />
                </span>
                <span className="text-right font-semibold text-fg">{Math.round(m[k])} mi</span>
              </li>
            ))}
          </ul>
          {arrival && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Flag size={14} aria-hidden="true" />
              Arrives <span className="font-semibold text-fg">{formatEta(arrival)}</span>
            </div>
          )}
        </div>
      </Collapse>
    </div>
  )
}

export default memo(RouteCard)
