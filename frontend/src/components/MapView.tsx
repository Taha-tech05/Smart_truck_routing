import { useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Minus, Plus } from 'lucide-react'
import type { Feature, FeatureCollection } from 'geojson'
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
import { PEEK_PX } from './BottomSheet'
import CheckpointPopup from './CheckpointPopup'

const LIGHT_STYLE =
  import.meta.env.VITE_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/positron'
const DARK_STYLE =
  import.meta.env.VITE_MAP_STYLE_DARK_URL ??
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

const SLOTS = 3
const HEAT_SRC = ['heat-a', 'heat-b'] as const
const HEAT_LAYER = ['heat-a-layer', 'heat-b-layer'] as const
const HEAT_OPACITY = 0.8
const CP_SRC = 'checkpoints'
const CP_LAYERS = ['checkpoints-even', 'checkpoints-odd'] as const
const routeSrc = (i: number) => `route-${i}`
const casingLayer = (i: number) => `route-${i}-casing`
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
  /** Changes whenever a new analysis arrives; fits all routes. */
  fitKey: number
}

const styleFor = (t: Theme) => (t === 'dark' ? DARK_STYLE : LIGHT_STYLE)

/** MapLibre `match` expression: risk level -> colour (resolved from the current theme tokens). */
function levelMatch(values: (level: number) => string | number): unknown[] {
  return ['match', ['get', 'level'], 0, values(0), 1, values(1), 2, values(2), 3, values(3), 4, values(4), values(0)]
}

function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function pin(color: string): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `width:14px;height:14px;box-sizing:border-box;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgb(0 0 0 / 0.35)`
  return el
}

function heatFeatures(data: HeatmapResponse, hour: number): FeatureCollection {
  const features: Feature[] = []
  data.points.forEach(([lat, lng], i) => {
    const level = Number(data.levels[i][hour] ?? 0)
    if (level < 1) return // Low is fully transparent: don't even send it to the layer
    features.push({ type: 'Feature', properties: { level }, geometry: { type: 'Point', coordinates: [lng, lat] } })
  })
  return { type: 'FeatureCollection', features }
}

function wholeLine(route: RouteResult): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { level: 0, routeId: route.id },
        geometry: { type: 'LineString', coordinates: route.geometry.coordinates },
      },
    ],
  }
}

function panelWidth(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-w'))
  return Number.isFinite(v) ? v : 400
}

