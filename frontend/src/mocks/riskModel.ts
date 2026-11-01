/** Fake weather field + a TypeScript port of the backend risk thresholds (mock data only). */
export interface Wx {
  wind: number
  rain: number
  snow: number
}

const gauss = (d2: number, sigma: number) => Math.exp(-d2 / (2 * sigma * sigma))

/** A storm cell that drifts across the map and swells/fades over time. */
interface Cell {
  lat: number
  lng: number
  dLat: number // degrees per hour
  dLng: number
  sigma: number // size in degrees
  peakHour: number
  life: number // half-width of the intensity bump, in hours
  wind: number
  rain: number
  snow: number
}

const CELLS: Cell[] = [
  // 1. Wind + rain front crossing the Texas panhandle toward Oklahoma
  { lat: 35.3, lng: -105.0, dLat: 0.02, dLng: 0.36, sigma: 0.9, peakHour: 8, life: 14, wind: 44, rain: 1.0, snow: 0 },
  // 2. Snow band over the Colorado Rockies, building then drifting east
  { lat: 38.9, lng: -106.6, dLat: -0.01, dLng: 0.07, sigma: 0.8, peakHour: 20, life: 13, wind: 28, rain: 0, snow: 3.2 },
  // 3. Wind storm over Kansas moving north-east
  { lat: 37.2, lng: -102.0, dLat: 0.07, dLng: 0.14, sigma: 0.75, peakHour: 28, life: 12, wind: 50, rain: 0.35, snow: 0 },
  // 4. Southern rain band near Dallas / Oklahoma, moving east
  { lat: 33.6, lng: -100.5, dLat: 0.05, dLng: 0.2, sigma: 0.7, peakHour: 4, life: 10, wind: 34, rain: 0.85, snow: 0 },
]

/** Deterministic weather: four moving storm cells over a gentle background wind. */
export function fakeWeather(lat: number, lng: number, hour: number): Wx {
  const base = 9 + 5 * Math.sin(lat * 1.7 + hour / 9) + 3 * Math.cos(lng * 1.3)
  let wind = base
  let rain = 0
  let snow = 0
  for (const c of CELLS) {
    const t = (hour - c.peakHour) / c.life
    const pulse = Math.exp(-t * t)
    const g =
      gauss((lat - (c.lat + c.dLat * hour)) ** 2 + (lng - (c.lng + c.dLng * hour)) ** 2, c.sigma) * pulse
    wind += c.wind * g
    rain += c.rain * g
    snow += c.snow * g
  }
  return { wind: Math.max(0, wind), rain, snow }
}

export function classifyWind(w: number) {
  return w >= 55 ? 4 : w >= 45 ? 3 : w >= 35 ? 2 : w >= 25 ? 1 : 0
}
export function classifyRain(r: number) {
  return r > 1 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : r >= 0.1 ? 1 : 0
}
export function classifySnow(s: number) {
  return s > 3 ? 4 : s > 2 ? 3 : s > 1 ? 2 : s >= 0.5 ? 1 : 0
}

export function assess(wx: Wx, loadLb: number): { level: 0 | 1 | 2 | 3 | 4; reasons: string[] } {
  const w = classifyWind(wx.wind)
  const r = classifyRain(wx.rain)
  const s = classifySnow(wx.snow)
  const base = Math.max(w, r, s)
  let level = base
  if (wx.wind >= 55) level = 4
  else if (wx.wind >= 45 && loadLb > 30000) level = 4
  else if (wx.wind >= 35 && loadLb > 40000) level = Math.max(level, 3)
  const names = ['Low', 'Moderate', 'High', 'Severe', 'No Travel']
  const reasons: string[] = []
  if (base === 0) reasons.push('Wind, rain and snow are all within low-risk limits')
  else {
    if (w) reasons.push(`Wind ${wx.wind.toFixed(0)} mph is ${names[w]}`)
    if (r) reasons.push(`Rain ${wx.rain.toFixed(2)} in/hr is ${names[r]}`)
    if (s) reasons.push(`Snow ${wx.snow.toFixed(2)} in/hr is ${names[s]}`)
  }
  if (level > base) {
    reasons.push(
      `Load ${loadLb.toLocaleString('en-US')} lb with wind ${wx.wind.toFixed(0)} mph raises the level from ${names[base]} to ${names[level]}`,
    )
  }
  return { level: level as 0 | 1 | 2 | 3 | 4, reasons }
}
