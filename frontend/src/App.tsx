import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Route as RouteIcon } from 'lucide-react'
import BottomSheet, { type Snap } from './components/BottomSheet'
import HeatmapSlider from './components/HeatmapSlider'
import MapView from './components/MapView'
import { AnalyzeProgress, ErrorCard, SkeletonCards } from './components/ResultsStates'
import RouteList from './components/RouteList'
import ThemeToggle from './components/ThemeToggle'
import TripForm, { buildRequest, defaultTrip, type TripValues } from './components/TripForm'
import { useAnalyze } from './hooks/useAnalyze'
import { useHeatmap } from './hooks/useHeatmap'
import { useIsMobile } from './hooks/useIsMobile'
import { useTheme } from './hooks/useTheme'
import type { AnalyzeRequest, AnalyzeResponse } from './types'
import { formatLb } from './utils/format'

const shortName = (place: string) => place.split(',')[0]

function currentHour(): Date {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  return d
}

export default function App() {
  const { theme, toggle } = useTheme()
  const isMobile = useIsMobile()

  const [trip, setTrip] = useState<TripValues>(defaultTrip)
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null) // last SUCCESSFUL result
  const [request, setRequest] = useState<AnalyzeRequest | null>(null) // the request that produced it
  const [pending, setPending] = useState<AnalyzeRequest | null>(null) // the request in flight / last tried
  const [editing, setEditing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fitKey, setFitKey] = useState(0)
  const [snap, setSnap] = useState<Snap>('half')

  const [heatOn, setHeatOn] = useState(true)
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)

  const onSuccess = useCallback((data: AnalyzeResponse, req: AnalyzeRequest) => {
    setAnalysis(data)
    setRequest(req)
    setSelectedId(data.recommendation.route_id ?? data.routes[0]?.id ?? null)
    setEditing(false)
    setHour(0)
    setFitKey((k) => k + 1)
    if (window.matchMedia('(max-width: 767px)').matches) setSnap('peek')
  }, [])
  const analyzer = useAnalyze(onSuccess)

  const submit = useCallback(
    (req: AnalyzeRequest) => {
      setPending(req)
      setPlaying(false)
      analyzer.run(req)
    },
    [analyzer],
  )

  // ---- heatmap: ONE request per selected route; the slider only reads from the cached response ----
  const selected = analysis?.routes.find((r) => r.id === selectedId) ?? null
  const heat = useHeatmap(selected, request?.load_weight_lb ?? 0, request?.departure_time ?? '', heatOn && !!request)
  const heatStart = useMemo(() => (heat.data ? new Date(heat.data.start_time) : currentHour()), [heat.data])
  const maxHour = heat.data ? heat.data.hours - 1 : 48

  useEffect(() => {
    if (!playing || !heatOn) return
    const id = window.setInterval(() => setHour((h) => (h >= maxHour ? 0 : h + 1)), 400)
    return () => window.clearInterval(id)
  }, [playing, heatOn, maxHour])

  const heatmap = useMemo(() => ({ enabled: heatOn, data: heat.data ?? null, hour }), [heatOn, heat.data, hour])
  const onEnabled = useCallback((v: boolean) => {
    setHeatOn(v)
    if (!v) setPlaying(false)
  }, [])

  const loading = analyzer.loading
  const err = analyzer.error
  const showForm = (!analysis || editing || !!err) && !loading

  useEffect(() => {
    document.querySelectorAll('[data-scroll-area]').forEach((el) => el.scrollTo({ top: 0 }))
  }, [showForm, loading])

  const tripRow = (req: AnalyzeRequest | null) =>
    req && (
      <div className="flex h-12 items-center gap-3 rounded-control border border-line bg-surface-2 pl-3 pr-2">
        <RouteIcon size={16} className="shrink-0 text-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold text-fg">
            {shortName(req.origin.label)} → {shortName(req.destination.label)}
          </span>
          <span className="text-muted"> · {formatLb(req.load_weight_lb)}</span>
        </div>
        {!loading && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit trip"
            title="Edit trip"
            className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-control text-muted hover:bg-surface hover:text-fg"
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    )

  const serverMessage = err && err.userFacing ? err.message : null

  let body: React.ReactNode = null
  if (loading) {
    body = (
      <>
        {tripRow(pending)}
        <AnalyzeProgress onCancel={analyzer.cancel} />
        {analysis ? (
          // keep the previous result visible (dimmed) rather than flashing to empty
          <div className="pointer-events-none opacity-50" aria-hidden="true">
            <RouteList analysis={analysis} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        ) : (
          <SkeletonCards />
        )}
      </>
    )
  } else if (showForm) {
    body = (
      <>
        <TripForm
          values={trip}
          onChange={setTrip}
          onSubmit={() => submit(buildRequest(trip))}
          loading={loading}
          serverError={serverMessage}
        />
        {err && !err.userFacing && <ErrorCard error={err} onRetry={pending ? () => submit(pending) : undefined} />}
        {analysis && !err && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="h-8 cursor-pointer self-start rounded-control px-1 text-xs font-semibold text-primary hover:underline"
          >
            Back to results
          </button>
        )}
      </>
    )
  } else if (analysis) {
    body = (
      <>
        {tripRow(request)}
        <RouteList key={fitKey} analysis={analysis} selectedId={selectedId} onSelect={setSelectedId} />
      </>
    )
  }
  const panelBody = <div className="flex flex-col gap-4">{body}</div>

  const slider = (
    <HeatmapSlider
      enabled={heatOn}
      onEnabledChange={onEnabled}
      hour={hour}
      onHourChange={setHour}
      playing={playing}
      onPlayingChange={setPlaying}
      start={heatStart}
      hours={maxHour}
      loading={heat.isFetching && !heat.data}
      failed={heat.isError}
      onRetry={() => void heat.refetch()}
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
            <div
              data-scroll-area
              className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6 pl-6 pr-4 pt-1"
            >
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
