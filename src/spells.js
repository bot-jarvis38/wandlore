import * as THREE from 'three'
import { radialSprite } from './textures.js'

/**
 * The wand that fires the spells, and the particle work that sells the hit.
 * Every spell is a colour, a shape of light, and a rule — the incantation is
 * the trigger, so the payoff for saying it has to be loud.
 *
 * The spells themselves moved to `spellbook.js` when the bank went from
 * twenty-one words to a hundred: a thousand lines of data in front of the
 * three.js classes that draw it made both harder to find. Re-exported here so
 * that everything importing `SPELLS` from this file still works.
 */
export { SPELLS, spellsForFloor } from './spellbook.js'

/* ── the wand in your hand ─────────────────────────────────────────── */

export class Wand {
  constructor(camera) {
    this.group = new THREE.Group()
    camera.add(this.group)
    // Held close and barely off-centre. A phone held upright has a narrow
    // horizontal field of view — parked at x=0.3 the wand sat entirely
    // outside the frame and the game looked like it had no first-person hand
    // at all.
    this.group.position.set(0.15, -0.4, -0.72)
    this.group.rotation.set(-0.34, 0.22, -0.2)
    // Scale rather than rebuilt geometry: the wand is authored at a
    // comfortable modelling size, then shrunk to the slice of frame a held
    // object should actually occupy. Full size it read as a lamp-post.
    this.group.scale.setScalar(0.5)

    // The corridor is lit by distant torches, so a wand lit only by them is a
    // black stick. This is the hand-held fill every FPS gives the weapon.
    this.fill = new THREE.PointLight(0xffd2a0, 0.7, 1.1, 2)
    this.fill.position.set(0.1, 0.1, 0.24)
    this.group.add(this.fill)

    const shaftMat = new THREE.MeshStandardMaterial({
      color: 0x4b3020,
      roughness: 0.62,
      metalness: 0.14,
    })
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x3d2418,
      roughness: 0.8,
      metalness: 0.05,
    })

    // tapered holly shaft, built from stacked segments so it isn't a stick
    const shaft = new THREE.Group()
    const segments = 7
    for (let i = 0; i < segments; i++) {
      const t = i / segments
      const r0 = 0.026 - t * 0.015
      const r1 = 0.026 - ((i + 1) / segments) * 0.015
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(r1, r0, 0.076, 10),
        shaftMat
      )
      seg.position.y = 0.07 + i * 0.076
      seg.rotation.z = Math.sin(i * 1.7) * 0.012
      shaft.add(seg)
    }
    this.group.add(shaft)

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.03, 0.16, 12), gripMat)
    grip.position.y = -0.01
    this.group.add(grip)

    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.005, 6, 14), gripMat)
      ring.rotation.x = Math.PI / 2
      ring.position.y = -0.06 + i * 0.05
      this.group.add(ring)
    }

    // the tip: an emissive bead plus its own light, so it lights your hand
    this.tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.019, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff0cf })
    )
    this.tip.position.y = 0.61
    this.group.add(this.tip)

    this.tipGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialSprite('rgba(255,240,207,1)', 'rgba(255,180,80,0)'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    // Small on purpose. At 0.26 the sprite plus bloom rendered as a glowing
    // ball the size of a streetlamp bulb hanging off the end of a stick — the
    // wand read as a torch, not a wand.
    this.tipGlow.scale.set(0.1, 0.1, 1)
    this.tipGlow.position.y = 0.61
    this.group.add(this.tipGlow)

    this.tipLight = new THREE.PointLight(0xffd9a0, 0.5, 1.5, 2)
    this.tipLight.position.y = 0.64
    this.group.add(this.tipLight)

    this.recoil = 0
    this.charge = 0
    this.basePos = this.group.position.clone()
  }

  /** Muzzle position in world space — where a bolt is born. */
  muzzle(target) {
    return this.tip.getWorldPosition(target)
  }

  fire(color) {
    this.recoil = 1
    this.tip.material.color.setHex(color)
    this.tipLight.color.setHex(color)
  }

  update(dt, t, charge) {
    this.charge += (charge - this.charge) * Math.min(1, dt * 8)
    this.recoil = Math.max(0, this.recoil - dt * 4.2)

    const kick = this.recoil * this.recoil
    const breathe = Math.sin(t * 1.6) * 0.006
    const sway = Math.sin(t * 0.9) * 0.008

    this.group.position.set(
      this.basePos.x + sway,
      this.basePos.y + breathe - kick * 0.05,
      this.basePos.z + kick * 0.14
    )
    this.group.rotation.x = -0.3 - kick * 0.5 + Math.sin(t * 1.3) * 0.012
    this.group.rotation.z = -0.16 + Math.cos(t * 1.1) * 0.014

    const pulse = 0.075 + this.charge * 0.075 + kick * 0.26 + Math.sin(t * 6) * 0.008
    this.tipGlow.scale.set(pulse, pulse, 1)
    this.tipLight.intensity = 0.35 + this.charge * 0.7 + kick * 4.5
  }
}

