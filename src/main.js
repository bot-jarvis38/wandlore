import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import './style.css'
import { buildWorld, CORRIDOR } from './world.js'
import { SPELLS, spellsForFloor, Wand, Particles, Projectiles } from './spells.js'
import { Dementor, Armour, Pixie } from './enemies.js'
import {
  PREFIX_COVER,
  VoiceListener,
  engine,
  prefixMatch,
  prepareLocalEngine,
  scoreUtterance,
  speechSupported,
  thresholdFor,
} from './voice.js'

/**
 * How long after the mic hears you start does the game keep treating you as
 * mid-word. Covers the engine's own thinking time — Safari can sit on a
 * finished utterance for the better part of a second — without being so long
 * that a hit taken well before you spoke gets wrongly refunded.
 */
const SPEECH_FLIGHT_MS = 2200
/** And how long the ending is held open for a transcript still in the air. */
const DEATH_GRACE_MS = 900
/**
 * How long a heard fragment stays available to be glued onto the next one.
 * Long enough to cover a recogniser restart (roughly a second on iOS Safari),
 * short enough that two genuinely separate attempts never merge into one.
 */
const STITCH_MS = 2600

/**
 * The lowest the adaptive resolution may ever go: one rendered pixel per CSS
 * pixel. A slow phone is allowed to give up supersampling; it is not allowed to
 * hand the browser an image smaller than the screen and let it stretch.
 */
const QUALITY_FLOOR = 1
/**
 * Where it starts, and how high it may climb. Starting at native on a phone
 * reporting 3 costs over twice the pixels of a 2, which is a stutter in the
 * first seconds — the worst moment to have one. So it opens at 2 and is allowed
 * to climb to native only after the device has proved it has the frames spare.
 */
const QUALITY_START = 2
const QUALITY_CEILING = 3

/** Every resolution the renderer is ever set to passes through here. */
const qualityClamp = n => Math.min(QUALITY_CEILING, Math.max(QUALITY_FLOOR, n))

const params = new URLSearchParams(location.search)
const DEBUG_STATE = params.get('state') // title | play | interlude | gameover
const DEBUG_POPULATE = params.get('populate') // spawn a specific line-up for a shot

const $ = id => document.getElementById(id)

const ui = {
  loader: $('loader'),
  title: $('title'),
  permission: $('permission'),
  permissionStatus: $('permission-status'),
  permissionRetry: $('permission-retry'),
  hud: $('hud'),
  interlude: $('interlude'),
  interludeTitle: $('interlude-title'),
  interludeNext: $('interlude-next'),
  gameover: $('gameover'),
  word: $('spell-word'),
  incantation: $('incantation'),
  castFill: $('cast-fill'),
  heard: $('heard'),
  matchFill: $('match-fill'),
  matchPct: $('match-pct'),
  reaction: $('reaction'),
  health: $('health-fill'),
  score: $('score'),
  waveLabel: $('wave-label'),
  micState: $('mic-state'),
  micText: $('mic-text'),
  castButton: $('cast-button'),
  damageFlash: $('damage-flash'),
}

/* ── waves ─────────────────────────────────────────────────────────── */

/**
 * Floors, not "waves" — and the castle does not run out of them. The first
 * build shipped five hand-written waves and ended, which read as a demo rather
 * than a game. These twelve are authored; past twelve the generator keeps
 * going and the counts keep climbing, so a run ends when you do.
 */
const FLOORS = [
  { name: 'THE GRAND STAIRCASE', pattern: [['Dementor', 2], ['Pixie', 3]], gap: 2.2 },
  { name: 'THE CHARMS CORRIDOR', pattern: [['Pixie', 5], ['Armour', 2]], gap: 1.95 },
  { name: 'THE TROPHY ROOM', pattern: [['Armour', 3], ['Dementor', 3]], gap: 1.8 },
  { name: 'THE ASTRONOMY STAIR', pattern: [['Pixie', 6], ['Dementor', 4], ['Armour', 2]], gap: 1.7 },
  { name: 'THE VIADUCT', pattern: [['Armour', 5], ['Pixie', 5]], gap: 1.6 },
  { name: 'THE CLOCK TOWER', pattern: [['Dementor', 6], ['Armour', 4]], gap: 1.52 },
  { name: 'THE DUNGEON STAIR', pattern: [['Pixie', 9], ['Dementor', 4]], gap: 1.44 },
  { name: 'THE GREENHOUSES', pattern: [['Armour', 6], ['Pixie', 7], ['Dementor', 3]], gap: 1.36 },
  { name: 'THE OWLERY', pattern: [['Pixie', 12], ['Armour', 4]], gap: 1.28 },
  { name: 'THE ROOM OF REQUIREMENT', pattern: [['Dementor', 8], ['Armour', 6]], gap: 1.2 },
  { name: 'THE FORBIDDEN FLOOR', pattern: [['Dementor', 7], ['Armour', 7], ['Pixie', 8]], gap: 1.12 },
  { name: 'THE HEADMASTER’S STAIR', pattern: [['Armour', 9], ['Dementor', 9], ['Pixie', 9]], gap: 1.04 },
]

