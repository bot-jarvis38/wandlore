/**
 * Actually play the game, out loud.
 *
 * Every check before this one fed text straight into the matcher and asked
 * whether it liked it. That tests the matcher and nothing else — not the
 * microphone, not the recogniser, not the wait between finishing a word and
 * the spell going off, which is the entire thing the player complained about.
 * This drives real Chrome with a real speech engine and a synthesised voice
 * piped in as the microphone, then reports the only number that matters:
 *
 *   from the moment the word is spoken, how long until the spell fires?
 *
 * Real Chrome, not headless Chromium: the Web Speech API needs the browser's
 * own speech service, which plain Chromium builds do not carry.
 *
 *   node tools/play-aloud.mjs <url> [wav ...]
 */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const url = process.argv[2]
const wavs = process.argv.slice(3)
if (!url || !wavs.length) {
  console.error('usage: node tools/play-aloud.mjs <url> <wav> [wav ...]')
  process.exit(1)
}

for (const w of wavs) {
  if (!existsSync(w)) {
    console.error(`missing audio: ${w}`)
    process.exit(1)
  }
}

/** One spoken attempt, in a browser whose microphone is that file. */
async function speak(wav) {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      // Looped, not %noloop: once a one-shot file runs out the fake device
      // reports itself gone and the recogniser fails with audio-capture, which
      // measures Chrome's flag handling rather than the game. The clips carry
      // 2.5s of trailing silence, so looping just means the word is said again
      // every few seconds — and only the first firing is scored.
      `--use-file-for-fake-audio-capture=${wav}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    permissions: ['microphone'],
  })
  const page = await context.newPage()
  page.on('pageerror', e => console.log('  PAGEERROR', String(e)))

  await page.goto(url, { waitUntil: 'networkidle' })

  // Timeline recorded inside the page, where the events actually happen.
  await page.evaluate(() => {
    window.__trace = { events: [] }
    const stamp = (what, extra) =>
      window.__trace.events.push({ at: Math.round(performance.now()), what, ...extra })
    window.__trace.stamp = stamp

    const wait = setInterval(() => {
      const g = window.__game
      if (!g || !g.voice) return
      clearInterval(wait)
      stamp('game-ready')

      const listener = g.voice
      const origSpeechStart = g.onSpeechStart.bind(g)
      g.onSpeechStart = () => {
        stamp('mic-hears-voice')
        origSpeechStart()
      }
      const origHeard = g.onHeard.bind(g)
      g.onHeard = (transcript, isFinal) => {
        stamp(isFinal ? 'transcript-final' : 'transcript-interim', {
          text: transcript,
          spell: g.spell?.word,
        })
        origHeard(transcript, isFinal)
      }
      const origCast = g.castCurrent.bind(g)
      g.castCurrent = source => {
        const before = g.casting
        origCast(source)
        if (!before && g.casting) stamp('SPELL FIRES', { spell: g.spell?.word })
      }
      const origState = g.onVoiceState.bind(g)
      let states = 0
      g.onVoiceState = state => {
        // A thrashing engine can emit these hundreds of times a second, which
        // would bury the interesting events. Count them all, print a few.
        window.__trace.stateCount = (window.__trace.stateCount ?? 0) + 1
        if (states++ < 12) stamp('engine-' + state, { restarts: listener.restarts })
        origState(state)
      }
      listener.onEngineError = err => {
        window.__trace.errors = window.__trace.errors ?? {}
        window.__trace.errors[err] = (window.__trace.errors[err] ?? 0) + 1
      }
    }, 30)
  })

  await page.click('#start-button')
  // The word the game asks for is random; pin it so the audio matches.
  await page.waitForFunction(() => window.__game?.state === 'playing', { timeout: 20000 })
  const want = wav.split('/').pop().replace('.wav', '')
  await page.evaluate(word => {
    const g = window.__game
    const hit = g.constructor.name && window.__spells
    void hit
    const all = window.__allSpells || []
    const match = all.find(s => s.word.toLowerCase().replace(/\s/g, '') === word)
    if (match) {
      g.spell = match
      g.bestHeard = 0
      g.renderWord(0)
    }
    g.castLeft = 999
    g.castWindow = 999
    window.__trace.stamp('word-shown', { spell: g.spell?.word })
  }, want)

  await page.waitForTimeout(9000)

  const trace = await page.evaluate(() => window.__trace.events)
  const summary = await page.evaluate(() => ({
    stateChanges: window.__trace.stateCount ?? 0,
    errors: window.__trace.errors ?? {},
    restarts: window.__game?.voice?.restarts ?? 0,
  }))
  console.log('  engine churn:', JSON.stringify(summary))
  await browser.close()
  return trace
}

for (const wav of wavs) {
  const name = wav.split('/').pop()
  console.log(`\n─── ${name} ─────────────────────────────`)
  const trace = await speak(wav)
  if (!trace.length) {
    console.log('  no events — the page never got going')
    continue
  }
  const t0 = trace.find(e => e.what === 'word-shown')?.at ?? trace[0].at
  for (const e of trace) {
    const rel = ((e.at - t0) / 1000).toFixed(2).padStart(6)
    const bits = [e.text && `"${e.text}"`, e.spell && `[${e.spell}]`].filter(Boolean).join(' ')
    console.log(`  ${rel}s  ${e.what.padEnd(20)} ${bits}`)
  }
  const onset = trace.find(e => e.what === 'mic-hears-voice')
  const fired = trace.find(e => e.what === 'SPELL FIRES')
  console.log(
    onset && fired
      ? `  → ${((fired.at - onset.at) / 1000).toFixed(2)}s from starting to speak to the spell firing`
      : `  → NEVER FIRED${onset ? '' : ' (and the mic never heard a voice at all)'}`
  )
}
