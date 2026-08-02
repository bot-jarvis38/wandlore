import * as THREE from 'three'

/**
 * Every surface in the castle is drawn here, at load time, into a 2D canvas.
 * No image files ship with the game — but nothing is a flat colour either:
 * each material gets a colour map, a matching normal map derived from its own
 * luminance, and a roughness map, so the torchlight actually catches on the
 * mortar and the flagstone chips.
 */

function makeCanvas(size) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return canvas
}

/** Value noise, tileable on `size`, so nothing seams at a wall join. */
function noiseField(size, cells, seed = 1) {
  const rand = mulberry32(seed)
  const grid = new Float32Array(cells * cells)
  for (let i = 0; i < grid.length; i++) grid[i] = rand()

  const out = new Float32Array(size * size)
  const step = cells / size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x * step
      const fy = y * step
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = smooth(fx - x0)
      const ty = smooth(fy - y0)
      const a = grid[(y0 % cells) * cells + (x0 % cells)]
      const b = grid[(y0 % cells) * cells + ((x0 + 1) % cells)]
      const c = grid[((y0 + 1) % cells) * cells + (x0 % cells)]
      const d = grid[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)]
      out[y * size + x] = lerp(lerp(a, b, tx), lerp(c, d, tx), ty)
    }
  }
  return out
}

function fbm(size, seed) {
  const a = noiseField(size, 4, seed)
  const b = noiseField(size, 8, seed + 11)
  const c = noiseField(size, 16, seed + 23)
  const d = noiseField(size, 32, seed + 37)
  const out = new Float32Array(size * size)
  for (let i = 0; i < out.length; i++) {
    out[i] = a[i] * 0.5 + b[i] * 0.26 + c[i] * 0.15 + d[i] * 0.09
  }
  return out
}

const smooth = t => t * t * (3 - 2 * t)
const lerp = (a, b, t) => a + (b - a) * t

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Derive a normal map from a colour canvas by treating luminance as height. */
function normalFromCanvas(canvas, strength = 2.2) {
  const size = canvas.width
  const src = canvas.getContext('2d').getImageData(0, 0, size, size).data
  const out = document.createElement('canvas')
  out.width = out.height = size
  const dst = out.getContext('2d').createImageData(size, size)

  const lum = i => (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = lum(y * size + ((x - 1 + size) % size))
      const r = lum(y * size + ((x + 1) % size))
      const u = lum(((y - 1 + size) % size) * size + x)
      const d = lum(((y + 1) % size) * size + x)
      const nx = (l - r) * strength
      const ny = (u - d) * strength
      const nz = 1
      const len = Math.hypot(nx, ny, nz)
      const i = (y * size + x) * 4
      dst.data[i] = ((nx / len) * 0.5 + 0.5) * 255
      dst.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255
      dst.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255
      dst.data[i + 3] = 255
    }
  }
  out.getContext('2d').putImageData(dst, 0, 0)
  return out
}

