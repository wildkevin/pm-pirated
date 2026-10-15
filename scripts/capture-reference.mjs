// Read-only capture of a running Postman desktop app for visual reference: screenshot, CSS design
// tokens and bounding boxes of key UI regions. Uses Postman's local remote-debugging port.
// Usage: node scripts/capture-reference.mjs [label]   → docs/reference/private/<label>.*
import { chromium } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const label = process.argv[2] ?? 'capture'
const outDir = 'docs/reference/private'
const portFile =
  process.platform === 'win32'
    ? join(process.env.APPDATA ?? '', 'Postman', 'DevToolsActivePort')
    : join(homedir(), 'Library/Application Support/Postman/DevToolsActivePort')
const port = (await readFile(portFile, 'utf8')).split('\n')[0].trim()
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
await mkdir(outDir, { recursive: true })
const pages = browser.contexts().flatMap((c) => c.pages())
let n = 0
for (const page of pages) {
  const name = pages.length > 1 ? `${label}-${++n}` : label
  await page.screenshot({ path: join(outDir, `${name}.png`) })
  const info = await page.evaluate(() => {
    const tokens = {}
    const cs = getComputedStyle(document.documentElement)
    for (let i = 0; i < cs.length; i++) if (cs[i].startsWith('--')) tokens[cs[i]] = cs.getPropertyValue(cs[i]).trim()
    // Every visible element with a stable-looking class: box + key styles, for layout measurements.
    const boxes = []
    for (const el of document.querySelectorAll('[class]')) {
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      const s = getComputedStyle(el)
      boxes.push({
        cls: String(el.className).slice(0, 120),
        tag: el.tagName,
        text: (el.childElementCount === 0 ? el.textContent : '')?.trim().slice(0, 40),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        font: `${s.fontWeight} ${s.fontSize} ${s.fontFamily.split(',')[0]}`,
        color: s.color, bg: s.backgroundColor, border: s.borderBottom,
      })
    }
    return { url: location.href, title: document.title, viewport: [innerWidth, innerHeight], tokens, boxes }
  })
  await writeFile(join(outDir, `${name}.json`), JSON.stringify(info, null, 2))
  console.log('captured', name, info.title, info.viewport, Object.keys(info.tokens).length, 'tokens', info.boxes.length, 'boxes')
}
// connectOverCDP: close() only disconnects; Postman keeps running.
await browser.close()
