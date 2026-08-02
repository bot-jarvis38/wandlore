/**
 * How long does the picture stay soft after the device has recovered?
 *
 * The adaptive resolution has always been measured on the way DOWN — a hitch
 * must not move it, sustained slowness must, and it must stop at the floor
 * (`probe-quality.mjs`). Nobody measured the way back UP, and that is where the
 * bug was.
 *
 * Dropping is cheap: 45 long frames per notch, four notches, so three seconds
 * of stutter takes the game from 2.0 to the 1.0 floor. Climbing used to cost
 * 3600 consecutive good frames per notch — a full minute each, four minutes to
 * undo those three seconds, because every drop doubled the price and nothing
 * ever brought it back down. On a phone reporting a device pixel ratio of 3,
 * sitting at 1.0 means a third-resolution image stretched over the display.
 * That is what "it looks blurry" was, and the resource leak is what guaranteed
 * the stalls that triggered it.
 *
 * This drives the real tuneQuality on the live build: sustained slow frames
 * until it bottoms out, then nothing but good frames, counting how many it
 * takes to get back.
 *
 *   node tools/probe-recovery.mjs http://localhost:5173
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173'
/** The asymmetry we are willing to ship: recovery no worse than 30× the fall. */
const MAX_ASYMMETRY = 30

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const p = await (await b.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 3,
})).newPage()
p.on('pageerror', e => console.log('PAGEERROR', String(e)))
await p.goto(`${url}/?state=play`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)

const r = await p.evaluate(() => {
  const g = window.__game
  g.setPixelRatio(2)
  g._q = null // a fresh tuner, so the measurement starts where a player does
  const out = { start: g.pixelRatio, drops: [] }

  // Sustained long frames, the way a leaking build produces them.
  for (let i = 0; i < 4000; i++) {
    const before = g.pixelRatio
    g.tuneQuality(0.033)
    if (g.pixelRatio !== before) out.drops.push({ frame: i, to: g.pixelRatio })
  }
  out.floor = g.pixelRatio
  out.framesToFall = out.drops.length ? out.drops[out.drops.length - 1].frame : 0

  // The device is healthy again. Nothing but good frames from here.
  let frames = 0
  while (g.pixelRatio < 2 && frames < 200000) {
    g.tuneQuality(0.01)
    frames++
  }
  out.framesToRecover = frames
  out.recoveredTo = g.pixelRatio
  return out
})

const secs = f => (f / 60).toFixed(1)
console.log(`opened at        : ${r.start}`)
console.log(`fell to          : ${r.floor} after ${r.framesToFall} long frames (${secs(r.framesToFall)}s)`)
console.log(`climbed back to  : ${r.recoveredTo} after ${r.framesToRecover} good frames (${secs(r.framesToRecover)}s)`)

const asymmetry = r.framesToRecover / Math.max(1, r.framesToFall)
console.log(`\nasymmetry        : ${asymmetry.toFixed(1)}× (recovery vs fall)`)
console.log(asymmetry <= MAX_ASYMMETRY ? 'PASS' : `FAIL — over ${MAX_ASYMMETRY}×, one stall leaves the game soft`)

await b.close()
process.exit(asymmetry <= MAX_ASYMMETRY ? 0 : 1)
