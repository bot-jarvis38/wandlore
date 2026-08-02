/**
 * The trigger. Everything else in the game waits on this file.
 *
 * Browser speech recognition mangles invented Latin — "Expelliarmus" comes
 * back as "a spell he armas" more often than not — so an exact string compare
 * would make the game unplayable and read as broken. Matching is fuzzy on
 * purpose: each spell carries the misreadings it actually produces, and
 * anything close enough by edit distance counts. Being generous here is the
 * difference between a voice game and a party trick.
 */

const SpeechRecognition =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition)

export const speechSupported = Boolean(SpeechRecognition)

const LANG = 'en-US'
const LOCAL_OPTIONS = { langs: [LANG], processLocally: true }

/**
 * Where the listening actually happens. Not a guess — set from what the
 * browser reports, and shown to the player, because "sometimes it's fast and
 * sometimes it isn't" is exactly what a network round-trip feels like and the
 * player deserves to be able to see which one they got.
 *
 *   'local'   — recognised on the device, no audio leaves it
 *   'network' — audio is streamed to the vendor's servers and back
 *   'unknown' — the browser doesn't say (every engine before Chrome 139)
 */
export const engine = { mode: 'unknown', detail: '' }

/**
 * Ask for on-device recognition, downloading the language pack if the browser
 * has one to offer.
 *
 * Worth the trouble because the round-trip is the whole latency problem: a
 * general dictation service hears you, ships the audio off, and answers when
 * it answers. On-device it is milliseconds and works on a bad connection.
 * Call it from a user gesture — the download wants one.
 */
export async function prepareLocalEngine(onProgress) {
  if (!SpeechRecognition || typeof SpeechRecognition.available !== 'function') {
    engine.mode = 'unknown'
    engine.detail = 'browser does not say'
    return engine.mode
  }
  try {
    let status = await SpeechRecognition.available(LOCAL_OPTIONS)
    if (status === 'downloadable' || status === 'downloading') {
      onProgress?.('downloading')
      await SpeechRecognition.install(LOCAL_OPTIONS)
      status = await SpeechRecognition.available(LOCAL_OPTIONS)
    }
    if (status === 'available') {
      engine.mode = 'local'
      engine.detail = 'on this device'
    } else {
      engine.mode = 'network'
      engine.detail = status
    }
  } catch (err) {
    engine.mode = 'unknown'
    engine.detail = String(err && err.name ? err.name : err)
  }
  return engine.mode
}

const normalise = s =>
  s
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

function editDistance(a, b) {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m || !n) return Math.max(m, n)
  let prev = new Array(n + 1)
  let curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

const similarity = (a, b) => 1 - editDistance(a, b) / Math.max(a.length, b.length)

/**
 * A rough sound key — the same idea as Soundex, tuned for the one job here.
 *
 * Edit distance grades on spelling, and the recogniser is not spelling: handed
 * an invented Latin word it returns the nearest English *sounds* it can
 * assemble. "Expelliarmus" comes back as "a spell he armas", which is four
 * characters of difference away from correct by letter and essentially
 * identical by ear. Collapsing both sides onto their consonant skeleton — the
 * part a recogniser rarely gets wrong — scores the thing the player actually
 * did, which is say the word.
 *
 * Vowels are flattened to a single placeholder rather than deleted. Which
 * vowel it was is where nearly all the mishearing happens, so that has to go —
 * but *that there was one* is real structure, and dropping it collapses every
 * word onto a short consonant stub where unrelated things start colliding.
 * Deleting them outright made "hold on a second" cast INCENDIO
 * (`tools/score-bench.mjs`); flattening them does not.
 */
export function phoneticKey(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    // digraphs first — they are single sounds and must not be split
    .replace(/ph/g, 'f')
    .replace(/(?:ch|ck|qu|q|kh)/g, 'k')
    .replace(/sh/g, 's')
    .replace(/th/g, 't')
    .replace(/gh/g, 'g')
    .replace(/wr/g, 'r')
    .replace(/x/g, 'ks')
    // consonants a recogniser swaps freely
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/w/g, 'v')
    .replace(/[jy]/g, 'i')
    // a doubled letter is one sound — before the vowels flatten, so that a
    // genuine two-vowel run survives as two slots
    .replace(/(.)\1+/g, '$1')
    .replace(/[aeiou]/g, 'a')
}

