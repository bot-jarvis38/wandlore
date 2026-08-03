import * as THREE from 'three'

/**
 * Every dynamic light in this game, allocated once at boot and never again.
 *
 * This exists because of a specific, measurable stutter: "it's laggy when a
 * spell shoots off." The cause is not the particles, the sound or the bolt.
 * It is that three.js compiles the number of lights in the scene INTO every
 * shader it builds. A material's program is keyed on, among other things, how
 * many point lights it has to loop over — so the moment that number changes,
 * every material in the scene needs a program it does not have, and the browser
 * compiles and links them right there, synchronously, in the middle of the
 * frame you are looking at.
 *
 * A bolt carried its own point light and was added to the scene when fired.
 * Measured on the shipped build (`tools/probe-hitch.mjs`): one cast linked up to
 * 19 programs and compiled 38 shaders. Then the bolt expired 2.6 seconds later,
 * the count fell back, and it happened again — which is why the game also
 * stuttered a beat after the shot, for no reason the player could see. Every
 * spawn and every death did it too.
 *
 * So nothing here is ever added to or removed from the scene. The rig holds a
 * fixed number of lights from the first frame to the last; a creature or a bolt
 * borrows one, drives its colour, position and brightness — all of which are
 * uniforms, and uniforms are free — and hands it back with the brightness at
 * zero. The light count never moves, so nothing ever recompiles.
 *
 * The budget is a real budget. When it is spent, the next creature walks
 * unlit rather than the game buying a stall to light it, and `Game.relight`
 * hands freed slots to whatever is nearest the player. That is the trade this
 * makes deliberately: a distant creature is dimmer, and the frame never stops.
 */
export class LightRig {
  constructor(scene, count, { distance = 6, decay = 2 } = {}) {
    this.all = []
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(0xffffff, 0, distance, decay)
      // Parked under the floor. A slot is claimed a frame before anything
      // positions it, and at the origin that frame is a flash in the corridor.
      light.position.set(0, -40, 0)
      scene.add(light)
      this.all.push(light)
    }
    this.free = this.all.slice()
  }

  /** A light, or null when the budget is spent. Never allocates. */
  claim(color, intensity, distance) {
    const light = this.free.pop()
    if (!light) return null
    light.color.setHex(color)
    light.intensity = intensity
    light.distance = distance
    return light
  }

  release(light) {
    if (!light) return
    light.intensity = 0
    light.position.set(0, -40, 0)
    this.free.push(light)
  }

  get spare() {
    return this.free.length
  }
}

/**
 * A light something WANTS, which may or may not be one it gets.
 *
 * The creatures used to own their lights outright — `this.light = new
 * PointLight(...)`, parented to the model, and that parenting is what made
 * spawning cost a recompile. A Lamp is the same intent with the ownership taken
 * out: it carries the colour and brightness the creature wants, and an anchor
 * parented to the model so the position still follows every animation, comedy
 * status and rotation for free. Whether a real light is behind it is the rig's
 * business, and every driver in `enemies.js` writes `lamp.intensity` without
 * caring either way.
 */
export class Lamp {
  constructor(parent, color, intensity, distance, x = 0, y = 0, z = 0) {
    this.color = color
    this.intensity = intensity
    this.distance = distance
    this.anchor = new THREE.Object3D()
    this.anchor.position.set(x, y, z)
    parent.add(this.anchor)
    this.light = null
  }

  claim(rig) {
    if (!this.light) this.light = rig.claim(this.color, this.intensity, this.distance)
    return !!this.light
  }

  release(rig) {
    rig.release(this.light)
    this.light = null
  }

  /** Follow the model, and take whatever brightness was written this frame. */
  sync() {
    if (!this.light) return
    this.anchor.getWorldPosition(this.light.position)
    this.light.intensity = this.intensity
  }
}
