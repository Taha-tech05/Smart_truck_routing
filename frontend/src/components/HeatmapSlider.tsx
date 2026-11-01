import { memo, useEffect, useId, useRef, useState } from 'react'
import { Info, Pause, Play } from 'lucide-react'
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
const THUMB = 18

function at(start: Date, h: number): Date {
  return new Date(start.getTime() + h * 3600 * 1000)
}

/** x position of hour `h` along the slider, matching where the native thumb centre sits. */
function pos(h: number, hours: number): string {
  return `calc(${THUMB / 2}px + ${h / hours} * (100% - ${THUMB}px))`
}

function Switch({ enabled, onChange, showLabel }: { enabled: boolean; onChange: (v: boolean) => void; showLabel: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Show weather heatmap"
      onClick={() => onChange(!enabled)}
      className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-control pr-1 text-sm font-semibold text-fg"
    >
      <span
        aria-hidden="true"
        className={`relative h-6 w-10 shrink-0 rounded-badge transition-colors ${enabled ? 'bg-primary' : 'border border-line bg-surface-2'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
      <span className={showLabel}>Heatmap</span>
    </button>
  )
}

function Legend() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-4 cursor-pointer items-center gap-1 text-xs text-muted hover:text-fg"
      >
        <Info size={12} aria-hidden="true" />
        Legend
      </button>
      {open && (
        <ul
          aria-label="Risk legend"
          className="float-card absolute bottom-full left-0 mb-3 w-56 space-y-2 rounded-control p-3 text-xs"
        >
          <li className="text-muted">Colors show risk for your load at this hour.</li>
          {LEVEL_NAMES.map((name, level) => (
            <li key={name} className="flex items-center gap-2 text-fg">
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: riskCssVar(level) }} />
              {name}
              {level === 0 && <span className="ml-auto text-muted">clear</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
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
  const label = formatHour(at(start, hour))

  if (!enabled) {
    return (
      <section aria-label="Weather heatmap timeline" className="float-card mx-auto w-fit rounded-card px-3 py-2">
        <Switch enabled={false} onChange={onEnabledChange} showLabel="" />
      </section>
    )
  }

  return (
    <section aria-label="Weather heatmap timeline" className="float-card rounded-card px-3 py-2">
      <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-2 sm:gap-x-3">
        <Switch enabled onChange={onEnabledChange} showLabel="hidden lg:inline" />
        <button
          type="button"
          onClick={() => onPlayingChange(!playing)}
          aria-label={playing ? 'Pause animation' : 'Play animation'}
          className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-bg transition-opacity hover:opacity-90"
        >
          {playing ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
        </button>

        <input
          id={id}
          className="slider"
          type="range"
          min={0}
          max={hours}
          step={1}
          value={hour}
          style={{ '--pct': pos(hour, hours) } as React.CSSProperties}
          onChange={(e) => onHourChange(Number(e.target.value))}
          aria-label="Forecast hour"
          aria-valuetext={label}
        />

        <div className="w-[72px] whitespace-nowrap text-right sm:w-[76px] text-sm font-semibold tabular-nums text-fg" aria-live="polite">
          {label}
        </div>

        {/* second row: legend under the switch + play button, tick labels exactly under the slider */}
        <div className="col-span-2 flex items-center pl-1">
          <Legend />
        </div>
        <div className="@container relative h-[17px] text-xs leading-3 tabular-nums text-muted" aria-hidden="true">
          {TICKS.map((t) => (
            <span key={t} className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: pos(t, hours) }}>
              <span className="mx-auto mb-px block h-1 w-px bg-line" />
              <span className={t === 12 || t === 36 ? '@max-[220px]:hidden' : ''}>{t === 0 ? 'Now' : `+${t}h`}</span>
            </span>
          ))}
        </div>
        <div />
      </div>
    </section>
  )
}

export default memo(HeatmapSlider)
