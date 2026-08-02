# Test cases

Every one of these is driven against a **running build** by a tool in `tools/`,
not asserted by reading the code. Each names what it checks, how to run it, and
the number that counts as a pass. A change that moves one of these numbers the
wrong way is a regression even if the game still loads.

Run everything against a live server:

```sh
npx vite --port 5173          # or a deployed URL
node tools/probe-leak.mjs   http://localhost:5173
node tools/score-bench.mjs
node tools/word-audit.mjs
node tools/probe-rim.mjs    http://localhost:5173 ./shots-rim
```

---

## TC-1 — The game gives back what it takes

**Complaint it exists for:** "it gets laggier the longer you play."

**Tool:** `tools/probe-leak.mjs` — spawns 12 creatures and fires 12 bolts per
round, kills them the way the game kills them, and reads the renderer's own
ledger. Eight rounds, 96 creatures. Waits on the enemy list draining rather
than on a timer, because headless SwiftShader renders this scene at about three
frames a second and a fixed pause is frequently shorter than one frame.

**Pass:** `geometries`, `textures` and `scene children` are **identical** at
round 8 to round 1 — flat, not "slowly growing". Final line reads `LEAKING: no`.

**Where it was:** 5.83 geometries and 0.58 textures leaked *per creature*, scene
children climbing 12 per round and never falling. On an endless run that is
unbounded.

**Now:** 0.00 per creature, children 5 → 5, `LEAKING: no`.

---

## TC-2 — A correctly-spoken incantation fires

**Complaint it exists for:** "I'm saying the words and the engine is evaluating
wrong."

**Tool:** `tools/score-bench.mjs` — every spell against its declared
mishearings, plus generic manglings, plus a seeded per-character corruption
sweep.

**Pass:** ≥ 99% of correct utterances accepted at the per-word bar, and the
simulated-error row at 20% characters wrong stays at 100%.

**Now:** 1820/1821 (99.9%). The single failure is `ovodokidovro`, the bench's
own synthetic every-vowel-swapped mangle of AVADA KEDAVRA, at 0.503 against a
0.52 bar — a constructed string, not something a recogniser returns.

---

## TC-3 — The spellbook is made of distinctive sounds

**Complaint it exists for:** the bank going from 21 words to 99. The matcher was
deliberately widened on the argument that with one word on screen, confusable
spells cost nothing. That argument does not survive a bank this size, because a
bank this size has to reach into words that sound like English.

**Tool:** `tools/word-audit.mjs`, against the hostile corpus in
`tools/noise-corpus.mjs` (106 phrases: filler, talking to someone else in the
room, long latinate English, and deliberate near-rhymes of the spells).

**Pass — the bar is the 21-word bank measured on the same corpus:**

| | 21 words (before) | 99 words (now) |
|---|---|---|
| confusable pairs | 1.67% | **1.33%** |
| false fires on speech | 1.21% | **1.28%** |
| early false fires | 3 (0.14/word) | 10 (0.10/word) |

Per-word — which is what a player experiences, since one word is on screen at a
time — the bank is **no more confusable than the one that shipped**, and the
absolute pair rate is better.

**How it got there:** 113 candidates were written, audited, and the 14 worst
offenders cut on the numbers (`--prune` names them). Cuts included CONCUSSIO
(fires on "concussion"), VELOCITAS ("velocity"), OBLITERO ("obliterated") and
RIDDIKULUS ("ridiculous" — which is exactly what a player says while losing).

**Rule for adding words:** seven characters minimum, and re-run this. The
threshold allows three characters of absolute slop, which on a five-letter word
is most of the word.

---

## TC-4 — The creatures are edge-lit, not washed

**Complaint it exists for:** "the monsters still look blurry."

**Tool:** `tools/probe-rim.mjs` — sweeps the rim-light falloff and brightness on
the live build and photographs each setting.

**The instrument matters here.** The first version left the game running between
shots, so torches flickered and dust drifted between captures; two independent
judges came back with contradictory verdicts and one reasoned explicitly about
the size of the torch bloom, which was not the variable under test. An A/B with
a moving scene is not an A/B. It now pins the resolution and silences every
updater — timer, world, particles, wand, gameplay — so consecutive frames differ
in the rim and nothing else.

**Pass:** a judge that did not build it, shown the captures blind with no
indication which is the candidate, picks the chosen setting on sharpness.

**The result was not the predicted one, and this is the part worth keeping.**
The hypothesis going in was that the glow had been widened too far and needed
tightening. Tightening it *alone* (0.5 / 5.5) was judged **worse** — twice, by
two judges who never saw each other's answers. In a corridor this dark the rim
is not a highlight on top of the lighting, it **is** the lighting: the gradient
across the cloak is the only thing separating one fold panel from the next.
Tighten without brightening and the folds stop being distinguishable, the
creature collapses to a flat dark mass, and that reads as out of focus.

Tight **and bright** (0.9 / 6.0) was judged sharper *and* easier to find against
the dark than what shipped. That is the setting in the code.

**Honest limit:** the judges also called this difference subtle, and both of
them — unprompted, in both directions — named the same defects underneath it:
a visibly faceted low-poly hood, flat straight-edged polygon cloak panels with
no cloth detail, no contact shadow at the floor, and a second creature that is
not findable on its own silhouette. Those are geometry, not shading. No shader
value fixes them.

---

## TC-6 — A stall does not leave the game soft

**Complaint it exists for:** "it looks blurry" — the other half of it, and the
half that turned out to matter most.

**Tool:** `tools/probe-recovery.mjs` — drives the real `tuneQuality` on the live
build: sustained long frames until the resolution bottoms out, then nothing but
good frames, counting how many it takes to climb back.

**Pass:** recovery no worse than **30×** the fall.

**Where it was:** falling took 179 long frames (**3.0s**); climbing back took
14,400 good frames (**240s**) — an **80×** asymmetry. Every drop doubled the
price of a lift and nothing ever brought it down, so the doubling that was
added to stop oscillation quietly re-created the one-way ratchet it replaced.
Three seconds of stutter bought four minutes of soft picture, and the resource
leak (TC-1) guaranteed the stutter kept coming. On a phone reporting a device
pixel ratio of 3, the floor is a third-resolution image stretched over the
screen.

**Now:** 3.0s down, 56.5s back — **18.9×**, `PASS`. A notch earned back halves
the price of the next one, so a device that has genuinely recovered accelerates,
while one that is truly borderline drops again, re-doubles and still settles.

---

## TC-5 — Clean console

**Tool:** any of the probes; they all fail loudly on `pageerror`.

**Pass:** no errors, and no warnings originating in our code, across title,
play, interlude and gameover.

**Now:** clean. The two that were there are fixed — the 2D canvases are created
`willReadFrequently` (this file reads every one of them back per-pixel twice, so
it is the correct hint as well as a quieter one), and `THREE.Clock` is replaced
by `THREE.Timer`. What remains under headless SwiftShader is GL driver
performance chatter from the software renderer, which is not our code and does
not occur on a device.
