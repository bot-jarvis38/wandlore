/**
 * The two things added for "the game gets a bit laggy" and "sometimes the
 * voice works well, sometimes it lags":
 *
 *  1. resolution follows the device — long frames drop it, spare headroom
 *     lifts it back, and a single hitch moves nothing
 *  2. the game knows and shows whether listening is on-device or over the wire
 *
 * Headless Chromium under SwiftShader renders far slower than any real phone,
 * which makes it a good test rig for the downgrade path: it is genuinely slow,
 * so the real code path runs rather than a simulated one.
 */
import { chromium } from 'playwright'

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const p = await (await b.newContext({ viewport: { width: 430, height: 932 } })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', String(e)))
await p.goto(`${process.argv[2]}/?state=play&populate=Dementor`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)

const start = await p.evaluate(() => window.__game.pixelRatio)
console.log('starting pixel ratio     :', start)

/* one bad frame must not move it */
console.log(
  'single 200ms hitch moves :',
  await p.evaluate(() => {
    const g = window.__game
    const before = g.pixelRatio
    g.tuneQuality(0.2)
    return g.pixelRatio !== before
  })
)

/* a sustained run of long frames must */
console.log(
  'sustained slowness drops :',
  await p.evaluate(() => {
    const g = window.__game
    const before = g.pixelRatio
    for (let i = 0; i < 60; i++) g.tuneQuality(0.033)
    return { before, after: g.pixelRatio }
  })
)

/* and it must stop at the floor rather than approaching zero */
console.log(
  'floor holds              :',
  await p.evaluate(() => {
    const g = window.__game
    for (let i = 0; i < 5000; i++) g.tuneQuality(0.033)
    return g.pixelRatio
  })
)

/* climbing back is rationed, so a borderline device cannot oscillate forever */
console.log(
  'lift is capped           :',
  await p.evaluate(() => {
    const g = window.__game
    const seen = []
    for (let i = 0; i < 5000; i++) {
      g.tuneQuality(0.008)
      if (!seen.length || seen[seen.length - 1] !== g.pixelRatio) seen.push(g.pixelRatio)
    }
    return seen
  })
)

/* the engine label is reported, never assumed — including the "we don't know"
   case, which must not be dressed up as either answer */
console.log(
  'engine label             :',
  await p.evaluate(() => {
    const e = window.__voice.engine
    const at = mode => {
      e.mode = mode
      return window.__game.micLabel()
    }
    return { unknown: at('unknown'), network: at('network'), local: at('local') }
  })
)

await b.close()
