import * as THREE from 'three'
import { radialSprite } from './textures.js'
import { buildMaterials } from './textures.js'

/**
 * Three things come down the corridor. Each one has a silhouette you can read
 * at a glance in the dark, its own light so it never sinks into the fog, and a
 * movement rule that makes it a different problem to solve.
 */

let nextId = 1

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
    scene.add(this.group)
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

  dispose() {
    this.scene.remove(this.group)
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

    const cloakMat = new THREE.MeshStandardMaterial({
      color: 0x191a26,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    })

    // a ragged cone is the body; the vertices get pushed around every frame
    this.cloakGeo = new THREE.ConeGeometry(1.05, 3.5, 18, 10, true)
    this.baseVerts = this.cloakGeo.attributes.position.array.slice()
    this.cloak = new THREE.Mesh(this.cloakGeo, cloakMat)
    this.cloak.position.y = 1.9
    this.group.add(this.cloak)

    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 12), cloakMat)
    hood.scale.set(1, 1.25, 1)
    hood.position.y = 3.3
    this.group.add(hood)

    // the void inside the hood, with two cold points in it
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 })
    const hollow = new THREE.Mesh(new THREE.SphereGeometry(0.46, 12, 12), voidMat)
    hollow.position.set(0, 3.24, 0.22)
    this.group.add(hollow)

    this.eyes = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialSprite('rgba(150,220,255,1)', 'rgba(40,90,160,0)'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    this.eyes.scale.set(0.42, 0.26, 1)
    this.eyes.position.set(0, 3.26, 0.42)
    this.group.add(this.eyes)

    // skeletal hands, because the silhouette needs something human in it
    const boneMat = new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 0.9 })
    for (const side of [-1, 1]) {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), boneMat)
      hand.scale.set(1, 1.5, 0.6)
      hand.position.set(side * 0.78, 2.3, 0.32)
      this.group.add(hand)
    }

    this.light = new THREE.PointLight(0x4f7fd0, 1.7, 6, 2)
    this.light.position.y = 3.2
    this.group.add(this.light)

    this.phase = Math.random() * Math.PI * 2
  }

  update(dt, t, playerZ) {
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
      const n = Math.sin(t * 3 + i * 0.21 + this.phase) * hem * 0.42
      arr[i] = this.baseVerts[i] + n
      arr[i + 2] = this.baseVerts[i + 2] + Math.cos(t * 2.6 + i * 0.17) * hem * 0.42
      arr[i + 1] = y - hem * 0.5 * (0.5 + Math.sin(t * 2 + i) * 0.5)
    }
    this.cloakGeo.attributes.position.needsUpdate = true

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

    const mats = buildMaterials()
    const steel = mats.pewter.clone()
    steel.color.setHex(0x9aa0ab)

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 1.15, 10), steel)
    torso.position.y = 1.55
    this.group.add(torso)

    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.62, 0.7, 10), steel)
    skirt.position.y = 0.78
    this.group.add(skirt)

    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), steel)
    helm.scale.set(1, 1.2, 1.05)
    helm.position.y = 2.35
    this.group.add(helm)

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.12), new THREE.MeshBasicMaterial({ color: 0xff5a2a }))
    visor.position.set(0, 2.34, 0.3)
    this.group.add(visor)

    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0x7a1d1d, roughness: 0.9 }))
    plume.position.y = 2.75
    this.group.add(plume)

    this.limbs = []
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.68, 4, 8), steel)
      arm.position.set(side * 0.62, 1.5, 0)
      this.group.add(arm)
      this.limbs.push({ mesh: arm, side, base: 1.5 })

      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.62, 4, 8), steel)
      leg.position.set(side * 0.22, 0.36, 0)
      this.group.add(leg)
      this.limbs.push({ mesh: leg, side, base: 0.36, isLeg: true })
    }

    // a sword, so it's obviously the melee threat
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.35, 0.02), steel)
    blade.position.set(0.62, 2.15, 0.1)
    this.group.add(blade)
    this.blade = blade

    this.light = new THREE.PointLight(0xff6a2a, 1.3, 4.5, 2)
    this.light.position.set(0, 2.3, 0.4)
    this.group.add(this.light)

    this.phase = Math.random() * Math.PI * 2
  }

  update(dt, t, playerZ) {
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

    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 10, 10),
      new THREE.MeshStandardMaterial({
        color: 0x2fa8ff,
        emissive: 0x1c6fd0,
        emissiveIntensity: 2.2,
        roughness: 0.4,
      })
    )
    body.scale.set(1, 1.2, 1)
    this.group.add(body)
    this.body = body

    const wingMat = new THREE.MeshBasicMaterial({
      color: 0xbfe9ff,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.wings = []
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.CircleGeometry(0.3, 10, 0, Math.PI), wingMat)
      wing.position.set(side * 0.18, 0.08, -0.05)
      wing.rotation.y = side * 0.6
      this.group.add(wing)
      this.wings.push({ mesh: wing, side })
    }

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialSprite('rgba(140,220,255,1)', 'rgba(30,110,220,0)'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
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