/** Quieter basemap: fewer, fainter labels, and in dark mode a lifted land / water / road palette. */
function tuneBasemap(map: MapLibreMap, theme: Theme) {
  const hide =
    /^(place_hamlet|place_suburbs|place_villages|place_(city|capital)_dot|roadname|housenumber|poi_|highway-name|highway-shield|road_shield|airport|label_other|label_village|waterway|watername_lake_(pois|line)|water_name_line)/
  const dark = theme === 'dark'
  const darkPaint: Record<string, [string, string]> = {
    background: ['background-color', '#243247'],
    water: ['fill-color', '#162b46'],
    water_shadow: ['fill-color', '#162b46'],
    landcover: ['fill-color', '#2a3b50'],
    landuse: ['fill-color', '#27374c'],
    landuse_residential: ['fill-color', '#27374c'],
    park_national_park: ['fill-color', '#2a3f4f'],
    park_nature_reserve: ['fill-color', '#2a3f4f'],
    boundary_state: ['line-color', '#5a6d8a'],
    boundary_county: ['line-color', '#34465f'],
  }
  for (const layer of map.getStyle().layers) {
    try {
      if (layer.type === 'symbol') {
        if (hide.test(layer.id)) {
          map.setLayoutProperty(layer.id, 'visibility', 'none')
          continue
        }
        const small = /state|country|continent/.test(layer.id)
        map.setLayoutProperty(layer.id, 'text-size', ['interpolate', ['linear'], ['zoom'], 3, small ? 8 : 9, 8, small ? 10 : 12])
        map.setPaintProperty(layer.id, 'text-opacity', 0.6)
      } else if (dark) {
        const p = darkPaint[layer.id]
        if (p) map.setPaintProperty(layer.id, p[0] as never, p[1] as never)
        else if (layer.type === 'line' && /^(road|bridge|tunnel)_.*_fill/.test(layer.id))
          map.setPaintProperty(layer.id, 'line-color', '#41536f')
        else if (layer.type === 'line' && /^(road|bridge|tunnel)_.*_case/.test(layer.id))
          map.setPaintProperty(layer.id, 'line-color', '#243247')
      }
    } catch {
      /* layer without that property: ignore */
    }
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
  const lastFit = useRef(-1)
  const hoverId = useRef<number | null>(null)
  const heat = useRef({ version: -1, active: 0, hour: -1, data: null as HeatmapResponse | null })
  // bumps on every (re)loaded style so data effects re-apply to the fresh sources/layers
  const [styleVersion, setStyleVersion] = useState(0)
  const themeRef = useRef(theme)
  themeRef.current = theme

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
      tuneBasemap(map, themeRef.current)
      addLayers(map)
      setStyleVersion((v) => v + 1)
    })
    map.on('error', (e) => console.error('[map]', e.error ?? e))

    const around = (p: { x: number; y: number }, r = 6): [[number, number], [number, number]] => [
      [p.x - r, p.y - r],
      [p.x + r, p.y + r],
    ]
    const present = (ids: string[]) => ids.filter((id) => map.getLayer(id))

    map.on('click', (e) => {
      const cps = present([...CP_LAYERS])
      if (cps.length) {
        const f = map.queryRenderedFeatures(around(e.point, 7), { layers: cps })[0]
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
      const lines = present([0, 1, 2].map(lineLayer))
      if (lines.length) {
        const f = map.queryRenderedFeatures(around(e.point), { layers: lines })[0]
        if (f) propsRef.current.onSelectRoute(String(f.properties.routeId))
      }
    })

    map.on('mousemove', (e) => {
      const cps = present([...CP_LAYERS])
      const cpHit = cps.length ? map.queryRenderedFeatures(around(e.point, 7), { layers: cps })[0] : undefined
      const next = cpHit ? Number(cpHit.id) : null
      if (next !== hoverId.current) {
        if (hoverId.current !== null) map.setFeatureState({ source: CP_SRC, id: hoverId.current }, { hover: false })
        if (next !== null) map.setFeatureState({ source: CP_SRC, id: next }, { hover: true })
        hoverId.current = next
      }
      const lines = present([0, 1, 2].map(lineLayer))
      const lineHit = lines.length ? map.queryRenderedFeatures(around(e.point), { layers: lines }).length > 0 : false
      map.getCanvas().style.cursor = cpHit || lineHit ? 'pointer' : ''
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
    hoverId.current = null
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

  // ---- routes: selected one coloured per segment, others one neutral line; pins ---------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion) return
    const surface = tokenColor('--surface')
    const muted = tokenColor('--route-muted')
    for (let i = 0; i < SLOTS; i++) {
      const r = routes?.[i]
      const sel = !!r && r.id === selectedId
      const src = map.getSource(routeSrc(i)) as GeoJSONSource | undefined
      src?.setData(!r ? EMPTY_FC : sel ? riskSegments(r) : wholeLine(r))
      map.setPaintProperty(lineLayer(i), 'line-color', sel ? (levelMatch((l) => riskColor(l)) as never) : muted)
      map.setPaintProperty(lineLayer(i), 'line-width', sel ? 5 : 3)
      map.setPaintProperty(lineLayer(i), 'line-opacity', sel ? 1 : 0.6)
      map.setPaintProperty(casingLayer(i), 'line-color', surface)
      map.setPaintProperty(casingLayer(i), 'line-width', 9)
      map.setPaintProperty(casingLayer(i), 'line-opacity', sel ? 1 : 0)
      if (sel) {
        map.moveLayer(casingLayer(i))
        map.moveLayer(lineLayer(i))
      }
    }
    CP_LAYERS.forEach((id) => map.moveLayer(id))

    const selected = routes?.find((r) => r.id === selectedId)
    ;(map.getSource(CP_SRC) as GeoJSONSource | undefined)?.setData(selected ? checkpointPoints(selected) : EMPTY_FC)
    hoverId.current = null
    popupRef.current?.remove()

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    const first = routes?.[0]
    if (first) {
      const c = first.geometry.coordinates
      markersRef.current = [
        new Marker({ element: pin(tokenColor('--risk-low')) }).setLngLat(c[0]).addTo(map),
        new Marker({ element: pin('#0f1b2d') }).setLngLat(c[c.length - 1]).addTo(map),
      ]
    }
  }, [routes, selectedId, styleVersion])

  // ---- camera: fit all routes on a new analysis, the selected one on selection ----------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !routes?.length) return
    const all = fitKey !== lastFit.current
    lastFit.current = fitKey
    const list = all ? routes : routes.filter((r) => r.id === selectedId)
    const bounds = new LngLatBounds()
    list.forEach((r) => r.geometry.coordinates.forEach((c) => bounds.extend(c as [number, number])))
    map.fitBounds(bounds, {
      padding: isMobile
        ? { top: 72, right: 24, bottom: PEEK_PX + 76 + 8 + 24, left: 24 }
        : { top: 48, right: 48, bottom: 160, left: panelWidth() + 48 },
      duration: 600,
      maxZoom: 12,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, selectedId])

  // ---- heatmap: two layers cross-fade between hours -------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion || !map.getLayer(HEAT_LAYER[0])) return
    const h = heat.current
    const vis = heatmap.enabled ? 'visible' : 'none'
    HEAT_LAYER.forEach((id) => map.setLayoutProperty(id, 'visibility', vis))
    if (!heatmap.enabled) {
      h.hour = -1
      return
    }
    const src = (i: number) => map.getSource(HEAT_SRC[i]) as GeoJSONSource | undefined
    const opacity = (i: number, v: number) => map.setPaintProperty(HEAT_LAYER[i], 'heatmap-opacity', v)
    if (h.version !== styleVersion || h.hour < 0) {
      // first draw (or after a style swap): show immediately on layer A
      h.version = styleVersion
      h.active = 0
      src(0)?.setData(heatFeatures(heatmap.data, heatmap.hour))
      opacity(0, HEAT_OPACITY)
      opacity(1, 0)
    } else if (h.hour !== heatmap.hour || h.data !== heatmap.data) {
      const next = 1 - h.active
      src(next)?.setData(heatFeatures(heatmap.data, heatmap.hour))
      opacity(next, HEAT_OPACITY)
      opacity(h.active, 0)
      h.active = next
    }
    h.hour = heatmap.hour
    h.data = heatmap.data
  }, [heatmap.enabled, heatmap.hour, heatmap.data, styleVersion])

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {!isMobile && (
        <div className="float-card absolute right-4 top-4 z-10 flex flex-col overflow-hidden rounded-full lg:bottom-12 lg:top-auto">
          <ZoomButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
            <Plus size={18} aria-hidden="true" />
          </ZoomButton>
          <div className="mx-2 h-px bg-line" />
          <ZoomButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
            <Minus size={18} aria-hidden="true" />
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
      className="flex h-10 w-10 cursor-pointer items-center justify-center text-fg hover:bg-surface-2"
    >
      {children}
    </button>
  )
}

