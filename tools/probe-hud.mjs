import { chromium } from 'playwright'
const url = process.argv[2]
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']})
const ctx = await b.newContext({viewport:{width:430,height:932},deviceScaleFactor:1,hasTouch:true})
const p = await ctx.newPage()
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>m.type()==='error'&&errs.push(m.text()))
await p.goto(url,{waitUntil:'networkidle'})
await p.waitForTimeout(1500)
const s = await p.evaluate(() => {
  const g = document.getElementById('spell-word')
  const inc = document.getElementById('incantation')
  const r = inc.getBoundingClientRect()
  return {
    word: g.textContent,
    lit: g.querySelectorAll('.lit').length,
    total: g.querySelectorAll('span:not(.sp)').length,
    pct: document.getElementById('match-pct').textContent,
    matchWidth: document.getElementById('match-fill').style.width,
    heard: document.getElementById('heard').textContent,
    reaction: document.getElementById('reaction').textContent,
    cardTop: Math.round(r.top), cardBottom: Math.round(r.bottom), vh: innerHeight,
    coverage: +((r.height/innerHeight)*100).toFixed(1),
  }
})
console.log(JSON.stringify(s,null,1))
if(errs.length) console.log('ERRORS', errs.slice(0,5))
await b.close()
