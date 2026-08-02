/**
 * Does the game give back what it takes?
 *
 * "It gets laggier the longer you play" is a symptom with a dozen possible
 * causes, and the only way to tell a leak from a slow device is to count. This
 * drives the real game — real spawns, real bolts, real kills — and reads the
 * renderer's own ledger of what it is holding: geometries and textures live on
 * the GPU, programs are compiled shaders, and every one of them is a thing the
 * game asked for that nothing ever gave back.
 *
 * The numbers that matter are the DELTAS between rounds. A game that cleans up
 * after itself finishes each round holding what it held at the start, whatever
 * that number is. One that climbs by a fixed amount per round is leaking that
 * amount per enemy, and the run length before it matters is arithmetic.
 *
 *   node tools/probe-leak.mjs http://localhost:5173
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173'
const ROUNDS = 8
const ENEMIES_PER_ROUND = 12
const BOLTS_PER_ROUND = 12

const b = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--js-flags=--expose-gc',
  ],
})
const p = await (await b.newContext({ viewport: { width: 430, height: 932 } })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', String(e)))
await p.goto(`${url}/?state=play`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)

/** Everything the renderer admits to holding, plus the browser's own heap. */
const sample = () =>
  p.evaluate(() => {
    const g = window.__game
    const info = g.renderer.info
    return {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs.length,
      enemies: g.enemies.length,
      bolts: g.projectiles.live.length,
      children: g.scene.children.length,
      // What the scene is actually holding, so a climbing child count names
      // the culprit instead of starting another round of guessing.
      breakdown: g.scene.children.reduce((acc, c) => {
        const key = c.type + (c.children.length ? `[${c.children.length}]` : '')
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {}),
      enemyState: g.enemies.map(e => (e.alive ? 'alive' : 'dead')).join(',') || 'none',
      gameState: g.state,
      pooled: g.projectiles.pool.length,
      pixelRatio: g.pixelRatio,
      heapMB: +((performance.memory?.usedJSHeapSize ?? 0) / 1048576).toFixed(1),
    }
  })

/**
 * One round of ordinary play, compressed. Spawns a mixed line-up, fires a bolt
 * per enemy, then kills everything the way the game kills it — `alive = false`,
 * which is what tickPlay watches for — and lets the loop actually run so the
 * removal path executes rather than being simulated.
 */
async function round(n, e) {
  await p.evaluate(
    ({ n, e }) => {
      const g = window.__game
      const kinds = ['Dementor', 'Armour', 'Pixie']
      for (let i = 0; i < e; i++) g.spawnOne(kinds[i % 3], -8 - (i % 5) * 2)
      for (let i = 0; i < n; i++) {
        g.casting = false
        g.castCurrent('tap')
      }
      g.spawnQueue = []
    },
    { n, e }
  )
  await p.waitForTimeout(400)
  await p.evaluate(() => {
    const g = window.__game
    for (const en of g.enemies) en.alive = false
    g.projectiles.clear()
    g.spawnQueue = []
    // Topped up and forced back into play, because a creature that walks into
    // the player ends the run — and once the run is over nothing is spawned,
    // nothing is disposed and the probe measures a still frame instead of a
    // game. The counters must be read while the loop is actually running.
    g.health = 100
    g.state = 'playing'
  })
  // Waited on the condition, not on the clock. Headless Chromium under
  // SwiftShader renders this scene at about three frames a second, so a fixed
  // 400ms pause is frequently *shorter than one frame* — the first version of
  // this probe read the counters before the game had had a chance to run its
  // cleanup even once, and reported a leak that had already been fixed.
  await p.waitForFunction(() => window.__game.enemies.length === 0, null, { timeout: 20000 })
}

// A warm-up round first: the first enemy of each kind legitimately creates
// things that did not exist before, and counting that as a leak would be wrong.
await round(BOLTS_PER_ROUND, ENEMIES_PER_ROUND)
await p.evaluate(() => window.gc?.())
await p.waitForTimeout(300)

const base = await sample()
console.log('after warm-up:', JSON.stringify(base))
console.log('\nround   geo    tex   prog   scene   heapMB   px')

let prev = base
const deltas = []
for (let r = 1; r <= ROUNDS; r++) {
  await round(BOLTS_PER_ROUND, ENEMIES_PER_ROUND)
  const s = await sample()
  deltas.push({
    geo: s.geometries - prev.geometries,
    tex: s.textures - prev.textures,
    prog: s.programs - prev.programs,
  })
  console.log(
    `${String(r).padStart(5)} ${String(s.geometries).padStart(5)} ${String(s.textures).padStart(6)} ` +
      `${String(s.programs).padStart(6)} ${String(s.children).padStart(7)} ` +
      `${String(s.heapMB).padStart(8)} ${String(s.pixelRatio).padStart(4)}`
  )
  prev = s
}

const last = await sample()
const per = k => ((last[k] - base[k]) / (ROUNDS * ENEMIES_PER_ROUND)).toFixed(2)

console.log('\n── verdict ──')
console.log(`geometries held  : ${base.geometries} → ${last.geometries}  (${per('geometries')} per enemy)`)
console.log(`textures held    : ${base.textures} → ${last.textures}  (${per('textures')} per enemy)`)
console.log(`shader programs  : ${base.programs} → ${last.programs}`)
console.log(`scene children   : ${base.children} → ${last.children}`)
console.log(`js heap          : ${base.heapMB}MB → ${last.heapMB}MB`)
console.log(`pooled bolts     : ${last.pooled}`)
console.log(`scene holds      : ${JSON.stringify(last.breakdown)}`)
console.log(`game state       : ${last.gameState}, enemies ${last.enemyState}`)
console.log(
  `\nLEAKING: ${last.geometries > base.geometries || last.textures > base.textures ? 'YES' : 'no'}`
)

await b.close()
