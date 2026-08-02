/**
 * Jeremy: "your graphics got worse, it was better before, its super blurry now."
 *
 * The suspect is the adaptive resolution added in b5566c0. This drives a real
 * phone-shaped viewport at a phone's device pixel ratio and reports, over a run:
 *
 *   - where the render resolution ends up, and whether it can ever climb back
 *   - whether the offscreen buffers the scene is actually drawn into shrank with
 *     it (if they didn't, the "optimisation" costs full price and only throws
 *     away sharpness)
 *   - how sharp the final frame is, measured rather than eyeballed: the mean
 *     absolute difference between neighbouring pixels. A blurred image has
 *     gentler neighbours, so this number falls as the picture softens.
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5177'
const SECONDS = Number(process.argv[3] ?? 25)

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const ctx = await b.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 3, // what a current phone actually reports
})
const p = await ctx.newPage()
p.on('pageerror', e => console.log('PAGEERROR', String(e)))

await p.goto(`${url}/?state=play&populate=Dementor`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)

/* watch the resolution for the whole run instead of sampling the end state */
await p.evaluate(() => {
  const g = window.__game
  window.__trace = []
  const tick = () => {
    const c = g.composer
    window.__trace.push({
      t: Math.round(performance.now()),
      pr: g.pixelRatio,
      canvas: g.renderer.domElement.width,
      buffer: c.renderTarget1.width,
      bloomMip: c.passes.find(x => x.strength !== undefined)?.renderTargetsHorizontal?.[0]?.width,
    })
    setTimeout(tick, 250)
  }
  tick()
})

await p.waitForTimeout(SECONDS * 1000)

const trace = await p.evaluate(() => window.__trace)
const first = trace[0]
const last = trace[trace.length - 1]
const lowest = trace.reduce((a, x) => (x.pr < a.pr ? x : a), first)

const show = s => `pr=${s.pr}  canvas=${s.canvas}px  scene buffer=${s.buffer}px  bloom mip=${s.bloomMip}px`
console.log('start           :', show(first))
console.log('lowest reached  :', show(lowest))
console.log('end of run      :', show(last))
console.log(
  'recovery        :',
  lowest.pr === first.pr
    ? 'never dropped on this machine'
    : last.pr > lowest.pr
      ? `climbed back to ${last.pr}`
      : 'STUCK — dropped and never recovered'
)

/* the floor is the whole point: the adaptive path must never go sub-native */
const floorHeld = await p.evaluate(() => {
  const g = window.__game
  const before = g.pixelRatio
  for (let i = 0; i < 400; i++) g.tuneQuality(0.05) // 400 frames at 20fps
  const after = g.pixelRatio
  g.setPixelRatio(before)
  return after
})
console.log('floor after a long stall:', floorHeld, floorHeld >= 1 ? '(ok — never sub-native)' : '(BLURRY)')

/* css width * 3 is what a sharp frame would be drawn at on this device */
const nativeW = 430 * 3
console.log(
  'scene buffer vs native :',
  `${last.buffer}/${nativeW}`,
  last.buffer >= nativeW ? '(full — the drop saved nothing)' : `(${(last.buffer / nativeW).toFixed(2)}x)`
)

/* measured sharpness of the actual delivered frame */
const shot = await p.screenshot({ path: '/tmp/wandlore-sharp.png' })
const sharpness = await p.evaluate(async b64 => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + b64
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height).data
  let sum = 0
  let n = 0
  for (let y = 0; y < c.height; y++) {
    for (let px = 1; px < c.width; px++) {
      const i = (y * c.width + px) * 4
      sum += Math.abs(d[i] - d[i - 4]) + Math.abs(d[i + 1] - d[i - 3]) + Math.abs(d[i + 2] - d[i - 2])
      n += 3
    }
  }
  return sum / n
}, shot.toString('base64'))
console.log('edge contrast (higher = sharper):', sharpness.toFixed(3))

await b.close()
