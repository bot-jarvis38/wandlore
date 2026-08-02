/**
 * Drives the live build headless and photographs every state the spec names.
 * Run: node tools/shoot.mjs [baseUrl] [outDir]
 *
 * WebGL needs a real GPU path, so this uses headless Chromium with SwiftShader
 * rather than the old headless shell, and waits a beat on each state so the
 * torch flicker and particle systems have something on screen.
 */

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5177'
const outDir = process.argv[3] ?? './shots'
mkdirSync(outDir, { recursive: true })

const STATES = [
  { name: 'title', query: '' },
  { name: 'gameplay', query: '?state=play&populate=Dementor,Pixie,Pixie' },
  {
    name: 'intense',
    query: '?state=play&populate=Dementor,Armour,Pixie,Dementor,Pixie,Armour,Pixie',
  },
  { name: 'interlude', query: '?state=interlude' },
  { name: 'gameover', query: '?state=gameover' },
]

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
})

// deviceScaleFactor stays at 1 on purpose. SwiftShader is a software
// rasteriser: at 2x, one bloomed frame takes long enough that the boot
// timers never get a slice and every shot came back on the loading screen.
const context = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 1,
  hasTouch: true,
})

const page = await context.newPage()
const errors = []
page.on('console', m => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', e => errors.push(String(e)))

for (const state of STATES) {
  await page.goto(base + '/' + state.query, { waitUntil: 'networkidle' })
  // 900ms of boot delay, then let a few waves of enemies walk into frame
  await page.waitForTimeout(state.name === 'title' ? 3500 : 3200)
  if (state.name === 'intense') {
    // fire a couple of bolts so the shot has spell light in it
    await page.evaluate(() => {
      const btn = document.getElementById('cast-button')
      btn?.click()
      setTimeout(() => btn?.click(), 260)
    })
    await page.waitForTimeout(420)
  }
  await page.screenshot({ path: join(outDir, `${state.name}.png`) })
  console.log('shot', state.name)
}

await browser.close()

if (errors.length) {
  console.log('\nPAGE ERRORS:')
  for (const e of [...new Set(errors)].slice(0, 12)) console.log(' -', e)
  process.exitCode = 1
} else {
  console.log('\nno page errors')
}
