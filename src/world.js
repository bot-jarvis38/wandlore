import * as THREE from 'three'
import { buildMaterials, radialSprite } from './textures.js'

/**
 * A vaulted stone corridor that runs away from the camera down the -Z axis.
 * The look rests on three things: real geometry for the ribs and arcades so
 * the silhouette reads as architecture, torch point-lights that actually
 * flicker and light the walls they hang on, and moon shafts through the
 * windows to give the fog something to sit in.
 */

// Tighter than a real cathedral nave on purpose. At 9m wide and 8.4m tall the
// walls fell outside a portrait phone's narrow horizontal field of view and
// the shot read as "dark space with candles in it" — no architecture at all.
export const CORRIDOR = {
  width: 6.2,
  height: 6.4,
  length: 96,
  bayDepth: 5.2,
}

export function buildWorld(scene) {
  const mats = buildMaterials()
  const world = new THREE.Group()
  scene.add(world)

  scene.fog = new THREE.FogExp2(0x0d101c, 0.026)
  scene.background = new THREE.Color(0x05050a)

  const { width, height, length, bayDepth } = CORRIDOR
  const bays = Math.round(length / bayDepth)

  // ── floor ────────────────────────────────────────────────────────
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, length), mats.floor)
  floor.rotation.x = -Math.PI / 2
  floor.position.z = -length / 2 + 6
  floor.receiveShadow = true
  world.add(floor)

  // ── walls ────────────────────────────────────────────────────────
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(length, height), mats.wall)
    wall.rotation.y = side * (Math.PI / 2)
    wall.position.set((side * width) / 2, height / 2, -length / 2 + 6)
    wall.receiveShadow = true
    world.add(wall)
  }

  // ── vaulted ceiling: ribs springing from each pier ───────────────
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, length), mats.ceiling)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.set(0, height, -length / 2 + 6)
  world.add(ceiling)

  const ribGeo = new THREE.TorusGeometry(width / 2, 0.19, 6, 22, Math.PI)
  const vaultGeo = new THREE.TorusGeometry(width / 2 - 0.1, 0.5, 5, 18, Math.PI)

  for (let i = 0; i <= bays; i++) {
    const z = 4 - i * bayDepth

    const rib = new THREE.Mesh(ribGeo, mats.wall)
    rib.position.set(0, height - 1.5, z)
    rib.castShadow = true
    world.add(rib)

    // a shallow second arch behind each rib reads as the vault webbing
    const vault = new THREE.Mesh(vaultGeo, mats.ceiling)
    vault.position.set(0, height - 1.6, z - bayDepth / 2)
    world.add(vault)

    // engaged piers either side, the thing the ribs land on
    for (const side of [-1, 1]) {
      const pier = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, height - 1.5, 0.75),
        mats.wall
      )
      pier.position.set((side * (width - 0.5)) / 2, (height - 1.5) / 2, z)
      pier.castShadow = true
      pier.receiveShadow = true
      world.add(pier)

      const capital = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.32, 1.0), mats.wall)
      capital.position.set((side * (width - 0.5)) / 2, height - 1.5, z)
      world.add(capital)
    }
  }

  // ── gothic windows down the left, moon behind them ───────────────
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x6f86b8,
    emissive: 0x2d4a86,
    emissiveIntensity: 1.5,
    roughness: 0.25,
    metalness: 0,
    transparent: true,
    opacity: 0.4,
  })
  const shaftTex = radialSprite('rgba(150,190,255,0.5)', 'rgba(150,190,255,0)')
  const shaftMat = new THREE.MeshBasicMaterial({
    map: shaftTex,
    transparent: true,
    opacity: 0.09,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })

  const moonLights = []
  for (let i = 0; i < bays; i++) {
    const z = -i * bayDepth
    const x = -width / 2 + 0.12

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.6, 2.0), mats.wall)
    frame.position.set(x - 0.16, 3.5, z)
    world.add(frame)

    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 3.2), glassMat)
    glass.rotation.y = Math.PI / 2
    glass.position.set(x, 3.5, z)
    world.add(glass)

    // stone mullions across the light
    for (let m = -1; m <= 1; m++) {
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.3, 0.12), mats.wall)
      mullion.position.set(x + 0.05, 3.5, z + m * 0.6)
      world.add(mullion)
    }
    const transom = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 1.7), mats.wall)
    transom.position.set(x + 0.05, 4.1, z)
    world.add(transom)

    // the shaft of moonlight it throws across the floor
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 4.6), shaftMat)
    shaft.position.set(-0.9, 2.4, z)
    shaft.rotation.y = Math.PI / 2.6
    world.add(shaft)

    const moon = new THREE.PointLight(0x8fb4ff, 3.4, 11, 2)
    moon.position.set(x + 1.1, 3.4, z)
    world.add(moon)
    moonLights.push(moon)
  }

  // ── torches down the right, the warm key light ───────────────────
  const flameTex = radialSprite('rgba(255,190,90,1)', 'rgba(255,90,20,0)')
  const torches = []

  for (let i = 0; i < bays; i++) {
    const z = -i * bayDepth - bayDepth / 2
    const x = width / 2 - 0.3

    const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.9, 6), mats.iron)
    bracket.position.set(x, 2.9, z)
    bracket.rotation.z = Math.PI / 5
    world.add(bracket)

    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.1, 0.3, 8), mats.iron)
    bowl.position.set(x - 0.28, 3.32, z)
    world.add(bowl)

    const flame = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: flameTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xffb257,
      })
    )
    flame.scale.set(0.85, 1.25, 1)
    flame.position.set(x - 0.28, 3.66, z)
    world.add(flame)

    const light = new THREE.PointLight(0xff9a42, 9, 11, 2)
    light.position.set(x - 0.6, 3.5, z)
    world.add(light)

    torches.push({ light, flame, seed: Math.random() * 100 })
  }

  // ── floating candles, the one thing everyone recognises ──────────
  const candleTex = radialSprite('rgba(255,214,150,1)', 'rgba(255,150,40,0)')
  const candles = new THREE.Group()
  const candleMat = new THREE.SpriteMaterial({
    map: candleTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const waxMat = new THREE.MeshStandardMaterial({
    color: 0xe8ddc4,
    roughness: 0.85,
    emissive: 0x1a1206,
  })
  const waxGeo = new THREE.CylinderGeometry(0.032, 0.036, 0.52, 6)

  for (let i = 0; i < 26; i++) {
    const c = new THREE.Group()
    c.position.set(
      (Math.random() - 0.5) * (width - 1.6),
      4.5 + Math.random() * 1.5,
      -Math.random() * (length - 10)
    )
    const wax = new THREE.Mesh(waxGeo, waxMat)
    c.add(wax)
    const glow = new THREE.Sprite(candleMat)
    glow.scale.set(0.19, 0.19, 1)
    glow.position.y = 0.3
    c.add(glow)
    c.userData.bob = Math.random() * Math.PI * 2
    c.userData.baseY = c.position.y
    candles.add(c)
  }
  world.add(candles)

  // ── dust in the shafts ───────────────────────────────────────────
  const dustCount = 420
  const dustPos = new Float32Array(dustCount * 3)
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * width
    dustPos[i * 3 + 1] = Math.random() * height
    dustPos[i * 3 + 2] = -Math.random() * length
  }
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      size: 0.045,
      map: radialSprite('rgba(255,238,210,1)', 'rgba(255,238,210,0)'),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  )
  world.add(dust)

  // ── far end: a shut oak door, so the corridor has a destination ──
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, 4.2, 0.35), mats.oak)
  door.position.set(0, 2.1, -length + 5)
  world.add(door)
  const doorArch = new THREE.Mesh(
    new THREE.TorusGeometry(1.3, 0.24, 6, 18, Math.PI),
    mats.wall
  )
  doorArch.position.set(0, 4.2, -length + 5)
  world.add(doorArch)

  // ── ambient: barely there, so the torches do the work ────────────
  scene.add(new THREE.AmbientLight(0x3b4366, 1.05))
  const cold = new THREE.DirectionalLight(0x9db6e4, 0.7)
  cold.position.set(-6, 10, 4)
  scene.add(cold)

  return {
    group: world,
    update(t) {
      for (const { light, flame, seed } of torches) {
        const f =
          0.72 +
          Math.sin(t * 9.1 + seed) * 0.12 +
          Math.sin(t * 23.7 + seed * 2.3) * 0.09 +
          Math.random() * 0.07
        light.intensity = 9 * f
        flame.scale.set(0.78 + f * 0.2, 1.15 + f * 0.35, 1)
        flame.material.rotation = Math.sin(t * 4 + seed) * 0.12
      }
      for (const c of candles.children) {
        c.position.y = c.userData.baseY + Math.sin(t * 0.8 + c.userData.bob) * 0.12
      }
      for (const m of moonLights) {
        m.intensity = 3.1 + Math.sin(t * 0.7 + m.position.z) * 0.35
      }
      dust.rotation.y = t * 0.006
    },
  }
}
