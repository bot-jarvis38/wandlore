/**
 * Dragging the corridor around must never raise the browser's own furniture.
 *
 * The complaint: "when you drag around in phone browser, sometimes it triggers
 * the long press menu popup." Two different mechanisms produce that, and a fix
 * for one is not a fix for the other, so both are checked here against a real
 * touch device profile rather than a mouse:
 *
 *   1. The selection callout — iOS raises a magnifier and a COPY / LOOK UP
 *      bubble on a press-and-hold. That is CSS: `user-select` and
 *      `-webkit-touch-callout`. A drag that pauses is a press-and-hold.
 *   2. The context menu — Android fires a `contextmenu` event, which no CSS
 *      property can prevent. That is script.
 *
 * And `touch-action`, which is the one that was actually missing: it is NOT an
 * inherited property, so declaring it on <body> did nothing for the canvas the
 * game is dragged on.
 *
 *   node tools/probe-touch.mjs http://localhost:5173
 */
import { chromium, devices } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173'

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const p = await (await b.newContext({ ...devices['iPhone 14 Pro'], isMobile: true, hasTouch: true })).newPage()
p.on('pageerror', e => console.log('PAGEERROR', String(e)))
// TC-5 lives here too: a gesture fix that quietly throws on every touch would
// still pass every assertion below. Software-renderer chatter is not ours.
const noise = []
p.on('console', m => {
  if (m.type() !== 'error' && m.type() !== 'warning') return
  if (/SwiftShader|GroupMarkerNotSet|Automatic fallback to software|GL Driver Message/i.test(m.text())) return
  noise.push(`${m.type()}: ${m.text()}`)
})

await p.goto(`${url}/?state=play&populate=Dementor,Pixie`, { waitUntil: 'domcontentloaded' })
await p.waitForFunction(() => !!window.__game)

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${detail}`)
}

/* ── 1. the CSS half, read off the elements a thumb actually lands on ── */
const styles = await p.evaluate(() =>
  ['scene', 'hud', 'app'].map(id => {
    const el = document.getElementById(id)
    const s = getComputedStyle(el)
    return {
      id,
      touchAction: s.touchAction,
      userSelect: s.userSelect || s.webkitUserSelect,
      callout: s.webkitTouchCallout ?? 'unsupported',
    }
  })
)
for (const s of styles) {
  check(
    `#${s.id} gesture properties`,
    s.touchAction === 'none' && s.userSelect === 'none',
    `touch-action:${s.touchAction} user-select:${s.userSelect} callout:${s.callout}`
  )
}

/* ── 2. the script half ───────────────────────────────────────────────── */
// Chrome does not implement `-webkit-touch-callout`, so it never appears in
// computed style above — and iOS, the only browser that raises the callout, is
// the one browser that does. Checked in the shipped stylesheet instead, which
// is the honest version of the claim: the rule is on the page, and only a real
// iPhone can prove it lands.
const calloutShipped = await p.evaluate(async () => {
  const hrefs = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href)
  const inline = [...document.querySelectorAll('style')].map(s => s.textContent)
  const fetched = await Promise.all(hrefs.map(h => fetch(h).then(r => r.text())))
  return [...inline, ...fetched].join('\n').replace(/\s/g, '').includes('-webkit-touch-callout:none')
})
check('callout rule is in the CSS', calloutShipped, `shipped=${calloutShipped}`)

const menu = await p.evaluate(() => {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  document.getElementById('scene').dispatchEvent(ev)
  return ev.defaultPrevented
})
check('contextmenu is prevented', menu, `defaultPrevented=${menu}`)

const menuOnHud = await p.evaluate(() => {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  document.getElementById('spell-word').dispatchEvent(ev)
  return ev.defaultPrevented
})
check('…over the HUD too', menuOnHud, `defaultPrevented=${menuOnHud}`)

/* ── 3. the actual gesture: a slow drag with a pause in the middle ───── */
// The reported trigger, reproduced — a finger down, a hold, then movement.
// A real long press cannot be synthesised through CDP in a way that makes the
// browser raise its own menu, so what this proves is the two things under our
// control: the drag turns the camera, and it leaves no selection behind.
const yawBefore = await p.evaluate(() => window.__game.look.targetYaw)
await p.touchscreen.tap(215, 500)
await p.evaluate(() => {
  const el = document.getElementById('scene')
  const touch = (type, x, y) =>
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        isPrimary: true,
      })
    )
  touch('pointerdown', 215, 500)
  for (let i = 1; i <= 12; i++) touch('pointermove', 215 - i * 9, 500 + i * 2)
  touch('pointerup', 107, 524)
})
const yawAfter = await p.evaluate(() => window.__game.look.targetYaw)
check(
  'drag turns the camera',
  Math.abs(yawAfter - yawBefore) > 0.1,
  `yaw ${yawBefore.toFixed(3)} → ${yawAfter.toFixed(3)}`
)

const selected = await p.evaluate(() => {
  // What the callout hangs off. If a drag over the HUD can select the
  // incantation, iOS has something to offer a menu about.
  const word = document.getElementById('spell-word')
  const range = document.createRange()
  range.selectNodeContents(word)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  return sel.toString()
})
check(
  'HUD text cannot be selected',
  selected === '',
  selected === '' ? 'nothing selectable' : `selected “${selected}”`
)

check('console stays clean', noise.length === 0, noise.length ? noise.join(' | ') : 'no errors or warnings')

const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
console.log(`LONG-PRESS SURFACE: ${failed.length ? 'EXPOSED' : 'clean'}`)
await b.close()
process.exit(failed.length ? 1 : 0)