/** Floor 13 and beyond: authored floors run out, the castle does not. */
function floorSpec(index) {
  if (index < FLOORS.length) return FLOORS[index]
  const over = index - FLOORS.length + 1
  const last = FLOORS[FLOORS.length - 1]
  return {
    name: `THE ${ordinal(index + 1)} FLOOR`,
    pattern: last.pattern.map(([kind, n]) => [kind, Math.round(n * (1 + over * 0.22))]),
    gap: Math.max(0.55, last.gap - over * 0.05),
  }
}

function ordinal(n) {
  const s = ['TH', 'ST', 'ND', 'RD']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

const KINDS = { Dementor, Armour, Pixie }

/* ── audio: a tiny synth, no files to load ─────────────────────────── */

class Sfx {
  constructor() {
    this.ctx = null
  }

  resume() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (Ctx) this.ctx = new Ctx()
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume()
  }

  tone(freq, dur, type = 'sine', gain = 0.15, sweepTo = null) {
    if (!this.ctx) return
    const t0 = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const amp = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur)
    amp.gain.setValueAtTime(0.0001, t0)
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(amp).connect(this.ctx.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  noise(dur, gain = 0.2, freq = 900) {
    if (!this.ctx) return
    const t0 = this.ctx.currentTime
    const frames = Math.floor(this.ctx.sampleRate * dur)
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(freq, t0)
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.25), t0 + dur)
    const amp = this.ctx.createGain()
    amp.gain.setValueAtTime(gain, t0)
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(filter).connect(amp).connect(this.ctx.destination)
    src.start(t0)
  }

  cast() {
    this.noise(0.3, 0.16, 2400)
    this.tone(320, 0.28, 'sawtooth', 0.07, 900)
  }
  impact() {
    this.noise(0.24, 0.24, 480)
    this.tone(90, 0.22, 'square', 0.09, 45)
  }
  kill() {
    this.tone(520, 0.4, 'triangle', 0.1, 130)
  }
  hurt() {
    this.tone(150, 0.35, 'sawtooth', 0.14, 60)
    this.noise(0.3, 0.18, 300)
  }
  fizzle() {
    this.tone(220, 0.18, 'square', 0.05, 110)
  }
}

/* ── the game ──────────────────────────────────────────────────────── */

