/** Floors must never run out, and the spell pool must widen with them. */
import { chromium } from 'playwright'
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const p = await (await b.newContext({viewport:{width:430,height:932}})).newPage()
p.on('pageerror',e=>console.log('PAGEERROR',String(e)))
await p.goto(process.argv[2]+'/?state=play&populate=Dementor',{waitUntil:'networkidle'})
await p.waitForTimeout(1200)
console.log(await p.evaluate(async () => {
  const { spellsForFloor, SPELLS } = await import('/assets/' + [...document.querySelectorAll('script')].map(s=>s.src.split('/').pop()).find(n=>n.endsWith('.js')))
  return { note: 'module import path', SPELLS: SPELLS?.length }
}).catch(e => 'module probe unavailable: ' + e.message))
// drive the real game object instead
console.log(await p.evaluate(() => {
  const g = window.__game
  const floors = []
  for (const i of [0, 4, 11, 12, 20, 40]) {
    g.waveIndex = i
    g.startWave(i)
    floors.push({ i, name: g.currentWave.name, spawn: g.spawnQueue.length, gap: +g.currentWave.gap.toFixed(2) })
  }
  const pools = {}
  for (const f of [1, 2, 4, 8, 14]) {
    g.waveIndex = f - 1
    const seen = new Set()
    for (let n = 0; n < 400; n++) { g.nextSpell(); seen.add(g.spell.word) }
    pools[f] = { distinct: seen.size, hasTier3: [...seen].some(w => w.includes(' ') || w.length > 11) }
  }
  return { floors, pools, totalSpells: g.spell ? undefined : undefined }
}))
await b.close()
