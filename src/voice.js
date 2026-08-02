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
    best = Math.max(best, similarity(said, target), similarity(saidFlat, targetFlat))

    // Windows around the target's own word count, not just at it: a spell said
    // as one word, or with a filler word swallowed into it, still lines up.
    const span = target.split(' ').length
    for (let width = Math.max(1, span - 1); width <= span + 2; width++) {
      for (let i = 0; i + width <= words.length; i++) {
        const chunk = words.slice(i, i + width).join(' ')
        best = Math.max(
          best,
          similarity(chunk, target),
          similarity(chunk.replace(/ /g, ''), targetFlat),
        )
      }
    }
  }
  return best
}

/** The bar an ordinary spell has to clear. */
export const MATCH_THRESHOLD = 0.66

/**
 * Three characters of slop, or 36% of the word, whichever is kinder.
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
 */
export function thresholdFor(spell) {
  const n = spell.word.replace(/\s/g, '').length
  const allowed = Math.max(3, n * 0.36)
  return Math.max(0.5, 1 - allowed / n)
}

export class VoiceListener {
  constructor({ onResult, onStateChange }) {
    this.onResult = onResult
    this.onStateChange = onStateChange
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
    rec.lang = 'en-US'
    rec.maxAlternatives = 4

    rec.onstart = () => this.setState('listening')

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
