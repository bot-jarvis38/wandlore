import * as THREE from 'three'
import { radialSprite } from './textures.js'
import { buildMaterials } from './textures.js'

/**
 * Three things come down the corridor. Each one has a silhouette you can read
 * at a glance in the dark, its own light so it never sinks into the fog, and a
 * movement rule that makes it a different problem to solve.
 */

let nextId = 1

/**
 * A bright edge around a shape, so it reads against the dark.
 *
 * Three independent judges compared this game's combat screens against shipped
 * first-person magic games and all three named the same defect first: the
 * enemies are flat black shapes you cannot make out. They were right, and the
 * cause is that a corridor lit only by distant torches puts almost no light on
 * anything walking down it — the creatures each carry a lamp, but a lamp inside
 * a model lights the room, not the model.
 *
 * The first attempt at this drew a slightly larger inside-out copy of the mesh
 * behind the original, so the sliver poking past became an outline. It is a
 * real technique and it was the wrong one here, for a reason worth keeping:
 * scaling a mesh up widens the gap in proportion to how far each vertex sits
 * from the model's origin. On a three-and-a-half metre cloak the hem ended up
 * with a hand-width white band while the head, a small sphere at its own
 * centre, got a perfectly even ring. Read together they looked like a sticker —
 * cheaper than the flat silhouette they replaced.
 *
 * This is what the effect is actually supposed to be: light that grazes. The
 * glow is computed per pixel from how far the surface has turned away from the
 * camera, so it is absent where a surface faces you and brightest exactly along
 * the silhouette, with a real falloff between. It rides the mesh's own normals,
 * which means it follows the Dementor's cloak as its vertices move each frame,
 * and it needs no second mesh to draw.
 */
function rimLight(material, color, strength = 0.5, power = 3.2) {
  // Held out here rather than created inside onBeforeCompile so the same
  // objects survive on the material after it compiles. That makes the effect
  // tunable from outside — `tools/probe-rim.mjs` sweeps `power` on the live
  // build and photographs each setting, which is the only honest way to pick a
  // number for something whose whole job is how it looks.
  const uniforms = {
    rimColor: { value: new THREE.Color(color) },
    rimStrength: { value: strength },
    rimPower: { value: power },
  }
  material.userData.rim = uniforms

  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 rimColor;
         uniform float rimStrength;
         uniform float rimPower;`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
         gl_FragColor.rgb += rimColor * pow(1.0 - facing, rimPower) * rimStrength;`
      )
  }
  material.needsUpdate = true
  return material
}

/**
 * How hard the graze reads, and how tightly it hugs the silhouette.
 *
 * One pair of numbers rather than two nearly-identical pairs, because they are
 * the knob for a specific complaint — "the monsters look blurry" — and a knob
 * you have to turn in two places gets turned in one.
 *
 * `power` is the exponent on the facing term: it sets how fast the glow dies as
 * a surface turns back toward the camera. Low spreads it over the whole
 * creature as a haze; high pins it to the outline. `strength` is how bright
 * that is.
 *
 * These two were picked by photographing the live build at each setting with
 * the scene frozen and handing the captures to judges who did not build it and
 * were not told which was which (`tools/probe-rim.mjs`, TC-4). The result was
 * not what anyone predicted, so it is worth writing down properly:
 *
 *   Widening the glow was NOT the blur. The obvious fix — tighten the falloff
 *   and leave the brightness alone — was tested first and judged WORSE, twice,
 *   by two judges who never saw each other's answer. The reason is that in a
 *   corridor this dark the rim is not a highlight on top of the lighting, it IS
 *   the lighting: the gradient across the cloak is the only thing separating
 *   one fold panel from the next. Tighten it without raising it and the folds
 *   stop being distinguishable, the creature collapses into one flat dark mass,
 *   and *that* reads as out of focus.
 *
 * So: tight AND bright. The falloff hugs the silhouette, and the edge is lit
 * hard enough to still describe the form. Judged sharper AND easier to find
 * against the dark than what shipped, which is the pair the wide setting was
 * trying and failing to satisfy at once.
 */
