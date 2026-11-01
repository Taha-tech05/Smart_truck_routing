import { memo, useId } from 'react'
import { formatHour } from '../utils/format'
import { LEVEL_NAMES, riskCssVar } from '../utils/risk'

interface Props {
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  hour: number
  onHourChange: (h: number) => void
  playing: boolean
  onPlayingChange: (v: boolean) => void
  start: Date
  hours?: number
}

const TICKS = [0, 12, 24, 36, 48]

function at(start: Date, h: number): Date {
  return new Date(start.getTime() + h * 3600 * 1000)
}

function HeatmapSlider({
  enabled,
  onEnabledChange,
  hour,
  onHourChange,
  playing,
  onPlayingChange,
  start,
  hours = 48,
}: Props) {
  const id = useId()
  const label = hour === 0 ? 'Now' : formatHour(at(start, hour))
  return (
    <section
      aria-label="Weather heatmap timeline"
      className="@container rounded-card border border-line bg-surface p-3 shadow-panel sm:p-4"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Show weather heatmap"
          onClick={() => onEnabledChange(!enabled)}
          className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-control pr-1 text-sm font-semibold text-fg"
        >
          <span
            aria-hidden="true"
            className={`relative h-6 w-10 shrink-0 rounded-badge transition-colors ${enabled ? 'bg-primary' : 'bg-surface-2 border border-line'}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`}
            />
          </span>
          Heatmap
        </button>

        <div className="min-w-0 flex-1 text-right text-sm text-muted" aria-live="polite">
          <span className="font-semibold text-fg">{label}</span>
          {hour > 0 && <span className="hidden @min-[400px]:inline"> · +{hour} h</span>}
        </div>

        <button
          type="button"
          disabled={!enabled}
          onClick={() => onPlayingChange(!playing)}
          aria-label={playing ? 'Pause animation' : 'Play animation'}
          className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-control bg-primary text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.8l-10-6.5A1 1 0 0 0 8 5.5Z" />
            </svg>
          )}
        </button>
      </div>

      <div className="px-1.5">
        <input
          id={id}
          className="slider"
          type="range"
          min={0}
          max={hours}
          step={1}
          value={hour}
          disabled={!enabled}
          onChange={(e) => onHourChange(Number(e.target.value))}
          aria-label="Forecast hour"
          aria-valuetext={label}
        />
        <div className="relative -mt-1 h-4 text-xs text-muted" aria-hidden="true">
          {TICKS.map((t, i) => (
            <span
              key={t}
              className={`absolute whitespace-nowrap ${t === 12 || t === 36 ? 'hidden @min-[480px]:block' : ''}`}
              style={{
                left: `${(t / hours) * 100}%`,
                transform: i === 0 ? 'none' : i === TICKS.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {t === 0 ? 'Now' : formatHour(at(start, t))}
            </span>
          ))}
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-label="Risk legend">
        {LEVEL_NAMES.map((name, level) => (
          <li key={name} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: riskCssVar(level) }} />
            {name}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default memo(HeatmapSlider)
