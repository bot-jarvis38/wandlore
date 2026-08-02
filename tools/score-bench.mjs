/**
 * How often does a correctly-spoken incantation actually fire?
 *
 * The player's report is "I'm saying the words and the engine is evaluating
 * wrong", which is unfalsifiable without a number. This is the number: a
 * corpus of what browser speech recognition plausibly returns when someone
 * says each incantation *correctly* — split across word boundaries, swapped
 * for real English, topped and tailed with filler, or cut short — scored
 * exactly the way the game scores it.
 *
 * Honest caveat: these strings are constructed, not captured from a real
 * recogniser. They are a proxy for "said right, heard imperfectly", and their
 * value is comparative — the same corpus before and after a scoring change.
 *
 *   node tools/score-bench.mjs         # pass rate + every failure
 */

import { SPELLS } from '../src/spells.js'
import * as voice from '../src/voice.js'
const { scoreUtterance, MATCH_THRESHOLD } = voice
const thresholdFor = voice.thresholdFor ?? (() => MATCH_THRESHOLD)

/**
 * Mangles that do NOT depend on the specific word: the recogniser hearing the
 * incantation cleanly but wrapping it in speech, or clipping its tail.
 */
function genericVariants(word) {
  const w = word.toLowerCase()
  const flat = w.replace(/\s/g, '')
  const out = [
    w,
    `${w}!`,
    `uh ${w}`,
    `${w} uh`,
    `okay ${w}`,
    flat,
    // split at a couple of plausible seams
    `${w.slice(0, 4)} ${w.slice(4)}`,
    `${w.slice(0, Math.ceil(w.length / 2))} ${w.slice(Math.ceil(w.length / 2))}`,
    // the tail clipped by the recogniser cutting off early
    w.slice(0, Math.max(4, Math.round(w.length * 0.85))),
  ]
  return [...new Set(out)]
}

/**
 * The hard half. A recogniser handed an invented Latin word does not return a
 * near-miss of it — it returns the nearest English it can assemble, chopped
 * wherever the acoustics suggested a boundary. These are the cases the first
 * build failed and the player felt as "I said it right and nothing happened".
 */
function harshVariants(word) {
  const w = word.toLowerCase()
  const flat = w.replace(/\s/g, '')
  const chunks = n => {
    const size = Math.ceil(flat.length / n)
    const parts = []
    for (let i = 0; i < flat.length; i += size) parts.push(flat.slice(i, i + size))
    return parts.join(' ')
  }
  const dropMiddle = flat.slice(0, Math.floor(flat.length / 2) - 1) +
    flat.slice(Math.floor(flat.length / 2) + 1)
  const vowelSwap = flat.replace(/a/g, 'o').replace(/e/g, 'i')
  return [
    chunks(3), // shattered into three pieces
    chunks(4), // and four
    dropMiddle, // a swallowed syllable
    vowelSwap, // vowels heard wrong throughout
    `um ${chunks(2)} uh`, // pieces plus filler on both ends
  ]
}

let total = 0
let passed = 0
let passedFlat = 0
const failures = []

for (const spell of SPELLS) {
  // Every declared misreading must fire — they are in the file precisely
  // because they are what the recogniser comes back with.
  const cases = [
    ...genericVariants(spell.word),
    ...harshVariants(spell.word),
    ...spell.spoken,
  ]
  for (const said of cases) {
    total++
    const score = scoreUtterance(said, spell)
    const bar = thresholdFor(spell)
    if (score >= MATCH_THRESHOLD) passedFlat++
    if (score >= bar) passed++
    else failures.push({ spell: spell.word, said, score: +score.toFixed(3), bar: +bar.toFixed(3) })
  }
}

const pc = n => `${n}/${total} (${((n / total) * 100).toFixed(1)}%)`
console.log(`pass, per-word bar : ${pc(passed)}`)
console.log(`pass, flat ${MATCH_THRESHOLD} bar : ${pc(passedFlat)}`)
if (failures.length) {
  console.log('\nfailures — a correct utterance the game refuses:')
  for (const f of failures) {
    console.log(`  ${f.spell.padEnd(20)} "${f.said}"  ${f.score} < ${f.bar}`)
  }
}

/* ── the other side: mumbling must NOT fire ─────────────────────────── */

const NOISE = [
  'what', 'hello', 'come on', 'oh no', 'aaaah', 'shit', 'wait wait wait',
  'i said it', 'the door', 'yeah okay', 'hold on a second', 'is this thing on',
]

let falsePositives = 0
for (const spell of SPELLS) {
  for (const said of NOISE) {
    const bar = thresholdFor(spell)
    if (scoreUtterance(said, spell) >= bar) {
      falsePositives++
      console.log(`  FALSE FIRE  ${spell.word} <- "${said}"`)
    }
  }
}
console.log(`\nfalse fires on noise ${falsePositives}/${SPELLS.length * NOISE.length}`)

/**
 * Discrimination: saying one incantation must never fire a different one. This
 * is the check that keeps a generous bar honest — the noise list above is
 * short words that look nothing like Latin, whereas the twenty other spells
 * are the closest confusable strings that exist in the game.
 */
let crossFires = 0
let crossTotal = 0
for (const spell of SPELLS) {
  for (const other of SPELLS) {
    if (other === spell) continue
    crossTotal++
    if (scoreUtterance(other.word, spell) >= thresholdFor(spell)) {
      crossFires++
      console.log(`  CROSS FIRE  ${spell.word} <- "${other.word}"`)
    }
  }
}
console.log(`cross fires between spells ${crossFires}/${crossTotal}`)

/* ── simulated recognition error ────────────────────────────────────── */

/**
 * The corpus above is hand-written and therefore flattering. This is the same
 * question asked without an author's thumb on it: corrupt every incantation at
 * a fixed per-character error rate and count how many still fire. Deterministic
 * (seeded LCG), so the numbers move only when the scorer does.
 */
function corrupt(word, rate, seed) {
  let out = ''
  let r = seed
  const rnd = () => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648
  for (const c of word.toLowerCase()) {
    if (c === ' ') { out += ' '; continue }
    const x = rnd()
    if (x < rate * 0.5) continue // dropped outright
    else if (x < rate) out += 'aeiourstln'[Math.floor(rnd() * 10)] // misheard
    else out += c
  }
  return out
}

console.log('\nsimulated recognition error — share of correct attempts that fire:')
for (const rate of [0.2, 0.3, 0.4]) {
  let adaptive = 0
  let flat = 0
  let n = 0
  for (const spell of SPELLS) {
    for (let k = 0; k < 12; k++) {
      const score = scoreUtterance(corrupt(spell.word, rate, k * 7919 + spell.word.length), spell)
      n++
      if (score >= thresholdFor(spell)) adaptive++
      if (score >= MATCH_THRESHOLD) flat++
    }
  }
  const p = v => `${((v / n) * 100).toFixed(0)}%`
  console.log(`  ${(rate * 100).toFixed(0)}% of characters wrong :  ` +
    `per-word bar ${p(adaptive)}   flat ${MATCH_THRESHOLD} bar ${p(flat)}`)
}
