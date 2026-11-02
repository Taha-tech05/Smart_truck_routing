import { useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Minus, Plus } from 'lucide-react'
import type { Feature, FeatureCollection, Point } from 'geojson'
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
const DEBUG_HEATMAP = import.meta.env.VITE_DEBUG_HEATMAP === 'true'
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
  data: HeatmapResponse | null
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
  /** City names of the trip's endpoints: their basemap labels are hidden so pins never cover text. */
  endpointNames?: string[]
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

function pin(color: string, name?: string): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `width:14px;height:14px;box-sizing:border-box;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgb(0 0 0 / 0.35);position:relative`
  if (name) {
    // the basemap label for this city is hidden, so the pin carries its own name
    const label = document.createElement('span')
    label.textContent = name
    label.style.cssText =
      'position:absolute;left:50%;top:-8px;transform:translate(-50%,-100%);white-space:nowrap;pointer-events:none;' +
      'font:600 12px/16px system-ui,sans-serif;padding:1px 6px;border-radius:6px;background:var(--surface);color:var(--fg);' +
      'border:1px solid var(--border);box-shadow:0 1px 3px rgb(0 0 0 / 0.25)'
    el.appendChild(label)
  }
  return el
}

/** Point features are built once per response; each hour only rewrites the numeric weight `w`. */
const heatCache = new WeakMap<HeatmapResponse, Feature<Point, { w: number }>[]>()
function heatFeatures(data: HeatmapResponse, hour: number): FeatureCollection {
  let features = heatCache.get(data)
  if (!features) {
    features = data.points.map(([lat, lng]) => ({
      type: 'Feature',
      properties: { w: 0 },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    }))
    heatCache.set(data, features)
  }
  const out = features
  data.levels.forEach((s, i) => {
    const code = s.charCodeAt(hour) - 48
    out[i].properties.w = code >= 0 && code <= 4 ? code : 0 // 0 (Low) is transparent
    // VITE_DEBUG_HEATMAP=true forces a few points to High..No Travel so the layer can be checked visually
    if (DEBUG_HEATMAP && i % 6 === 0) out[i].properties.w = 3 + (i % 12 === 0 ? 1 : 0)
  })
  return { type: 'FeatureCollection', features: out }
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

/** Live height of the slider card (it collapses when the heatmap is off). */
function sliderHeight(): number {
  return document.querySelector<HTMLElement>('[aria-label="Weather heatmap timeline"]')?.offsetHeight ?? 76
}

function panelWidth(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-w'))
  return Number.isFinite(v) ? v : 400
}

/**
 * Basemap label + palette tuning. Place labels stay visible with zoom tiers (large cities from zoom 4,
 * mid cities from 6, towns from 8); state / country / water labels are muted and smaller; road, POI and
 * house-number labels are dropped. In dark mode land, water and roads are lifted for contrast.
 */
const LARGE = /^(label_city_capital|label_city|place_city_r5|place_capital_dot_z7)$/
const MID = /^(label_town|place_city_r6|place_city_dot_(r7|r4|r2|z7))$/
const TOWN = /^(label_village|place_town)$/
const SMALL = /^(place_villages|place_suburbs|place_hamlet)$/
const REGION = /^(label_state|label_country|place_state|place_country|place_continent|water_name|watername_(ocean|sea|lake)$)/
const NOISE = /^(roadname|housenumber|poi_|highway-name|highway-shield|road_shield|airport|label_other|waterway|watername_lake_(pois|line)|water_name_line)/

function tuneBasemap(map: MapLibreMap, theme: Theme) {
  const dark = theme === 'dark'
  const place = dark ? { color: '#C9D3E3', halo: '#0B1220' } : { color: '#2b3646', halo: '#ffffff' }
  const region = dark ? { color: '#7f8da3', halo: '#0B1220' } : { color: '#8a96a8', halo: '#ffffff' }
  const size = (z0: number, s0: number, z1: number, s1: number) => ['interpolate', ['linear'], ['zoom'], z0, s0, z1, s1]
  const darkPaint: Record<string, [string, string]> = {
    background: ['background-color', '#2c3d56'],
    water: ['fill-color', '#12263f'],
    water_shadow: ['fill-color', '#12263f'],
    landcover: ['fill-color', '#33465f'],
    landuse: ['fill-color', '#2f4059'],
    landuse_residential: ['fill-color', '#2f4059'],
    park_national_park: ['fill-color', '#2a3f4f'],
    park_nature_reserve: ['fill-color', '#2a3f4f'],
    boundary_state: ['line-color', '#5a6d8a'],
    boundary_county: ['line-color', '#34465f'],
  }
  const text = (id: string, c: { color: string; halo: string }, opacity: number, sz: unknown, minzoom?: number) => {
    map.setPaintProperty(id, 'text-color', c.color)
    map.setPaintProperty(id, 'text-halo-color', c.halo)
    map.setPaintProperty(id, 'text-halo-width', 1.5)
    map.setPaintProperty(id, 'text-opacity', opacity)
    map.setLayoutProperty(id, 'text-size', sz as never)
    if (minzoom !== undefined) map.setLayerZoomRange(id, minzoom, 24)
  }
  for (const layer of map.getStyle().layers) {
    const id = layer.id
    try {
      if (layer.type === 'symbol') {
        if (NOISE.test(id)) map.setLayoutProperty(id, 'visibility', 'none')
        else if (LARGE.test(id)) text(id, place, 1, size(4, 11, 8, 15), 4)
        else if (MID.test(id)) text(id, place, 1, size(6, 10, 9, 12), 6)
        else if (TOWN.test(id)) text(id, place, 1, size(8, 10, 11, 12), 8)
        else if (SMALL.test(id)) text(id, place, 0.9, size(9, 10, 12, 11), 9)
        else if (REGION.test(id)) text(id, region, 0.75, size(3, 8, 8, 10))
      } else if (dark) {
        const p = darkPaint[id]
        if (p) map.setPaintProperty(id, p[0] as never, p[1] as never)
        else if (layer.type === 'line' && /^(road|bridge|tunnel)_.*_fill/.test(id)) map.setPaintProperty(id, 'line-color', '#7a90b3')
        else if (layer.type === 'line' && /^(road|bridge|tunnel)_(mot|trunk|pri)_case/.test(id)) {
          // Dark Matter draws major highways ONLY as these outlines until zoom 10: keep them visible
          map.setPaintProperty(id, 'line-color', '#667ca0')
          map.setPaintProperty(id, 'line-opacity', 1)
          map.setPaintProperty(id, 'line-width', ['interpolate', ['linear'], ['zoom'], 5, 0.9, 8, 1.6, 10, 2.4, 13, 5] as never)
        } else if (layer.type === 'line' && /^(road|bridge|tunnel)_.*_case/.test(id)) map.setPaintProperty(id, 'line-color', '#2c3d56')
      }
    } catch {
      /* layer without that property: ignore */
    }
  }
}

/** Hide the basemap labels of the given city names (the pins stand in for them) via a data-driven text-opacity. */
function hideEndpointLabels(map: MapLibreMap, names: string[]) {
  const opacity = names.length ? ['match', ['get', 'name'], names, 0, 1] : 1
  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'symbol' || !(LARGE.test(layer.id) || MID.test(layer.id) || TOWN.test(layer.id))) continue
    try {
      map.setPaintProperty(layer.id, 'text-opacity', opacity as never)
    } catch {
      /* ignore */
    }
  }
}

