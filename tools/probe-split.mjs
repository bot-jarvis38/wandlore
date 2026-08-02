/**
 * The reported symptom, reproduced as a test:
 *
 *   "when you speak a word, the detection detects some of it then pauses for a
 *    second or two, and then automatically resumes and finishes the detection"
 *
 * That is the recogniser ending its session mid-word. Neither half is the
 * spell, so a perfectly spoken incantation scores nothing twice. This drives
 * the halves in exactly as the engine delivers them — separate utterances, a
 * real gap between — and checks the spell fires anyway.
 *
 * Guarded on the other side too: two genuinely separate attempts, far enough
 * apart, must NOT be welded into one.
 */
import { chromium } from 'playwright'

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const p = await (await b.newContext({ viewport: { width: 430, height: 932 } })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', String(e)))

const url = process.argv[2]
const fresh = async spell => {
  await p.goto(`${url}/?state=play&populate=Dementor&spell=${encodeURIComponent(spell)}`, {
    waitUntil: 'networkidle',
  })
  await p.waitForTimeout(1200)
}

/*
 * The whole complaint, in one check. Split at a seam where NEITHER half clears
 * the bar on its own — "taranta" scores 0.54 and "llegra" 0.38 against a bar of
 * 0.56 — so the only way this fires is if the two are put back together.
 */
await fresh('TARANTALLEGRA')
console.log(
  'split word fires (want true)     :',
  await p.evaluate(async () => {
    const g = window.__game
    g.onHeard('taranta', true) // session one ends mid-word
    const halfway = g.casting
    await new Promise(r => setTimeout(r, 900)) // engine restarting, game deaf
    g.onHeard('llegra', true) // session two brings the rest
    return { eitherHalfAlone: halfway, together: g.casting }
  })
)

/* a fragment arriving as an interim result must glue on too, not just finals */
await fresh('TARANTALLEGRA')
console.log(
  'interim tail glues on (true)     :',
  await p.evaluate(async () => {
    const g = window.__game
    g.onHeard('taranta', true)
    await new Promise(r => setTimeout(r, 600))
    g.onHeard('llegra', false)
    return g.casting
  })
)

/* the guard: fragments that are too old must not be welded together */
await fresh('TARANTALLEGRA')
console.log(
  'stale halves fire (want false)   :',
  await p.evaluate(async () => {
    const g = window.__game
    g.onHeard('taranta', true)
    await new Promise(r => setTimeout(r, 3000)) // longer than the stitch window
    g.onHeard('llegra', true)
    return g.casting
  })
)

/* the guard: two unrelated things said in quick succession must not add up */
await fresh('EXPELLIARMUS')
console.log(
  'junk accumulates (want false)   :',
  await p.evaluate(async () => {
    const g = window.__game
    for (const junk of ['what', 'hold on', 'is this thing on', 'come on then']) {
      g.onHeard(junk, true)
      await new Promise(r => setTimeout(r, 120))
    }
    return g.casting
  })
)

/* and the buffer must not survive a cast — the next word starts clean */
await fresh('STUPEFY')
console.log(
  'after a cast (fired, leftover 0):',
  await p.evaluate(async () => {
    const g = window.__game
    g.onHeard('stupefy', true)
    const fired = g.casting
    return { fired, leftover: (g.heardParts ?? []).length }
  })
)

await b.close()
