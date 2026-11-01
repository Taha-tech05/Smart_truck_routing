// Captures the app at 4 viewports x 2 themes into frontend/screenshots/ (gitignored).
// Usage: npm run dev (port 5173), then `node scripts/screenshots.mjs [url]`.
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const APP = process.argv[2] ?? 'http://localhost:5173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const VIEWPORTS = [
  ['1440x900', 1440, 900],
  ['1024x768', 1024, 768],
  ['768x1024', 768, 1024],
  ['390x844', 390, 844],
]
mkdirSync(OUT, { recursive: true })

// Use the installed Edge/Chrome so no browser download is needed.
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge' })
for (const theme of ['light', 'dark']) {
  for (const [name, width, height] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
    await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('pageerror', e.message))
    await page.goto(APP, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'Analyze routes' }).click()
    await page.waitForSelector('[aria-label="Route options"]')
    await page.waitForTimeout(500)
    // move the heatmap to a stormy hour, then wait for tiles + camera animation to settle
    const slider = page.getByRole('slider', { name: 'Forecast hour' })
    await slider.fill('9')
    await page.waitForTimeout(3500)
    await page.screenshot({ path: `${OUT}${name}-${theme}.png` })
    console.log('saved', name, theme)
    await ctx.close()
  }
}
await browser.close()
