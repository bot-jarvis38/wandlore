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
node tools/probe-hitch.mjs  http://localhost:5173
node tools/probe-touch.mjs  http://localhost:5173
node tools/probe-ultimate.mjs http://localhost:5173
node tools/probe-pacing.mjs http://localhost:5173 3.0 8
node tools/shot-ultimate.mjs http://localhost:5173 shots   # pictures, not a gate
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

## TC-4 — The creatures carry no edge effect

**Complaint it exists for:** "graphics was worse than before the highlights were
introduced. i like it better before then."

**Retired, deliberately, and kept here as the record.** Two versions of a bright
edge on the creatures shipped and both are gone: an inside-out scaled shell
(which put a hand-width white band on the cloak hem and a perfect ring on the
head) and then a per-pixel graze term in the fragment shader, tuned to 0.9 / 6.0
by a blind judge sweep with the scene frozen.

**The judges and the player disagreed, and the player won.** Two judges who
never saw each other's answers picked the graze as sharper and easier to find
against the dark. Played rather than photographed, it read as haze — the term is
additive and sat above the bloom threshold, so every silhouette in a busy frame
carried a glow. A still of one creature is not the state the effect is used in.
Where taste is the question, the person playing is the judge that counts.

**Pass:** `grep -c 'onBeforeCompile' src/enemies.js` is 0. The creatures are lit
by their key lights and nothing is drawn on their outlines.

**What it costs, honestly:** the graze was doing real work — in an unlit corridor
the gradient across the cloak is much of what separates one fold panel from the
next, so the Dementor is flatter without it. The right answer to that is the key
light and the material, not a glow on the edge. The defects underneath were
never shading anyway: both judges, unprompted, named a faceted low-poly hood,
flat straight-edged cloak panels with no cloth detail, no contact shadow, and a
second creature not findable on its own silhouette. Those are geometry.

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

## TC-7 — Firing a spell compiles nothing

**Complaint it exists for:** "it's frigging laggy when a spell shoots off."

**Tool:** `tools/probe-hitch.mjs` — counts GLSL programs linked and shaders
compiled **at the WebGL boundary**, per cast, and samples the number of point
lights in the scene throughout. Three phases: casting into a fight, a bolt alone
in the corridor so it stays in flight, and the moment it expires.

**Why counts and not milliseconds.** Frame time under headless SwiftShader
describes the test rig, not a phone. The count of shader compiles is exact and
identical on every device, and a compile is synchronous — it happens in the
middle of the frame you are looking at. So the count *is* the stutter.

**Pass:** **0** programs linked across the whole run, and the point-light count
**constant** from first frame to last. Final line reads `HITCHING: no`.

**Where it was:** 43 point lights at rest with three creatures on screen, and a
cast linked up to **12 programs / 24 shader compiles** in one frame. three.js
compiles the scene's light count into every material's program, so a bolt
carrying its own point light meant firing invalidated every shader in the scene
— then the bolt expired 2.6s later, the count fell back, and it happened again.
That second one is why the game also stuttered a beat *after* the shot, with
nothing on screen to explain it. Every spawn and every death did it too.

**Now:** 25 point lights, constant, and **0 links / 0 compiles** across six
casts, an ultimate released and swept, a bolt in flight and a bolt expiring.

**Twenty-five, not twenty-four:** the bolt rig went from two lights to three
when the ultimate landed, because an ultimate spawns a bolt *and* a shockwave
and the one shot in the game that must never go out dim is that one. It is a
constant twenty-five, which is the property that matters.

**The ultimate is in this test on purpose.** It is exactly the shape of object a
prewarm misses: it spends its whole life hidden, and `renderer.compile` walks
the scene with `traverseVisible`, so a hidden mesh is skipped and pays for its
own shader the first time it is shown — which would be the single loudest moment
in the game. `prewarm` shows it for the one compile and hides it again.

**And in real frames, on real hardware.** The counts say nothing recompiles;
this says what that is worth. Same machine, same 430×932 viewport, same six
creatures, 480 frames with a cast every 40, driven through Chrome DevTools
against a desktop GPU rather than SwiftShader:

| | before | after |
|---|---|---|
| median frame | 37.2ms (27fps) | **16.6ms (60fps)** |
| 95th percentile | 42.7ms | **17.6ms** |
| worst frame | **1810ms** | 60.5ms |
| worst frame within 3 frames of a cast | **1810ms** | **17.6ms** |
| frames over 33ms | 469 of 480 | **1 of 480** |

The 1810ms frame is the complaint, in one number: nearly two seconds of frozen
picture, and it lands on a cast.

**How.** `src/lights.js` — every dynamic light is allocated once at boot into a
fixed rig and never added to or removed from the scene; creatures and bolts
borrow one and hand it back with the brightness at zero. Colour, position and
intensity are uniforms, and uniforms are free. The corridor's own lighting is
capped at `LIT_DEPTH` too: it was building a torch and a window light for all 18
bays of a 96-metre corridor, and 22 of those were beyond their own 11-metre
range from a camera that never moves — so they cost every lit fragment in the
frame and lit nothing. Cutting them further, to every *other* near window, was
tried and reverted: photographed against the shipped build it visibly dims the
left wall and the floor. The far ones are free to lose; the near ones are not.

**What it costs, deliberately:** the budget is six creature lights and two bolt
lights. On a crowded floor the creatures past the third walk unlit rather than
the game buying a stall to light them, and `Game.relight` hands freed slots to
whatever is nearest the player.

---

## TC-10 — The ultimate does what the strip says it does

**What it exists for:** TC-9 measures how often you get one. This is the
behaviour underneath, which a healthy rate would happily report as fine while
the button did nothing at all.

