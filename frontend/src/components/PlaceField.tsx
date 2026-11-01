import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useGeocode } from '../hooks/useGeocode'
import type { Place } from '../types'

interface Props {
  label: string
  text: string
  place: Place | null
  onText: (text: string) => void // typing invalidates the chosen place
  onSelect: (place: Place) => void
  error?: string
  inputClass: string
}

/** Autocomplete input. The field is only valid once a suggestion has been chosen. */
export default function PlaceField({ label, text, place, onText, onSelect, error, inputClass }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const search = useGeocode(text, open && !place)
  const options = search.data ?? []
  const typed = text.trim().length >= 3
  const showList = open && !place && typed
  const choose = (p: Place) => {
    onSelect(p)
    setOpen(false)
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-muted">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-invalid={!!error}
          aria-activedescendant={showList && options[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          value={text}
          placeholder="City or address"
          className={`${inputClass} ${error ? 'border-risk-severe' : ''} ${search.isSearching ? 'pr-10' : ''}`}
          onChange={(e) => {
            onText(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!showList) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              if (options.length) setActive((a) => (a + 1) % options.length)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              if (options.length) setActive((a) => (a - 1 + options.length) % options.length)
            } else if (e.key === 'Enter') {
              if (options[active]) {
                e.preventDefault()
                choose(options[active])
              }
            } else if (e.key === 'Escape') setOpen(false)
          }}
        />
        {search.isSearching && !place && (
          <Loader2
            size={16}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted"
            aria-label="Searching"
          />
        )}
      </div>
      {error && !showList && <p className="mt-1 text-xs text-risk-severe">{error}</p>}
      {showList && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="float-card absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-control py-1"
        >
          {options.map((p, i) => (
            <li
              key={`${p.label}-${p.lat}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(p)
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-10 cursor-pointer items-center px-3 py-1.5 text-sm ${i === active ? 'bg-surface-2' : ''}`}
            >
              {p.label}
            </li>
          ))}
          {options.length === 0 && (
            <li role="presentation" className="flex min-h-10 items-center gap-2 px-3 text-sm text-muted">
              {search.isSearching ? (
                <>
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Searching…
                </>
              ) : search.isError ? (
                'Search failed. Keep typing to retry.'
              ) : (
                'No places found'
              )}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
