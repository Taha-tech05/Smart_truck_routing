import { Pencil, Route as RouteIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BottomSheet, { type Snap } from './components/BottomSheet'
import HeatmapSlider from './components/HeatmapSlider'
import MapView from './components/MapView'
import RouteList from './components/RouteList'
import ThemeToggle from './components/ThemeToggle'
import TripForm, { DEFAULT_TRIP, type TripValues } from './components/TripForm'
import { useIsMobile } from './hooks/useIsMobile'
import { useTheme } from './hooks/useTheme'
import { MOCK_START } from './mocks/clock'
import { MOCK_ANALYSIS } from './mocks/analyze'
import { MOCK_HEATMAP } from './mocks/heatmap'
import type { AnalyzeResponse } from './types'
import { formatLb } from './utils/format'

function shortName(place: string): string {
  return place.split(',')[0]
}

export default function App() {
  const { theme, toggle } = useTheme()
  const isMobile = useIsMobile()

  const [trip, setTrip] = useState<TripValues>(DEFAULT_TRIP)
  const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null)
  const [editing, setEditing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fitKey, setFitKey] = useState(0)
  const [snap, setSnap] = useState<Snap>('half')

  const [heatOn, setHeatOn] = useState(true)
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)

  // ---- fake "network": analyze resolves with the mock after a short delay ----
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const analyze = useCallback(() => {
    setLoading(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setAnalysis(MOCK_ANALYSIS)
      setSelectedId(MOCK_ANALYSIS.recommendation.route_id)
      setEditing(false)
      setLoading(false)
      setFitKey((k) => k + 1)
      if (window.matchMedia('(max-width: 767px)').matches) setSnap('peek')
    }, 700)
  }, [])

  // ---- heatmap playback: advance the hour locally, no network ----
  useEffect(() => {
    if (!playing || !heatOn) return
    const id = window.setInterval(() => setHour((h) => (h >= 48 ? 0 : h + 1)), 600)
    return () => window.clearInterval(id)
  }, [playing, heatOn])

  const heatmap = useMemo(() => ({ enabled: heatOn, data: MOCK_HEATMAP, hour }), [heatOn, hour])
  const onEnabled = useCallback((v: boolean) => {
    setHeatOn(v)
    if (!v) setPlaying(false)
  }, [])

  const showForm = !analysis || editing

  // new content (form <-> results): start from the top of whichever panel scrolls
  useEffect(() => {
    document.querySelectorAll('[data-scroll-area]').forEach((el) => el.scrollTo({ top: 0 }))
  }, [showForm])

  const panelBody = (
    <div className="flex flex-col gap-4">
      {showForm ? (
        <TripForm values={trip} onChange={setTrip} onSubmit={analyze} loading={loading} />
      ) : (
        <>
          <div className="flex h-12 items-center gap-3 rounded-control border border-line bg-surface-2 pl-3 pr-2">
            <RouteIcon size={16} className="shrink-0 text-muted" aria-hidden="true" />
            <div className="min-w-0 flex-1 truncate text-sm">
              <span className="font-semibold text-fg">
                {shortName(trip.origin)} → {shortName(trip.destination)}
              </span>
              <span className="text-muted"> · {formatLb(trip.loadLb)}</span>
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit trip"
              title="Edit trip"
              className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-control text-muted hover:bg-surface hover:text-fg"
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
          </div>
          <RouteList analysis={analysis} selectedId={selectedId} onSelect={setSelectedId} />
        </>
      )}
    </div>
  )

  const slider = (
    <HeatmapSlider
      enabled={heatOn}
      onEnabledChange={onEnabled}
      hour={hour}
      onHourChange={setHour}
      playing={playing}
      onPlayingChange={setPlaying}
      start={MOCK_START}
    />
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <MapView
        theme={theme}
        routes={analysis?.routes ?? null}
        selectedId={selectedId}
        onSelectRoute={setSelectedId}
        heatmap={heatmap}
        isMobile={isMobile}
        fitKey={fitKey}
      />

      {isMobile ? (
        <>
          <ThemeToggle theme={theme} onToggle={toggle} className="float-card fixed right-4 top-4 z-20" />
          {snap !== 'full' && (
            <div
              className="fixed inset-x-4 z-20 transition-[bottom] duration-200"
              style={{ bottom: 'calc(var(--sheet-h, 132px) + 8px)' }}
            >
              {slider}
            </div>
          )}
          <BottomSheet snap={snap} onSnapChange={setSnap}>
            <h1 className="mb-4 text-xl font-semibold text-fg">Truck Weather Router</h1>
            {panelBody}
          </BottomSheet>
        </>
      ) : (
        <>
          <aside
            aria-label="Trip panel"
            className="float-card absolute left-4 top-4 z-20 flex h-[calc(100dvh-32px)] flex-col overflow-hidden rounded-card"
            style={{ width: 'var(--panel-w)' }}
          >
            <header className="flex shrink-0 items-center justify-between gap-3 px-6 pb-4 pt-6">
              <h1 className="text-xl font-semibold leading-8 text-fg">Truck Weather Router</h1>
              <ThemeToggle theme={theme} onToggle={toggle} />
            </header>
            <div data-scroll-area className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6 pl-6 pr-4 pt-1">
              {panelBody}
            </div>
          </aside>

          <div className="absolute bottom-4 right-14 z-20 lg:right-18" style={{ left: 'calc(var(--panel-w) + 32px)' }}>
            <div className="mx-auto w-full max-w-[560px]">{slider}</div>
          </div>
        </>
      )}
    </div>
  )
}
