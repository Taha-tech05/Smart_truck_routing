/** Fake weather field + a TypeScript port of the backend risk thresholds (mock data only). */
export interface Wx {
  wind: number
  rain: number
  snow: number
}

const gauss = (d2: number, sigma: number) => Math.exp(-d2 / (2 * sigma * sigma))

/** Deterministic weather: two moving storm cells over a gentle background wind. */
export function fakeWeather(lat: number, lng: number, hour: number): Wx {
  // Storm A (wind + rain) drifts east across the Texas panhandle.
  const aLng = -104.5 + 0.2 * hour
  const a = gauss((lat - 35.6) ** 2 + (lng - aLng) ** 2, 1.5)
  const aPulse = 0.55 + 0.45 * Math.sin((hour / 48) * Math.PI)
  // Storm B (snow + wind) builds over the Colorado Rockies and fades.
  const b = gauss((lat - 38.6) ** 2 + (lng + 105.6) ** 2, 1.3)
  const bPulse = Math.max(0, Math.sin(((hour - 12) / 30) * Math.PI))
  const base = 9 + 5 * Math.sin(lat * 1.7 + hour / 9) + 3 * Math.cos(lng * 1.3)
  return {
    wind: Math.max(0, base + 42 * a * aPulse + 24 * b * bPulse),
    rain: 0.95 * a * aPulse,
    snow: 2.4 * b * bPulse,
  }
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
