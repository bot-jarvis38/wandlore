/**
 * Photograph the ultimate, at exact moments, on demand.
 *
 * The effect lasts nine tenths of a second and the corridor is moving the whole
 * time, so "take a screenshot while it goes off" is not a repeatable
 * instruction — every capture lands somewhere different and two builds can
 * never be compared. This stops the game's own loop and drives it by hand at a
 * fixed timestep instead, so a named moment is the same moment every run and on
 * every machine.
 *
 *   node tools/shot-ultimate.mjs http://localhost:5173 [outDir]
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? 'http://localhost:5173'
const out = process.argv[3] ?? 'shots'
await mkdir(out, { recursive: true })

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const p = await (await b.newContext({ viewport: { width: 430, height: 932 } })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', String(e)))

await p.goto(
  `${url}/?state=play&populate=Dementor,Armour,Pixie,Pixie,Dementor,Armour`,
  { waitUntil: 'domcontentloaded' }
)
await p.waitForFunction(() => !!window.__game)

// Take the loop off the game. The scheduled callback calls this.frame(), so
// replacing it lets the chain run out rather than dying mid-frame; everything
// after this renders exactly when asked and not otherwise.
await p.evaluate(async () => {
  const g = window.__game
  g.frame = () => {}
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
})

const draw = () =>
  p.evaluate(() => {
    const g = window.__game
    g.wand.update(0.016, 1.2, 0.5)
    g.composer.render()
  })

/** Advance the fight by `seconds`, at the timestep the game really uses. */
const advance = seconds =>
  p.evaluate(s => {
    const g = window.__game
    const DT = 1 / 60
    for (let i = 0; i < Math.round(s / DT); i++) {
      g._t = (g._t ?? 0) + DT
      g.world.update(g._t)
      g.particles.update(DT)
      g.tickPlay(DT, g._t)
    }
  }, seconds)

const shot = async name => {
  await draw()
  await p.screenshot({ path: `${out}/${name}.png` })
  console.log(`${out}/${name}.png`)
}

const setCharge = (charge, armed) =>
  p.evaluate(
    ({ charge, armed }) => {
      const g = window.__game
      g.ultCharge = charge
      g.ultArmed = armed
      g.updateUlt()
    },
    { charge, armed }
  )

await advance(1.2)

/* ── the meter, in each of its three states ───────────────────────── */
await setCharge(0.5, false)
await shot('ult-1-charging')
await setCharge(1, false)
await shot('ult-2-ready')
await setCharge(1, true)
await shot('ult-3-armed')

/* ── and the release, moment by moment ────────────────────────────── */
await p.evaluate(() => {
  const g = window.__game
  g.casting = false
  g.castCurrent('tap')
})
await shot('ult-4-released')

for (const [name, seconds] of [
  ['ult-5-near', 0.12],
  ['ult-6-mid', 0.22],
  ['ult-7-far', 0.28],
  ['ult-8-after', 0.45],
]) {
  await advance(seconds)
  await shot(name)
}

console.log(
  await p.evaluate(() => {
    const g = window.__game
    return {
      creaturesLeft: g.enemies.filter(e => e.alive).length,
      score: g.score,
      charge: g.ultCharge,
      armed: g.ultArmed,
    }
  })
)
await b.close()