class Game {
  constructor() {
    this.canvas = $('scene')
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: window.devicePixelRatio < 2,
      powerPreference: 'high-performance',
    })
    // Where the resolution starts. It does not stay here — see `tuneQuality`.
    this.pixelRatio = qualityClamp(Math.min(window.devicePixelRatio, QUALITY_START))
    this.renderer.setPixelRatio(this.pixelRatio)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 160)
    this.camera.position.set(0, 1.72, 2)
    this.camera.rotation.order = 'YXZ'
    this.scene.add(this.camera)

    this.world = buildWorld(this.scene)
    this.particles = new Particles(this.scene)
    this.projectiles = new Projectiles(this.scene, this.particles)
    this.wand = new Wand(this.camera)
    this.sfx = new Sfx()

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // threshold sits high on purpose: at 0.2 every candle and enemy light was
    // over it, and a busy wave bloomed the whole screen to white haze.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.45, 0.82)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.enemies = []
    this.state = 'title'
    this.clock = new THREE.Clock()
    this.trauma = 0
    this.look = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 }
    this.silentMode = false
    this.castWindow = 5
    this.castLeft = 5

    this.addReticle()
    this.bindInput()
    this.resize()
    window.addEventListener('resize', () => this.resize())

    this.voice = new VoiceListener({
      onResult: (transcript, isFinal) => this.onHeard(transcript, isFinal),
      onStateChange: state => this.onVoiceState(state),
      onSpeechStart: () => this.onSpeechStart(),
    })

    this.resetRun()
  }

  addReticle() {
    const reticle = document.createElement('div')
    reticle.className = 'reticle'
    reticle.innerHTML = '<span></span><span></span><span></span><span></span><i></i>'
    ui.hud.appendChild(reticle)
  }

  resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h, false)
    // Sizes every pass too, in *device* pixels. Do not follow this with a
    // manual `bloom.setSize(w, h)`: that passes CSS pixels back in and the
    // bloom pass halves whatever it is handed, so the glow ends up computed at
    // a quarter of the frame and smeared back over it. It read as the whole
    // picture being soft.
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /**
   * Render at whatever resolution this particular phone can actually hold 60 at.
   *
   * The lag is pixels, not logic: a modern phone reports a device pixel ratio
   * of 3, and every one of those pixels goes through a bloom pass that blurs
   * the frame five times over. Guessing a safe number for "a phone" is how you
   * end up soft on a good device and still stuttering on a bad one, so this
   * measures instead — drop a notch when frames run long, and climb back when
   * there is room to spare.
   *
   * Only ever moves on a sustained run of frames, so one hitch (a wave
   * spawning, a garbage collection) cannot knock the resolution down.
   *
   * The floor is one rendered pixel per CSS pixel and must stay there. Below
   * that the browser stretches the frame back up to fill the screen, and the
   * softness is immediately obvious on a phone — the first version of this
   * bottomed out at 0.75 on a device reporting 3, which meant a quarter-size
   * image blown up over the display. That is what "super blurry" was.
   */
  tuneQuality(dt) {
    const q = this._q ?? (this._q = { slow: 0, fast: 0, patience: 240 })
    const ms = dt * 1000

    if (ms > 20.5) {
      q.slow++
      q.fast = 0
    } else if (ms < 15) {
      q.fast++
      q.slow = 0
    } else {
      return
    }

    if (q.slow >= 45 && this.pixelRatio > QUALITY_FLOOR) {
      this.setPixelRatio(Math.max(QUALITY_FLOOR, this.pixelRatio - 0.25))
      q.slow = 0
      // Each drop makes the next attempt to climb back more cautious, so a
      // device sitting on the boundary settles instead of oscillating. A hard
      // cap on the number of lifts did that too, but it was a one-way ratchet:
      // a phone that dipped once during a busy wave stayed soft for the rest
      // of the session even when it had room to spare.
      q.patience = Math.min(3600, q.patience * 2)
      return
    }
    const ceiling = qualityClamp(Math.min(window.devicePixelRatio, QUALITY_CEILING))
    if (q.fast >= q.patience && this.pixelRatio < ceiling) {
      this.setPixelRatio(Math.min(ceiling, this.pixelRatio + 0.25))
      q.fast = 0
    }
  }

  setPixelRatio(raw) {
    // Clamped here rather than only where the value is computed. An independent
    // review of the first version of this fix found the floor held on the way
    // down and nowhere else: a browser zoomed out reports a ratio below one, so
    // the game opened below the floor and could never climb, because its own
    // ceiling was that same sub-one number. The rule is a property of the
    // renderer, so it belongs on the one function that sets it.
    const next = qualityClamp(raw)
    if (next === this.pixelRatio) return
    this.pixelRatio = next
    this.renderer.setPixelRatio(next)
    // The composer caches the ratio it was built with and sizes its offscreen
    // buffers by it, so without this the scene kept being drawn at the old
    // resolution and was merely squashed into a smaller canvas on the way out:
    // the full cost of the frame we were trying to avoid, and a blurrier
    // picture for it. Must come before resize(), which reads it back.
    this.composer.setPixelRatio(next)
    this.resize()
  }

  bindInput() {
    const el = this.canvas
    let dragging = false
    let lastX = 0
    let lastY = 0

    el.addEventListener('pointerdown', e => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
    })
    el.addEventListener('pointermove', e => {
      if (!dragging) return
      this.look.targetYaw -= (e.clientX - lastX) * 0.0032
      this.look.targetPitch -= (e.clientY - lastY) * 0.0028
      lastX = e.clientX
      lastY = e.clientY
      this.look.targetYaw = THREE.MathUtils.clamp(this.look.targetYaw, -0.78, 0.78)
      this.look.targetPitch = THREE.MathUtils.clamp(this.look.targetPitch, -0.42, 0.34)
    })
    const up = () => {
      dragging = false
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)

    ui.castButton.addEventListener('click', () => this.castCurrent('tap'))
    // Tapping the mic readout wakes a stalled engine by hand. On iOS a fresh
    // user gesture is sometimes the only thing that will restart it at all.
    ui.micState.addEventListener('click', () => {
      if (this.silentMode) return
      this.voice.stop()
      this.voice.start()
      this.voice.lastHeardAt = performance.now()
      this._micDeaf = false
      ui.micState.classList.remove('deaf')
      ui.micText.textContent = this.micLabel()
    })
    window.addEventListener('keydown', e => {
      if (e.code === 'Space') {
        e.preventDefault()
        this.castCurrent('key')
      }
    })
  }

  /* ── run lifecycle ───────────────────────────────────────────────── */

  resetRun() {
    for (const e of this.enemies) e.dispose()
    this.enemies = []
    this.projectiles.clear()
    this.health = 100
    this.score = 0
    this.streak = 0
    this.bestStreak = 0
    this.landed = 0
    this.attempts = 0
    this.waveIndex = 0
    this.spawnQueue = []
    this.spawnTimer = 0
    this.currentWave = floorSpec(0)
    clearTimeout(this._deathTimer)
    this.pendingHit = null
    this.speechStartedAt = 0
    this.updateHud()
  }

  startWave(index) {
    const wave = floorSpec(index)
    this.currentWave = wave
    this.spawnQueue = []
    for (const [kind, count] of wave.pattern) {
      for (let i = 0; i < count; i++) this.spawnQueue.push(kind)
    }
    for (let i = this.spawnQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[this.spawnQueue[i], this.spawnQueue[j]] = [this.spawnQueue[j], this.spawnQueue[i]]
    }
    this.spawnTimer = 0.6
    ui.waveLabel.textContent = wave.name
    this.nextSpell()
  }

  spawnOne(kind, zOverride) {
    const Kind = KINDS[kind]
    const lane = (Math.random() - 0.5) * (CORRIDOR.width - 3.4)
    const z = zOverride ?? -CORRIDOR.length * (0.42 + Math.random() * 0.25)
    this.enemies.push(new Kind(this.scene, z, lane))
  }

  nextSpell() {
    // Draw from the floor's pool, never the same word twice running, and
    // never the same word two draws apart either — with 21 spells in the bag
    // a plain random pick still felt repetitive because the eye notices a
    // repeat long before the statistics justify one.
    const pool = spellsForFloor(this.waveIndex + 1).filter(s => !this.recentSpells?.includes(s))
    const bag = pool.length ? pool : spellsForFloor(this.waveIndex + 1)
    this.spell = bag[Math.floor(Math.random() * bag.length)]
    this.recentSpells = [this.spell, ...(this.recentSpells ?? [])].slice(0, 3)

    // Longer words get more time. A 2.6s window on WINGARDIUM LEVIOSA is not
    // difficulty, it is an impossible ask.
    const syllables = Math.max(3, this.spell.word.replace(/[^AEIOUY]/g, '').length)
    this.castWindow = Math.max(3.0, 3.4 + syllables * 0.42 - this.waveIndex * 0.18)
    this.castLeft = this.castWindow

    this.bestHeard = 0
    this.casting = false
    this.heardParts = []
    this.renderWord(0)
    this.showMatch(0)
    ui.incantation.classList.remove('success', 'fail')
    ui.heard.textContent = ''
    ui.heard.className = 'heard'
  }

  /**
   * The word as individual letters, the first `progress` share of them lit.
   * Spaces get their own element so a two-word incantation still breaks in the
   * right place while every letter stays individually addressable.
   */
  renderWord(progress) {
    const word = this.spell.word
    const letters = [...word].filter(c => c !== ' ')
    const litCount = Math.round(progress * letters.length)
    let seen = 0
    ui.word.innerHTML = ''
    for (const ch of word) {
      const span = document.createElement('span')
      if (ch === ' ') {
        span.className = 'sp'
      } else {
        span.textContent = ch
        if (seen < litCount) span.className = 'lit'
        seen++
      }
      ui.word.appendChild(span)
    }
  }

  /** The live match bar and percentage — the same number that fires the spell. */
  showMatch(score) {
    const pct = Math.round(score * 100)
    const band = score >= 1 ? 'hit' : score >= 0.66 ? 'near' : ''
    ui.matchFill.style.width = `${pct}%`
    ui.matchFill.className = `match-fill ${band}`
    ui.matchPct.textContent = `${pct}%`
    ui.matchPct.className = `match-pct ${band}`
  }

  /** One line of what the spell just did, over the corridor and gone. */
  flashReaction(text) {
    ui.reaction.textContent = text
    ui.reaction.classList.add('show')
    clearTimeout(this._reactionTimer)
    this._reactionTimer = setTimeout(() => ui.reaction.classList.remove('show'), 1500)
  }

  /* ── casting ─────────────────────────────────────────────────────── */

  /**
   * The mic heard a human start. Nothing is known about the words yet, and
   * that is the point: this is the timestamp the cast is judged from, so the
   * seconds the recogniser spends thinking are charged to the game and not to
   * the player. See `rollBackLateHit`.
   */
  onSpeechStart() {
    if (this.state !== 'playing') return
    if (performance.now() - (this.lastCastAt ?? -1e9) < 600) return
    this.speechStartedAt = performance.now()
  }

  /**
   * Glue an incantation back together when the recogniser cuts it in half.
   *
   * This is the reported symptom, exactly: "it detects some of it, pauses for
   * a second or two, then resumes and finishes." The engine ends its session
   * mid-word — iOS Safari does this after every utterance no matter what you
   * ask for — and coming back takes it the better part of a second. Neither
   * half is the spell. "expelli" scores nothing, "armus" scores nothing, and
   * the player who said the whole word perfectly gets nothing twice.
   *
   * So the pieces are scored joined as well as alone. Restarting faster cannot
   * fix this, because the gap belongs to the engine; the only way through is
   * to stop throwing away what was already heard.
   */
  stitch(transcript, isFinal) {
    const now = performance.now()
    const parts = (this.heardParts ?? []).filter(p => now - p.at < STITCH_MS)
    this.heardParts = parts
    if (isFinal && transcript.trim()) parts.push({ text: transcript.trim(), at: now })
    if (!parts.length) return transcript
    // The tail is the current utterance either way, so a fragment that arrives
    // as an interim result still gets glued to whatever came before it.
    const joined = isFinal ? parts.map(p => p.text) : [...parts.map(p => p.text), transcript]
    return joined.join(' ')
  }

  /** Is a word still somewhere between the player's mouth and the transcript? */
  speechInFlight(now = performance.now()) {
    return this.speechStartedAt > 0 && now - this.speechStartedAt < SPEECH_FLIGHT_MS
  }

  /**
   * A hit that landed while the player was already saying the word is the lag
   * hitting them, not the enemy. When the transcript finally lands and it was
   * right, the hit is taken back.
   *
   * Only the most recent one, only if it landed after they started speaking,
   * and only once — so this can never become a way to farm health.
   */
  rollBackLateHit() {
    const hit = this.pendingHit
    this.pendingHit = null
    if (!hit || !this.speechStartedAt || hit.at < this.speechStartedAt) return false
    // A word that took longer than the flight window to come back is a stalled
    // engine, not lag on this cast — past that point the hit is honestly theirs.
    if (performance.now() - hit.at > SPEECH_FLIGHT_MS) return false

    this.health = Math.min(100, this.health + hit.damage)
    clearTimeout(this._deathTimer)
    this.updateHud()
    this.flashReaction('Said in time — that one does not count.')
    return true
  }

  onHeard(transcript, isFinal) {
    if (this.state !== 'playing' || !this.spell) return
    // The tail of the utterance that just fired a spell keeps arriving for a
    // beat afterwards. Scored against the NEW word it reads as a bad attempt
    // and paints a red 20% under a word you have not tried yet.
    if (performance.now() - (this.lastCastAt ?? -1e9) < 600) return

    // Not every engine fires speechstart. Without it the arrival of the first
    // words is the earliest moment we can prove they were talking — a worse
    // anchor than the real onset, but far better than the transcript's own
    // timestamp, which is the thing being compensated for.
    if (!this.speechInFlight()) this.speechStartedAt = performance.now()

    const said = transcript.trim()
    const score = scoreUtterance(this.stitch(transcript, isFinal), this.spell)
    const bar = thresholdFor(this.spell)

    // Shown as a share of THIS word's bar, not as a raw similarity — so a full
    // meter always means "that fires" and a lit word always means "that was
    // enough", on every spell. A raw number would sit at 61% on a word whose
    // bar is 54% and read as a failure the game then rewarded.
    const shown = Math.min(1, score / bar)

    // Interim results arrive out of order across alternatives, so the display
    // tracks the best seen for this word rather than the latest — otherwise
    // the bar lurches backwards while you are still speaking.
    // Enough of the word is in that it can only be this spell. Don't make them
    // finish it and then wait for the engine — the outcome is already decided,
    // and the waiting is what read as the game being slow.
    const cover = score >= bar ? 0 : prefixMatch(transcript, this.spell)

    this.bestHeard = Math.max(this.bestHeard ?? 0, cover || 0, shown)
    this.renderWord(this.bestHeard)
    this.showMatch(this.bestHeard)
    if (said) ui.heard.textContent = `“${said}”`

    if (score >= bar || cover >= PREFIX_COVER) {
      ui.heard.className = 'heard hit'
      this.castCurrent('voice')
    } else if (isFinal && said.length > 2) {
      this.attempts++
      ui.heard.className = 'heard miss'
      ui.heard.textContent = `heard “${said}” — ${Math.round(shown * 100)}%`
      ui.incantation.classList.add('fail')
      setTimeout(() => ui.incantation.classList.remove('fail'), 340)
      this.sfx.fizzle()
      if (shown >= 0.7) this.flashReaction('So close. Again.')
    }
  }

  castCurrent(source) {
    if (this.state !== 'playing' || !this.spell) return
    // With a working mic the spoken word is the only trigger — otherwise the
    // tap button quietly becomes the better way to play and the game stops
    // being a voice game. Checked BEFORE the lock below: taking the lock and
    // then bailing here would leave casting stuck on and deafen the game.
    if ((source === 'tap' || source === 'key') && !this.silentMode) return
    // The lit word is held for a beat before the next one is drawn; without a
    // lock, a second interim result inside that beat fires the same spell twice.
    if (this.casting) return
    this.casting = true
    this.lastCastAt = performance.now()
    if (source === 'voice') this.rollBackLateHit()
    this.speechStartedAt = 0
    this.heardParts = []

    const spell = this.spell
    this.attempts++
    this.landed++

    const from = this.wand.muzzle(new THREE.Vector3())
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)

    // The bolt is born a stride ahead of the wand, not on the tip. Spawned at
    // the tip it sits ~0.5m from the lens, where a 0.14m sphere and its halo
    // fill a third of the screen with white — the first pass looked like a
    // lens flare, not a spell.
    const origin = from.clone().addScaledVector(dir, 1.25)
    this.projectiles.spawn(spell, origin, dir)
    this.wand.fire(spell.color)
    // Thrown forward, down the corridor, from further out — not sprayed around
    // the muzzle. Sixteen additive sprites blooming a metre from the lens sat
    // right on top of the enemy and read as a blending fault rather than a
    // cast, which is exactly how a judge described it.
    this.particles.burst(
      from.clone().addScaledVector(dir, 2.4),
      spell.glow, 14, 3.4, 0.26, dir
    )
    this.trauma = Math.min(1, this.trauma + 0.22)
    this.sfx.cast()

    ui.incantation.classList.add('success')
    this.renderWord(1)
    this.showMatch(1)
    setTimeout(() => ui.incantation.classList.remove('success'), 240)

    // Held one frame so the fully-lit word is visible before it is replaced —
    // without this the payoff for finally saying WINGARDIUM LEVIOSA correctly
    // was the word vanishing.
    clearTimeout(this._nextSpellTimer)
    this._nextSpellTimer = setTimeout(() => {
      if (this.state === 'playing') this.nextSpell()
    }, 260)
  }

  onSpellHit(spell, enemy, at, back) {
    this.sfx.impact()
    this.particles.burst(at, spell.color, 40, 7.5, 0.65, back)
    this.trauma = Math.min(1, this.trauma + 0.16)

    const killed = enemy.takeDamage(spell.damage)

    // The funny part. A spell that only subtracts a number is a number; these
    // do something to the thing in front of you and say so.
    if (spell.effect && !killed) {
      enemy.applyEffect(spell.effect)
      this.particles.burst(at, spell.glow, 22, 3.2, 0.9, back)
    }
    if (spell.reaction) this.flashReaction(spell.reaction)

    if (spell.radius > 0) {
      for (const other of this.enemies) {
        if (other === enemy || !other.alive) continue
        const d = other.hitPoint(new THREE.Vector3()).distanceTo(at)
        if (d < spell.radius) {
          const falloff = 1 - d / spell.radius
          if (other.takeDamage(spell.damage * 0.6 * falloff)) this.onKill(other)
          if (spell.knockback) other.group.position.z -= spell.knockback * falloff
        }
      }
      this.particles.burst(at, spell.glow, 26, spell.radius * 2.2, 0.8)
    }

    if (spell.knockback) enemy.group.position.z -= spell.knockback

    if (killed) this.onKill(enemy)
    else this.score += Math.round(spell.damage)

    this.updateHud()
  }

  onKill(enemy) {
    if (enemy.dead) return
    enemy.dead = true
    this.streak++
    this.bestStreak = Math.max(this.bestStreak, this.streak)
    const mult = 1 + Math.min(2, this.streak * 0.1)
    this.score += Math.round(enemy.score * mult)
    this.particles.burst(enemy.hitPoint(new THREE.Vector3()), 0xfff0c0, 40, 8, 0.9)
    this.sfx.kill()
    this.trauma = Math.min(1, this.trauma + 0.2)
  }

  onPlayerHit(enemy) {
    const now = performance.now()
    this.health = Math.max(0, this.health - enemy.damage)
    this.pendingHit = { damage: enemy.damage, at: now }
    this.streak = 0
    this.trauma = 1
    this.sfx.hurt()
    ui.damageFlash.animate([{ opacity: 0.9 }, { opacity: 0 }], {
      duration: 620,
      easing: 'ease-out',
    })
    this.updateHud()

    if (this.health > 0) return
    // Dying with the winning word already spoken and still stuck inside the
    // recogniser is the single most unfair thing this game can do. Hold the
    // ending open long enough for the transcript to arrive and undo it.
    if (this.speechInFlight(now)) {
      clearTimeout(this._deathTimer)
      this._deathTimer = setTimeout(() => {
        if (this.state === 'playing' && this.health <= 0) this.endRun()
      }, DEATH_GRACE_MS)
      return
    }
    this.endRun()
  }

  /* ── screens ─────────────────────────────────────────────────────── */

  show(name) {
    for (const el of [ui.title, ui.permission, ui.interlude, ui.gameover, ui.loader]) {
      el.classList.add('hidden')
    }
    ui.hud.classList.toggle('hidden', name !== 'playing')
    if (name === 'title') ui.title.classList.remove('hidden')
    if (name === 'permission') ui.permission.classList.remove('hidden')
    if (name === 'interlude') ui.interlude.classList.remove('hidden')
    if (name === 'gameover') ui.gameover.classList.remove('hidden')
    this.state = name
  }

  async begin(useVoice) {
    this.sfx.resume()
    this.silentMode = !useVoice || !speechSupported

    if (!this.silentMode) {
      this.show('permission')
      ui.permissionStatus.textContent = 'Awaiting permission…'
      const result = await this.voice.requestPermission()
      if (result !== 'granted') {
        ui.permissionStatus.textContent =
          result === 'denied'
            ? 'The castle cannot hear you. Play by tapping instead.'
            : 'No microphone found. Play by tapping instead.'
        ui.permissionRetry.classList.remove('hidden')
        return
      }
      // Done here rather than at load because the language-pack download wants
      // a user gesture, and the tap that granted the mic is the one we have.
      ui.permissionStatus.textContent = 'Waking the castle…'
      await prepareLocalEngine(() => {
        ui.permissionStatus.textContent = 'Learning your voice — one-time download…'
      })
      this.voice.start()
    }

    ui.castButton.classList.toggle('hidden', !this.silentMode)
    ui.micState.classList.toggle('muted', this.silentMode)
    ui.micText.textContent = this.silentMode ? 'SILENT' : this.micLabel()

    this.resetRun()
    this.runStartedAt = performance.now()
    this._micDeaf = false
    ui.micState.classList.remove('deaf')
    this.startWave(0)
    this.show('playing')
  }

  advanceWave() {
    this.waveIndex++
    const accuracy = this.attempts ? Math.round((this.landed / this.attempts) * 100) : 100
    $('tally-cast').textContent = this.landed
    $('tally-accuracy').textContent = `${accuracy}%`
    $('tally-best').textContent = this.bestStreak
    ui.interludeTitle.textContent =
      this.waveIndex >= FLOORS.length ? 'STILL STANDING' : 'THE CORRIDOR FALLS SILENT'
    const next = floorSpec(this.waveIndex)
    const harder = this.waveIndex === 1 || this.waveIndex === 3
    ui.interludeNext.textContent = harder
      ? `Next: ${next.name.toLowerCase()} — and longer words.`
      : `Next: ${next.name.toLowerCase()}.`
    this.show('interlude')
  }

  endRun() {
    clearTimeout(this._deathTimer)
    $('final-score').textContent = this.score.toLocaleString()
    $('final-wave').textContent = this.waveIndex + 1
    $('final-best').textContent = this.bestStreak
    this.voice.stop()
    this.show('gameover')
  }

  updateHud() {
    ui.health.style.width = `${this.health}%`
    ui.score.textContent = this.score.toLocaleString()
  }

  /**
   * The mic pill says WHERE the listening happens. "Sometimes it's fast and
   * sometimes it isn't" is exactly what a network round-trip feels like, and
   * from inside the game there is no way to tell that apart from a bad mic.
   */
  micLabel() {
    // Three states, not two. A browser that won't say where it listens gets a
    // plain label — claiming "via net" there would be asserting something
    // nobody checked, which is the same sin as the lag it is meant to explain.
    if (engine.mode === 'local') return 'LISTENING · ON DEVICE'
    if (engine.mode === 'network') return 'LISTENING · VIA NET'
    return 'LISTENING'
  }

  onVoiceState(state) {
    if (this.silentMode) return
    const where = this.micLabel()
    ui.micText.textContent =
      state === 'listening'
        ? where
        : state === 'denied'
          ? 'MUTED'
          : // The engine keeps dying on start-up. Saying LISTENING here is a
            // lie the player has no way to catch, and it is the exact lie that
            // made the stutter so hard to place.
            state === 'stalled'
            ? 'MIC WON’T START — TAP'
            : 'RE-LISTENING'
    ui.micState.classList.toggle('muted', state === 'denied')
    ui.micState.classList.toggle('deaf', state === 'stalled')
    ui.micState.classList.toggle('remote', engine.mode === 'network')
  }

  /**
   * A speech engine that has quietly stopped delivering results is
   * indistinguishable, from the player's chair, from a game that is marking
   * correct answers wrong. So say it out loud, and offer the fix.
   */
  checkMicHealth() {
    if (this.silentMode || this.voice.state === 'denied') return
    const since = performance.now() - (this.voice.lastHeardAt || this.runStartedAt || 0)
    const deaf = since > 9000
    if (deaf === this._micDeaf) return
    this._micDeaf = deaf
    ui.micState.classList.toggle('deaf', deaf)
    ui.micText.textContent = deaf ? 'MIC ASLEEP — TAP' : this.micLabel()
    if (deaf) {
      // Kick it ourselves as well as offering the tap; on iOS Safari the
      // engine ends after every utterance and occasionally never comes back.
      this.voice.stop()
      this.voice.start()
    }
  }

  /* ── frame ───────────────────────────────────────────────────────── */

  frame() {
    const raw = this.clock.getDelta()
    const dt = Math.min(0.05, raw)
    const t = this.clock.elapsedTime

    // Judged on the real delta, not the clamped one — the clamp exists to keep
    // physics sane through a stall, and a stall is precisely what needs seeing.
    this.tuneQuality(raw)

    this.world.update(t)
    this.particles.update(dt)

    this.look.yaw += (this.look.targetYaw - this.look.yaw) * Math.min(1, dt * 9)
    this.look.pitch += (this.look.targetPitch - this.look.pitch) * Math.min(1, dt * 9)
    this.trauma = Math.max(0, this.trauma - dt * 1.5)
    const shake = this.trauma * this.trauma

    this.camera.rotation.x = this.look.pitch + (Math.random() - 0.5) * shake * 0.06
    this.camera.rotation.y = this.look.yaw + (Math.random() - 0.5) * shake * 0.06
    this.camera.rotation.z = (Math.random() - 0.5) * shake * 0.04
    this.camera.position.y =
      1.72 + Math.sin(t * 1.1) * 0.012 + (Math.random() - 0.5) * shake * 0.05

    if (this.state === 'playing') this.tickPlay(dt, t)

    this.wand.update(
      dt,
      t,
      this.state === 'playing' ? 1 - this.castLeft / this.castWindow : 0.2
    )
    this.composer.render()
    requestAnimationFrame(() => this.frame())
  }

  tickPlay(dt, t) {
    if (this.spawnQueue.length) {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0) {
        this.spawnOne(this.spawnQueue.shift())
        this.spawnTimer = this.currentWave.gap * (0.6 + Math.random() * 0.8)
      }
    }

    if (!this.casting) {
      this.castLeft -= dt
      ui.castFill.style.transform = `scaleX(${Math.max(0, this.castLeft / this.castWindow)})`
      if (this.castLeft <= 0) {
        // The word STAYS. Swapping it here was the cruellest bug in the build:
        // you say a five-syllable incantation correctly, the window closes
        // while you are still on the last syllable, the word changes, and the
        // transcript that finally lands gets scored against something you were
        // never asked for. From the outside that reads as the engine marking a
        // correct answer wrong. Now the clock only costs you the streak.
        this.streak = 0
        this.castLeft = this.castWindow
        this.sfx.fizzle()
        ui.incantation.classList.add('fail')
        setTimeout(() => ui.incantation.classList.remove('fail'), 340)
        this.flashReaction('Too slow — but the word still stands.')
      }
    }

    this._micCheck = (this._micCheck ?? 0) + dt
    if (this._micCheck > 1) {
      this._micCheck = 0
      this.checkMicHealth()
    }

    this.projectiles.update(dt, this.enemies, (spell, enemy, at, back) =>
      this.onSpellHit(spell, enemy, at, back)
    )

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      if (!e.alive) {
        e.dispose()
        this.enemies.splice(i, 1)
        continue
      }
      if (e.update(dt, t, this.camera.position.z)) {
        this.onPlayerHit(e)
        e.alive = false
        e.dispose()
        this.enemies.splice(i, 1)
      }
    }

    if (!this.spawnQueue.length && !this.enemies.length && this.health > 0) {
      this.advanceWave()
    }
  }
}

