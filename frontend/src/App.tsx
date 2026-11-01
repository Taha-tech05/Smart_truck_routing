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

  const panelBody = (
    <div className="flex flex-col gap-4">
      {showForm ? (
        <TripForm values={trip} onChange={setTrip} onSubmit={analyze} loading={loading} />
      ) : (
        <>
          <div className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-line bg-surface-2 py-1 pl-3 pr-1">
            <div className="min-w-0 text-sm font-semibold text-fg">
              <span className="block truncate">
                {shortName(trip.origin)} → {shortName(trip.destination)}, {formatLb(trip.loadLb)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="h-11 shrink-0 cursor-pointer rounded-control px-3 text-sm font-semibold text-primary hover:bg-surface"
            >
              Edit
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
          <ThemeToggle theme={theme} onToggle={toggle} className="fixed right-4 top-4 z-20 shadow-panel" />
          {snap !== 'full' && (
            <div
              className="fixed inset-x-3 z-20 transition-[bottom] duration-200"
              style={{ bottom: 'calc(var(--sheet-h, 132px) + 8px)' }}
            >
              {slider}
            </div>
          )}
          <BottomSheet snap={snap} onSnapChange={setSnap}>
            <h1 className="mb-3 text-base font-semibold text-fg">Weather-Aware Truck Routing</h1>
            {panelBody}
          </BottomSheet>
        </>
      ) : (
        <>
          <aside
            aria-label="Trip panel"
            className="absolute left-4 top-4 z-20 flex w-100 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-panel"
            style={{ maxHeight: 'calc(100vh - 32px)' }}
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h1 className="text-xl font-semibold text-fg">Truck Weather Router</h1>
              <ThemeToggle theme={theme} onToggle={toggle} />
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{panelBody}</div>
          </aside>

          <div
            className="absolute bottom-4 left-108 right-4 z-20 mx-auto"
            style={{ width: 'min(640px, 100% - 464px)' }}
          >
            {slider}
          </div>
        </>
      )}
    </div>
  )
}
