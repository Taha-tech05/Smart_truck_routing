import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, NavigationControl } from '../utils/maplibre'

const STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/positron'

export default function Map() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL,
      center: [-98.5, 39.8],
      zoom: 4,
    })
    map.addControl(new NavigationControl(), 'top-right')
    map.on('error', (e) => console.error('[map]', e.error ?? e))
    map.on('load', () => console.log('[map] loaded'))
    return () => map.remove()
  }, [])

  // Inline size: maplibre-gl.css sets `.maplibregl-map { position: relative }`, which
  // beats Tailwind (layered) utilities and would collapse an `absolute inset-0` container.
  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
}

