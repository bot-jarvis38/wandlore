import { chromium } from 'playwright'
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const p = await (await b.newContext({viewport:{width:430,height:932}})).newPage()
p.on('pageerror',e=>console.log('PAGEERROR',String(e)))
p.on('console',m=>console.log('CONSOLE',m.type(),m.text()))
await p.goto(process.argv[2]+'/?state=play&populate=Dementor&spell=STUPEFY',{waitUntil:'networkidle'})
await p.waitForTimeout(1200)
console.log(await p.evaluate(() => {
  const g = window.__game
  const out = { state: g.state, casting: g.casting, spell: g.spell.word, hasTimer: !!g._nextSpellTimer }
  g.onHeard('stupefy', true)
  out.afterCasting = g.casting
  out.afterTimer = !!g._nextSpellTimer
  return out
}))
await p.waitForTimeout(3000)
console.log(await p.evaluate(() => ({ state: window.__game.state, casting: window.__game.casting, spell: window.__game.spell.word })))
await b.close()
