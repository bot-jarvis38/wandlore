/**
 * How long does a run actually last, and how many spells do you get to cast?
 *
 * The complaint: "the game is a little short, ends too quick, users not able to
 * cast that many spells before dying." That is a claim about pacing, and pacing
 * is the one thing you cannot read off the source — the floor table says how
 * many creatures walk in, not how many you kill before one reaches you.
 *
 * So this plays the game. Not by rendering it: the fight is driven directly at
 * a fixed timestep with the render loop stopped, because under a software
 * renderer the scene draws at about three frames a second and a run would take
 * an hour of wall-clock to simulate. The logic is the real logic — the real
 * floor table, the real creatures, the real projectiles, the real hit tests.
 *
 * The player it simulates:
 *   • casts every CAST_PERIOD seconds, which is how long it takes a human to
 *     read an incantation, say it, and have the recogniser come back;
 *   • aims at whatever is nearest, with a few degrees of error, because a
 *     player who cannot miss is not a player;
 *   • arms the ultimate the moment it is available, which is the generous
 *     reading — it puts an upper bound on how many you get per floor.
 *
 * What it reports is the thing being tuned: floors cleared, spells cast,
 * seconds survived, and ultimates earned per floor.
 *
 *   node tools/probe-pacing.mjs http://localhost:5173 [castPeriod] [runs]
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173'
const CAST_PERIOD = Number(process.argv[3] ?? 3.0)
const RUNS = Number(process.argv[4] ?? 8)

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const p = await (await b.newContext({ viewport: { width: 430, height: 932 } })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', String(e)))

await p.goto(`${url}/?state=play`, { waitUntil: 'domcontentloaded' })
await p.waitForFunction(() => !!window.__game)

const runs = await p.evaluate(
  async ({ CAST_PERIOD, RUNS }) => {
    const g = window.__game
    // Stop the render loop. The scheduled callback calls this.frame(), so
    // replacing it lets the chain run out on its own rather than being killed
    // mid-frame — the page stays alive, it just stops drawing.
    g.frame = () => {}
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

    const DT = 1 / 60
    const MAX_SECONDS = 900

    const one = () => {
      g.resetRun()
      g.startWave(0)
      g.show('playing')

      const floors = []
      let t = 0
      let castAt = 0.8
      let casts = 0
      let ultimates = 0
      let floorCasts = 0
      let floorUltimates = 0

      const realAdvance = g.advanceWave.bind(g)
      g.advanceWave = () => {
        realAdvance() // the real one, so anything it does to health counts
        floors.push({
          floor: floors.length + 1,
          casts: floorCasts,
          ultimates: floorUltimates,
          seconds: Math.round(t),
          healthAfter: Math.round(g.health),
        })
        floorCasts = 0
        floorUltimates = 0
        g.startWave(g.waveIndex)
        g.show('playing')
      }

      while (g.state === 'playing' && t < MAX_SECONDS) {
        t += DT
        g.tickPlay(DT, t)

        if (t >= castAt && g.state === 'playing') {
          castAt = t + CAST_PERIOD

          // Aim at whatever is nearest — creatures come from -z toward the
          // camera, so nearest is the largest z — with a few degrees of error.
          const live = g.enemies.filter(e => e.alive)
          if (live.length) {
            const target = live.reduce((a, e) =>
              e.group.position.z > a.group.position.z ? e : a
            )
            const at = target.hitPoint()
            const c = g.camera.position
            const dx = at.x - c.x
            const dy = at.y - c.y
            const dz = at.z - c.z
            const len = Math.hypot(dx, dy, dz)
            g.camera.rotation.y = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * 0.09
            g.camera.rotation.x = Math.asin(dy / len) + (Math.random() - 0.5) * 0.05
            g.camera.updateMatrixWorld(true)
          }

          // Arm the moment it is offered — the upper bound on ultimates.
          if (g.ultReady && !g.ultArmed) g.armUltimate?.()
          const wasArmed = !!g.ultArmed

          g.casting = false
          g.castCurrent('tap')
          if (g.casting) {
            casts++
            floorCasts++
            if (wasArmed) {
              ultimates++
              floorUltimates++
            }
            // The real game draws the next word on a 260ms timer, and a timer
            // cannot fire inside a synchronous loop.
            clearTimeout(g._nextSpellTimer)
            g.nextSpell()
          }
        }
      }

      g.advanceWave = realAdvance
      return {
        floorsCleared: floors.length,
        casts,
        ultimates,
        seconds: Math.round(t),
        died: g.state === 'gameover',
        floors,
      }
    }

    return Array.from({ length: RUNS }, one)
  },
  { CAST_PERIOD, RUNS }
)

const mean = xs => xs.reduce((a, x) => a + x, 0) / xs.length
const med = xs => [...xs].sort((a, c) => a - c)[Math.floor(xs.length / 2)]

console.log(`\n${RUNS} runs, a cast every ${CAST_PERIOD}s\n`)
console.log('  run   floors   casts   ultimates   seconds')
runs.forEach((r, i) =>
  console.log(
    `  ${String(i + 1).padStart(3)}   ${String(r.floorsCleared).padStart(6)}   ` +
      `${String(r.casts).padStart(5)}   ${String(r.ultimates).padStart(9)}   ` +
      `${String(r.seconds).padStart(7)}${r.died ? '' : '  (survived the cap)'}`
  )
)

console.log(
  `\nmedian: ${med(runs.map(r => r.floorsCleared))} floors, ` +
    `${med(runs.map(r => r.casts))} casts, ` +
    `${med(runs.map(r => r.ultimates))} ultimates, ` +
    `${med(runs.map(r => r.seconds))}s`
)
console.log(
  `mean:   ${mean(runs.map(r => r.floorsCleared)).toFixed(1)} floors, ` +
    `${mean(runs.map(r => r.casts)).toFixed(1)} casts, ` +
    `${mean(runs.map(r => r.ultimates)).toFixed(1)} ultimates, ` +
    `${mean(runs.map(r => r.seconds)).toFixed(0)}s`
)

// Per-floor is what the ultimate is tuned against: the ask is one or two per
// round, and a rate that averages right can still be zero on the floor you
// actually reach.
const byFloor = new Map()
for (const r of runs) {
  for (const f of r.floors) {
    if (!byFloor.has(f.floor)) byFloor.set(f.floor, [])
    byFloor.get(f.floor).push(f)
  }
}
console.log('\n  floor   runs reaching it   casts   ultimates   health after')
for (const [floor, fs] of [...byFloor].sort((a, c) => a[0] - c[0])) {
  console.log(
    `  ${String(floor).padStart(5)}   ${String(fs.length).padStart(15)}   ` +
      `${mean(fs.map(f => f.casts)).toFixed(1).padStart(5)}   ` +
      `${mean(fs.map(f => f.ultimates)).toFixed(2).padStart(9)}   ` +
      `${mean(fs.map(f => f.healthAfter)).toFixed(0).padStart(12)}`
  )
}

const ults = runs.flatMap(r => r.floors.map(f => f.ultimates))
if (ults.length) {
  const inBand = ults.filter(u => u >= 1 && u <= 2).length
  console.log(
    `\nfloors giving 1–2 ultimates: ${inBand}/${ults.length} ` +
      `(${Math.round((inBand / ults.length) * 100)}%)`
  )
}
await b.close()
