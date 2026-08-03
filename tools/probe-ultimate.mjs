/**
 * The ultimate's contract, driven through the real HUD.
 *
 * The rate at which the meter fills is TC-9's business; this is the behaviour
 * underneath it, which a pacing number would happily report as fine while the
 * button did nothing. Every step here goes through the same surface a player
 * touches — a real DOM click on the strip, the real cast path — because the
 * bug this is written against is the one where the state is perfect and the
 * control is not wired to it.
 *
 *   node tools/probe-ultimate.mjs http://localhost:5173
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173'

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const p = await (await b.newContext({ viewport: { width: 430, height: 932 } })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', String(e)))

await p.goto(`${url}/?state=play&populate=Pixie,Pixie,Dementor,Armour`, {
  waitUntil: 'domcontentloaded',
})
await p.waitForFunction(() => !!window.__game)

const results = []
const check = (name, pass, detail) => {
  results.push({ pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} ${detail}`)
}

const state = () =>
  p.evaluate(() => {
    const g = window.__game
    return {
      charge: Math.round(g.ultCharge * 100) / 100,
      armed: g.ultArmed,
      ready: g.ultReady,
      disabled: document.getElementById('ult').disabled,
      label: document.getElementById('ult-label').textContent,
      classes: document.getElementById('ult').className,
      waveLive: g.shockwave.busy,
      alive: g.enemies.filter(e => e.alive).length,
      hp: g.enemies.filter(e => e.alive).map(e => Math.round(e.hp)),
    }
  })

const cast = () =>
  p.evaluate(() => {
    const g = window.__game
    g.casting = false
    g.castCurrent('tap')
    clearTimeout(g._nextSpellTimer)
    g.nextSpell()
  })

/* ── 1. it starts empty and fills one cast at a time ─────────────────── */
let s = await state()
check('starts empty and dead', s.charge === 0 && s.disabled, `charge=${s.charge} disabled=${s.disabled}`)

const steps = []
for (let i = 0; i < 6; i++) {
  await cast()
  steps.push((await state()).charge)
}
check('six casts fill it exactly', steps[5] === 1, steps.join(' → '))
check(
  'and it stops at full',
  (await (async () => {
    await cast()
    return (await state()).charge
  })()) === 1,
  'a seventh cast does not overflow'
)

s = await state()
check('full offers itself', s.ready && !s.disabled && /READY/.test(s.label), `“${s.label}”`)
check('…but is not armed yet', !s.armed && !/ARMED/.test(s.label), `armed=${s.armed}`)

/* ── 2. a real tap on the strip arms it, and only arms it ────────────── */
await p.click('#ult')
s = await state()
check('a tap arms it', s.armed && /ARMED/.test(s.label), `“${s.label}”`)
// Deliberately NOT "the creature count is unchanged": the fight is still
// running, bolts from the six charging casts are still landing, and a check
// against a moving scene fails for reasons that have nothing to do with the
// button. What arming must not do is start the wave or spend the charge.
check('arming fires nothing', !s.waveLive && s.charge === 1, `wave=${s.waveLive} charge=${s.charge}`)
check(
  'and it can be thought better of',
  await p.click('#ult').then(async () => !(await state()).armed),
  'tapping again disarms'
)
await p.click('#ult')

/* ── 3. the next successful cast spends it ───────────────────────────── */
// Tally the sweep at the source. Reading survivors' health afterwards cannot
// tell a single hit from ten — the first version of this check asserted every
// survivor had hp > 0 and passed on an EMPTY array, which is to say it passed
// hardest in the exact case it was written to catch.
await p.evaluate(() => {
  const g = window.__game
  window.__swept = []
  const real = g.onSweepHit.bind(g)
  g.onSweepHit = (enemy, at) => {
    window.__swept.push(enemy.id)
    return real(enemy, at)
  }
})
// A fixed line-up, placed just before the shot. The creatures that walked in
// during the six charging casts are dead or nearly so by now, and a sweep test
// against whatever happens to be left measures the previous six casts rather
// than this one. Three inside the wave's 27m reach, one deliberately beyond it.
const lineUp = await p.evaluate(() => {
  const g = window.__game
  g.enemies.forEach(e => {
    e.alive = false
    e.dispose()
  })
  g.enemies.length = 0
  g.projectiles.clear()
  g.spawnQueue = []
  g.spawnOne('Pixie', -8)
  g.spawnOne('Dementor', -15)
  g.spawnOne('Armour', -22)
  g.spawnOne('Dementor', -46) // beyond reach: must survive untouched
  return g.enemies.map(e => ({ id: e.id, z: Math.round(e.group.position.z), hp: e.hp }))
})
const inReach = lineUp.filter(e => e.z > -27).length
const armedHp = lineUp.map(e => e.hp)

await p.evaluate(() => {
  const g = window.__game
  // Point the wand at the ceiling first. An ultimate fires an amplified bolt
  // AS WELL as the wave, and a bolt that kills the front creature on the way
  // makes it impossible to say what the wave itself did. Set and cast in one
  // synchronous block so the render loop cannot put the camera back first.
  g.look.pitch = g.look.targetPitch = 0.32
  g.camera.rotation.x = 0.32
  g.camera.updateMatrixWorld(true)
  g.casting = false
  g.castCurrent('tap')
  clearTimeout(g._nextSpellTimer)
  g.nextSpell()
})
s = await state()
check('the cast spends the charge', s.charge === 0 && !s.armed, `charge=${s.charge} armed=${s.armed}`)
check('the wave is live', s.waveLive, `busy=${s.waveLive}`)

/* ── 4. and it sweeps the corridor, once per creature ────────────────── */
await p.evaluate(
  () =>
    new Promise(res => {
      let guard = 900
      const check = () =>
        !window.__game.shockwave.busy || --guard <= 0 ? res(true) : requestAnimationFrame(check)
      requestAnimationFrame(check)
    })
)
const after = await state()
const swept = await p.evaluate(() => window.__swept)
check(
  'everything in reach was swept',
  swept.length >= inReach && inReach === 3,
  `${swept.length} swept, ${inReach} were in reach; hp ${armedHp.join(',')} → ` +
    `${after.hp.join(',') || '—'}`
)
check(
  'each one hit once, not once per frame',
  new Set(swept).size === swept.length,
  `ids ${swept.join(',')} — ${swept.length} hits across ${new Set(swept).size} creatures`
)
const far = lineUp[3]
const farHp = await p.evaluate(id => window.__game.enemies.find(e => e.id === id)?.hp ?? null, far.id)
check(
  'the far one is out of reach',
  !swept.includes(far.id) && farHp === far.hp,
  `the Dementor at ${far.z}m is untouched on ${farHp}/${far.hp} hp`
)
check(
  'a heavy survives the wave alone',
  // The design claim, checked rather than asserted in a comment: 70 kills a
  // Pixie and a Dementor outright and leaves an Armour one ordinary spell from
  // dead. The bolt was aimed at the ceiling above, so this is the wave's doing.
  after.hp.includes(96 - 70),
  `an Armour swept for 70 of 96 is on ${after.hp.join(', ')}`
)

/* ── 5. an ordinary cast is still an ordinary cast ───────────────────── */
await cast()
s = await state()
check('an unarmed cast makes no wave', !s.waveLive, `charge back to ${s.charge}, wave=${s.waveLive}`)

const failed = results.filter(r => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} passed`)
console.log(`ULTIMATE: ${failed ? 'BROKEN' : 'wired'}`)
await b.close()
process.exit(failed ? 1 : 0)
