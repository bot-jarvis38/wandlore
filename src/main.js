import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import './style.css'
import { buildWorld, CORRIDOR } from './world.js'
import { SPELLS, spellsForFloor, Wand, Particles, Projectiles, Shockwave } from './spells.js'
import { Dementor, Armour, Pixie } from './enemies.js'
import { LightRig } from './lights.js'
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
/**
 * How many consecutive good frames buy one notch of resolution back, and the
 * most that may ever be demanded. 240 is four seconds at 60fps — long enough
 * that a single quiet moment between waves does not lift the resolution into
 * the next stutter. The ceiling was 3600 (a full minute per notch) and that is
 * how a three-second stall turned into a four-minute-blurry game; see the
 * halving in `tuneQuality`.
 */
const QUALITY_PATIENCE_MIN = 240
const QUALITY_PATIENCE_MAX = 1800

/** Every resolution the renderer is ever set to passes through here. */
const qualityClamp = n => Math.min(QUALITY_CEILING, Math.max(QUALITY_FLOOR, n))

/* ── the ultimate ──────────────────────────────────────────────────── */

/**
 * How many correct incantations fill the meter.
 *
 * Measured, not guessed. `tools/probe-pacing.mjs` plays the real game at a
 * human cadence — aimed, with a few degrees of error — and a floor takes 9 to
 * 16 casts to clear, climbing as the floors do.
 *
 * Six was chosen over seven on the numbers. Seven put 98% of floors in the
 * asked-for one-to-two band for a fluent player casting every three seconds,
 * but only 78% for a slower one at four — and the floors it missed were the
 * early ones, which end before the meter has filled. Six is 100% and 87%.
 * Where the two ends of the trade-off disagree, this errs toward filling too
 * fast, because the failure that matters is a floor with NO ultimate in it: a
 * player who never finds out the feature is there.
 */
const ULT_CASTS = 6
/**
 * What the wave does to everything it passes. Seventy kills a Pixie (24) and a
 * Dementor (62) outright and leaves an Armour (96) on 26 — one ordinary spell
 * from dead. So an ultimate clears the corridor of everything except the heavy
 * ones, which is a release worth six casts without being a free floor.
 */
const ULT_DAMAGE = 70
const ULT_KNOCKBACK = 3.2
/** And what an ultimate does to the spell it rides in on. */
const ULT_BOLT_DAMAGE = 2.2
const ULT_BOLT_RADIUS = 5.5

/**
 * Vitality returned when a floor falls silent.
 *
 * "The game ends too quick" is mostly this: nothing ever gave any health back,
 * so a run was a strictly downward line and every hit was permanent. Measured
 * over eight simulated runs, a competent player finished the first floor on 98,
 * the second on 66 and the third on 32, and died early in the fourth — three
 * floors, about 140 seconds. The interlude is already the moment the corridor
 * goes quiet; this makes it mean something.
 *
 * Twenty-two rather than thirty, which was tried and gave the same run length —
 * the ceiling on a run is the floor table's own ramp, not the size of the
 * rest — but flattened the middle of it, holding the player at full health
 * through four floors. At 22 the damage starts sticking from the fifth, so the
 * later floors cost something and the run still ends: the floors grow faster
 * than 22 a time can cover, which is what keeps this from being an endless mode.
 */
