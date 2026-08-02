import * as THREE from 'three'
import { radialSprite } from './textures.js'

/**
 * Spells, the wand that fires them, and the particle work that sells the hit.
 * Every spell is a colour, a shape of light, and a rule — the incantation is
 * the trigger, so the payoff for saying it has to be loud.
 */

/**
 * `tier` is how hard the word is to say, not how strong the spell is — 1 is a
 * word you can bark, 3 is a mouthful you will fumble the first three times.
 * The game ramps tiers with the floor, so the difficulty curve is your tongue.
 *
 * `effect` is the funny one. A spell that only subtracts a number is a number;
 * these do something visible and stupid to the thing in front of you, and
 * `reaction` is the line that flashes when it lands.
 */
export const SPELLS = [
  /* ── tier 1: short, barkable ─────────────────────────────────────── */
  {
    word: 'STUPEFY',
    tier: 1,
    spoken: ['stupefy', 'stupify', 'stupefied', 'stupa fy', 'stew pify', 'to pacify'],
    color: 0xff3b30,
    glow: 0xff8a6a,
    damage: 34,
    speed: 46,
    radius: 0,
    note: 'a red bolt, straight to the chest',
    reaction: 'It drops like a sack of bricks.',
  },
  {
    word: 'INCENDIO',
    tier: 1,
    spoken: ['incendio', 'in cendio', 'insendio', 'in send io', 'incendia', 'in san diego'],
    color: 0xff6a1a,
    glow: 0xffb066,
    damage: 22,
    speed: 34,
    radius: 3.4,
    burn: true,
    note: 'a gout of flame that keeps burning',
    reaction: 'Something back there is on fire now.',
  },
  {
    word: 'BOMBARDA',
    tier: 1,
    spoken: ['bombarda', 'bombardo', 'bomb arda', 'bombarder', 'bum barda', 'bomb barda'],
    color: 0xbfe8ff,
    glow: 0xffffff,
    damage: 48,
    speed: 30,
    radius: 4.6,
    note: 'blast radius, so aim into the crowd',
    reaction: 'The corridor rearranges itself.',
  },
  {
    word: 'REDUCTO',
    tier: 1,
    spoken: ['reducto', 'reductor', 'reduce toe', 'reduct o', 'ridotto', 'red duct o'],
    color: 0xc07bff,
    glow: 0xe4c4ff,
    damage: 40,
    speed: 62,
    radius: 0,
    pierce: true,
    note: 'punches through everything in the lane',
    reaction: 'Straight through. And through the next one.',
  },
  {
    word: 'DIFFINDO',
    tier: 1,
    spoken: ['diffindo', 'difindo', 'diff indo', 'defiendo', 'the fiendo'],
    color: 0x9ef0d0,
    glow: 0xdffff2,
    damage: 30,
    speed: 58,
    radius: 0,
    note: 'a clean severing charm',
    reaction: 'Cut neatly in half. Both halves look annoyed.',
  },
  {
    word: 'CONFRINGO',
    tier: 1,
    spoken: ['confringo', 'con fringo', 'confringe o', 'kon fringo', 'con flamingo'],
    color: 0xffa23d,
    glow: 0xffe0b0,
    damage: 38,
    speed: 40,
    radius: 3.8,
    note: 'the blasting curse',
    reaction: 'Everything nearby is briefly airborne.',
  },
  {
    // Not REDUCIO, which is the canon shrinking charm — one letter from
    // REDUCTO, already in this list. Two words that differ by a letter are a
    // scoring coin-flip, and losing a coin-flip reads as a broken engine.
    word: 'DIMINUENDO',
    tier: 1,
    spoken: ['diminuendo', 'diminuento', 'dimin uendo', 'diminuendo', 'the minuendo'],
    color: 0x7fd8ff,
    glow: 0xd9f4ff,
    damage: 10,
    speed: 52,
    radius: 0,
    effect: 'shrink',
    note: 'shrinks it to something you can step on',
    reaction: 'It is now the size of a teapot and furious about it.',
  },

  /* ── tier 2: the ones you have to slow down for ──────────────────── */
  {
    word: 'EXPELLIARMUS',
    tier: 2,
    spoken: [
      'expelliarmus', 'expeliarmus', 'expelly armus', 'expel he armus',
      'a spell he armas', 'expel yarmouth', 'expel the armors',
    ],
    color: 0xffc23d,
    glow: 0xffe6a0,
    damage: 26,
    speed: 54,
    radius: 2.4,
    knockback: 7,
    note: 'disarms, and throws them back',
    reaction: 'Disarmed, and sent back down the corridor.',
  },
  {
    word: 'IMPEDIMENTA',
    tier: 2,
    spoken: ['impedimenta', 'impediment a', 'impediment', 'impede a menta', 'in pedimenta'],
    color: 0x8fd0ff,
    glow: 0xdbefff,
    damage: 16,
    speed: 50,
    radius: 3.0,
    effect: 'freeze',
    note: 'stops it dead where it stands',
    reaction: 'Frozen mid-stride, one foot still up.',
  },
  {
    word: 'LEVICORPUS',
    tier: 2,
    spoken: ['levicorpus', 'levi corpus', 'levy corpus', 'levi corpse', 'heavy corpus'],
    color: 0xc9f0ff,
    glow: 0xffffff,
    damage: 14,
    speed: 48,
    radius: 0,
    effect: 'levitate',
    note: 'hoists it into the air by the ankle',
    reaction: 'Hanging upside down by one ankle, flailing.',
  },
  {
    word: 'RICTUSEMPRA',
    tier: 2,
    spoken: ['rictusempra', 'rictus empra', 'rictus sempra', 'rick to sempra', 'ricky sempra'],
    color: 0xffe27a,
    glow: 0xfff6d0,
    damage: 12,
    speed: 56,
    radius: 0,
    effect: 'laugh',
    note: 'the tickling charm',
    reaction: 'It doubles over laughing. It cannot advance while laughing.',
  },
  {
    word: 'ENGORGIO',
    tier: 2,
    spoken: ['engorgio', 'en gorgio', 'in gorgio', 'and gorgio', 'in georgia'],
    color: 0xff8fd0,
    glow: 0xffd6ee,
    damage: 18,
    speed: 44,
    radius: 0,
    effect: 'grow',
    note: 'inflates it until it is a liability',
    reaction: 'Now enormous, slow, and extremely easy to hit.',
  },
  {
    word: 'FURNUNCULUS',
    tier: 2,
    spoken: ['furnunculus', 'fur nunculus', 'furuncle us', 'fernunculus', 'for uncle us'],
    color: 0x9fe07a,
    glow: 0xdcf7c4,
    damage: 28,
    speed: 46,
    radius: 2.2,
    note: 'covers it in boils',
    reaction: 'Boils. Everywhere. It has stopped caring about you.',
  },
  {
    word: 'EXPECTO PATRONUM',
    tier: 2,
    spoken: [
      'expecto patronum', 'expecto patronium', 'expect o patronum',
      'expecto patron', 'expect a patronum', 'espresso patronum',
    ],
    color: 0xdff4ff,
    glow: 0xffffff,
    damage: 30,
    speed: 26,
    radius: 7.5,
    note: 'a stag of light — clears the corridor',
    reaction: 'A stag of light goes through the lot of them.',
  },

  /* ── tier 3: tongue-twisters ─────────────────────────────────────── */
  {
    word: 'TARANTALLEGRA',
    tier: 3,
    spoken: [
      'tarantallegra', 'tarantella gra', 'tarantula legra', 'tarantallegro',
      'tarantella allegra', 'tarantula allegra',
    ],
    color: 0xff6ad5,
    glow: 0xffd4f2,
    damage: 14,
    speed: 50,
    radius: 2.6,
    effect: 'dance',
    note: 'makes its legs dance without permission',
    reaction: 'Its legs have started dancing. The rest of it disapproves.',
  },
  {
    word: 'PETRIFICUS TOTALUS',
    tier: 3,
    spoken: [
      'petrificus totalus', 'petrificus totalis', 'petrify us totalus',
      'pacificus totalus', 'petrificus total us', 'terrific is totalus',
    ],
    color: 0xa8b8d8,
    glow: 0xe6eeff,
    damage: 26,
    speed: 44,
    radius: 0,
    effect: 'freeze',
    note: 'full body-bind',
    reaction: 'Rigid as a plank. Falls over like one too.',
  },
  {
    word: 'LOCOMOTOR MORTIS',
    tier: 3,
    spoken: [
      'locomotor mortis', 'loco motor mortis', 'locomotive mortis',
      'locomotor morris', 'loco motor mortise',
    ],
    color: 0x7ad4ff,
    glow: 0xd6f2ff,
    damage: 20,
    speed: 52,
    radius: 0,
    effect: 'trip',
    note: 'locks the legs together',
    reaction: 'Legs glued shut. It topples like a felled tree.',
  },
  {
    word: 'WINGARDIUM LEVIOSA',
    tier: 3,
    spoken: [
      'wingardium leviosa', 'wingardium leviosar', 'win gardium leviosa',
      'wing hard him leviosa', 'wingardium levio sa', 'wing garden leviosa',
    ],
    color: 0xdfe8ff,
    glow: 0xffffff,
    damage: 12,
    speed: 40,
    radius: 2.0,
    effect: 'levitate',
    note: "it's leviOsa, not levioSA",
    reaction: 'Up it goes, slowly, looking betrayed.',
  },
  {
    word: 'SLUGULUS ERUCTO',
    tier: 3,
    spoken: [
      'slugulus eructo', 'sluggulus eructo', 'slug u lus eructo',
      'slugulus erupto', 'slug list eructo', 'sluggish eructo',
    ],
    color: 0x8fd67a,
    glow: 0xd8f5c8,
    damage: 24,
    speed: 38,
    radius: 0,
    effect: 'laugh',
    note: 'the slug-vomiting charm, regrettably',
    reaction: 'It is now producing slugs. Steadily. It has given up on you.',
  },
  {
    word: 'ANTEOCULATIA',
    tier: 3,
    spoken: [
      'anteoculatia', 'ante oculatia', 'anti oculatia', 'anteo culatia',
      'auntie oculatia', 'ante ocular tia',
    ],
    color: 0xc8a2ff,
    glow: 0xeadcff,
    damage: 22,
    speed: 46,
    radius: 0,
    effect: 'grow',
    note: 'grows antlers on it',
    reaction: 'It has antlers now. It keeps catching them on the walls.',
  },
  {
    word: 'OPPUGNO MAXIMA',
    tier: 3,
    spoken: [
      'oppugno maxima', 'oppugno maximus', 'opugno maxima', 'oh pugno maxima',
      'a pug no maxima', 'oppugno maximum',
    ],
    color: 0xffd27a,
    glow: 0xfff0cc,
    damage: 36,
    speed: 44,
    radius: 5.2,
    knockback: 4,
    note: 'sets the whole corridor on them',
    reaction: 'Everything loose in the corridor picks a side, and it is yours.',
  },
]

