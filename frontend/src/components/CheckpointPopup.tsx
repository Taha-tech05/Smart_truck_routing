import type { Checkpoint } from '../types'
import { formatEta } from '../utils/format'
import RiskBadge from './RiskBadge'

/** Popup body for a checkpoint. Pure/hook-free so it can be rendered to static HTML for MapLibre. */
export default function CheckpointPopup({ checkpoint: c }: { checkpoint: Checkpoint }) {
  return (
    <div className="w-[240px] font-medium text-fg">
      <div className="flex items-center justify-between gap-2 pr-6">
        <div className="text-base font-semibold">Mile {c.mile.toFixed(0)}</div>
        <RiskBadge level={c.risk.level} />
      </div>
      <div className="mt-0.5 text-xs text-muted">ETA {formatEta(c.eta)}</div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[
          ['Wind', `${c.weather.wind_mph.toFixed(0)} mph`],
          ['Rain', `${c.weather.rain_in_hr.toFixed(2)} in/hr`],
          ['Snow', `${c.weather.snow_in_hr.toFixed(2)} in/hr`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-control bg-surface-2 px-1 py-1.5">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="text-sm font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {c.beyond_forecast && (
        <p className="mt-3 rounded-control bg-surface-2 px-2 py-1.5 text-xs text-muted">
          Forecast unavailable, using last available hour.
        </p>
      )}
      <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-muted">
        {c.risk.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  )
}