/**
 * The sound key is a lossy space, so a match in it is weaker evidence than a
 * match in the letters. Shaded down by this much before the two compete, which
 * keeps the generous ear from becoming a generous bar. Tuned on
 * `tools/score-bench.mjs`: at 0.05 the sound key alone dragged cross-spell
 * fires from 1 in 420 to 4, and at 0.08 it puts them back to 1 while keeping
 * nearly all of the gain on mis-heard speech.
 */
const PHONETIC_DISCOUNT = 0.08

const soundSimilarity = (a, b) => {
  const ka = phoneticKey(a)
  const kb = phoneticKey(b)
  if (!ka || !kb) return 0
  return Math.max(0, similarity(ka, kb) - PHONETIC_DISCOUNT)
}

/** Best of the two readings: what they spelled, and what it sounded like. */
const bothWays = (a, b) => Math.max(similarity(a, b), soundSimilarity(a, b))

/**
 * How well does anything the player just said match this spell? Slides a
 * window over the transcript so a match still lands inside "uh, stupefy!".
 */
export function scoreUtterance(transcript, spell) {
  const said = normalise(transcript)
  if (!said) return 0

  const targets = [spell.word, ...spell.spoken].map(normalise)
  const words = said.split(' ')
  // Compared with the spaces gone as well as with them in. Recognisers break
  // an invented word wherever they like — "wing gardium levi osa" is four
  // words for a target that is two — and a word-aligned window can never see
  // past that, while the flattened forms line up exactly.
  const saidFlat = said.replace(/ /g, '')
  let best = 0

  for (const target of targets) {
    const targetFlat = target.replace(/ /g, '')
    best = Math.max(best, bothWays(said, target), bothWays(saidFlat, targetFlat))

    // Windows around the target's own word count, not just at it: a spell said
    // as one word, or with a filler word swallowed into it, still lines up.
    const span = target.split(' ').length
    for (let width = Math.max(1, span - 1); width <= span + 2; width++) {
      for (let i = 0; i + width <= words.length; i++) {
        const chunk = words.slice(i, i + width).join(' ')
        best = Math.max(
          best,
          bothWays(chunk, target),
          bothWays(chunk.replace(/ /g, ''), targetFlat),
        )
      }
    }
  }
  return best
}

/** How much of the word must be in before an unfinished one can fire. */
export const PREFIX_COVER = 0.6
/** And how cleanly that much of it has to match. */
export const PREFIX_FIDELITY = 0.84

/**
 * Fire before the player has finished saying it.
 *
 * The whole-word score can only be reached once the whole word is in, and on
 * TARANTALLEGRA that is most of a second of the player still talking with a
 * boulder already in the air. But by the time two thirds of a five-syllable
 * invented word has arrived, nothing else in the game begins like that — the
 * outcome is decided and the only thing left to do is wait, which is exactly
 * what felt unfair.
 *
 * Returns how much of the word is confidently in (0 when it isn't).
 */
export function prefixMatch(transcript, spell) {
  const said = normalise(transcript).replace(/ /g, '')
  if (said.length < 5) return 0

  let best = 0
  for (const raw of [spell.word, ...spell.spoken]) {
    const target = normalise(raw).replace(/ /g, '')
    // A prefix that is already the whole word is not a prefix — that case
    // belongs to scoreUtterance, at the full bar.
    const limit = Math.min(said.length, target.length - 1)
    // The incantation may start partway in ("okay tarantalle…"), so try every
    // starting point and keep the most complete confident read.
    for (let i = 0; i + 5 <= limit; i++) {
      for (let end = limit; end > i + 4; end--) {
        const cover = (end - i) / target.length
        if (cover < PREFIX_COVER) break
        if (cover <= best) break
        if (bothWays(said.slice(i, end), target.slice(0, end - i)) >= PREFIX_FIDELITY) {
          best = cover
          break
        }
      }
    }
  }
  return best
}

/** The bar an ordinary spell has to clear. */
export const MATCH_THRESHOLD = 0.66

