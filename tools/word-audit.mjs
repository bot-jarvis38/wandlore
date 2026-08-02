/**
 * Is the spellbook still made of distinctive sounds?
 *
 * The match bar is generous, and it was widened on the argument that with one
 * word on screen at a time, two spells that sound alike cost nothing. That
 * argument holds at twenty-one words. It does not hold at a hundred: a bank
 * that size has to reach past invented Latin into words that sound like
 * English, and every one of those is a chance for the game to fire while the
 * player is talking to someone else in the room.
 *
 * So this is the gate for adding words. It measures three things:
 *
 *   CONFUSABLE PAIRS  — saying spell B scores as spell A. The number to watch.
 *   FALSE FIRES       — ordinary speech scores as a spell.
 *   EARLY FALSE FIRES — worse, because these fire mid-utterance, before the
 *                       player has even finished saying the wrong thing.
 *
 * and then, because knowing is not fixing, it names the words to cut: greedily
 * drop whichever word is in the most collisions, until none are left.
 *
 *   node tools/word-audit.mjs            # report
 *   node tools/word-audit.mjs --prune    # report + the list of words to cut
 */

import { SPELLS } from '../src/spellbook.js'
import { NOISE } from './noise-corpus.mjs'
import { scoreUtterance, thresholdFor, prefixMatch, PREFIX_COVER } from '../src/voice.js'

const pruneMode = process.argv.includes('--prune')

console.log(`spellbook: ${SPELLS.length} words`)
const tiers = SPELLS.reduce((a, s) => ((a[s.tier] = (a[s.tier] ?? 0) + 1), a), {})
console.log(`tiers    : ${JSON.stringify(tiers)}`)

/* ── rule 1: nothing shorter than seven characters ──────────────────── */

const tooShort = SPELLS.filter(s => s.word.replace(/\s/g, '').length < 7)
console.log(`\nunder 7 characters (the bar allows 3 of slop — unusable): ${tooShort.length}`)
for (const s of tooShort) console.log(`  ${s.word}`)

/* ── rule 2: spells must not score as each other ────────────────────── */

/**
 * Both directions are checked and both counted, because they are different
 * failures: B scoring as A means saying B fires A, and the bar that decides it
 * is A's. A long word and a short one can collide one way and not the other.
 */
const pairs = []
for (const spell of SPELLS) {
  for (const other of SPELLS) {
    if (other === spell) continue
    const score = scoreUtterance(other.word, spell)
    if (score >= thresholdFor(spell)) pairs.push({ spell, other, score })
  }
}
pairs.sort((a, b) => b.score - a.score)

const ordered = SPELLS.length * (SPELLS.length - 1)
console.log(`\nCONFUSABLE PAIRS: ${pairs.length}/${ordered} (${((pairs.length / ordered) * 100).toFixed(2)}%)`)
for (const p of pairs) {
  console.log(`  ${p.spell.word.padEnd(21)} fires on "${p.other.word}"  ${p.score.toFixed(3)}`)
}

/* ── rule 3: ordinary speech must not score as a spell ──────────────── */

const falseFires = []
for (const spell of SPELLS) {
  for (const said of NOISE) {
    const score = scoreUtterance(said, spell)
    if (score >= thresholdFor(spell)) falseFires.push({ spell, said, score })
  }
}
falseFires.sort((a, b) => b.score - a.score)

const noiseTotal = SPELLS.length * NOISE.length
console.log(
  `\nFALSE FIRES ON SPEECH: ${falseFires.length}/${noiseTotal} ` +
    `(${((falseFires.length / noiseTotal) * 100).toFixed(2)}%)`
)
for (const f of falseFires) {
  console.log(`  ${f.spell.word.padEnd(21)} fires on "${f.said}"  ${f.score.toFixed(3)}`)
}

/* ── rule 4: and must not fire before the wrong word is finished ────── */

const earlyFires = []
for (const spell of SPELLS) {
  for (const other of SPELLS) {
    if (other === spell) continue
    const flat = other.word.toLowerCase().replace(/\s/g, '')
    for (let n = 5; n <= flat.length; n++) {
      if (prefixMatch(flat.slice(0, n), spell) >= PREFIX_COVER) {
        earlyFires.push({ spell, said: `${other.word} (as "${flat.slice(0, n)}")` })
        break
      }
    }
  }
  for (const said of NOISE) {
    if (prefixMatch(said, spell) >= PREFIX_COVER) earlyFires.push({ spell, said })
  }
}

console.log(`\nEARLY FALSE FIRES: ${earlyFires.length}`)
for (const e of earlyFires) console.log(`  ${e.spell.word.padEnd(21)} fires early on "${e.said}"`)

/* ── the cut list ───────────────────────────────────────────────────── */

/**
 * Greedy, and greedy is right here: one bad word usually collides with several
 * others, so removing the worst offender clears more than its own share and the
 * list converges fast. A word in exactly one collision is a coin-flip between
 * the two — cut the longer-tailed one, which is the one still in the list.
 */
if (pruneMode) {
  const collisions = new Map()
  const bump = (w, other) => {
    if (!collisions.has(w)) collisions.set(w, new Set())
    collisions.get(w).add(other)
  }
  for (const p of pairs) {
    bump(p.spell.word, p.other.word)
    bump(p.other.word, p.spell.word)
  }
  for (const f of falseFires) bump(f.spell.word, `noise:${f.said}`)
  for (const e of earlyFires) bump(e.spell.word, `early:${e.said}`)

  const cut = []
  while (collisions.size) {
    const worst = [...collisions.entries()].sort(
      (a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0])
    )[0]
    if (!worst || worst[1].size === 0) break
    cut.push(worst[0])
    collisions.delete(worst[0])
    for (const [, set] of collisions) set.delete(worst[0])
    for (const [w, set] of [...collisions]) if (set.size === 0) collisions.delete(w)
  }

  console.log(`\n── cut these ${cut.length} and the bank is clean ──`)
  console.log(cut.join('\n'))
  console.log(`\nremaining: ${SPELLS.length - cut.length} words`)
}

const clean = pairs.length === 0 && falseFires.length === 0 && earlyFires.length === 0
console.log(`\n${clean ? 'CLEAN' : 'NOT CLEAN'} — ${pairs.length} pairs, ${falseFires.length} false, ${earlyFires.length} early`)
