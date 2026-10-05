# Wandlore (hogwarts-duel)

A mobile browser wand duel you cast with your voice. First-person, three.js: creatures walk down a castle corridor, an incantation is shown on screen, and saying it fires the spell. Jeremy's personal project; phones are the main target.

Live: https://hogwarts-duel.vercel.app

The product is "Wandlore". The folder and Vercel project are `hogwarts-duel`; the GitHub repo is named `wandlore`.

## Status

Active, feature work on request. Binding decisions:

- **Every merge to `main` is live in production.** There is no `staging` or `production` branch. Vercel deploys `main` straight to https://hogwarts-duel.vercel.app, so a merged PR is a release. PR branches get preview deployments; use those to check a change before merging.
- **Never add or remove a light from the scene at runtime.** three.js compiles the number of lights into every material's program. Changing it mid-game forces a synchronous recompile of the whole scene (it caused a near two-second freeze on a cast). All dynamic lights live in a fixed rig (`src/lights.js`) allocated once at boot; creatures and bolts borrow one and hand it back at zero intensity. A new effect that wants a light takes one from the rig.
- **No edge or rim highlights on the creatures.** Jeremy's call: "graphics was worse than before the highlights were introduced." Two versions (an inverted shell, then a per-pixel graze term) were removed. Stills of one creature favoured the glow, but in a busy corridor it read as haze, and on taste the person playing outranks stills. If a creature reads flat, fix the key light or the material, not the edge.
- **Long-press menus stay off.** Dragging the corridor must never raise the browser's own menu. `touch-action` is not inherited in CSS, so it has to be set on the canvas and HUD themselves; iOS callouts need `user-select` and `-webkit-touch-callout`, and Android needs a prevented `contextmenu` event.
- **Resolution never drops below one rendered pixel per CSS pixel**, and it must be able to climb back after a stall (`tuneQuality` in `src/main.js`). A one-way ratchet that leaves the picture soft for minutes was a real bug.
- **New spells need at least seven characters** (spaces not counted), and the word audit must stay at or better than the current bank (see Gotchas).
- Known limit: the creatures' look is bounded by their hand-built low-poly geometry (faceted hood, flat cloak panels, no contact shadow). Shader tweaks move it only a little. Better models would be Jeremy's call.

## Stack

Vite 8, three.js 0.185 (with the EffectComposer, bloom and output passes), plain JavaScript modules (no TypeScript, no framework). No backend, no database, no environment variables. The game ships no image or audio files: textures are drawn to canvas at load time and sound is synthesised with WebAudio. Fonts (Cinzel, Cormorant Garamond) load from Google Fonts. Voice uses the browser Speech Recognition API, on-device where the browser allows it, with a fuzzy matcher. Playwright is a dev dependency used by the probes in `tools/`.

## Branches and deploys

- `main` is the only long-lived branch. Open PRs into it from short-lived branches (`fix/...`, `feat/...`, `perf/...`).
- Merge style: squash (`gh pr merge --squash --delete-branch`).
- Merging to `main` redeploys production. Check the change on the PR's preview deployment first.

## Run and test

```bash
npm install
npx vite --port 5173 --strictPort    # dev server (strictPort so a stale server cannot silently shift the port)
npm run build                        # production build into dist/
npx playwright install chromium      # once, for the probes
```

`TEST_CASES.md` is the test plan and the gate. Each case (TC-1 to TC-10) names a tool in `tools/` that drives the running game and the number that counts as a pass. A change that moves one of those numbers the wrong way is a regression even if the game still loads. With the dev server up:

```bash
node tools/probe-leak.mjs      http://localhost:5173   # TC-1 no resource leak
node tools/score-bench.mjs                              # TC-2 spoken words are accepted
node tools/word-audit.mjs                               # TC-3 spellbook stays distinct (--prune lists cuts)
node tools/probe-recovery.mjs  http://localhost:5173   # TC-6 resolution recovers after a stall
node tools/probe-hitch.mjs     http://localhost:5173   # TC-7 firing a spell compiles nothing
node tools/probe-touch.mjs     http://localhost:5173   # TC-8 drag is not a long press
node tools/probe-pacing.mjs    http://localhost:5173 3.0 8   # TC-9 run length and ultimate rate
node tools/probe-ultimate.mjs  http://localhost:5173   # TC-10 ultimate contract
node tools/shoot.mjs           http://localhost:5173 shots   # screenshots of every state (not a gate)
```

There is no CI. The console must be clean (TC-5): no errors and no warnings from our code on title, play, interlude and game over.

URL parameters for tests and screenshots: `?state=play|interlude|gameover` and `&populate=Pixie,Dementor,Armour`. `window.__game`, `window.__voice` and `window.__allSpells` are exposed for probes.

## Where things are

- `src/main.js`: the `Game` class, floor table, HUD wiring, quality tuning, the ultimate (`ULT_CASTS`), `FLOOR_HEAL`, prewarm.
- `src/voice.js`: speech recognition and the fuzzy matcher (`scoreUtterance`, `thresholdFor`).
- `src/spellbook.js`: the spell data (99 words). `src/spells.js`: the wand, particles, bolts and the ultimate's `Shockwave`.
- `src/enemies.js`: Dementor, Armour, Pixie. `src/world.js`: the corridor and its lighting. `src/lights.js`: the fixed light rig. `src/textures.js`: procedural materials.
- `index.html` and `src/style.css`: all screens and the HUD.

## Gotchas

- **Prewarm hidden objects.** `renderer.compile` only walks visible objects, so anything that lives hidden (like the ultimate's shockwave) compiles its shader the first time it is shown, at the loudest moment of the game. `prewarm()` shows it for one compile. Cloak materials are recycled, not disposed, because disposing the last user deletes the compiled program.
- **Voice matching is generous on purpose.** Browsers return odd English for invented Latin, so each spell lists the mishearings it actually produces. The match threshold allows about half a word of slop, which is why short words fire on ordinary speech. Before and after adding spells, run `node tools/word-audit.mjs` and compare per word, not per bank.
- **Pacing numbers are measured, not guessed** (`ULT_CASTS = 6`, `FLOOR_HEAL = 22`). Re-run `tools/probe-pacing.mjs` before changing either. Run length is capped by the floor table's ramp, not by the heal.
- **Headless rendering is software GL and runs at a few frames per second.** Never wait on a fixed delay in a probe; wait on a condition. Frame-time numbers from it describe the test rig, not a phone. Program and compile counts are exact on any device. For real timings use a real Chrome with DevTools. A second Wandlore tab open in the same browser halves the frame rate, so close other tabs before trusting a bad frame number.
- Clearing every enemy ends the floor and stops bolts ageing. A probe that waits for a bolt to expire must stub `advanceWave` first.
- To freeze the scene for a visual comparison, neutralise the updaters (timer, world, particles, wand, play tick, each enemy's update, camera shake). Replacing `game.frame()` with a bare render loop breaks the page. Pin the camera and the creature positions too: a comparison with a moving scene proves nothing.
- Chrome blocks the microphone on insecure origins. Voice needs HTTPS or `localhost`; "Play without a microphone" is the fallback.
