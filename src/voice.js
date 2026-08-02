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
  let best = 0

  for (const target of targets) {
    const span = target.split(' ').length
    for (let i = 0; i + span <= words.length; i++) {
      best = Math.max(best, similarity(words.slice(i, i + span).join(' '), target))
    }
    // and against the whole utterance, for one-word spells said alone
    best = Math.max(best, similarity(said, target))
  }
  return best
}

export const MATCH_THRESHOLD = 0.66

export class VoiceListener {
  constructor({ onResult, onStateChange }) {
    this.onResult = onResult
    this.onStateChange = onStateChange
    this.recognition = null
    this.wantsToRun = false
    this.state = 'idle'
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

    // Chrome ends the session after a pause. Restart, or the game goes deaf
    // partway through a wave with no visible cause.
    rec.onend = () => {
      this.recognition = null
      if (this.wantsToRun) {
        this.setState('restarting')
        setTimeout(() => this.wantsToRun && this.start(), 220)
      } else {
        this.setState('idle')
      }
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