/* ── boot ──────────────────────────────────────────────────────────── */

const game = new Game()
// Exposed so tools/probe-cast.mjs can drive a spoken utterance headlessly —
// a cast cycle is otherwise only reachable by speaking into a real phone.
window.__game = game
// Which speech engine we ended up on, readable from a probe and from a phone's
// dev console — the one question you cannot answer by looking at the game.
window.__voice = { engine }
// So a test can pin the word it is about to speak aloud, in the ordinary flow
// rather than the debug one — the mic only exists on the real path.
window.__allSpells = SPELLS
game.frame()

$('start-button').addEventListener('click', () => game.begin(true))
$('start-silent').addEventListener('click', () => game.begin(false))
ui.permissionRetry.addEventListener('click', () => game.begin(false))
$('interlude-button').addEventListener('click', () => {
  game.startWave(game.waveIndex)
  game.show('playing')
})
$('retry-button').addEventListener('click', () => game.begin(!game.silentMode))

// Let the corridor render behind the title, so the game never opens on a
// black rectangle while the textures are still being drawn.
setTimeout(() => ui.loader.classList.add('hidden'), 900)

// Debug states are applied synchronously, never on a timer. Under a software
// renderer a single bloomed frame can take longer than the boot delay, and
// every capture came back photographing the loading screen.
function applyDebugState() {
  if (!DEBUG_STATE) return
  ui.loader.classList.add('hidden')

  game.silentMode = true
  ui.castButton.classList.remove('hidden')
  ui.micState.classList.add('muted')
  ui.micText.textContent = 'SILENT'

  if (DEBUG_STATE !== 'title') {
    game.resetRun()
    game.startWave(0)
    game.show('playing')
  }

  if (DEBUG_POPULATE) {
    DEBUG_POPULATE.split(',').forEach((kind, i) => {
      const k = kind.trim()
      if (KINDS[k]) game.spawnOne(k, -7 - i * 2.6)
    })
    game.spawnQueue = []
  }

  // ?spell=WORD pins the incantation and ?say=text feeds the recogniser, so a
  // headless capture can photograph the mid-utterance state that is otherwise
  // only reachable by speaking into a phone.
  const forced = params.get('spell')
  if (forced) {
    const match = SPELLS.find(s => s.word === forced.toUpperCase())
    if (match) {
      game.spell = match
      game.bestHeard = 0
      game.casting = false
      game.castWindow = 6
      game.castLeft = 6
      game.renderWord(0)
      game.showMatch(0)
    }
  }
  const said = params.get('say')
  if (said) game.onHeard(said, false)
  const effect = params.get('effect')
  if (effect) game.enemies.forEach(e => e.applyEffect(effect))

  if (DEBUG_STATE === 'interlude') {
    game.score = 4820
    game.landed = 31
    game.attempts = 34
    game.bestStreak = 12
    game.advanceWave()
  }

  if (DEBUG_STATE === 'gameover') {
    game.score = 7315
    game.waveIndex = 3
    game.bestStreak = 17
    game.health = 0
    game.endRun()
  }

  document.body.dataset.ready = DEBUG_STATE
}

applyDebugState()
