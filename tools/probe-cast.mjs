/** Watches one cast cycle: word lights, spell fires, HUD resets for the next. */
import { chromium } from 'playwright'
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const p = await (await b.newContext({viewport:{width:430,height:932},deviceScaleFactor:1,hasTouch:true})).newPage()
const errs=[]; p.on('pageerror',e=>errs.push(String(e)))
await p.goto(process.argv[2]+'/?state=play&populate=Dementor&spell=STUPEFY',{waitUntil:'networkidle'})
await p.waitForTimeout(1200)
const snap = () => p.evaluate(() => ({
  word: [...document.getElementById('spell-word').children].map(s=>s.className==='lit'?s.textContent:'.').join(''),
  pct: document.getElementById('match-pct').textContent,
  w: document.getElementById('match-fill').style.width,
  cls: document.getElementById('match-fill').className,
  reaction: document.getElementById('reaction').textContent,
}))
console.log('before   ', JSON.stringify(await snap()))
await p.evaluate(() => window.__game?.onHeard('stupefy', true))
await p.waitForTimeout(60)
console.log('on cast  ', JSON.stringify(await snap()))
await p.waitForTimeout(2500)
console.log('next word', JSON.stringify(await snap()))
if (errs.length) console.log('ERRORS', errs.slice(0,3))
await b.close()
