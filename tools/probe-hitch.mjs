/**
 * Why does the game stutter the moment a spell leaves the wand?
 *
 * "Laggy when a spell shoots off" is a frame-time complaint, and frame time is
 * the one thing a headless software renderer cannot tell you honestly — this
 * scene runs at a few frames a second under SwiftShader, so any millisecond
 * figure here describes the test rig, not a phone. What IS exact, and is
 * identical on a phone, is *what the engine is made to do* at the moment of the
 * cast. So that is what this counts:
 *
 *   1. GLSL programs compiled and linked, per cast. three.js keys a material's
 *      program on, among other things, the number of lights in the scene. Add
 *      one light and every material in the scene needs a program it does not
 *      have, and the browser builds it synchronously, in the middle of the
 *      frame. A bolt used to carry its own point light, so firing changed the
 *      count — and so did the bolt expiring 2.6s later, and every spawn, and
 *      every death.
 *
 *   2. The number of point lights in the scene, sampled throughout. This is the
 *      cause behind (1) and also the per-pixel cost of every lit surface in the
 *      frame: three.js loops all of them for every fragment, whether or not the
 *      light is anywhere near it.
 *
 * Three phases, because the two halves of the bug fire at different moments: a
 * cast with creatures on screen, a bolt in flight with none, and the moment the
 * bolt expires — which the player feels as a stutter with nothing on screen to
 * explain it.
 *
 *   node tools/probe-hitch.mjs http://localhost:5173
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173'
const CASTS = 6

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const p = await (await b.newContext({ viewport: { width: 430, height: 932 } })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', String(e)))
p.on('crash', () => console.log('PAGE CRASHED'))

// Counted at the WebGL boundary rather than from three.js's own bookkeeping:
// `renderer.info.programs` reports what is currently held, which stays flat
// while programs are thrown away and rebuilt underneath it. The thing that
// costs a frame is the call, so count calls.
await p.addInitScript(() => {
  window.__gl = { links: 0, compiles: 0 }
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const link = proto.linkProgram
    proto.linkProgram = function (...a) {
      window.__gl.links++
      return link.apply(this, a)
    }
    const compile = proto.compileShader
    proto.compileShader = function (...a) {
      window.__gl.compiles++
      return compile.apply(this, a)
    }
  }
})

await p.goto(`${url}/?state=play&populate=Dementor,Armour,Pixie`, { waitUntil: 'domcontentloaded' })

/**
 * Wait on rendered frames, never on the clock — under a software renderer a
 * fixed pause is regularly shorter than a single frame of this scene, which is
 * how an earlier probe on this game reported a leak that was already fixed.
 */
const frames = (n = 3) =>
  p.evaluate(
    n =>
      new Promise(res => {
        let left = n
        const tick = () => (--left <= 0 ? res(true) : requestAnimationFrame(tick))
        requestAnimationFrame(tick)
      }),
    n
  )

const sample = () =>
  p.evaluate(() => {
    const g = window.__game
    let point = 0
    let other = 0
    g.scene.traverse(o => {
      if (o.isPointLight) point++
      else if (o.isLight) other++
    })
    return {
      ...window.__gl,
      point,
      other,
      programs: g.renderer.info.programs.length,
      bolts: g.projectiles.live.length,
      enemies: g.enemies.filter(e => e.alive).length,
    }
  })

const cast = () =>
  p.evaluate(() => {
    const g = window.__game
    g.casting = false
    g.castCurrent('tap')
  })

await frames(10)
const before = await sample()
console.log(
  `steady state: ${before.point} point lights, ${before.other} other, ` +
    `${before.programs} programs held, ${before.enemies} creatures\n`
)

let prev = before
let worst = 0
let minPoint = before.point
let maxPoint = before.point
const t0 = Date.now()

const step = async label => {
  await frames(3)
  const now = await sample()
  minPoint = Math.min(minPoint, now.point)
  maxPoint = Math.max(maxPoint, now.point)
  const linked = now.links - prev.links
  worst = Math.max(worst, linked)
  console.log(
    `${label.padEnd(22)} ${String(linked).padStart(3)} programs linked, ` +
      `${String(now.compiles - prev.compiles).padStart(3)} shaders compiled, ` +
      `point lights ${prev.point} → ${now.point}, ` +
      `${now.bolts} bolts, ${now.enemies} creatures`
  )
  prev = now
  return now
}

/* ── 1. casting into a fight, which is where the complaint lives ───── */
for (let i = 1; i <= CASTS; i++) {
  await cast()
  await step(`cast ${i} (in a fight)`)
}

/* ── 2. a bolt alone in the corridor, so it stays in flight ────────── */
await p.evaluate(() => {
  const g = window.__game
  // An empty corridor ends the floor, and the interlude stops tickPlay — which
  // stops bolts ageing, so nothing would ever expire to be measured.
  g.advanceWave = () => {}
  g.enemies.forEach(e => (e.alive = false))
})
await step('creatures cleared')
await cast()
await step('cast, bolt in flight')

/* ── 3. and the moment it expires, seconds after the shot ──────────── */
try {
  await p.evaluate(
    () =>
      new Promise(res => {
        let guard = 600
        const check = () =>
          window.__game.projectiles.live.length === 0 || --guard <= 0
            ? res(true)
            : requestAnimationFrame(check)
        requestAnimationFrame(check)
      })
  )
  await step('bolt expired')
} catch (e) {
  console.log('(could not observe expiry:', String(e).split('\n')[0], ')')
}

console.log(
  `\npoint lights ranged ${minPoint} → ${maxPoint}` +
    (minPoint === maxPoint
      ? ' (constant — nothing can recompile)'
      : ' (CHANGES — every change recompiles)')
)
console.log(`worst single step: ${worst} programs linked`)
console.log(`total: ${prev.links - before.links} links, ${prev.compiles - before.compiles} compiles`)
// Not a phone number and not a frame time — but the same script, on the same
// machine, against the same software renderer, so the ratio between two builds
// is worth reading.
console.log(`rig wall-clock for the run: ${((Date.now() - t0) / 1000).toFixed(0)}s`)
console.log(`\nHITCHING: ${prev.links - before.links === 0 ? 'no' : 'yes'}`)

await b.close()
