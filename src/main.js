import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import './style.css'
import { buildWorld, CORRIDOR } from './world.js'
import { SPELLS, Wand, Particles, Projectiles } from './spells.js'
import { Dementor, Armour, Pixie } from './enemies.js'
import { VoiceListener, scoreUtterance, speechSupported, MATCH_THRESHOLD } from './voice.js'

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
  health: $('health-fill'),
  score: $('score'),
  waveLabel: $('wave-label'),
  micState: $('mic-state'),
  micText: $('mic-text'),
  castButton: $('cast-button'),
  damageFlash: $('damage-flash'),
}

/* ── waves ─────────────────────────────────────────────────────────── */

const WAVES = [
  { name: 'THE GRAND STAIRCASE', pattern: [['Dementor', 2], ['Pixie', 3]], gap: 2.2 },
  { name: 'THE CHARMS CORRIDOR', pattern: [['Pixie', 5], ['Armour', 2]], gap: 1.9 },
  { name: 'THE TROPHY ROOM', pattern: [['Armour', 3], ['Dementor', 3]], gap: 1.7 },
  { name: 'THE ASTRONOMY STAIR', pattern: [['Pixie', 6], ['Dementor', 4], ['Armour', 3]], gap: 1.45 },
  { name: 'THE FORBIDDEN FLOOR', pattern: [['Dementor', 6], ['Armour', 5], ['Pixie', 6]], gap: 1.2 },
]

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
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
    this.composer.setSize(w, h)
    this.bloom.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
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
    this.currentWave = WAVES[0]
    this.updateHud()
  }

  startWave(index) {
    const wave = WAVES[Math.min(index, WAVES.length - 1)]
    const scale = 1 + Math.max(0, index - WAVES.length + 1) * 0.4
    this.currentWave = wave
    this.spawnQueue = []
    for (const [kind, count] of wave.pattern) {
      for (let i = 0; i < Math.round(count * scale); i++) this.spawnQueue.push(kind)
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
    const pool = SPELLS.filter(s => s !== this.spell)
    this.spell = pool[Math.floor(Math.random() * pool.length)]
    this.castWindow = Math.max(2.6, 5.4 - this.waveIndex * 0.35)
    this.castLeft = this.castWindow
    ui.word.textContent = this.spell.word
    ui.incantation.classList.remove('success', 'fail')
    ui.heard.textContent = ''
  }

  /* ── casting ─────────────────────────────────────────────────────── */

  onHeard(transcript, isFinal) {
    if (this.state !== 'playing' || !this.spell) return
    const score = scoreUtterance(transcript, this.spell)
    ui.heard.textContent = `“${transcript.trim()}”`
    if (score >= MATCH_THRESHOLD) {
      this.castCurrent('voice')
    } else if (isFinal && transcript.trim().length > 2) {
      this.attempts++
      ui.incantation.classList.add('fail')
      setTimeout(() => ui.incantation.classList.remove('fail'), 340)
      this.sfx.fizzle()
    }
  }

  castCurrent(source) {
    if (this.state !== 'playing' || !this.spell) return
    // With a working mic the spoken word is the only trigger — otherwise the
    // tap button quietly becomes the better way to play and the game stops
    // being a voice game.
    if ((source === 'tap' || source === 'key') && !this.silentMode) return

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
    this.particles.burst(origin, spell.glow, 16, 2.6, 0.35)
    this.trauma = Math.min(1, this.trauma + 0.22)
    this.sfx.cast()

    ui.incantation.classList.add('success')
    setTimeout(() => ui.incantation.classList.remove('success'), 240)
    this.nextSpell()
  }

  onSpellHit(spell, enemy, at) {
    this.sfx.impact()
    this.particles.burst(at, spell.color, 34, 7, 0.65)
    this.trauma = Math.min(1, this.trauma + 0.16)

    const killed = enemy.takeDamage(spell.damage)

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
    this.health = Math.max(0, this.health - enemy.damage)
    this.streak = 0
    this.trauma = 1
    this.sfx.hurt()
    ui.damageFlash.animate([{ opacity: 0.9 }, { opacity: 0 }], {
      duration: 620,
      easing: 'ease-out',
    })
    this.updateHud()
    if (this.health <= 0) this.endRun()
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
      this.voice.start()
    }

    ui.castButton.classList.toggle('hidden', !this.silentMode)
    ui.micState.classList.toggle('muted', this.silentMode)
    ui.micText.textContent = this.silentMode ? 'SILENT' : 'LISTENING'

    this.resetRun()
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
      this.waveIndex >= WAVES.length ? 'STILL STANDING' : 'THE CORRIDOR FALLS SILENT'
    ui.interludeNext.textContent = `Next: ${WAVES[
      Math.min(this.waveIndex, WAVES.length - 1)
    ].name.toLowerCase()}.`
    this.show('interlude')
  }

  endRun() {
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

  onVoiceState(state) {
    if (this.silentMode) return
    ui.micText.textContent =
      state === 'listening' ? 'LISTENING' : state === 'denied' ? 'MUTED' : 'RE-LISTENING'
    ui.micState.classList.toggle('muted', state === 'denied')
  }

  /* ── frame ───────────────────────────────────────────────────────── */

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta())
    const t = this.clock.elapsedTime

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

    this.castLeft -= dt
    ui.castFill.style.transform = `scaleX(${Math.max(0, this.castLeft / this.castWindow)})`
    if (this.castLeft <= 0) {
      this.streak = 0
      this.sfx.fizzle()
      ui.incantation.classList.add('fail')
      setTimeout(() => ui.incantation.classList.remove('fail'), 340)
      this.nextSpell()
    }

    this.projectiles.update(dt, this.enemies, (spell, enemy, at) =>
      this.onSpellHit(spell, enemy, at)
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
