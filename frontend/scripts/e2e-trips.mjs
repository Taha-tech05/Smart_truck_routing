// Manual end-to-end check against the REAL backend (both servers must be running).
//   node scripts/e2e-trips.mjs [appUrl]
// For six trips it drives the UI, then reports: routes, summaries, warnings, time to results,
// time to heatmap, route distinctness / kinks, console problems, and that moving the slider
// through all 49 hours fires no API requests. Screenshots go to frontend/screenshots/trip-*.png.
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const APP = process.argv[2] ?? 'http://localhost:5173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const TRIPS = [
  { id: 'dallas-denver-38k', load: '38000' },
  { id: 'dallas-denver-45k', load: '45000' },
  { id: 'austin-houston', from: ['Austin, TX', /Austin, TX/], to: ['Houston, TX', /Houston, TX/], load: '38000' },
  { id: 'dallas-fortworth', from: ['Dallas, TX', /Dallas, TX/], to: ['Fort Worth, TX', /Fort Worth, TX/], load: '38000' },
  { id: 'seattle-slc', from: ['Seattle, WA', /Seattle, WA/], to: ['Salt Lake City, UT', /Salt Lake City, UT/], load: '38000' },
  { id: 'miami-orlando', from: ['Miami, FL', /Miami, FL/], to: ['Orlando, FL', /Orlando, FL/], load: '38000' },
  { id: 'miami-orlando-downtown', from: ['Miami, FL', /Miami, FL/], to: ['Downtown Orlando', /Downtown Orlando/], load: '38000' },
  { id: 'dallas-denver-20k', load: '20000' },
]

