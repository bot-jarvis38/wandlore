import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5177'
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 932 } })
const logs = []
page.on('console', m => logs.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', e => logs.push(`pageerror: ${e}`))

await page.goto(`${base}/?state=play&populate=Dementor,Pixie`, { waitUntil: 'load' })
await page.waitForTimeout(4000)

const report = await page.evaluate(() => {
  const canvas = document.getElementById('scene')
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
  const vis = id => {
    const el = document.getElementById(id)
    return el ? !el.classList.contains('hidden') : 'missing'
  }
  return {
    search: location.search,
    webgl: !!gl,
    renderer: gl
      ? gl.getParameter(
          gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER
        )
      : null,
    canvasSize: [canvas.width, canvas.height],
    visible: {
      loader: vis('loader'),
      title: vis('title'),
      hud: vis('hud'),
      interlude: vis('interlude'),
      gameover: vis('gameover'),
    },
    word: document.getElementById('spell-word')?.textContent,
  }
})

console.log(JSON.stringify(report, null, 2))
console.log(logs.slice(0, 20).join('\n'))
await browser.close()
