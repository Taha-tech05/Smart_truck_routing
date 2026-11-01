import { useId, useMemo, useState } from 'react'
import { MOCK_PLACES } from '../mocks/places'
import { MOCK_DEPARTURE } from '../mocks/clock'

export interface TripValues {
  origin: string
  destination: string
  departure: string // datetime-local value
  loadLb: number
  interval: 10 | 25 | 50
}

const MAX_LOAD = 120000
const INTERVALS = [10, 25, 50] as const

function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const DEFAULT_TRIP: TripValues = {
  origin: 'Dallas, TX, USA',
  destination: 'Denver, CO, USA',
  departure: toLocalInput(MOCK_DEPARTURE),
  loadLb: 38000,
  interval: 25,
}

const inputBase =
  'h-11 w-full rounded-control border border-line bg-surface-2 px-3 text-sm text-fg placeholder:text-muted'

/** Autocomplete input (UI only: filters a fake list). */
function PlaceInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const options = useMemo(() => {
    const q = value.trim().toLowerCase()
    return MOCK_PLACES.filter((p) => p.toLowerCase().includes(q) && p !== value).slice(0, 5)
  }, [value])
  const show = open && options.length > 0

  const choose = (p: string) => {
    onChange(p)
    setOpen(false)
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-muted">
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={show}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={show ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        value={value}
        placeholder="City or address"
        className={inputBase}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && show) {
            e.preventDefault()
            setActive((a) => (a + 1) % options.length)
          } else if (e.key === 'ArrowUp' && show) {
            e.preventDefault()
            setActive((a) => (a - 1 + options.length) % options.length)
          } else if (e.key === 'Enter' && show) {
            e.preventDefault()
            choose(options[active])
          } else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {show && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-control border border-line bg-surface shadow-panel"
        >
          {options.map((p, i) => (
            <li
              key={p}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(p)
              }}
              className={`flex min-h-11 cursor-pointer items-center px-3 text-sm ${i === active ? 'bg-surface-2' : ''}`}
            >
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface Props {
  values: TripValues
  onChange: (v: TripValues) => void
  onSubmit: () => void
  loading: boolean
}

export default function TripForm({ values, onChange, onSubmit, loading }: Props) {
  const loadId = useId()
  const departId = useId()
  const set = <K extends keyof TripValues>(k: K, v: TripValues[K]) => onChange({ ...values, [k]: v })
  const pct = Math.min(100, Math.max(0, (values.loadLb / MAX_LOAD) * 100))

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      aria-label="Trip details"
    >
      <PlaceInput label="Origin" value={values.origin} onChange={(v) => set('origin', v)} />
      <PlaceInput label="Destination" value={values.destination} onChange={(v) => set('destination', v)} />

      <div>
        <label htmlFor={departId} className="mb-1.5 block text-xs font-semibold text-muted">
          Departure
        </label>
        <input
          id={departId}
          type="datetime-local"
          value={values.departure}
          onChange={(e) => set('departure', e.target.value)}
          className={inputBase}
        />
      </div>

      <div>
        <label htmlFor={loadId} className="mb-1.5 block text-xs font-semibold text-muted">
          Load weight
        </label>
        <div className="relative">
          <input
            id={loadId}
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_LOAD}
            step={500}
            value={values.loadLb}
            onChange={(e) => set('loadLb', Math.min(MAX_LOAD, Math.max(0, Number(e.target.value) || 0)))}
            className={`${inputBase} pr-10`}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">lb</span>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-badge bg-surface-2"
          role="img"
          aria-label={`${Math.round(pct)}% of the 120,000 lb maximum`}
        >
          <div className="h-full rounded-badge bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted" aria-hidden="true">
          <span>0</span>
          <span>120,000 lb</span>
        </div>
      </div>

      <div>
        <span id="interval-label" className="mb-1.5 block text-xs font-semibold text-muted">
          Checkpoint interval
        </span>
        <div
          role="radiogroup"
          aria-labelledby="interval-label"
          className="grid grid-cols-3 gap-1 rounded-control border border-line bg-surface-2 p-1"
        >
          {INTERVALS.map((n) => {
            const on = values.interval === n
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set('interval', n)}
                className={`h-11 cursor-pointer rounded-[8px] text-sm font-semibold transition-colors ${
                  on ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'
                }`}
              >
                {n} mi
              </button>
            )
          })}
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="h-11 w-full cursor-pointer rounded-control bg-accent text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
      >
        {loading ? 'Analyzing…' : 'Analyze routes'}
      </button>
    </form>
  )
}
