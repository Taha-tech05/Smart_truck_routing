import { useId } from 'react'
import { ArrowUpDown } from 'lucide-react'
import PlaceField from './PlaceField'
import type { AnalyzeRequest, Place } from '../types'

export interface TripValues {
  originText: string
  origin: Place | null
  destText: string
  destination: Place | null
  departure: string // datetime-local value, in the user's timezone
  loadText: string
  interval: 10 | 25 | 50
}

const MAX_LOAD = 120000
const INTERVALS = [10, 25, 50] as const
const HOUR = 3600_000

const pad = (n: number) => n.toString().padStart(2, '0')

export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Now rounded UP to the next 15 minutes. */
export function nextQuarterHour(now = new Date()): Date {
  const q = 15 * 60_000
  return new Date(Math.ceil(now.getTime() / q) * q)
}

/** ISO 8601 with the local UTC offset, e.g. 2026-11-02T08:00:00-06:00 */
export function toOffsetISO(d: Date): string {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const a = Math.abs(off)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
}

export function defaultTrip(): TripValues {
  return {
    originText: 'Dallas, TX, USA',
    origin: { label: 'Dallas, TX, USA', lat: 32.7767, lng: -96.797 },
    destText: 'Denver, CO, USA',
    destination: { label: 'Denver, CO, USA', lat: 39.7392, lng: -104.9903 },
    departure: toLocalInput(nextQuarterHour()),
    loadText: '38000',
    interval: 25,
  }
}

export interface TripErrors {
  origin?: string
  destination?: string
  departure?: string
  load?: string
}

export function validateTrip(v: TripValues, now = new Date()): TripErrors {
  const e: TripErrors = {}
  if (!v.origin) e.origin = v.originText.trim() ? 'Choose a place from the suggestions.' : 'Enter an origin.'
  if (!v.destination) e.destination = v.destText.trim() ? 'Choose a place from the suggestions.' : 'Enter a destination.'
  if (v.origin && v.destination && v.origin.lat === v.destination.lat && v.origin.lng === v.destination.lng)
    e.destination = 'Origin and destination must be different places.'
  const d = new Date(v.departure)
  if (!v.departure || Number.isNaN(d.getTime())) e.departure = 'Enter a departure time.'
  else if (d.getTime() < now.getTime() - HOUR) e.departure = 'Departure can be at most 1 hour in the past.'
  else if (d.getTime() > now.getTime() + 7 * 24 * HOUR) e.departure = 'Departure can be at most 7 days ahead.'
  const load = Number(v.loadText)
  if (v.loadText.trim() === '' || !Number.isInteger(load) || load < 0 || load > MAX_LOAD)
    e.load = 'Enter a whole number from 0 to 120,000 lb.'
  return e
}

export function buildRequest(v: TripValues): AnalyzeRequest {
  return {
    origin: v.origin!,
    destination: v.destination!,
    departure_time: toOffsetISO(new Date(v.departure)),
    load_weight_lb: Number(v.loadText),
    interval_miles: v.interval,
  }
}

const inputBase =
  'h-11 w-full rounded-control border border-line bg-surface-2 px-3 text-sm text-fg placeholder:text-muted'

interface Props {
  values: TripValues
  onChange: (v: TripValues) => void
  onSubmit: () => void
  loading: boolean
  /** Message from a backend 400, shown under the form. */
  serverError?: string | null
}

export default function TripForm({ values, onChange, onSubmit, loading, serverError }: Props) {
  const loadId = useId()
  const departId = useId()
  const set = <K extends keyof TripValues>(k: K, v: TripValues[K]) => onChange({ ...values, [k]: v })
  const errors = validateTrip(values)
  const valid = Object.keys(errors).length === 0
  const load = Number(values.loadText)
  const pct = Math.min(100, Math.max(0, ((Number.isFinite(load) ? load : 0) / MAX_LOAD) * 100))
  // a place error only shows once the user has typed something
  const showOrigin = values.originText.trim() ? errors.origin : undefined
  const showDest = values.destText.trim() ? errors.destination : undefined

  const swap = () =>
    onChange({
      ...values,
      originText: values.destText,
      origin: values.destination,
      destText: values.originText,
      destination: values.origin,
    })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid && !loading) onSubmit()
      }}
      aria-label="Trip details"
      noValidate
    >
      <div className="relative flex flex-col gap-4">
        <PlaceField
          label="Origin"
          text={values.originText}
          place={values.origin}
          onText={(t) => onChange({ ...values, originText: t, origin: null })}
          onSelect={(p) => onChange({ ...values, originText: p.label, origin: p })}
          error={showOrigin}
          inputClass={`${inputBase} pr-10`}
        />
        <button
          type="button"
          onClick={swap}
          aria-label="Swap origin and destination"
          title="Swap origin and destination"
          className="absolute right-2 top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-muted hover:text-fg"
        >
          <ArrowUpDown size={16} aria-hidden="true" />
        </button>
        <PlaceField
          label="Destination"
          text={values.destText}
          place={values.destination}
          onText={(t) => onChange({ ...values, destText: t, destination: null })}
          onSelect={(p) => onChange({ ...values, destText: p.label, destination: p })}
          error={showDest}
          inputClass={`${inputBase} pr-10`}
        />
      </div>

      <div>
        <label htmlFor={departId} className="mb-1.5 block text-xs font-semibold text-muted">
          Departure <span className="font-medium">(your local time)</span>
        </label>
        <input
          id={departId}
          type="datetime-local"
          value={values.departure}
          onChange={(e) => set('departure', e.target.value)}
          aria-invalid={!!errors.departure}
          className={`${inputBase} ${errors.departure ? 'border-risk-severe' : ''}`}
        />
        {errors.departure && <p className="mt-1 text-xs text-risk-severe">{errors.departure}</p>}
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
            value={values.loadText}
            onChange={(e) => set('loadText', e.target.value)}
            aria-invalid={!!errors.load}
            className={`${inputBase} pr-10 ${errors.load ? 'border-risk-severe' : ''}`}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">lb</span>
        </div>
        {errors.load && <p className="mt-1 text-xs text-risk-severe">{errors.load}</p>}
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
        disabled={!valid || loading}
        className="h-11 w-full cursor-pointer rounded-control bg-accent text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Analyze routes
      </button>
      {serverError && (
        <p role="alert" className="rounded-control border border-risk-severe/40 bg-surface-2 px-3 py-2 text-xs text-fg">
          {serverError}
        </p>
      )}
    </form>
  )
}
