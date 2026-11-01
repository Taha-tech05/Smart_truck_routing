// Dallas -> Houston against the real backend: screenshots at hour 0 and at the stormiest hour, both themes.
//   node scripts/heat-shots.mjs [appUrl] [tag]
import { chromium } from 'playwright'
const APP = process.argv[2] ?? 'http://localhost:5173/'
const TAG = process.argv[3] ?? 'real'
const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge' })
for (const theme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme)
  const page = await ctx.newPage()
  const problems = []
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(m.text().slice(0, 160)))
  let heat = null
  page.on('response', async (r) => {
    if (r.url().endsWith('/api/heatmap') && r.status() === 200) heat = await r.json()
  })
  await page.goto(APP)
  await page.getByRole('combobox', { name: 'Destination' }).fill('Houston, TX')
  await page.getByRole('option').filter({ hasText: /Houston, TX/ }).first().click()
  await page.getByRole('button', { name: 'Analyze routes' }).click()
  await page.waitForSelector('[aria-label="Route options"]', { timeout: 40000 })
  await page.waitForTimeout(5000)
  await page.screenshot({ path: `screenshots/heat-${TAG}-${theme}-h0.png` })
  const peak = heat ? heat.summary.reduce((m, r) => (r.counts.slice(1).reduce((a, b) => a + b, 0) > m.n ? { h: r.hour, n: r.counts.slice(1).reduce((a, b) => a + b, 0) } : m), { h: 9, n: -1 }).h : 9
  await page.getByRole('slider', { name: 'Forecast hour' }).fill(String(peak))
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `screenshots/heat-${TAG}-${theme}-h${peak}.png` })
  console.log(theme, 'peak hour', peak, 'problems', JSON.stringify(problems))
  await ctx.close()
}
await b.close()
