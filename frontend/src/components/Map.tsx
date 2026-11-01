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
    return () => map.remove()
  }, [])

  return <div ref={containerRef} className="absolute inset-0" />
}