/* ── particles: one pooled buffer for every burst in the game ──────── */

// Scratch vectors: burst() runs dozens of times per impact and allocating a
// Vector3 per particle is how a hit becomes a hitch.
const _v0 = new THREE.Vector3()
const _v1 = new THREE.Vector3()

export class Particles {
  constructor(scene, count = 900) {
    this.count = count
    this.pos = new Float32Array(count * 3)
    this.vel = new Float32Array(count * 3)
    this.col = new Float32Array(count * 3)
    this.life = new Float32Array(count)
    this.maxLife = new Float32Array(count)
    this.cursor = 0

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3))

    // park them far away until used, rather than at the origin
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -9999

    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.15,
        map: radialSprite(),
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      })
    )
    this.points.frustumCulled = false
    scene.add(this.points)
  }

  /**
   * A burst with a direction, because an impact has one.
   *
   * The old version scattered every particle evenly over a sphere, which is
   * the definition of the defect three judges independently named: "an
   * undirected white blob", "a floating cotton-ball cloud". A real hit sprays
   * *back along the way the shot came*, in a cone, with a few fast pieces
   * outrunning the rest — that shape is what tells the eye something struck
   * something, and no amount of glow substitutes for it.
   *
   * `back` is the direction the spray should favour (typically the reverse of
   * the projectile's travel). Omit it and the old even scatter is used, which
   * is still right for an ambient puff with no impact behind it.
   */
  burst(origin, color, amount, spread = 6, life = 0.7, back = null) {
    const c = new THREE.Color(color)
    const axis = back ? _v0.copy(back).normalize() : null
    for (let n = 0; n < amount; n++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % this.count
      this.pos[i * 3] = origin.x
      this.pos[i * 3 + 1] = origin.y
      this.pos[i * 3 + 2] = origin.z

      const dir = _v1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
      if (axis) {
        // Pulled toward the impact axis rather than replaced by it: a cone
        // still needs spread, or it reads as a laser instead of a splash.
        dir.lerp(axis, 0.55 + Math.random() * 0.3).normalize()
      }
      // A tenth of the particles are three times as fast. They become the
      // streaks that give the burst its edge — without them every piece
      // travels at the same rate and the whole thing expands as a soft ball.
      const streak = n % 10 === 0 ? 3.1 : 1
      dir.multiplyScalar(spread * (0.35 + Math.random() * 0.65) * streak)

      this.vel[i * 3] = dir.x
      this.vel[i * 3 + 1] = dir.y
      this.vel[i * 3 + 2] = dir.z
      // Hotter at the core, cooler at the fringe, so the spray has a gradient
      // instead of being one flat colour throughout.
      const tint = streak > 1 ? 1.35 : 0.55 + Math.random() * 0.45
      this.col[i * 3] = c.r * tint
      this.col[i * 3 + 1] = c.g * tint
      this.col[i * 3 + 2] = c.b * tint
      this.life[i] = life * (streak > 1 ? 0.45 : 0.6 + Math.random() * 0.6)
      this.maxLife[i] = this.life[i]
    }
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -9999
        continue
      }
      const drag = Math.pow(0.12, dt)
      this.vel[i * 3] *= drag
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - 2.4 * dt
      this.vel[i * 3 + 2] *= drag
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      const fade = this.life[i] / this.maxLife[i]
      this.col[i * 3] *= 0.94 + fade * 0.06
      this.col[i * 3 + 1] *= 0.93 + fade * 0.07
      this.col[i * 3 + 2] *= 0.93 + fade * 0.07
    }
    this.points.geometry.attributes.position.needsUpdate = true
    this.points.geometry.attributes.color.needsUpdate = true
  }
}

/* ── the bolts themselves ──────────────────────────────────────────── */

