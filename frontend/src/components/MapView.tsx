import { useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FeatureCollection } from 'geojson'
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  Popup,
  type GeoJSONSource,
} from '../utils/maplibre'
import type { Theme } from '../hooks/useTheme'
import type { HeatmapResponse, RouteResult } from '../types'
import { checkpointPoints, EMPTY_FC, riskSegments } from '../utils/segments'
import { riskColor, tokenColor } from '../utils/risk'
import CheckpointPopup from './CheckpointPopup'

const LIGHT_STYLE =
  import.meta.env.VITE_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/positron'
const DARK_STYLE =
  import.meta.env.VITE_MAP_STYLE_DARK_URL ??
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

const SLOTS = 3
const HEAT_SRC = 'heat'
const HEAT_LAYER = 'heat-wash'
const CP_SRC = 'checkpoints'
const CP_LAYER = 'checkpoints-dots'
const routeSrc = (i: number) => `route-${i}`
const outlineLayer = (i: number) => `route-${i}-outline`
const lineLayer = (i: number) => `route-${i}-line`

export interface HeatmapView {
  enabled: boolean
  data: HeatmapResponse
  hour: number
}

interface Props {
  theme: Theme
  routes: RouteResult[] | null
  selectedId: string | null
  onSelectRoute: (id: string) => void
  heatmap: HeatmapView
  isMobile: boolean
  /** Changes whenever a new analysis arrives; triggers a camera fit. */
  fitKey: number
}

const styleFor = (t: Theme) => (t === 'dark' ? DARK_STYLE : LIGHT_STYLE)

/** MapLibre `match` expression: risk level -> colour (resolved from the current theme tokens). */
function levelMatch(values: (level: number) => string | number): unknown[] {
  return ['match', ['get', 'level'], 0, values(0), 1, values(1), 2, values(2), 3, values(3), 4, values(4), values(0)]
}

function pin(color: string): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `width:18px;height:18px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 5px rgb(0 0 0 / 0.45)`
  return el
}

function heatFeatures(data: HeatmapResponse, hour: number): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: data.points.map(([lat, lng], i) => ({
      type: 'Feature',
      properties: { level: Number(data.levels[i][hour] ?? 0) },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })),
  }
}