function toTexture(canvas, repeatX = 1, repeatY = 1, srgb = false) {
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeatX, repeatY)
  tex.anisotropy = 8
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/* ── stone wall: coursed ashlar blocks, chipped, damp at the base ──── */
function stoneWallCanvas(size = 512) {
  const canvas = makeCanvas(size)
  const ctx = canvas.getContext('2d')
  const grain = fbm(size, 7)

  ctx.fillStyle = '#2a2521'
  ctx.fillRect(0, 0, size, size)

  const rows = 8
  const h = size / rows
  const rand = mulberry32(99)

  for (let row = 0; row < rows; row++) {
    const offset = (row % 2) * (size / 10)
    const cols = 5
    const w = size / cols
    for (let col = -1; col <= cols; col++) {
      const x = col * w + offset
      const y = row * h
      const pad = 2.5
      const base = 62 + rand() * 26
      ctx.fillStyle = `rgb(${base + 8}, ${base + 2}, ${base - 8})`
      ctx.fillRect(x + pad, y + pad, w - pad * 2, h - pad * 2)

      // chamfer: a lit top edge and a dark underside sell the depth
      ctx.fillStyle = 'rgba(255,240,215,0.09)'
      ctx.fillRect(x + pad, y + pad, w - pad * 2, 2)
      ctx.fillStyle = 'rgba(0,0,0,0.42)'
      ctx.fillRect(x + pad, y + h - pad - 3, w - pad * 2, 3)
    }
  }

  // per-pixel grain + damp gradient toward the floor
  const img = ctx.getImageData(0, 0, size, size)
  for (let y = 0; y < size; y++) {
    const damp = Math.pow(y / size, 3) * 0.45
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const n = (grain[y * size + x] - 0.5) * 46
      img.data[i] = Math.max(0, img.data[i] + n - damp * 40)
      img.data[i + 1] = Math.max(0, img.data[i + 1] + n * 0.95 - damp * 34)
      img.data[i + 2] = Math.max(0, img.data[i + 2] + n * 0.85 - damp * 22)
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/* ── floor: worn flagstones, polished into a walking line ──────────── */
function flagstoneCanvas(size = 512) {
  const canvas = makeCanvas(size)
  const ctx = canvas.getContext('2d')
  const grain = fbm(size, 21)
  const rand = mulberry32(404)

  ctx.fillStyle = '#1b1815'
  ctx.fillRect(0, 0, size, size)

  const cells = 4
  const c = size / cells
  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) {
      const jitter = 3
      const x = gx * c + rand() * jitter
      const y = gy * c + rand() * jitter
      const base = 52 + rand() * 22
      ctx.fillStyle = `rgb(${base}, ${base - 3}, ${base - 9})`
      ctx.fillRect(x + 3, y + 3, c - 6, c - 6)
      ctx.strokeStyle = 'rgba(255,235,205,0.06)'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 3.5, y + 3.5, c - 7, c - 7)
    }
  }

  const img = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < size * size; i++) {
    const n = (grain[i] - 0.5) * 40
    img.data[i * 4] = Math.max(0, img.data[i * 4] + n)
    img.data[i * 4 + 1] = Math.max(0, img.data[i * 4 + 1] + n * 0.96)
    img.data[i * 4 + 2] = Math.max(0, img.data[i * 4 + 2] + n * 0.88)
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/* ── oak: pillars, door frames, the spellbook lectern ──────────────── */
function oakCanvas(size = 256) {
  const canvas = makeCanvas(size)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#38251a'
  ctx.fillRect(0, 0, size, size)
  const rand = mulberry32(77)
  for (let i = 0; i < 120; i++) {
    const y = rand() * size
    ctx.strokeStyle = `rgba(${20 + rand() * 40},${12 + rand() * 24},${8 + rand() * 16},0.6)`
    ctx.lineWidth = 0.6 + rand() * 2.2
    ctx.beginPath()
    ctx.moveTo(0, y)
    for (let x = 0; x <= size; x += 16) {
      ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 2 + i) * 3)
    }
    ctx.stroke()
  }
  return canvas
}

function buildMaterial(canvas, { repeatX, repeatY, roughness, metalness, normalScale, color }) {
  const map = toTexture(canvas, repeatX, repeatY, true)
  const normalMap = toTexture(normalFromCanvas(canvas), repeatX, repeatY)
  return new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughness,
    metalness,
    color: color ?? 0xffffff,
  })
}

let cache = null

export function buildMaterials() {
  if (cache) return cache

  const wallCanvas = stoneWallCanvas()
  const floorCanvas = flagstoneCanvas()
  const oak = oakCanvas()

  cache = {
    wall: buildMaterial(wallCanvas, {
      repeatX: 3,
      repeatY: 2,
      roughness: 0.94,
      metalness: 0.02,
      normalScale: 1.5,
    }),
    floor: buildMaterial(floorCanvas, {
      repeatX: 6,
      repeatY: 24,
      roughness: 0.62,
      metalness: 0.05,
      normalScale: 1.1,
    }),
    ceiling: buildMaterial(wallCanvas, {
      repeatX: 3,
      repeatY: 12,
      roughness: 0.98,
      metalness: 0,
      normalScale: 1.2,
      color: 0x6a6a72,
    }),
    oak: buildMaterial(oak, {
      repeatX: 1,
      repeatY: 2,
      roughness: 0.8,
      metalness: 0.05,
      normalScale: 0.8,
    }),
    iron: new THREE.MeshStandardMaterial({
      color: 0x2a2a30,
      roughness: 0.42,
      metalness: 0.92,
    }),
    pewter: new THREE.MeshStandardMaterial({
      color: 0x8b8f98,
      roughness: 0.34,
      metalness: 0.95,
    }),
  }
  return cache
}

/** Soft radial sprite — flames, embers, dust, impact bursts all use it. */
export function radialSprite(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const canvas = makeCanvas(128)
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, inner)
  g.addColorStop(0.4, inner.replace(/[\d.]+\)$/, '0.55)'))
  g.addColorStop(1, outer)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
