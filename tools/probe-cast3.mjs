import { chromium } from 'playwright'
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const p = await (await b.newContext({viewport:{width:430,height:932}})).newPage()
p.on('pageerror',e=>console.log('PAGEERROR',String(e)))
await p.goto(process.argv[2]+'/?state=play&populate=Dementor&spell=STUPEFY',{waitUntil:'networkidle'})
await p.waitForTimeout(1200)
console.log(await p.evaluate(() => {
  const g = window.__game
  try { g.nextSpell(); return { ok: true, spell: g.spell.word, floor: g.waveIndex } }
  catch (e) { return { ok: false, err: String(e && e.stack || e) } }
}))
await b.close()