/** Add all sources/layers (empty) once per loaded style. Data is pushed by the effects above. */
function addLayers(map: MapLibreMap) {
  const surface = tokenColor('--surface')
  const mod = tokenColor('--risk-moderate')
  const high = tokenColor('--risk-high')
  const severe = tokenColor('--risk-severe')
  const stop = tokenColor('--risk-notravel')

  // Heatmap: weight = level / 4; Low (level 0) is filtered out so it is fully transparent.
  HEAT_SRC.forEach((srcId, i) => {
    map.addSource(srcId, { type: 'geojson', data: EMPTY_FC })
    map.addLayer({
      id: HEAT_LAYER[i],
      type: 'heatmap',
      source: srcId,
      filter: ['>=', ['get', 'level'], 1],
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': ['/', ['get', 'level'], 4],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 0.16, 8, 0.4],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 24, 5, 40, 8, 90, 10, 150],
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, rgba(mod, 0),
          0.08, rgba(mod, 0),
          0.25, rgba(mod, 0.35),
          0.5, rgba(high, 0.5),
          0.75, rgba(severe, 0.6),
          1, rgba(stop, 0.7),
        ] as never,
        'heatmap-opacity': 0,
        'heatmap-opacity-transition': { duration: 350, delay: 0 },
      },
    })
  })

  // Added in reverse so slot 0 (the best-ranked route) is drawn on top; the selected one is moved up later.
  for (let i = SLOTS - 1; i >= 0; i--) {
    map.addSource(routeSrc(i), { type: 'geojson', data: EMPTY_FC })
    map.addLayer({
      id: casingLayer(i),
      type: 'line',
      source: routeSrc(i),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': surface, 'line-width': 9, 'line-opacity': 0 },
    })
    map.addLayer({
      id: lineLayer(i),
      type: 'line',
      source: routeSrc(i),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': tokenColor('--route-muted'), 'line-width': 3, 'line-opacity': 0.6 },
    })
  }

  // Checkpoint dots: 6px with a 1.5px surface ring, 10px on hover. Odd-numbered dots appear from zoom 6.
  map.addSource(CP_SRC, { type: 'geojson', data: EMPTY_FC })
  const dot = (id: string, filter: unknown, minzoom: number) =>
    map.addLayer({
      id,
      type: 'circle',
      source: CP_SRC,
      minzoom,
      filter: filter as never,
      paint: {
        'circle-color': levelMatch((l) => riskColor(l)) as never,
        'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 5, 3] as never,
        'circle-radius-transition': { duration: 120, delay: 0 },
        'circle-stroke-color': surface,
        'circle-stroke-width': 1.5,
      },
    })
  dot(CP_LAYERS[0], ['==', ['%', ['get', 'index'], 2], 0], 0)
  dot(CP_LAYERS[1], ['!=', ['%', ['get', 'index'], 2], 0], 6)
}