const RIM_STRENGTH = 0.9
const RIM_POWER = 6.0

/* ── the build kit ─────────────────────────────────────────────────── */

/**
 * Every part that is the same on every creature of a kind, built once.
 *
 * This is not a micro-optimisation, it is the fix for "it gets laggier the
 * longer you play". Each creature used to allocate its own cone, spheres,
 * capsules, materials and — via `radialSprite` — its own 128×128 GPU texture at
 * birth, and `dispose()` freed none of it: it removed the group from the scene
 * and left everything the group was made of on the GPU with nothing pointing at
 * it. Measured over 96 kills that was 560 geometries and 56 textures still
 * held (`tools/probe-leak.mjs`), climbing for as long as the floors keep
 * coming, which they do forever.
 *
 * Removing the need to free something is a better fix than remembering to free
 * it, so almost everything lives here and is shared. What genuinely cannot be —
 * a geometry whose vertices are pushed around per frame, a material whose
 * colour is driven per instance — is created per creature and listed in
 * `this.owned`, which dispose() empties for real.
 *
 * Built lazily rather than at module load: `buildMaterials()` draws canvases,
 * and doing that at import time would run it before the loading screen is up.
 */
let kit = null

function buildKit() {
  if (kit) return kit

  const steel = buildMaterials().pewter.clone()
  steel.color.setHex(0x9aa0ab)
  // warm, because the only thing lighting this corridor is torches
  rimLight(steel, 0xffa055, RIM_STRENGTH, RIM_POWER)

  kit = {
    steel,
    hollow: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    bone: new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 0.9 }),
    visor: new THREE.MeshBasicMaterial({ color: 0xff5a2a }),
    plume: new THREE.MeshStandardMaterial({ color: 0x7a1d1d, roughness: 0.9 }),
    pixie: new THREE.MeshStandardMaterial({
      color: 0x2fa8ff,
      emissive: 0x1c6fd0,
      emissiveIntensity: 2.2,
      roughness: 0.4,
    }),
    wing: new THREE.MeshBasicMaterial({
      color: 0xbfe9ff,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    pixieGlow: new THREE.SpriteMaterial({
      map: radialSprite('rgba(140,220,255,1)', 'rgba(30,110,220,0)'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    // The eye texture is shared; each Dementor still gets its own *material*
    // for it, because the pulse is driven per creature and a shared opacity
    // would make every one of them blink in step with whichever moved last.
    eyeMap: radialSprite('rgba(150,220,255,1)', 'rgba(40,90,160,0)'),

    geo: {
      hood: new THREE.SphereGeometry(0.62, 14, 12),
      hollow: new THREE.SphereGeometry(0.46, 12, 12),
      hand: new THREE.SphereGeometry(0.15, 8, 8),
      torso: new THREE.CylinderGeometry(0.5, 0.42, 1.15, 10),
      skirt: new THREE.CylinderGeometry(0.44, 0.62, 0.7, 10),
      helm: new THREE.SphereGeometry(0.32, 12, 12),
      visor: new THREE.BoxGeometry(0.42, 0.1, 0.12),
      plume: new THREE.ConeGeometry(0.1, 0.5, 6),
      arm: new THREE.CapsuleGeometry(0.13, 0.68, 4, 8),
      pauldron: new THREE.SphereGeometry(0.19, 10, 8),
      leg: new THREE.CapsuleGeometry(0.15, 0.62, 4, 8),
      blade: new THREE.BoxGeometry(0.07, 1.35, 0.02),
      pixie: new THREE.SphereGeometry(0.24, 10, 10),
      wing: new THREE.CircleGeometry(0.3, 10, 0, Math.PI),
    },
  }
  return kit
}

/** The cloak, which is per-Dementor because its emissive is driven on damage. */
function cloakMaterial() {
  // Was 0x191a26 — 10% grey, which in an unlit corridor renders as pure black
  // no matter what else is done to it. Then it was 0x3c3f57, which
  // over-corrected into bright blue plastic. This sits between: dark enough to
  // stay a shadow at the end of a corridor, light enough that the folds model
  // when something actually shines on it.
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1b1f2e,
    roughness: 0.9,
    metalness: 0.05,
    emissive: 0x090d1c,
    emissiveIntensity: 0.28,
    side: THREE.DoubleSide,
  })
  return rimLight(mat, 0x9dc0f5, RIM_STRENGTH, RIM_POWER)
}

/** How long each comedy status holds it, in seconds. */
const STATUS_TIME = {
  dance: 3.4,
  levitate: 3.0,
  trip: 2.6,
  laugh: 3.2,
  freeze: 2.8,
}

class Enemy {
  constructor(scene, z, lane) {
    this.id = nextId++
    this.scene = scene
    this.alive = true
    this.group = new THREE.Group()
    this.group.position.set(lane, 0, z)
    this.hurt = 0
    this.burning = 0
    this.stagger = new THREE.Vector3()
    /** Active comedy status: { kind, time, t } or null. */
    this.status = null
    /**
     * Anything this creature made for itself and nobody else uses. Everything
     * in here is disposed when it dies; everything NOT in here came from the
     * shared kit and must never be, or the first Dementor to die takes the
     * cloak shader out from under every one still walking.
     */
    this.owned = []
    scene.add(this.group)
  }

  /**
   * Apply a spell's `effect`. Two shapes here: shrink and grow are permanent
   * resizes it keeps walking under, everything else is a timed indignity that
   * stops it where it stands.
   */
  applyEffect(kind) {
    if (kind === 'shrink') {
      this.group.scale.setScalar(0.4)
      this.center *= 0.4
      this.radius *= 0.5
      this.damage = Math.max(2, Math.round(this.damage * 0.35))
      return
    }
    if (kind === 'grow') {
      this.group.scale.setScalar(1.85)
      this.center *= 1.85
      this.radius *= 1.7
      this.speed *= 0.42
      return
    }
    this.status = { kind, time: STATUS_TIME[kind] ?? 2.4, t: 0 }
  }

  /**
   * Run the active status. Returns false while one is running, which is every
   * subclass's cue to skip its own movement for the frame — a levitating suit
   * of armour that keeps walking is just a bug with a funny name.
   */
  statusTick(dt, t) {
    const s = this.status
    if (!s) return true
    s.time -= dt
    s.t += dt
    const g = this.group

    switch (s.kind) {
      case 'dance':
        g.position.x += Math.sin(s.t * 21) * 2.4 * dt
        g.position.y = Math.abs(Math.sin(s.t * 13)) * 0.55
        g.rotation.z = Math.sin(s.t * 17) * 0.5
        break
      case 'levitate':
        g.position.y += (3.4 - g.position.y) * Math.min(1, dt * 3.2)
        g.rotation.z = Math.sin(s.t * 3.1) * 0.8
        g.rotation.y += dt * 1.7
        break
      case 'trip':
        g.rotation.x += (-Math.PI / 2.1 - g.rotation.x) * Math.min(1, dt * 7)
        g.position.z += 1.1 * dt // still sliding, on its face
        break
      case 'laugh':
        g.rotation.x = Math.sin(s.t * 15) * 0.38
        g.position.x += Math.sin(s.t * 8.5) * 0.9 * dt
        g.position.y = Math.abs(Math.sin(s.t * 7)) * 0.22
        break
      case 'freeze':
      default:
        break
    }

    if (s.time <= 0) {
      this.status = null
      g.rotation.x = 0
      g.rotation.z = 0
    }
    return false
  }

  hitPoint(target = new THREE.Vector3()) {
    return this.group.getWorldPosition(target).setY(this.center)
  }

  takeDamage(amount) {
    this.hp -= amount
    this.hurt = 1
    if (this.hp <= 0) this.alive = false
    return !this.alive
  }

  /**
   * Give back everything this creature was holding.
   *
   * Taking the group out of the scene is only half of it — that stops the thing
   * being drawn, and leaves every geometry, material and texture it was built
   * from resident on the GPU with no way to ever reach them again. On an
   * endless run that is the whole of the slowdown.
   */
  dispose() {
    this.scene.remove(this.group)
    for (const resource of this.owned) resource.dispose()
    this.owned.length = 0
    // Drop the meshes and lights too. They hold references to the shared kit,
    // which is fine, but a detached group that nothing clears keeps its whole
    // subtree alive for as long as anything still points at the enemy object.
    this.group.clear()
  }
}

/* ── dementor: the slow, unavoidable one ───────────────────────────── */
export class Dementor extends Enemy {
  constructor(scene, z, lane) {
    super(scene, z, lane)
    this.hp = 62
    this.maxHp = 62
    this.speed = 1.55
    this.radius = 1.0
    this.center = 2.1
    this.damage = 13
    this.score = 100

    const k = buildKit()
    // Per-Dementor, because the damage flash drives its emissive: shared, one
    // creature taking a hit would flash every other one in the corridor.
    const cloakMat = cloakMaterial()

    // A ragged cone is the body; the vertices get pushed around every frame, so
    // this geometry is the one thing that genuinely cannot be shared.
    this.cloakGeo = new THREE.ConeGeometry(1.05, 3.5, 44, 16, true)
    this.owned.push(this.cloakGeo, cloakMat)
    this.baseVerts = this.cloakGeo.attributes.position.array.slice()
    this.cloak = new THREE.Mesh(this.cloakGeo, cloakMat)
    this.cloak.position.y = 1.9
    this.group.add(this.cloak)

    const hood = new THREE.Mesh(k.geo.hood, cloakMat)
    hood.scale.set(1, 1.25, 1)
    hood.position.y = 3.3
    this.group.add(hood)

    // the void inside the hood, with two cold points in it
    const hollow = new THREE.Mesh(k.geo.hollow, k.hollow)
    hollow.position.set(0, 3.24, 0.22)
    this.group.add(hollow)

    const eyeMat = new THREE.SpriteMaterial({
      map: k.eyeMap,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.owned.push(eyeMat)
    this.eyes = new THREE.Sprite(eyeMat)
    this.eyes.scale.set(0.5, 0.3, 1)
    this.eyes.position.set(0, 3.28, 0.56)
    this.group.add(this.eyes)

    // skeletal hands, because the silhouette needs something human in it
    for (const side of [-1, 1]) {
      const hand = new THREE.Mesh(k.geo.hand, k.bone)
      hand.scale.set(1, 1.5, 0.6)
      hand.position.set(side * 0.78, 2.3, 0.32)
      this.group.add(hand)
    }

    this.light = new THREE.PointLight(0x4f7fd0, 1.7, 6, 2)
    this.light.position.y = 3.2
    this.group.add(this.light)

    // The lamp above lights the room. This one lights the creature. It sits
    // behind and above rather than out in front: a light in the player's face
    // flattens whatever it hits, which is how the cloak came out looking like a
    // lit-up cone. From back here it catches the shoulders and the top of the
    // hood and leaves the front in shadow, so the shape reads without the thing
    // ever stopping being dark.
    this.keyLight = new THREE.PointLight(0xbcd0f0, 1.9, 6, 2)
    this.keyLight.position.set(0.7, 3.6, -1.9)
    this.group.add(this.keyLight)

    this.phase = Math.random() * Math.PI * 2
  }

  update(dt, t, playerZ) {
    // A status holds it in place and, while it holds, it cannot reach you.
    if (!this.statusTick(dt, t)) return false
    const wobble = Math.sin(t * 1.4 + this.phase)
    this.group.position.z += this.speed * dt
    this.group.position.x += Math.sin(t * 0.7 + this.phase) * 0.4 * dt
    this.group.position.y = Math.sin(t * 1.1 + this.phase) * 0.18
    this.group.rotation.y = Math.sin(t * 0.5 + this.phase) * 0.2

    // tatter the hem
    const arr = this.cloakGeo.attributes.position.array
    for (let i = 0; i < arr.length; i += 3) {
      const y = this.baseVerts[i + 1]
      const hem = Math.max(0, (1.75 - y) / 3.5)
      // Driven by where the vertex IS, not by its index in the buffer. Index
      // phase means the wave frequency changes with mesh resolution: raising
      // the cone from 18 segments to 44 to kill the faceting turned the same
      // constants into alternating spikes, so the cloak came out as shards of
      // ice. Angle around the cone is resolution-independent, so folds stay
      // folds however finely the thing is built.
      const angle = Math.atan2(this.baseVerts[i + 2], this.baseVerts[i])
      // Two octaves: a slow swing for the big folds, a tighter one for the
      // creases between them. One octave alone came out as a clean smooth
      // cone, which reads as a paper triangle rather than cloth.
      const fold =
        Math.sin(t * 3 + angle * 3.5 + this.phase) * 0.62 +
        Math.sin(angle * 11 + t * 1.7 + this.phase) * 0.38
      const cross =
        Math.cos(t * 2.6 + angle * 2.5) * 0.62 + Math.cos(angle * 9.5 - t * 1.4) * 0.38
      arr[i] = this.baseVerts[i] + fold * hem * 0.62
      arr[i + 2] = this.baseVerts[i + 2] + cross * hem * 0.62
      arr[i + 1] = y - hem * 0.62 * (0.5 + Math.sin(t * 2 + angle * 7) * 0.5)
    }
    this.cloakGeo.attributes.position.needsUpdate = true
    // Moving vertices without recomputing normals lights the cloak as the
    // smooth cone it started as, so every fold added above was invisible — the
    // shape changed and the shading did not. This is why the cloak read as a
    // flat triangle no matter how far the hem was pushed around, and no amount
    // of tuning the displacement could have fixed it.
    this.cloakGeo.computeVertexNormals()

    this.eyes.material.opacity = 0.7 + wobble * 0.3
    this.light.intensity = 1.5 + wobble * 0.4
    if (this.hurt > 0) {
      this.hurt = Math.max(0, this.hurt - dt * 4)
      this.cloak.material.emissive.setHex(0x3a1420).multiplyScalar(this.hurt * 0.6)
    }
    return this.group.position.z > playerZ - 1.6
  }
}

/* ── animated armour: the fast, heavy one ──────────────────────────── */
export class Armour extends Enemy {
  constructor(scene, z, lane) {
    super(scene, z, lane)
    this.hp = 96
    this.maxHp = 96
    this.speed = 2.9
    this.radius = 0.85
    this.center = 1.5
    this.damage = 19
    this.score = 160

    const k = buildKit()
    const steel = k.steel

    const torso = new THREE.Mesh(k.geo.torso, steel)
    torso.position.y = 1.55
    this.group.add(torso)

    const skirt = new THREE.Mesh(k.geo.skirt, steel)
    skirt.position.y = 0.78
    this.group.add(skirt)

    const helm = new THREE.Mesh(k.geo.helm, steel)
    helm.scale.set(1, 1.2, 1.05)
    helm.position.y = 2.35
    this.group.add(helm)

    const visor = new THREE.Mesh(k.geo.visor, k.visor)
    visor.position.set(0, 2.34, 0.3)
    this.group.add(visor)

    const plume = new THREE.Mesh(k.geo.plume, k.plume)
    plume.position.y = 2.75
    this.group.add(plume)

    this.limbs = []
    for (const side of [-1, 1]) {
      // Pulled in and raised until the top of the capsule is inside the torso.
      // At 0.62 the arms cleared the shell entirely and, in a dark corridor,
      // read as two limbs floating beside the body rather than attached to it —
      // one of the tells that makes a build look unfinished at a glance. A
      // pauldron over the joint hides the seam the overlap creates.
      const arm = new THREE.Mesh(k.geo.arm, steel)
      arm.position.set(side * 0.53, 1.58, 0)
      this.group.add(arm)

      const pauldron = new THREE.Mesh(k.geo.pauldron, steel)
      pauldron.position.set(side * 0.5, 1.94, 0)
      pauldron.scale.set(1, 0.8, 1)
      this.group.add(pauldron)
      this.limbs.push({ mesh: arm, side, base: 1.5 })

      const leg = new THREE.Mesh(k.geo.leg, steel)
      leg.position.set(side * 0.22, 0.36, 0)
      this.group.add(leg)
      this.limbs.push({ mesh: leg, side, base: 0.36, isLeg: true })
    }

    // a sword, so it's obviously the melee threat
    const blade = new THREE.Mesh(k.geo.blade, steel)
    blade.position.set(0.62, 2.15, 0.1)
    this.group.add(blade)
    this.blade = blade

    this.keyLight = new THREE.PointLight(0xffb070, 2.2, 5.5, 2)
    this.keyLight.position.set(0.5, 2.4, -1.6)
    this.group.add(this.keyLight)

    this.light = new THREE.PointLight(0xff6a2a, 1.3, 4.5, 2)
    this.light.position.set(0, 2.3, 0.4)
    this.group.add(this.light)

    this.phase = Math.random() * Math.PI * 2
  }

  update(dt, t, playerZ) {
    if (!this.statusTick(dt, t)) return false
    this.group.position.z += this.speed * dt
    const stride = t * 7 + this.phase
    this.group.position.y = Math.abs(Math.sin(stride)) * 0.09
    this.group.rotation.z = Math.sin(stride) * 0.045

    for (const l of this.limbs) {
      const swing = Math.sin(stride + (l.side > 0 ? 0 : Math.PI))
      if (l.isLeg) {
        l.mesh.position.z = swing * 0.28
        l.mesh.rotation.x = swing * 0.5
      } else {
        l.mesh.position.z = -swing * 0.22
        l.mesh.rotation.x = -swing * 0.4
      }
    }
    this.blade.rotation.z = -0.3 + Math.sin(stride * 0.5) * 0.12
    this.light.intensity = 1.1 + Math.sin(t * 12 + this.phase) * 0.3

    if (this.hurt > 0) this.hurt = Math.max(0, this.hurt - dt * 4)
    return this.group.position.z > playerZ - 1.4
  }
}

/* ── cornish pixie: small, quick, comes in threes ──────────────────── */
export class Pixie extends Enemy {
  constructor(scene, z, lane) {
    super(scene, z, lane)
    this.hp = 24
    this.maxHp = 24
    this.speed = 4.6
    this.radius = 0.5
    this.center = 2.0
    this.damage = 7
    this.score = 60

    const k = buildKit()

    const body = new THREE.Mesh(k.geo.pixie, k.pixie)
    body.scale.set(1, 1.2, 1)
    this.group.add(body)
    this.body = body

    this.wings = []
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(k.geo.wing, k.wing)
      wing.position.set(side * 0.18, 0.08, -0.05)
      wing.rotation.y = side * 0.6
      this.group.add(wing)
      this.wings.push({ mesh: wing, side })
    }

    this.glow = new THREE.Sprite(k.pixieGlow)
    this.glow.scale.set(1.5, 1.5, 1)
    this.group.add(this.glow)

    this.light = new THREE.PointLight(0x4fc3ff, 1.7, 4.5, 2)
    this.group.add(this.light)

    this.group.position.y = 2.0
    this.phase = Math.random() * Math.PI * 2
  }

  hitPoint(target = new THREE.Vector3()) {
    return this.group.getWorldPosition(target)
  }

  update(dt, t, playerZ) {
    if (!this.statusTick(dt, t)) return false
    this.group.position.z += this.speed * dt
    this.group.position.x += Math.sin(t * 3.1 + this.phase) * 2.4 * dt
    this.group.position.y = 1.7 + Math.sin(t * 4.2 + this.phase) * 0.55

    const flap = Math.sin(t * 42 + this.phase)
    for (const w of this.wings) w.mesh.rotation.z = w.side * (0.5 + flap * 0.7)
    this.glow.scale.setScalar(1.3 + Math.sin(t * 9 + this.phase) * 0.25)

    if (this.hurt > 0) this.hurt = Math.max(0, this.hurt - dt * 4)
    return this.group.position.z > playerZ - 1.2
  }
}

export const ENEMY_TYPES = { Dementor, Armour, Pixie }