const FLOOR_HEAL = 22

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
  ult: $('ult'),
  ultFill: $('ult-fill'),
  ultLabel: $('ult-label'),
  ultFlash: $('ult-flash'),
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
  /** The meter just filled — a clean rising bell, easy to hear mid-fight. */
  ready() {
    this.tone(620, 0.26, 'triangle', 0.09, 1240)
    this.tone(930, 0.34, 'sine', 0.05, 1860)
  }
  /** Armed. A small mechanical click, so it is felt rather than announced. */
  arm() {
    this.tone(440, 0.09, 'square', 0.05, 760)
  }
  /**
   * And the release. Three layers because one oscillator is a beep: a low
   * body you feel, a band of noise for the air moving, and a fast rising
   * sweep on top that reads as the thing leaving the wand.
   */
  ultimate() {
    this.tone(120, 0.95, 'sawtooth', 0.15, 34)
    this.noise(0.8, 0.3, 260)
    this.tone(680, 0.5, 'triangle', 0.09, 2400)
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
    /**
     * The whole dynamic lighting budget, allocated here and never changed.
     *
     * Two rigs rather than one shared pool, because they would starve each
     * other in exactly the wrong direction: a busy floor with every creature
     * light spoken for would leave the bolts dark, and the bolt is the thing
     * the player just earned. Splitting them means a cast always lights, and a
     * creature is what goes without.
     *
     * Six creature lights is three fully-lit creatures, or six Pixies. Whatever
     * is nearest the player gets them — see `relight`.
     */
    this.creatureLights = new LightRig(this.scene, 6)
    // Three, not two: an ultimate spawns a bolt AND the wave, and the wave
    // going out unlit is the one shot in the game that must never be dim.
    this.boltLights = new LightRig(this.scene, 3, { distance: 8 })
    this.projectiles = new Projectiles(this.scene, this.particles, this.boltLights)
    this.shockwave = new Shockwave(this.scene, this.particles, this.boltLights)
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
    this.timer = new THREE.Timer()
    this.trauma = 0
    this.look = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 }
    this.silentMode = false
    this.castWindow = 5
    this.castLeft = 5

    this.addReticle()
    this.bindInput()
    this.resize()
    this.prewarm()
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
    const q = this._q ?? (this._q = { slow: 0, fast: 0, patience: QUALITY_PATIENCE_MIN })
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
      q.patience = Math.min(QUALITY_PATIENCE_MAX, q.patience * 2)
      return
    }
    const ceiling = qualityClamp(Math.min(window.devicePixelRatio, QUALITY_CEILING))
    if (q.fast >= q.patience && this.pixelRatio < ceiling) {
      this.setPixelRatio(Math.min(ceiling, this.pixelRatio + 0.25))
      q.fast = 0
      // And each notch EARNED BACK makes the next one cheaper.
      //
      // Without this the doubling above is still a one-way ratchet, just a
      // quieter one — it re-created the exact bug it was written to fix.
      // Measured on the live build (`tools/probe-quality.mjs`): 180 long frames,
      // three seconds of them, took the picture from 2.0 down to the 1.0 floor,
      // and climbing back out cost 3600 consecutive good frames PER NOTCH —
      // four solid minutes to undo three seconds. On a phone reporting a device
      // pixel ratio of 3, sitting at 1.0 means a third-resolution image
      // stretched over the display, which is exactly what "it looks blurry" is.
      // The resource leak guaranteed the stalls; this is what made one stall
      // permanent for the rest of the session.
      //
      // Halving keeps the entire point of the doubling — a genuinely borderline
      // device drops again, re-doubles, and settles — while letting a device
      // that has actually recovered take its resolution back at an accelerating
      // rate rather than a punitive fixed one.
      q.patience = Math.max(QUALITY_PATIENCE_MIN, Math.round(q.patience / 2))
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

    /**
     * No context menu, anywhere, ever.
     *
     * Holding still for a moment mid-drag is a thing hands do, and on Android
     * that is a long press: the browser fires `contextmenu` and puts its own
     * menu over the duel. CSS cannot prevent an event, so this is the half of
     * the fix that has to be in script — the other half is `touch-action` and
     * the callout properties in style.css. Bound to the window rather than the
     * canvas because the HUD sits over the canvas and takes the press itself.
     */
    window.addEventListener('contextmenu', e => e.preventDefault())

    el.addEventListener('pointerdown', e => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      // Keeps the look glued to this finger even when it slides over the HUD
      // or off the edge of the screen, which is otherwise a drag that stops
      // dead halfway. Wrapped because a browser that cannot capture a pointer
      // should still turn the camera.
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* not fatal — the window-level pointerup below still ends the drag */
      }
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
    ui.ult.addEventListener('click', () => this.armUltimate())
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
    this.shockwave.clear()
    this.ultCharge = 0
    this.ultArmed = false
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
    this.updateUlt()
  }

  /* ── the ultimate ────────────────────────────────────────────────── */

  get ultReady() {
    return this.ultCharge >= 1
  }

  /**
   * One correct incantation's worth of charge.
   *
   * Cast, not kill — which is the request as made, and also the better rule:
   * charging on kills would pay the player most on the floors where they are
   * already winning, and nothing at all on the one where they are drowning.
   * The meter measures how well you are speaking, because that is the game.
   */
  gainCharge() {
    if (this.ultReady) return
    this.ultCharge = Math.min(1, this.ultCharge + 1 / ULT_CASTS)
    if (this.ultReady) {
      this.sfx.ready()
      this.flashReaction('The wand is full. Loose it when you like.')
    }
    this.updateUlt()
  }

  /** Arm, or think better of it. The next successful cast spends it. */
  armUltimate() {
    if (this.state !== 'playing' || !this.ultReady) return
    this.ultArmed = !this.ultArmed
    this.sfx.arm()
    this.updateUlt()
  }

  updateUlt() {
    const pct = Math.round(this.ultCharge * 100)
    ui.ultFill.style.width = `${pct}%`
    ui.ult.classList.toggle('ready', this.ultReady && !this.ultArmed)
    ui.ult.classList.toggle('armed', this.ultArmed)
    ui.ult.disabled = !this.ultReady
    ui.ultLabel.textContent = this.ultArmed
      ? 'ARMED — SAY THE WORD'
      : this.ultReady
        ? 'ULTIMATE READY — TAP'
        : `ULTIMATE · ${pct}%`
  }

  /** The spell the ultimate rides in on, amplified. Plain data, no cost. */
  amplify(spell) {
    return {
      ...spell,
      damage: Math.round(spell.damage * ULT_BOLT_DAMAGE),
      radius: Math.max(spell.radius, ULT_BOLT_RADIUS),
      knockback: (spell.knockback ?? 0) + 2,
      glow: 0xffffff,
    }
  }

  /**
   * Release: the wave, the flash, and the shove.
   *
   * Born a stride and a half out rather than on the wand, for the same reason
   * the bolts are — at the muzzle the ring is wider than the field of view for
   * its first frames, so the effect opens on a white screen instead of on a
   * ring you can see leaving.
   *
   * No reaction line here on purpose. The spell's own line lands a tenth of a
   * second later when the bolt connects and would simply overwrite it, and
   * between the flash, the sound, the wave and the meter emptying, the game has
   * already said this four times.
   */
  unleash(spell, from, dir) {
    this.shockwave.fire(from.clone().addScaledVector(dir, 3), spell.color, spell.glow)
    this.particles.burst(from.clone().addScaledVector(dir, 2.6), 0xffffff, 30, 8, 0.7, dir)
    this.trauma = 1
    this.sfx.ultimate()
    ui.ultFlash.animate([{ opacity: 0.55 }, { opacity: 0 }], {
      duration: 380,
      easing: 'ease-out',
    })
  }

  /** Everything the wave passes, once each. */
  onSweepHit(enemy, at) {
    this.particles.burst(at, 0xffffff, 20, 6, 0.55)
    const killed = enemy.takeDamage(ULT_DAMAGE)
    enemy.group.position.z -= ULT_KNOCKBACK
    if (killed) this.onKill(enemy)
    else this.score += ULT_DAMAGE
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
    const enemy = new Kind(this.scene, z, lane)
    // So that dispose() gives the lights back wherever it is called from, and
    // there are three such places.
    enemy.rig = this.creatureLights
    this.enemies.push(enemy)
    this.relight()
  }

  /**
   * Give the creature light budget to whatever is closest to the player.
   *
   * Called on every spawn and every death, and never in between: a light that
   * is reassigned while both creatures are alive is a light popping off one
   * shape and onto another, which is far more noticeable than the far one being
   * dim. So a creature keeps what it holds until it dies, and a freed slot goes
   * to the nearest thing walking without one.
   *
   * Creatures come down the corridor from -z toward the camera at z=2, so
   * "nearest" is simply the largest z.
   */
  relight() {
    const rig = this.creatureLights
    if (!rig.spare) return
    const waiting = this.enemies.filter(e => e.alive && e.unlit)
    waiting.sort((a, b) => b.group.position.z - a.group.position.z)
    for (const e of waiting) {
      if (!rig.spare) break
      e.claimLights(rig)
    }
  }

  /**
   * Compile every shader the fight needs while the loading screen is still up.
   *
   * three.js builds a material's program the first time it draws it, so without
   * this the first Dementor of the run costs a compile at the moment it walks
   * into view. One of each kind is built at the far end of the corridor, the
   * renderer is asked to compile the scene as it stands, and they are thrown
   * away — their materials come from the shared kit and the recycled cloak
   * pool, so the programs stay alive for the real ones.
   */
  prewarm() {
    const rehearsal = Object.values(KINDS).map(Kind => new Kind(this.scene, -CORRIDOR.length + 8, 0))
    // `compile` walks the scene with traverseVisible, so anything hidden is
    // skipped and pays for itself later. The shockwave spends its whole life
    // hidden except for the second it is used, and that second is the loudest
    // moment in the game — the worst possible time to stop and build a shader.
    this.shockwave.rehearse(true)
    this.renderer.compile(this.scene, this.camera)
    this.shockwave.rehearse(false)
    for (const e of rehearsal) e.dispose()
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

    // Armed spends here and nowhere else, so an ultimate can only ever be
    // released by saying a word correctly — the button arms it, the incantation
    // fires it. Read before the shot because the shot itself changes.
    const ultimate = this.ultArmed
    if (ultimate) {
      this.ultArmed = false
      this.ultCharge = 0
      this.updateUlt()
    }

    const spell = ultimate ? this.amplify(this.spell) : this.spell
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

    if (ultimate) this.unleash(spell, from, dir)
    else this.gainCharge()

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
    // The bolts and the wave belong to the floor that fired them; left live,
    // they arrive during the interlude and sweep an empty corridor.
    this.projectiles.clear()
    this.shockwave.clear()

    // A breather. See FLOOR_HEAL — a run with no way back up is why this game
    // was over in three floors.
    const before = this.health
    this.health = Math.min(100, this.health + FLOOR_HEAL)
    const rested = Math.round(this.health - before)
    this.updateHud()

    const accuracy = this.attempts ? Math.round((this.landed / this.attempts) * 100) : 100
    $('tally-cast').textContent = this.landed
    $('tally-accuracy').textContent = `${accuracy}%`
    $('tally-best').textContent = this.bestStreak
    ui.interludeTitle.textContent =
      this.waveIndex >= FLOORS.length ? 'STILL STANDING' : 'THE CORRIDOR FALLS SILENT'
    const next = floorSpec(this.waveIndex)
    const harder = this.waveIndex === 1 || this.waveIndex === 3
    const rest = rested > 0 ? ` You catch your breath — ${rested} vitality back.` : ''
    ui.interludeNext.textContent =
      (harder
        ? `Next: ${next.name.toLowerCase()} — and longer words.`
        : `Next: ${next.name.toLowerCase()}.`) + rest
    this.show('interlude')
  }

  endRun() {
    clearTimeout(this._deathTimer)
    // tickPlay stops with the run, and the wave is only advanced from there —
    // left live it hangs in the corridor behind the gameover card.
    this.shockwave.clear()
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
    // Timer, not Clock: three deprecated Clock and warns about it on every
    // load. Timer is read rather than sampled — update() once per frame, then
    // getDelta/getElapsed return that same frame's numbers however often they
    // are asked, which is also how a visual probe freezes the scene for an A/B:
    // simply stop updating it.
    this.timer.update()
    const raw = this.timer.getDelta()
    const dt = Math.min(0.05, raw)
    const t = this.timer.getElapsed()

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
    this.shockwave.update(dt, this.enemies, (enemy, at) => this.onSweepHit(enemy, at))

    let removed = false
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      if (!e.alive) {
        e.dispose()
        this.enemies.splice(i, 1)
        removed = true
        continue
      }
      if (e.update(dt, t, this.camera.position.z)) {
        this.onPlayerHit(e)
        e.alive = false
        e.dispose()
        this.enemies.splice(i, 1)
        removed = true
        continue
      }
      // After update, so the lights land where the model ended the frame
      // rather than a frame behind it.
      e.syncLights()
    }
    if (removed) this.relight()

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
  // ?ult=ready|armed|fired puts the meter in a state a probe or a screenshot
  // needs, which is otherwise seven correct incantations away.
  const ult = params.get('ult')
  if (ult) {
    game.ultCharge = 1
    game.ultArmed = ult === 'armed' || ult === 'fired'
    game.updateUlt()
    if (ult === 'fired') {
      game.casting = false
      game.castCurrent('tap')
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