const R = 3958.76
const rad = Math.PI / 180
function hav(a, b) {
  const dLat = (b[1] - a[1]) * rad
  const dLng = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
/** share of route A's sampled points that lie within 1.5 miles of route B's vertices */
function overlap(a, b) {
  const step = Math.max(1, Math.floor(a.length / 150))
  let near = 0
  let n = 0
  for (let i = 0; i < a.length; i += step) {
    n++
    let best = Infinity
    for (let j = 0; j < b.length; j += Math.max(1, Math.floor(b.length / 1500))) best = Math.min(best, hav(a[i], b[j]))
    if (best < 1.5) near++
  }
  return near / n
}
/** sharp reversals (> 135 degrees) between consecutive segments longer than 0.05 mi */
function kinks(c) {
  let k = 0
  for (let i = 1; i < c.length - 1; i++) {
    const ax = c[i][0] - c[i - 1][0]
    const ay = c[i][1] - c[i - 1][1]
    const bx = c[i + 1][0] - c[i][0]
    const by = c[i + 1][1] - c[i][1]
    const la = Math.hypot(ax, ay)
    const lb = Math.hypot(bx, by)
    if (hav(c[i - 1], c[i]) < 0.05 || hav(c[i], c[i + 1]) < 0.05) continue
    const cos = (ax * bx + ay * by) / (la * lb)
    if (cos < Math.cos((135 * Math.PI) / 180)) k++
  }
  return k
}

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge' })
const report = []

const ONLY = process.env.ONLY?.split(',')
for (const trip of TRIPS.filter((t) => !ONLY || ONLY.includes(t.id))) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const consoleProblems = []
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) consoleProblems.push(`${m.type()}: ${m.text().slice(0, 160)}`)
  })
  page.on('pageerror', (e) => consoleProblems.push(`pageerror: ${e.message}`))
  const api = []
  page.on('request', (r) => {
    if (r.url().includes('/api/')) api.push({ t: Date.now(), method: r.method(), url: r.url().replace(/^https?:\/\/[^/]+/, '') })
  })
  let analysis = null
  let heat = null
  let tHeat = null
  let heatStatus = null
  page.on('response', async (res) => {
    const u = res.url()
    try {
      if (u.endsWith('/api/analyze')) analysis = await res.json()
      if (u.endsWith('/api/heatmap')) {
        heatStatus = res.status()
        heat = await res.json()
        tHeat = Date.now()
      }
    } catch {
      /* non-JSON error body */
    }
  })

  await page.addInitScript(() => localStorage.setItem('theme', 'light'))
  await page.goto(APP, { waitUntil: 'load' })

  async function pick(label, [query, match]) {
    const box = page.getByRole('combobox', { name: label })
    await box.fill(query)
    const opt = page.getByRole('option').filter({ hasText: match }).first()
    await opt.waitFor({ timeout: 10000 })
    await opt.click()
  }
  if (trip.from) {
    await pick('Origin', trip.from)
    await pick('Destination', trip.to)
  }
  await page.getByLabel('Load weight').fill(trip.load)

  const t0 = Date.now()
  await page.getByRole('button', { name: 'Analyze routes' }).click()
  let tResults = null
  let error = null
  try {
    await Promise.race([
      page.waitForSelector('[aria-label="Route options"]', { timeout: 45000 }).then(() => (tResults = Date.now() - t0)),
      page.waitForSelector('[role="alert"]', { timeout: 45000 }).then(async () => {
        error = await page.locator('[role="alert"]').first().innerText()
      }),
    ])
  } catch (e) {
    error = `timeout waiting for results: ${e.message}`
  }

  if (!error) {
    const deadline = Date.now() + 40000
    while (!tHeat && Date.now() < deadline) await page.waitForTimeout(200)
    await page.waitForTimeout(3500) // let the camera settle and tiles draw
  }

  // ---- slider sweep: no API traffic while moving through all 49 hours ----
  let sweepRequests = null
  if (!error && heat) {
    const before = api.length
    const slider = page.getByRole('slider', { name: 'Forecast hour' })
    for (let h = 0; h <= 48; h++) {
      await slider.fill(String(h))
      await page.waitForTimeout(40)
    }
    sweepRequests = api.length - before
    await slider.fill('9')
    await page.waitForTimeout(1200)
  }
  await page.screenshot({ path: `${OUT}trip-${trip.id}.png` })

  const row = { trip: trip.id, load: trip.load, error, tResultsMs: tResults, tHeatMs: tHeat ? tHeat - t0 : null, heatStatus }
  if (analysis?.error) row.backendError = analysis.error
  if (analysis?.routes) {
    const routes = analysis.routes
    row.routes = routes.map((r) => ({
      id: r.id,
      summary: r.summary,
      provider: r.provider ?? null,
      miles: r.distance_miles,
      minutes: Math.round(r.duration_s / 60),
      rank: r.rank,
      recommended: r.recommended,
      severe: r.stats.severe_miles,
      high: r.stats.high_miles,
      moderate: r.stats.miles_by_level.moderate,
      noTravel: r.stats.no_travel_miles,
      vertices: r.geometry.coordinates.length,
      kinks: kinks(r.geometry.coordinates),
      beyondForecast: r.checkpoints.filter((c) => c.beyond_forecast).length,
      maxWind: Math.max(...r.checkpoints.map((c) => c.weather.wind_mph)),
    }))
    row.pairOverlap = []
    for (let i = 0; i < routes.length; i++)
      for (let j = i + 1; j < routes.length; j++)
        row.pairOverlap.push(
          `${routes[i].id}~${routes[j].id}: ${Math.round(overlap(routes[i].geometry.coordinates, routes[j].geometry.coordinates) * 100)}%`,
        )
    row.warnings = analysis.warnings
    row.recommendation = analysis.recommendation
  }
  if (heat) row.heatmap = { points: heat.points.length, hours: heat.hours, missing: heat.missing, warnings: heat.warnings }
  row.sweepRequests = sweepRequests
  row.apiRequests = api.map((a) => `${a.method} ${a.url}`)
  row.consoleProblems = consoleProblems
  report.push(row)
  console.log(JSON.stringify(row, null, 1))
  await ctx.close()
}
await browser.close()
writeFileSync(`${OUT}report${ONLY ? '-partial' : ''}.json`, JSON.stringify(report, null, 2))
console.log('report saved to screenshots/report.json')