export default function MapView(props: Props) {
  const { theme, routes, selectedId, heatmap, isMobile, fitKey } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const popupRef = useRef<Popup | null>(null)
  const markersRef = useRef<Marker[]>([])
  const attribRef = useRef<AttributionControl | null>(null)
  const firstTheme = useRef(true)
  // bumps on every (re)loaded style so data effects re-apply to the fresh sources/layers
  const [styleVersion, setStyleVersion] = useState(0)

  // ---- create the map once -------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: styleFor(propsRef.current.theme),
      center: [-100, 36.5],
      zoom: 4.2,
      attributionControl: false,
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __map?: MapLibreMap }).__map = map // dev/test aid

    map.on('style.load', () => {
      addLayers(map)
      setStyleVersion((v) => v + 1)
    })
    map.on('error', (e) => console.error('[map]', e.error ?? e))

    map.on('click', (e) => {
      if (map.getLayer(CP_LAYER)) {
        const f = map.queryRenderedFeatures(e.point, { layers: [CP_LAYER] })[0]
        if (f) {
          const route = propsRef.current.routes?.find((r) => r.id === f.properties.routeId)
          const cp = route?.checkpoints[Number(f.properties.index)]
          if (cp) {
            popupRef.current?.remove()
            popupRef.current = new Popup({ offset: 12, maxWidth: '280px' })
              .setLngLat([cp.lng, cp.lat])
              .setHTML(renderToStaticMarkup(<CheckpointPopup checkpoint={cp} />))
              .addTo(map)
            return
          }
        }
      }
      const lines = [0, 1, 2].map(lineLayer).filter((id) => map.getLayer(id))
      if (lines.length) {
        const f = map.queryRenderedFeatures(e.point, { layers: lines })[0]
        if (f) propsRef.current.onSelectRoute(String(f.properties.routeId))
      }
    })

    map.on('mousemove', (e) => {
      const ids = [CP_LAYER, ...[0, 1, 2].map(lineLayer)].filter((id) => map.getLayer(id))
      const hit = ids.length ? map.queryRenderedFeatures(e.point, { layers: ids }).length > 0 : false
      map.getCanvas().style.cursor = hit ? 'pointer' : ''
    })

    return () => {
      popupRef.current?.remove()
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      attribRef.current = null // map.remove() already detached it
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ---- theme -> swap the base style (layers are re-added on 'style.load') ---------------------
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false
      return
    }
    popupRef.current?.remove()
    mapRef.current?.setStyle(styleFor(theme))
  }, [theme])

  // ---- attribution placement (bottom-right on desktop, top-left on mobile) --------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (attribRef.current) map.removeControl(attribRef.current)
    attribRef.current = new AttributionControl({ compact: true })
    map.addControl(attribRef.current, isMobile ? 'top-left' : 'bottom-right')
    // Start collapsed (icon only) so it never covers other controls; it opens on click.
    // MapLibre opens it once on its first resize/idle, so collapse again after that.
    const collapse = () => {
      const el = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
      el?.classList.remove('maplibregl-compact-show')
      el?.removeAttribute('open')
    }
    collapse()
    map.once('idle', collapse)
  }, [isMobile])

  // ---- routes: coloured segments, start/end pins, camera --------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion) return
    for (let i = 0; i < SLOTS; i++) {
      const src = map.getSource(routeSrc(i)) as GeoJSONSource | undefined
      src?.setData(routes?.[i] ? riskSegments(routes[i]) : EMPTY_FC)
    }
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    const first = routes?.[0]
    if (first) {
      const c = first.geometry.coordinates
      markersRef.current = [
        new Marker({ element: pin(tokenColor('--risk-low')) }).setLngLat(c[0]).addTo(map),
        new Marker({ element: pin(tokenColor('--on-accent')) }).setLngLat(c[c.length - 1]).addTo(map),
      ]
    }
  }, [routes, styleVersion])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !routes?.length) return
    const bounds = new LngLatBounds()
    routes.forEach((r) => r.geometry.coordinates.forEach((c) => bounds.extend(c as [number, number])))
    map.fitBounds(bounds, {
      padding: isMobile
        ? { top: 64, left: 24, right: 24, bottom: Math.round(window.innerHeight * 0.5) + 190 }
        : { top: 56, left: 460, right: 56, bottom: 200 },
      duration: 700,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])

  // ---- selection: widths/opacity + checkpoint dots of the selected route ----------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion) return
    popupRef.current?.remove()
    for (let i = 0; i < SLOTS; i++) {
      const r = routes?.[i]
      const width = r?.recommended ? 6 : 4
      const opacity = r && (r.id === selectedId || r.recommended) ? 1 : 0.7
      map.setPaintProperty(lineLayer(i), 'line-width', width)
      map.setPaintProperty(lineLayer(i), 'line-opacity', opacity)
      map.setPaintProperty(outlineLayer(i), 'line-width', width + 4)
      map.setPaintProperty(outlineLayer(i), 'line-opacity', opacity)
    }
    const sel = routes?.find((r) => r.id === selectedId)
    ;(map.getSource(CP_SRC) as GeoJSONSource | undefined)?.setData(sel ? checkpointPoints(sel) : EMPTY_FC)
  }, [routes, selectedId, styleVersion])

  // ---- heatmap: toggle + hour change only call setData / setLayoutProperty --------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion || !map.getLayer(HEAT_LAYER)) return
    map.setLayoutProperty(HEAT_LAYER, 'visibility', heatmap.enabled ? 'visible' : 'none')
    if (heatmap.enabled) {
      ;(map.getSource(HEAT_SRC) as GeoJSONSource | undefined)?.setData(heatFeatures(heatmap.data, heatmap.hour))
    }
  }, [heatmap.enabled, heatmap.hour, heatmap.data, styleVersion])

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {!isMobile && (
        <div className="absolute bottom-11 right-4 z-10 flex max-[1279px]:bottom-[212px] flex-col overflow-hidden rounded-control border border-line bg-surface shadow-panel">
          <ZoomButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
            <path d="M12 5v14M5 12h14" />
          </ZoomButton>
          <div className="h-px bg-line" />
          <ZoomButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
            <path d="M5 12h14" />
          </ZoomButton>
        </div>
      )}
    </div>
  )
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-11 w-11 cursor-pointer items-center justify-center text-fg hover:bg-surface-2"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}

/** Add all sources/layers (empty) once per loaded style. Data is pushed by the effects above. */
function addLayers(map: MapLibreMap) {
  const surface = tokenColor('--surface')
  const lineColor = levelMatch((l) => riskColor(l)) as never

  map.addSource(HEAT_SRC, { type: 'geojson', data: EMPTY_FC })
  map.addLayer({
    id: HEAT_LAYER,
    type: 'circle',
    source: HEAT_SRC,
    layout: { visibility: 'none' },
    paint: {
      'circle-color': levelMatch((l) => riskColor(l)) as never,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 44, 5, 104, 7, 210, 9, 420] as never,
      'circle-blur': 1,
      'circle-opacity': levelMatch((l) => [0, 0.34, 0.44, 0.5, 0.55][l]) as never,
    },
  })

  // Added in reverse so slot 0 (the best-ranked route) is drawn on top.
  for (let i = SLOTS - 1; i >= 0; i--) {
    map.addSource(routeSrc(i), { type: 'geojson', data: EMPTY_FC })
    map.addLayer({
      id: outlineLayer(i),
      type: 'line',
      source: routeSrc(i),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': surface, 'line-width': 8, 'line-opacity': 0.7 },
    })
    map.addLayer({
      id: lineLayer(i),
      type: 'line',
      source: routeSrc(i),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': lineColor, 'line-width': 4, 'line-opacity': 0.7 },
    })
  }

  map.addSource(CP_SRC, { type: 'geojson', data: EMPTY_FC })
  map.addLayer({
    id: CP_LAYER,
    type: 'circle',
    source: CP_SRC,
    paint: {
      'circle-color': levelMatch((l) => riskColor(l)) as never,
      'circle-radius': 5,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })
}