/**
 * Three characters of slop, or 44% of the word, whichever is kinder.
 *
 * A flat ratio is the wrong shape for short words. Recognition error is
 * roughly per-character, so the *rate* is stable across lengths but the
 * variance is not: one bad character in STUPEFY is 14% of the word, and two
 * unlucky ones drop a perfectly good attempt under a flat 0.66 while the same
 * error rate on TARANTALLEGRA sails through. Simulated at a 20% character
 * error rate, the flat bar rejected 1 in 20 correct attempts and every single
 * rejection was a short word (`tools/score-bench.mjs`). The absolute-error
 * floor is what fixes that; 21 spells with only one on screen at a time is why
 * it costs nothing.
 *
 * The rate went 36% → 44% after the player reported correct words still being
 * refused: at a 30% character error rate that is 83% → 94% of correct attempts
 * accepted, and at 40% it is 57% → 74%. What it buys the other way is small and
 * one-directional — 1 phrase in 252 of ordinary English speech now fires
 * something, and 4 pairs of spells in 420 accept each other. Both of those
 * *grant* a cast the player did not earn; neither can refuse one they did. A
 * game that occasionally gives you a free hit is not the thing that reads as
 * broken. A game that ignores you is.
 */
export function thresholdFor(spell) {
  const n = spell.word.replace(/\s/g, '').length
  const allowed = Math.max(3, n * 0.44)
  return Math.max(0.5, 1 - allowed / n)
}

export class VoiceListener {
  constructor({ onResult, onStateChange, onSpeechStart }) {
    this.onResult = onResult
    this.onStateChange = onStateChange
    /**
     * The engine knows you started making noise long before it knows what you
     * said. That instant is the only honest timestamp for "the player cast" —
     * everything after it is the recogniser thinking, and the game must not
     * charge the player for that. See the hit rollback in main.js.
     */
    this.onSpeechStart = onSpeechStart
    this.recognition = null
    this.wantsToRun = false
    this.state = 'idle'
    /** Diagnostics: how often the engine dropped us, and when it last heard anything. */
    this.restarts = 0
    this.lastHeardAt = 0
  }

  /** Ask for the mic up front, so the in-game prompt isn't a surprise. */
  async requestPermission() {
    if (!speechSupported) return 'unsupported'
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
      return 'granted'
    } catch (err) {
      return err && err.name === 'NotAllowedError' ? 'denied' : 'unavailable'
    }
  }

  start() {
    if (!speechSupported || this.recognition) return
    this.wantsToRun = true

    const rec = new SpeechRecognition()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = LANG
    rec.maxAlternatives = 4

    // Only asked for once the browser has confirmed it can do it. Asking
    // speculatively is not free — an engine that cannot honour it fails the
    // whole session rather than quietly falling back, which would leave the
    // game deaf instead of merely slow.
    if (engine.mode === 'local') {
      try {
        rec.processLocally = true
        rec.options = LOCAL_OPTIONS
      } catch {
        engine.mode = 'network'
      }
    }

    rec.onstart = () => this.setState('listening')

    rec.onspeechstart = () => this.onSpeechStart?.()

    rec.onresult = event => {
      this.lastHeardAt = performance.now()
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        // every alternative is a chance for the incantation to be in there
        for (let a = 0; a < result.length; a++) {
          this.onResult(result[a].transcript, result.isFinal)
        }
      }
    }

    rec.onerror = event => {
      // The device said it could listen locally and then couldn't. Better a
      // slow game than a deaf one: give the on-device path up for this session
      // and let onend bring us back on the network engine.
      if (engine.mode === 'local' && event.error === 'language-not-supported') {
        engine.mode = 'network'
        engine.detail = 'device backed out'
        this.onStateChange?.(this.state)
        return
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.wantsToRun = false
        this.setState('denied')
      } else if (event.error === 'no-speech' || event.error === 'aborted') {
        // normal; onend restarts us
      } else {
        this.setState('error')
      }
    }

    // Every engine ends the session on its own: Chrome after a pause, iOS
    // Safari after every single utterance regardless of `continuous`. Whatever
    // ends it, the game is deaf until it comes back — and the old 220ms delay
    // sat on top of the engine's own start-up latency, so a spell spoken right
    // after the last one was simply never heard. Restart immediately.
    rec.onend = () => {
      this.recognition = null
      if (!this.wantsToRun) {
        this.setState('idle')
        return
      }
      this.restarts++
      this.setState('restarting')
      this.start()
      // A failed synchronous restart (engine still tearing down) leaves us
      // with no recogniser at all, which is the silent-death case. Retry.
      if (!this.recognition) setTimeout(() => this.wantsToRun && this.start(), 120)
    }

    this.recognition = rec
    try {
      rec.start()
    } catch {
      this.recognition = null
    }
  }

  stop() {
    this.wantsToRun = false
    if (this.recognition) {
      try {
        this.recognition.stop()
      } catch {}
      this.recognition = null
    }
    this.setState('idle')
  }

  setState(state) {
    if (this.state === state) return
    this.state = state
    this.onStateChange?.(state)
  }
}
