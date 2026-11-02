// Mobile route list with the sheet fully open (cards visible), both themes. Mock server on 5174.
import { chromium } from 'playwright'
const APP = process.argv[2] ?? 'http://localhost:5174/'
const OUT = new URL('../screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge' })
for (const theme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme)
  const page = await ctx.newPage()
  await page.goto(APP, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Analyze routes' }).click()
  await page.waitForSelector('[aria-label="Route options"]')
  const h = page.getByRole('slider', { name: 'Resize panel' })
  await h.focus()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}cards-390-${theme}.png` })
  await ctx.close()
}
await b.close()
