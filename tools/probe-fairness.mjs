/**
 * Two behaviours the player felt as "the engine is evaluating wrong":
 *  1. the word must NOT change when the cast window closes
 *  2. a near-miss must show what was heard and how close it was
 */
import { chromium } from 'playwright'
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const p = await (await b.newContext({viewport:{width:430,height:932}})).newPage()
p.on('pageerror',e=>console.log('PAGEERROR',String(e)))
await p.goto(process.argv[2]+'/?state=play&populate=Dementor&spell=TARANTALLEGRA',{waitUntil:'networkidle'})
await p.waitForTimeout(1200)

console.log('word before timeout :', await p.evaluate(() => window.__game.spell.word))
await p.evaluate(() => { window.__game.castLeft = 0.01 })
await p.waitForTimeout(2500)
console.log('word after timeout  :', await p.evaluate(() => window.__game.spell.word),
            '| meter refilled:', await p.evaluate(() => window.__game.castLeft > 1))

console.log(await p.evaluate(() => {
  const g = window.__game
  g.onHeard('tarantula allegra', true)
  return { nearMiss: document.getElementById('heard').textContent,
           cls: document.getElementById('heard').className,
           fired: g.casting }
}))
console.log(await p.evaluate(() => {
  const g = window.__game
  g.casting = false; g.bestHeard = 0
  g.onHeard('banana bread', true)
  return { junk: document.getElementById('heard').textContent, fired: g.casting }
}))
await b.close()