export class Projectiles {
  constructor(scene, particles, rig) {
    this.scene = scene
    this.particles = particles
    /**
     * Where a bolt's light comes from. It used to own one outright, parented to
     * the bolt group and added to the scene on every cast — which changed the
     * scene's light count twice per shot, and a changed light count recompiles
     * every shader in the scene mid-frame. That was the stutter on firing. The
     * rig's lights are always in the scene; a bolt borrows one and gives it
     * back. See `lights.js`.
     */
    this.rig = rig
    this.live = []
    this.trailTex = radialSprite()
    /**
     * Bolts are the highest-churn object in the game — one per cast, gone
     * within three seconds — and each one used to be built from scratch and
     * then abandoned: a sphere, three materials and a light per shot, removed
     * from the scene on expiry and never freed. Pooled instead. A bolt is a
     * bolt; only its colour and position differ, and those are cheap to set.
     */
    this.pool = []
    this.coreGeo = new THREE.SphereGeometry(0.11, 12, 12)
  }

  /** A bolt shell, from the pool if there is one going spare. */
  acquire() {
    const spare = this.pool.pop()
    if (spare) return spare

    const group = new THREE.Group()
    const core = new THREE.Mesh(this.coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }))
    group.add(core)

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.trailTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    halo.scale.set(0.9, 0.9, 1)
    group.add(halo)

    // a stretched sprite behind the core reads as speed
    const streak = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.trailTex,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    streak.scale.set(0.38, 2.2, 1)
    group.add(streak)

    return { group, core, halo, streak, light: null, hits: new Set(), dir: new THREE.Vector3() }
  }

  spawn(spell, from, direction) {
    const b = this.acquire()
    b.group.position.copy(from)
    b.core.material.color.setHex(spell.glow)
    b.halo.material.color.setHex(spell.color)
    b.streak.material.color.setHex(spell.color)
    // Null when every bolt light is already out on a shot in flight. The core,
    // halo and streak are all emissive, so a bolt without one still reads as a
    // bolt — it just stops lighting the walls it passes.
    b.light = this.rig.claim(spell.color, 6, 8)
    if (b.light) b.light.position.copy(from)
    b.dir.copy(direction).normalize()
    b.hits.clear()
    b.spell = spell
    b.age = 0

    this.scene.add(b.group)
    this.live.push(b)
  }

  /** Off the screen and back on the shelf, light included. */
  retire(b) {
    this.scene.remove(b.group)
    this.rig.release(b.light)
    b.light = null
    this.pool.push(b)
  }

  update(dt, enemies, onHit) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i]
      b.age += dt
      b.group.position.addScaledVector(b.dir, b.spell.speed * dt)
      b.halo.scale.setScalar(0.85 + Math.sin(b.age * 24) * 0.14)
      if (b.light) {
        b.light.position.copy(b.group.position)
        b.light.intensity = 5.5 + Math.sin(b.age * 30) * 1.4
      }

      this.particles.burst(b.group.position, b.spell.color, 2, 0.9, 0.22)

      let consumed = false
      for (const enemy of enemies) {
        if (!enemy.alive || b.hits.has(enemy.id)) continue
        if (b.group.position.distanceTo(enemy.hitPoint()) < enemy.radius + 0.5) {
          b.hits.add(enemy.id)
          // The spray needs to know which way the shot came from, or it comes
          // out as an even ball — the exact defect this was rewritten to fix.
          onHit(b.spell, enemy, b.group.position.clone(), b.dir.clone().negate())
          if (!b.spell.pierce) consumed = true
          break
        }
      }

      if (consumed || b.age > 2.6 || b.group.position.z < -100) {
        this.retire(b)
        this.live.splice(i, 1)
      }
    }
  }

  clear() {
    for (const b of this.live) this.retire(b)
    this.live.length = 0
  }
}

/* ── the ultimate: one wave, the whole corridor ────────────────────── */

/** How far down the corridor the wave reaches before it dies, in metres. */
const SWEEP_REACH = 27
/** And how fast it gets there. */
const SWEEP_SPEED = 30
/** Widest the ring grows. The corridor is 6.2m across, so this fills it. */
const SWEEP_RADIUS = 3.3
/**
 * And where its centre sits: the middle of a 6.4m corridor, not the height of
 * the wand. Born at the muzzle the lower half of the ring is under the floor
 * and what you see is an arch, which reads as scenery — a doorway going past —
 * rather than a ring of force filling the passage.
 */
const SWEEP_HEIGHT = 3.1

/**
 * The payoff for filling the meter: a ring of force that leaves the wand and
 * runs the length of the corridor, hitting everything it passes.
 *
 * A ring rather than a bigger bolt, on purpose. An ultimate that still has to
 * be aimed can be missed, and a thing you spent seven correct incantations
 * earning must not be missable — the seven casts are the skill, the release is
 * the reward. It also gives the effect a shape the eye can follow: a bolt
 * scaled up is just a brighter bolt, while a front sweeping away from you
 * reads as the corridor being cleared, which is what actually happened.
 *
 * Built once, at boot, and never rebuilt. Everything here obeys the rule in
 * lights.js: nothing joins or leaves the scene, the light comes from the rig,
 * and `prewarm` compiles the material behind the loading screen — otherwise
 * the first ultimate of the run would pay for a shader compile at the exact
 * moment the game is trying to look expensive.
 */