/** Our data layers go BELOW the first label layer: basemap fills < heatmap < routes < labels. */
function labelAnchor(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((l) => l.type === 'symbol' && map.getLayoutProperty(l.id, 'visibility') !== 'none')?.id
}

export default function MapView(props: Props) {
  const { theme, routes, selectedId, heatmap, isMobile, fitKey, endpointNames } = props
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
    const anchor = labelAnchor(map)
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
        map.moveLayer(casingLayer(i), anchor)
        map.moveLayer(lineLayer(i), anchor)
      }
    }
    CP_LAYERS.forEach((id) => map.moveLayer(id, anchor))

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
        new Marker({ element: pin(tokenColor('--risk-low'), endpointNames?.[0]) }).setLngLat(c[0]).addTo(map),
        new Marker({ element: pin('#0f1b2d', endpointNames?.[1]) }).setLngLat(c[c.length - 1]).addTo(map),
      ]
    }
  }, [routes, selectedId, styleVersion])

  // ---- keep city labels from sitting under the start/end pins ----
  const namesKey = (endpointNames ?? []).join('|')
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion) return
    hideEndpointLabels(map, namesKey ? namesKey.split('|') : [])
  }, [namesKey, styleVersion])

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
        ? { top: 72, right: 24, bottom: PEEK_PX + sliderHeight() + 8 + 24, left: 24 }
        : { top: 48, right: 48, bottom: sliderHeight() + 16 + 48, left: panelWidth() + 48 },
      duration: 600,
      maxZoom: 12,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, selectedId])

  // ---- heatmap: two layers cross-fade between hours; updates are coalesced per animation frame ----
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleVersion || !map.getLayer(HEAT_LAYER[0])) return
    const h = heat.current
    const vis = heatmap.enabled && heatmap.data ? 'visible' : 'none'
    HEAT_LAYER.forEach((id) => map.setLayoutProperty(id, 'visibility', vis))
    const data = heatmap.data
    if (!heatmap.enabled || !data) {
      h.hour = -1
      h.data = null
      return
    }
    const raf = requestAnimationFrame(() => {
      const src = (i: number) => map.getSource(HEAT_SRC[i]) as GeoJSONSource | undefined
      const opacity = (i: number, v: number) => map.setPaintProperty(HEAT_LAYER[i], 'heatmap-opacity', v)
      if (h.version !== styleVersion || h.hour < 0 || h.data !== data) {
        // first draw, a style swap or another route's data: show immediately on layer A
        h.version = styleVersion
        h.active = 0
        src(0)?.setData(heatFeatures(data, heatmap.hour))
        opacity(0, HEAT_OPACITY)
        opacity(1, 0)
      } else if (h.hour !== heatmap.hour) {
        const next = 1 - h.active
        src(next)?.setData(heatFeatures(data, heatmap.hour))
        opacity(next, HEAT_OPACITY)
        opacity(h.active, 0)
        h.active = next
      }
      h.hour = heatmap.hour
      h.data = data
    })
    return () => cancelAnimationFrame(raf)
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
  const before = labelAnchor(map)
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
      filter: ['>=', ['get', 'w'], 1],
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': ['/', ['get', 'w'], 4],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 8, 1.2],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 24, 5, 40, 8, 90, 10, 150],
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, rgba(mod, 0),
          0.03, rgba(mod, 0),
          0.12, rgba(mod, 0.35),
          0.35, rgba(high, 0.5),
          0.6, rgba(severe, 0.6),
          0.9, rgba(stop, 0.7),
        ] as never,
        'heatmap-opacity': 0,
        'heatmap-opacity-transition': { duration: 350, delay: 0 },
      },
    }, before)
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
    }, before)
    map.addLayer({
      id: lineLayer(i),
      type: 'line',
      source: routeSrc(i),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': tokenColor('--route-muted'), 'line-width': 3, 'line-opacity': 0.6 },
    }, before)
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
    }, before)
  dot(CP_LAYERS[0], ['==', ['%', ['get', 'index'], 2], 0], 0)
  dot(CP_LAYERS[1], ['!=', ['%', ['get', 'index'], 2], 0], 6)
}
