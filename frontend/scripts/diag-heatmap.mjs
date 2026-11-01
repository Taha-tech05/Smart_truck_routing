// Diagnoses the heatmap for Dallas -> Houston (38,000 lb) against the real backend.
//   node scripts/diag-heatmap.mjs [appUrl]
import { chromium } from 'playwright'

const APP = process.argv[2] ?? 'http://localhost:5173/'
const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge' })
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const log = []
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && log.push(`console ${m.type()}: ${m.text().slice(0, 200)}`))
page.on('pageerror', (e) => log.push('pageerror ' + e.message))
let heat = null
page.on('response', async (res) => {
  if (!res.url().includes('/api/')) return
  const body = await res.body().catch(() => Buffer.alloc(0))
  console.log(`[net] ${res.request().method()} ${res.url().replace(/^https?:\/\/[^/]+/, '')} -> ${res.status()} (${body.length} bytes)`)
  if (res.url().endsWith('/api/heatmap') && res.status() === 200) heat = JSON.parse(body.toString())
})
await page.goto(APP)
const box = page.getByRole('combobox', { name: 'Destination' })
await box.fill('Houston, TX')
await page.getByRole('option').filter({ hasText: /Houston, TX/ }).first().click()
await page.getByRole('button', { name: 'Analyze routes' }).click()
await page.waitForSelector('[aria-label="Route options"]', { timeout: 40000 })
await page.waitForTimeout(6000)

if (heat) {
  const perHour = Array.from({ length: heat.hours }, (_, h) => heat.levels.filter((s) => s[h] !== '0').length)
  const max = Math.max(...heat.levels.map((s) => Math.max(...[...s].map(Number))))
  console.log(`[heat] points=${heat.points.length} hours=${heat.hours} maxLevel=${max} warnings=${JSON.stringify(heat.warnings)}`)
  console.log('[heat] non-zero points per hour:', perHour.join(' '))
} else console.log('[heat] NO heatmap response captured')

const state = (label) =>
  page.evaluate((label) => {
    const m = window.__map
    const ids = ['heat-a', 'heat-b'].map((s) => !!m.getSource(s)).join('/')
    const layers = m.getStyle().layers.map((l) => l.id)
    const li = (id) => layers.indexOf(id)
    const vis = ['heat-a-layer', 'heat-b-layer'].map((id) => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') + '@' + m.getPaintProperty(id, 'heatmap-opacity'))
    const firstSymbol = layers.findIndex((id) => m.getLayer(id).type === 'symbol')
    const feats = ['heat-a', 'heat-b'].map((s) => m.querySourceFeatures(s).length)
    return { label, sources: ids, order: { heatA: li('heat-a-layer'), heatB: li('heat-b-layer'), route0: li('route-0-line'), firstSymbol, total: layers.length }, vis, zoom: +m.getZoom().toFixed(2), renderedFeatures: feats }
  }, label)
console.log('[map]', JSON.stringify(await state('after analyze')))
await page.screenshot({ path: 'screenshots/diag-heat-1.png' })
await page.locator('[role="button"][aria-pressed]').nth(1).click()
await page.waitForTimeout(4000)
console.log('[map]', JSON.stringify(await state('after route select')))
await page.getByRole('button', { name: /Switch to dark/ }).click()
await page.waitForTimeout(3500)
console.log('[map]', JSON.stringify(await state('after theme switch')))
await page.screenshot({ path: 'screenshots/diag-heat-2.png' })
console.log('[console]', JSON.stringify(log))
await b.close()