export class Shockwave {
  constructor(scene, particles, rig) {
    this.particles = particles
    this.rig = rig
    this.light = null
    this.age = 0
    this.life = 0

    this.group = new THREE.Group()
    this.group.visible = false
    scene.add(this.group)

    const ringMat = () =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })

    // Two rings: a hard bright front and a softer one trailing it. One ring
    // alone reads as a hoop; two read as a shock passing through.
    this.front = new THREE.Mesh(new THREE.TorusGeometry(1, 0.055, 8, 56), ringMat())
    this.trail = new THREE.Mesh(new THREE.TorusGeometry(1, 0.15, 8, 40), ringMat())
    this.group.add(this.front, this.trail)

    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialSprite(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    this.group.add(this.flash)

    this.hits = new Set()
  }

  /** Visible for one compile, so the first real one costs nothing. */
  rehearse(on) {
    this.group.visible = on
    if (on) this.group.position.set(0, 1.7, -6)
  }

  get busy() {
    return this.age < this.life
  }

  fire(origin, color, glow) {
    this.hits.clear()
    this.age = 0
    this.life = SWEEP_REACH / SWEEP_SPEED
    this.startZ = origin.z
    this.group.position.set(0, SWEEP_HEIGHT, origin.z)
    this.group.visible = true
    this.front.material.color.setHex(glow)
    this.trail.material.color.setHex(color)
    this.flash.material.color.setHex(color)
    this.light = this.rig.claim(glow, 9, 24)
    if (this.light) this.light.position.copy(this.group.position)
  }

  /**
   * `onSweep(enemy, at)` fires once per creature, the moment the front reaches
   * it. Damage is the game's business, not the effect's.
   */
  update(dt, enemies, onSweep) {
    if (!this.busy) return
    this.age += dt
    const k = Math.min(1, this.age / this.life)

    this.group.position.z = this.startZ - SWEEP_SPEED * this.age
    // Opens fast and keeps widening, so it looks like it is being pushed out
    // rather than inflated at a constant rate.
    const radius = 0.7 + SWEEP_RADIUS * Math.pow(k, 0.55)
    const fade = Math.pow(1 - k, 1.6)

    this.front.scale.setScalar(radius)
    this.trail.scale.setScalar(radius * 0.82)
    this.front.material.opacity = 0.95 * fade
    this.trail.material.opacity = 0.5 * fade
    this.front.rotation.z += dt * 2.4
    this.trail.rotation.z -= dt * 1.6
    // The core glow, kept deliberately small and short. The first version
    // scaled it to 2.6× the ring and held it at 0.45 — an additive white sprite
    // that size, a metre and a half from the lens and sitting well above the
    // bloom threshold, does not read as a glow behind the ring. It turns the
    // whole frame milky and the ring stops being a ring at all.
    this.flash.scale.setScalar(radius * 1.15)
    this.flash.material.opacity = 0.3 * Math.pow(1 - k, 3)

    if (this.light) {
      this.light.position.copy(this.group.position)
      this.light.intensity = 9 * fade
    }

    // A little debris on the way through, so the wave interacts with the room.
    // Every third frame, not every frame — at 60fps the wave otherwise lays
    // down a hundred additive sprites in under a second and the corridor fills
    // with what looks like snow.
    this._debris = (this._debris ?? 0) + 1
    if (this._debris % 3 === 0) {
      _v0.set((Math.random() - 0.5) * 5, 0.6 + Math.random() * 3.4, this.group.position.z)
      this.particles.burst(_v0, this.front.material.color.getHex(), 2, 3.6, 0.4)
    }

    for (const e of enemies) {
      if (!e.alive || this.hits.has(e.id)) continue
      // The front has gone past it. Creatures walk toward the camera from -z,
      // and the wave runs the other way, so "passed" is the front being at or
      // beyond the creature's own z.
      if (this.group.position.z <= e.group.position.z) {
        this.hits.add(e.id)
        onSweep(e, e.hitPoint(new THREE.Vector3()))
      }
    }

    if (!this.busy) this.clear()
  }

  clear() {
    this.group.visible = false
    this.age = 0
    this.life = 0
    this.hits.clear()
    this.rig.release(this.light)
    this.light = null
  }
}
