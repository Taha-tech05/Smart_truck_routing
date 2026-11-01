/** Small geometry helpers used only to build the fake data. */
export type LngLat = [number, number]

const R = 3958.7613

export function haversine(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLng = (b[0] - a[0]) * rad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Densify a waypoint path (roughly every `stepMiles`) with a gentle road-like wiggle. */
export function densify(waypoints: LngLat[], stepMiles = 4, wiggle = 0.04): LngLat[] {
  const out: LngLat[] = []
  waypoints.forEach((a, i) => {
    const b = waypoints[i + 1]
    if (!b) return
    const miles = haversine(a, b)
    const n = Math.max(1, Math.round(miles / stepMiles))
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    for (let k = 0; k < n; k++) {
      const t = k / n
      const w = Math.sin(t * Math.PI) * Math.sin((i * 7 + k) * 0.9) * wiggle
      out.push([a[0] + dx * t + (-dy / len) * w, a[1] + dy * t + (dx / len) * w])
    }
  })
  out.push(waypoints[waypoints.length - 1])
  return out
}

export function cumulative(coords: LngLat[]): number[] {
  const cum = [0]
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]))
  return cum
}

export function pointAt(coords: LngLat[], cum: number[], mile: number): LngLat {
  if (mile <= 0) return coords[0]
  if (mile >= cum[cum.length - 1]) return coords[coords.length - 1]
  let lo = 1
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid] >= mile) hi = mid
    else lo = mid + 1
  }
  const f = (mile - cum[lo - 1]) / (cum[lo] - cum[lo - 1])
  const a = coords[lo - 1]
  const b = coords[lo]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

/** Polyline between two distances along the route (inclusive of interpolated ends). */
export function slice(coords: LngLat[], cum: number[], from: number, to: number): LngLat[] {
  const out: LngLat[] = [pointAt(coords, cum, from)]
  for (let i = 0; i < coords.length; i++) if (cum[i] > from && cum[i] < to) out.push(coords[i])
  out.push(pointAt(coords, cum, to))
  return out
}
