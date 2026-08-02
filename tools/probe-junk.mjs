import { chromium } from 'playwright'
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const p = await (await b.newContext({viewport:{width:430,height:932}})).newPage()
p.on('pageerror',e=>console.log('PAGEERROR',String(e)))
await p.goto(process.argv[2]+'/?state=play&populate=Dementor&spell=TARANTALLEGRA',{waitUntil:'networkidle'})
await p.waitForTimeout(1200)
for (const said of ['banana bread', 'tarant allegra', 'terrible algebra']) {
  await p.evaluate(s => { const g = window.__game; g.casting = false; g.bestHeard = 0; g.lastCastAt = -1e9; g.onHeard(s, true) }, said)
  console.log(said.padEnd(18), await p.evaluate(() => ({
    heard: document.getElementById('heard').textContent,
    pct: document.getElementById('match-pct').textContent,
    fired: window.__game.casting,
  })))
  await p.waitForTimeout(50)
}
await b.close()