**Tool:** `tools/probe-ultimate.mjs`. Every step goes through the surface a
player touches — a real DOM click on the strip, the real cast path — because
the bug worth catching is the one where the state is perfect and the control is
not wired to it.

**Pass — 15 of 15:**

- starts empty, and the strip is disabled until it is full
- six casts fill it to exactly 100%, and a seventh does not overflow
- full, it says `ULTIMATE READY — TAP` and takes taps; it is not armed yet
- a tap arms it, and arming alone starts nothing and spends nothing
- a second tap disarms — you can think better of it
- the next successful cast spends the charge and the wave goes live
- everything inside 27m is swept, **once each**, and a creature at 46m is
  untouched on 62/62
- an Armour swept for 70 of 96 hp is left on 26 — the design claim, checked
- an unarmed cast makes no wave and simply charges

**Two assertions in the first draft were worthless, and both are worth
recording.** One read "every survivor has hp > 0" — which passes on an EMPTY
array, so it passed hardest in exactly the case it was written to catch
(everything vaporised). It now tallies hits at `onSweepHit` by creature id,
which can tell one hit from ten. The other compared the creature count before
and after arming, in a corridor where bolts from the six charging casts were
still landing: it failed for reasons that had nothing to do with the button.

**One deliberate rig:** the wand is pointed at the ceiling before the ultimate
is released. An ultimate fires an amplified bolt **as well as** the wave, and a
bolt that kills the front creature on its way makes it impossible to say what
the wave itself did.

---

## TC-9 — A round is long enough to earn one or two ultimates

**Complaint it exists for:** "the game is a little short, ends too quick, users
not able to cast that many spells before dying" — and the feature request that
came with it: a meter that fills on every successful cast, a button that arms
it, and the next successful cast lands as an ultimate. **One or two per round.**

**Tool:** `tools/probe-pacing.mjs` — plays the real game. Not by rendering it:
under a software renderer the scene draws at about three frames a second and a
run would take an hour of wall-clock, so the fight is driven directly at a fixed
timestep with the render loop stopped. The logic is the real logic — the real
floor table, creatures, projectiles and hit tests. The simulated player casts
every `castPeriod` seconds, aims at whatever is nearest with a few degrees of
error, and arms the ultimate the moment it is offered.

**Pass:** at least **90%** of floors give the player **1 or 2** ultimates, at a
three-second cadence. Reported per floor, not just on average, because a rate
that averages right can still be zero on the floor you actually reach.

**Now (`ULT_CASTS = 6`):** 100% at a three-second cadence, 87% at four seconds.

**How the number was chosen.** Seven was the first guess and it was measured
rather than kept: it gave 98% at three seconds but **78%** at four, and every
floor it missed was an early one that ends before the meter fills. Six is 100%
and 87%. Where the two ends of that trade-off disagree the tie goes to filling
too fast, because the failure that matters is a floor with **no** ultimate in
it — a player who never finds out the feature is there.

**And the length of a run**, same tool, eight runs each:

| cast every | | before | after |
|---|---|---|---|
| 3.0s | floors cleared | 3.0 | **7.5** |
| | spells cast | 46.5 | **98.3** |
| | seconds survived | 140 | **296** |
| 4.0s | floors cleared | 2.2 | **3.8** |
| | spells cast | 25.3 | **39.2** |
| | seconds survived | 101 | **157** |

**What made it longer, and what did not.** The ultimate is not what doubled the
run — `FLOOR_HEAL` is. Nothing in the game ever gave health back, so a run was a
strictly downward line: 98 after the first floor, 66 after the second, 32 after
the third, dead in the fourth. Thirty a floor was tried and gave the *same* run
length as twenty-two — the ceiling on a run is the floor table's own ramp, not
the size of the rest — but it held the player at full health through four
floors. Twenty-two keeps the damage sticking from the fifth floor on, so the
later floors cost something, and the run still ends: the floors grow faster than
22 a time can cover.

**Honest limit:** the simulated player casts on a metronome and never fumbles a
word. It is a fair instrument for *comparing* two builds and for tuning a rate,
and it is not a claim about how long your run will be.

---

## TC-8 — A drag is a drag, not a long press

**Complaint it exists for:** "when you drag around in phone browser, sometimes
it triggers the long press menu popup."

**Tool:** `tools/probe-touch.mjs`, run against an **iPhone device profile with
touch**, not a mouse. Reads the gesture properties off the three elements a
thumb actually lands on, fires a `contextmenu` at the canvas and at the HUD,
drags the corridor with synthetic pointer events, and tries to select the
incantation.

**Pass:** `touch-action` and `user-select` are `none` on `#app`, `#scene` and
`#hud`; `contextmenu` comes back `defaultPrevented`; the drag still turns the
camera; the HUD text cannot be selected. Final line reads
`LONG-PRESS SURFACE: clean`.

**Where it was:** 1 of 9. `touch-action: auto` on the canvas, `user-select:
auto` everywhere, `contextmenu` not prevented, and a drag over the HUD selected
the word `EPISKEY`.

**The actual bug:** `touch-action` is **not an inherited property.** It was
declared on `html, body` and stopped there, so the canvas the game is dragged on
kept the browser default — and a drag that pauses on a default-gesture surface
is a press-and-hold. Two mechanisms had to be closed separately: iOS raises a
selection callout, which is CSS (`user-select`, `-webkit-touch-callout`), and
Android fires a `contextmenu` event, which no CSS property can prevent.

**Honest limit:** Chrome does not implement `-webkit-touch-callout`, so it never
appears in computed style and iOS — the only browser that raises the callout —
is the only one that could confirm it. The probe checks that the rule is in the
shipped stylesheet and says so; the last mile is a real iPhone.

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
