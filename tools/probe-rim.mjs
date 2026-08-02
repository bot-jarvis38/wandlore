/**
 * Photographs the creatures at a sweep of rim-light settings, so the choice is
 * made by looking rather than by arguing.
 *
 * "The monsters look blurry" has two candidate causes and they need separating.
 * One is resolution — a slow frame drops the render scale and the browser
 * stretches a smaller image back over the screen. The other is this: the graze
 * of light along each creature's silhouette. It replaced a hard white outline,
 * and it was then WIDENED so that a creature standing behind another could
 * still be picked out — but a wide rim bleeds inward over the shape it is
 * supposed to describe, and past a point the eye stops reading "lit edge" and
 * starts reading "out of focus".
 *
 * `power` is the exponent on the facing term: low spreads the glow across the
 * whole creature, high pins it to the outline. This walks it and shoots each
 * setting at a fixed pixel ratio, so resolution is held constant and the only
 * thing changing between frames is the effect under test.
 *
 *   node tools/probe-rim.mjs http://localhost:5173 ./shots-rim
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5173'
const outDir = process.argv[3] ?? './shots-rim'
/**
 * `0.5 / 3.2` is what shipped and drew the complaint. The rest tighten the
 * falloff, and the last pair tightens it while turning the edge UP — the thing
 * the wide setting was actually reaching for was a creature you can find in the
 * dark, and a bright thin edge does that without washing the whole body.
 */
const SETTINGS = [
  { strength: 0.5, power: 3.2, label: 'shipped-wide' },
  { strength: 0.5, power: 5.5, label: 'tight' },
  { strength: 0.9, power: 6.0, label: 'tight-bright' },
]
mkdirSync(outDir, { recursive: true })

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const p = await (await b.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 2,
})).newPage()
p.on('pageerror', e => console.log('PAGEERROR', String(e)))

// Two of each, staggered in depth: the near one is the sharpness test, the far
// one is the legibility test the wide setting was reaching for. Both have to
// work at whatever number gets picked.
await p.goto(`${base}/?state=play&populate=Dementor,Armour,Dementor,Pixie,Armour`, {
  waitUntil: 'networkidle',
})
await p.waitForTimeout(2500)

/**
 * Resolution pinned AND the scene frozen, so the rim is the only thing that
 * differs between the captures.
 *
 * The first version of this probe left the game running between shots. Torches
 * flicker, dust drifts and the creatures walk, so every frame differed in a
 * dozen ways at once and two independent judges handed back contradictory
 * verdicts — one of them explicitly reasoning about the size of the torch
 * bloom, which was not the variable under test. An A/B with a moving scene is
 * not an A/B.
 */
await p.evaluate(() => {
  const g = window.__game
  g.tuneQuality = () => {}
  g.setPixelRatio(2)
  // Everything that moves, silenced — but the real frame loop left running, so
  // the game is still rendering itself the way it normally does. (Replacing
  // frame() outright with a bare render loop was the first attempt and it took
  // the page down with it.) Stopping the timer pins `t`, which is what the
  // torch flicker and the camera bob are both driven from.
  g.timer.update = () => {}
  g.world.update = () => {}
  g.particles.update = () => {}
  g.wand.update = () => {}
  g.tickPlay = () => {}
  g.trauma = 0
})
await p.waitForTimeout(900)

for (const { strength, power, label } of SETTINGS) {
  const applied = await p.evaluate(({ s, pw }) => {
    let n = 0
    window.__game.scene.traverse(o => {
      const rim = o.material?.userData?.rim
      if (rim) {
        rim.rimStrength.value = s
        rim.rimPower.value = pw
        n++
      }
    })
    return n
  }, { s: strength, pw: power })
  await p.waitForTimeout(500)
  const file = join(outDir, `rim-${label}.png`)
  await p.screenshot({ path: file })
  console.log(`${label.padEnd(13)} strength ${strength} power ${power}  (${applied} materials)  → ${file}`)
}

await b.close()
