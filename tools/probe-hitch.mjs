/**
 * Why does the game stutter the moment a spell leaves the wand?
 *
 * "Laggy when a spell shoots off" is a frame-time complaint, and frame time is
 * the one thing a headless software renderer cannot tell you honestly — this
 * scene runs at about three frames a second under SwiftShader, so every number
 * in milliseconds here is the test rig, not the phone. What IS exact, and is
 * identical on a phone, is *what the engine is made to do* at the moment of the
 * cast. So that is what this counts:
 *
 *   1. How many GLSL programs the browser compiles and links, per cast.
 *      three.js keys a program on, among other things, the number of lights in
 *      the scene. Add one light and every material in the scene needs a
 *      different program than the one it has; the compile is synchronous and it
 *      happens in the middle of the frame you are looking at. A bolt carries a
 *      point light, so firing changes the count — and so does the bolt expiring
 *      two seconds later, and every spawn, and every death.
 *
 *   2. The number of point lights in the scene, sampled the whole way through.
 *      This is the cause behind (1): if it never changes, nothing recompiles.
 *      It is also the per-pixel cost of every lit surface in the frame, paid on
 *      every fragment whether the light reaches it or not.
 *
 *   node tools/probe-hitch.mjs http://localhost:5173
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173'
const CASTS = 8

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const p = await (await b.newContext({ viewport: { width: 430, height: 932 } })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', String(e)))

// Counted at the WebGL boundary rather than inferred from three.js's own
// bookkeeping: `renderer.info.programs` reports what is currently held, which
// stays flat while programs are thrown away and rebuilt underneath it. The
// thing that costs a frame is the call, so count calls.
await p.addInitScript(() => {
  window.__gl = { links: 0, linkMs: 0, compiles: 0, compileMs: 0 }
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const link = proto.linkProgram
    proto.linkProgram = function (...a) {
      const t = performance.now()
      const r = link.apply(this, a)
      window.__gl.links++
      window.__gl.linkMs += performance.now() - t
      return r
    }
    const compile = proto.compileShader
    proto.compileShader = function (...a) {
      const t = performance.now()
      const r = compile.apply(this, a)
      window.__gl.compiles++
      window.__gl.compileMs += performance.now() - t
      return r
    }
  }
})

await p.goto(`${url}/?state=play&populate=Dementor,Armour,Pixie`, { waitUntil: 'networkidle' })
// Wait on a rendered frame, never on a timer — under SwiftShader a fixed pause
// is regularly shorter than a single frame of this scene.
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
await frames(12)

const sample = () =>
  p.evaluate(() => {
    const g = window.__game
    let point = 0
    let other = 0
    g.scene.traverse(o => {
      if (!o.isLight) return
      if (o.isPointLight) point++
      else other++
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

const before = await sample()
console.log(
  `steady state: ${before.point} point lights, ${before.other} other, ` +
    `${before.programs} programs held, ${before.enemies} enemies\n`
)

let prev = before
let worstNew = 0
let minPoint = before.point
let maxPoint = before.point

for (let i = 1; i <= CASTS; i++) {
  await p.evaluate(() => {
    const g = window.__game
    g.casting = false
    g.castCurrent('tap')
  })
  // One frame draws the bolt (its light joins the scene); the sample right
  // after is the compile the player feels as the stutter.
  await frames(3)
  const mid = await sample()
  minPoint = Math.min(minPoint, mid.point)
  maxPoint = Math.max(maxPoint, mid.point)

  const linked = mid.links - prev.links
  worstNew = Math.max(worstNew, linked)
  console.log(
    `cast ${String(i).padStart(2)}: ` +
      `${String(linked).padStart(3)} programs linked (${(mid.linkMs - prev.linkMs).toFixed(0)}ms), ` +
      `${mid.compiles - prev.compiles} shaders compiled, ` +
      `point lights ${prev.point} → ${mid.point}, bolts ${mid.bolts}`
  )
  prev = mid
}

// Bolts expire on their own two and a half seconds later. If the light count
// falls back when they do, that is a second recompile per cast that the player
// feels a beat AFTER the shot — worth naming separately, because it looks like
// a random stutter rather than one caused by anything.
await p.evaluate(() => {
  const g = window.__game
  return new Promise(res => {
    const check = () => (g.projectiles.live.length === 0 ? res(true) : requestAnimationFrame(check))
    requestAnimationFrame(check)
  })
})
await frames(3)
const after = await sample()
console.log(
  `\nbolts expired: ${after.links - prev.links} programs linked, ` +
    `point lights ${prev.point} → ${after.point}`
)

console.log(
  `\npoint lights ranged ${minPoint} → ${maxPoint} during the run` +
    (minPoint === maxPoint ? ' (constant)' : ' (CHANGES — every change recompiles)')
)
console.log(`worst single cast: ${worstNew} programs linked`)
console.log(
  `total across ${CASTS} casts: ${after.links - before.links} links, ` +
    `${after.compiles - before.compiles} shader compiles`
)
console.log(`\nHITCHING: ${after.links - before.links === 0 ? 'no' : 'yes'}`)

await b.close()
