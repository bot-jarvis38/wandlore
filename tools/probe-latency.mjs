/**
 * The two latency fixes, driven against a real running build:
 *  1. a half-spoken word fires the spell (no waiting for the last syllable)
 *  2. a hit taken while the player was already speaking is rolled back when
 *     the transcript finally lands — including a hit that took them to zero
 *
 * Both are timing behaviours, so arguing them from the diff proves nothing.
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

/* 1 — early fire on a partial utterance */
await fresh('TARANTALLEGRA')
console.log(
  'partial "tarantall" fires  :',
  await p.evaluate(() => {
    const g = window.__game
    g.onHeard('tarantall', false)
    return g.casting
  })
)

/* and the guard: a partial of something else must not */
await fresh('TARANTALLEGRA')
console.log(
  'partial "banana brea" fires:',
  await p.evaluate(() => {
    const g = window.__game
    g.onHeard('banana brea', false)
    return g.casting
  })
)

/* 2 — a hit during the utterance is refunded when the words arrive */
await fresh('STUPEFY')
console.log(
  'hit during speech refunded :',
  await p.evaluate(async () => {
    const g = window.__game
    g.health = 60
    g.onSpeechStart() // mic hears the player start
    g.onPlayerHit({ damage: 19 }) // the boulder lands mid-word
    const dipped = g.health
    g.onHeard('stupefy', true) // transcript finally arrives
    return { dipped, restored: g.health }
  })
)

/* the guard: a hit taken BEFORE they started speaking stays taken */
await fresh('STUPEFY')
console.log(
  'hit before speech kept     :',
  await p.evaluate(async () => {
    const g = window.__game
    g.health = 60
    g.onPlayerHit({ damage: 19 })
    await new Promise(r => setTimeout(r, 50))
    g.onSpeechStart()
    g.onHeard('stupefy', true)
    return g.health
  })
)

/* 3 — a killing blow mid-word does not end the run if the word was right */
await fresh('STUPEFY')
console.log(
  'lethal hit mid-word undone :',
  await p.evaluate(async () => {
    const g = window.__game
    g.health = 10
    g.onSpeechStart()
    g.onPlayerHit({ damage: 19 })
    const zeroed = g.health
    await new Promise(r => setTimeout(r, 200)) // engine still thinking
    g.onHeard('stupefy', true)
    await new Promise(r => setTimeout(r, 1200)) // past the grace window
    return { zeroed, health: g.health, state: g.state }
  })
)

/* the guard: a killing blow with nobody speaking still ends the run */
await fresh('STUPEFY')
console.log(
  'lethal hit in silence ends :',
  await p.evaluate(async () => {
    const g = window.__game
    g.health = 10
    g.onPlayerHit({ damage: 19 })
    await new Promise(r => setTimeout(r, 1200))
    return g.state
  })
)

await b.close()