/** Spells whose word is short enough to bark under pressure. */
export function spellsForFloor(floor) {
  // Floor 1 is tier 1 only; tier 2 joins at floor 2, tier 3 at floor 4. After
  // that everything is in the bag and the tongue-twisters get more likely.
  const maxTier = floor >= 4 ? 3 : floor >= 2 ? 2 : 1
  const pool = SPELLS.filter(s => s.tier <= maxTier)
  if (maxTier < 3) return pool
  // Weight the hard ones up as the floors climb, so late game is a mouthful.
  const extra = Math.min(3, Math.floor((floor - 4) / 2))
  return pool.concat(...Array.from({ length: extra }, () => SPELLS.filter(s => s.tier === 3)))
}

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

  burst(origin, color, amount, spread = 6, life = 0.7) {
    const c = new THREE.Color(color)
    for (let n = 0; n < amount; n++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % this.count
      this.pos[i * 3] = origin.x
      this.pos[i * 3 + 1] = origin.y
      this.pos[i * 3 + 2] = origin.z
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      )
        .normalize()
        .multiplyScalar(spread * (0.35 + Math.random() * 0.65))
      this.vel[i * 3] = dir.x
      this.vel[i * 3 + 1] = dir.y
      this.vel[i * 3 + 2] = dir.z
      const tint = 0.75 + Math.random() * 0.25
      this.col[i * 3] = c.r * tint
      this.col[i * 3 + 1] = c.g * tint
      this.col[i * 3 + 2] = c.b * tint
      this.life[i] = life * (0.6 + Math.random() * 0.6)
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
  constructor(scene, particles) {
    this.scene = scene
    this.particles = particles
    this.live = []
    this.trailTex = radialSprite()
  }

  spawn(spell, from, direction) {
    const group = new THREE.Group()
    group.position.copy(from)

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 12),
      new THREE.MeshBasicMaterial({ color: spell.glow })
    )
    group.add(core)

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.trailTex,
        color: spell.color,
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
        color: spell.color,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    streak.scale.set(0.38, 2.2, 1)
    group.add(streak)

    const light = new THREE.PointLight(spell.color, 6, 8, 2)
    group.add(light)

    this.scene.add(group)
    this.live.push({
      spell,
      group,
      halo,
      light,
      dir: direction.clone().normalize(),
      age: 0,
      hits: new Set(),
    })
  }

  update(dt, enemies, onHit) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i]
      b.age += dt
      b.group.position.addScaledVector(b.dir, b.spell.speed * dt)
      b.halo.scale.setScalar(0.85 + Math.sin(b.age * 24) * 0.14)
      b.light.intensity = 5.5 + Math.sin(b.age * 30) * 1.4

      this.particles.burst(b.group.position, b.spell.color, 2, 0.9, 0.22)

      let consumed = false
      for (const enemy of enemies) {
        if (!enemy.alive || b.hits.has(enemy.id)) continue
        if (b.group.position.distanceTo(enemy.hitPoint()) < enemy.radius + 0.5) {
          b.hits.add(enemy.id)
          onHit(b.spell, enemy, b.group.position.clone())
          if (!b.spell.pierce) consumed = true
          break
        }
      }

      if (consumed || b.age > 2.6 || b.group.position.z < -100) {
        this.scene.remove(b.group)
        this.live.splice(i, 1)
      }
    }
  }

  clear() {
    for (const b of this.live) this.scene.remove(b.group)
    this.live.length = 0
  }
}
