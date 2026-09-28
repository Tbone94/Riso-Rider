# Architecture & contract (v1, 2026-09-27)

Working title **Drift**. Every level is: **draw in side view → press Ride → ride it in first person**.
Fail → back to the drawing instantly with a ghost of the ride. Win → stars for ink used.
Read `DESIGN.md` (what the game is) and `RESEARCH.md` (why, plus the ranked plan) first.

## Files and owners
| File | Owner | What it is |
|---|---|---|
| `src/physics.js` | physics/levels agent | One simulation for both views. Pure JS, no DOM (runs in node). **Its exported API is frozen**, see below. Constants and internals may change. |
| `src/levels.js` | physics/levels agent | Level data + known solutions. Pure data. |
| `tools/validate.mjs` | physics/levels agent | `node tools/validate.mjs`: checks every level (fails empty, solutions win, costs ≤ ink). Exits non-zero on failure. |
| `src/side.js` | side-view agent | Side-view renderer + drawing editor + ghost trail of the last ride. |
| `src/ride.js` | ride agent | First-person renderer + ride backdrop + ride HUD (inset map, shadow…). |
| `src/app.js`, `index.html` | app agent | State machine, UI, input, settings, assist, transitions, bg printing, grain overlay. |
| `dev/<agent>-*.html` | each agent | Standalone test pages. Only touch your own. |
| `riso.js` | nobody (read-only) | Riso print engine: `Riso.renderScene`, `Riso.print`, `Riso.layersFor`, `Riso.INKS`, `Riso.PAPERS`, `Riso.SCENES` (you may *register* new scenes at runtime from your own module). |
| `legacy/game.js` | legacy, read-only | The old single-file side-view game. Reference for porting; `index.html` must stop loading it. |
| `legacy/fpv.html` | legacy, read-only | The first-person mock. Reference for the ride look and feel. |

Modules are native ES modules served by `tools/serve.py` at **http://localhost:5173** (already running, so don't start or stop it). `riso.js` is a classic script that sets `window.Riso`; load it before the modules.

## Coordinates
- Side view: 800×500 design units, x right, y **down**. Physics radius R=9.
- First person: z is lateral (sideways across the track), 0 = centre. Every surface is extruded along z with a half-width `hw`:
  - blocks 70 (roads)
  - drawn lines 13 (tightropes)
  - ropes 24
  - hazards infinite
- The rider collides with a surface only when `|z| ≤ hw + R*0.4`. Drift further than that and you fall past it.

## physics.js (frozen API)
```js
W,H,G,R,DT,SUB, COST, WIDTH, WIND, WELL, ROPE, JUMP, STEER, PUSH, STATE, NO_INPUT
closest(px,py,ax,ay,bx,by) -> [cx,cy,t]
polyLen(pts), itemCost(item), inkUsed(items), stars(level, used) -> 1|2|3
makeRope(a,b)
build(level, items, {assist:0|1|2}) -> world
step(world, level, input)            // advance one DT (1/60 s)
groundBelow(world, x, y, z) -> {y, kind} | null   // highest surface at/below (x,y) under the rider laterally
autopilot(world, level) -> input     // bot: centre, jump real gaps, nudge if stopped
simulate(level, items, {policy:'auto'|'none'|fn, maxT, assist}) -> {status,t,x,y,z,ink,jumps,world}
```
**input** = `{steer:-1..1, jump:bool (pressed this frame), jumpHeld:bool, push:-1..1}`

**world** (the fields you may read):
- `t` seconds, and `status`: `'run'|'win'|'fell'|'popped'|'stuck'`
- `rider`: `{x,y,z,vx,vy,vz,a (roll angle), grounded, groundKind:'block'|'line'|'rope'|null, groundHw, n:[nx,ny] contact normal, coyote, airT, speed}`
- `segs`: `[{ax,ay,bx,by,th,hw,kind:'block'|'line'}]` (block polygon edges and drawn-line segments)
- `hazards`: `[{ax,ay,bx,by,th,hw,kind:'hazard'}]`
- `ropes`: `[{ax,ay,bx,by,len,tx,ty,nx,ny,hw,side,depth,cx,cy,wob,wobT,wobSide}]`
  - While `side && depth>0`, the rope is stretched into a V through `(cx,cy)`.
  - Otherwise it wobbles with amplitude `wob*exp(-4*wobT)*cos(20*wobT)` toward `-wobSide*normal`.
- `winds`: `[{segs:[{ax,ay,bx,by,tx,ty}], pts, hw}]`, where tx,ty is the flow direction
- `wells`: `[{x,y}]`
- `path`: `[[x,y,z,state]]`, sampled every 2 frames. state: 0 ground, 1 air, 2 rope, 3 wind.
- `events`: `[{type:'jump'|'land'|'bounce'|'win'|'fell'|'popped'|'stuck', x,y,t, v?}]`
- `trail`: `[[x,y]]`, recent positions, newest first

**Level** (see `levels.js`):
- `{id, name, tools, ink, par:[3★,2★], hint}`
- `bg:{scene,seed,inks:[light,mid,key]}`
- `start:{x,y,vx}`, `goal:{x,y,r}`
- `blocks:[polygon]`, `hazards:[polyline]`, `solutions:[[items]]`, optional `blockHw`

**Items** (what the player draws):
- `{type:'line', pts:[[x,y],…]}`
- `{type:'wind', pts:[[x,y],…]}` (flows in drawing order)
- `{type:'rope', a:[x,y], b:[x,y]}`
- `{type:'well', x, y}`

Ink cost: line 1 per unit, wind 1.2, rope 1.5 × length, well 120 each.

## Shared app state `S` (owned by app.js, read by side.js and ride.js)
```js
S = {
  li, level,                       // level index + level object
  items: [],                       // committed drawings
  tool: 'line'|'wind'|'rope'|'well',
  mode: 'edit'|'ride'|'win',
  stroke: null | item,             // in-progress drawing (written by side.js editor)
  ink: {light, mid, key},          // hex colours of this level's 3 riso inks
  pat: {light, lightDense, mid, key},  // CanvasPatterns of halftone dots in those inks (made by app)
  ghost: null | {path, events, status, at:[x,y]},   // last ride, for the editor
  falls: 0,                        // failed rides on this level (resets on load and on win)
  settings: {fov:90, bob:false, chase:false, reducedMotion:bool, assist:0|1|2},
}
```

## side.js
```js
export function createSide({canvas, getState, hooks}) -> { draw(g, t), destroy() }
// hooks: { onChange(), toast(msg), flashInk() }
```
- `draw(g,t)` gets a 2D context **already transformed to design units** (800×500). It paints everything in the side view over the printed backdrop, including the goal, blocks, hazards, items, rider at the start, the in-progress stroke and the ghost trail. The fg canvas is `mix-blend-mode: multiply` over the backdrop, so draw in ink colours on transparent.
- The editor attaches pointer handlers to `canvas`. It is only active when `getState().mode==='edit'`. It enforces the ink budget (`inkUsed`) and the well keep-out (`WELL.keepOut`), sets `S.stroke`, pushes to `S.items`, and calls `hooks.onChange()` after every change.

## ride.js
```js
export function createRide() -> {
  printBackdrop(level, pw, ph) -> HTMLCanvasElement   // riso-printed ride backdrop, called once per level by app
  reset(world, level, S)                               // a ride starts
  draw(g, world, level, S, t, dt) -> {bg:{x,y,scale}}? // first-person frame; g in design units (800×500)
}
```
- The app draws the returned backdrop canvas on the bg layer. The optional return value lets the ride nudge or scale the backdrop for parallax; the app applies it as a CSS transform.
- `settings.chase` means a third-person chase camera instead of first person.
- `settings.fov` is in degrees. `settings.bob` controls head bob.
- `settings.reducedMotion` means no shake, no speed effects, and gentle transitions.

## app.js responsibilities
- **Page and UI:** level select, ink meter (star notches marked), tools, undo/clear, the Ride button.
- **Printing and overlays:** prints each level's side backdrop (pale) and ride backdrop (via `ride.printBackdrop`), overlays grain speckle on fg after drawing.
- **Riding:** calls `physics.step` at a fixed DT with input from keyboard and touch. Assist 1 = 0.7× time plus more centring; assist 2 = `autopilot` rides for you. Stars still count.
- **Ending a ride:**
  - On fail, go back to edit in **<300 ms** with `S.ghost` set, `S.falls++`, and a toast giving the reason.
  - After 3 falls, offer assist once, without judgment.
  - On win, show a card with stars, time and jumps.
- **Keys:**
  - Edit: 1–4 tools, Z undo, Enter/Space ride.
  - Ride: ←/→ or A/D steer, Space jump (hold for a floatier jump), ↑/W push, ↓/S brake.
  - Anywhere: R ride again, E or Esc back to edit.
- **Touch:** left and right steer zones plus a jump button, or tap to jump.
- **Settings panel:** FOV, head bob, chase cam, reduce motion (defaults from `prefers-reduced-motion`), assist.
- **Dev hook:** `window.game = {S, load(i), setItems(items), ride(), edit()}` for testing.

## Visual rules (everyone)
- **All UI chrome and in-canvas text follow `UI.md`** (the print-shop UI language: fonts, stamps, slips, vocabulary). It is binding.
- **Colour:** only the level's 3 riso inks (`S.ink`) plus paper. Game layers draw on transparent, multiplied over the printed backdrop. Mid ink offset behind key-ink shapes gives the misregistered look.
- **No synthwave:** no perspective grid floors, no sunburst skies, no glossy glow or bloom. Don't put halftone dots on everything; use dots for deliberate shading.
- **Readability over decoration** (Sable's lesson): gameplay surfaces must be the strongest contrast on screen.
- **Never colour-only:** each tool also differs by line style (solid line, dashed rope, streaked wind, ringed well).

## Testing
- **Physics:** `node tools/validate.mjs`.
- **Visuals:** your own `dev/*.html` page. In the browser, open **your own tab** (tabs_create, then navigate with that tabId) and never navigate, close or reuse other tabs. Several agents share the browser.

## Changelog (physics)
2026-09-27, physics/levels agent. The exported API is unchanged; everything below is constants, behaviour or additions.
- **Levels:** there are now 7, in this order: `first-line`, `mind-the-gap` (new), `springy`, `tightrope` (new), `updraft`, `pull`, `grand-tour`. The order is a sawtooth: difficulty rises, and dips whenever a level brings in a new tool. Tool-intro levels offer only their new tool (`springy` = rope, `updraft` = wind, `pull` = well). Several levels changed geometry, ink or par, so don't hard-code level data.
- **Jump is shorter:** `JUMP` is now `{v:300, coyote:.15, buffer:.15, apexGravity:.6, apexBand:110}`, down from v 400. Held-jump float now only applies to your own jumps (`rider.jumped`), never to plain falls. That was what broke `springy` under autopilot.
- **Steering** (`STEER`) now has three regimes: wide roads use the top-level `acc/damp/center`, narrow ribbons (hw < 30) use `STEER.narrow`, and airborne uses `STEER.air`. Tightrope sway is `STEER.sway/build/freq`. It is smooth and deterministic, and grows over ~1.6 s on the same line (slower riders sway less). Assist 1 multiplies centring by `STEER.assist.center` and sway by `STEER.assist.sway`.
- **New rider fields** (read-only):
  - `jumped`: airborne from your own jump
  - `sway`: −1..1, the tightrope's current push; good for camera lean
  - `lineT`: seconds on this line
  - `offSide`: you steered past a surface's edge and are falling past it
  - `owner`: id of the block, line or rope you're on
- **Falling off the side:** when you do, the ride ends promptly with status `'fell'`, even if you then land in spikes (it used to be `'popped'`). Steering back under a surface you've fallen past no longer pops you back up onto it.
- **Stuck rule:** pushing against a wall now counts as stuck after 2.5 s. Before, it ran until the 45 s timeout.
- **Broadphase:** `build()` adds `world.grid`, `world.cols` and `wind.grid` (Maps) plus bounding boxes on segments (`x0,x1,y0,y1,owner`). With ~600 segments a step takes about 0.05 ms, down from 1.3 ms and more. If you clone a world through JSON, it falls back to a full scan.
- **Autopilot** looks ahead by simulating, and jumps only at an edge where rolling on would fail. At an edge that can cost ~1–2 ms in one frame, or up to ~15 ms with a 600-segment stroke.
- **New export:** `cloneWorld(world)` gives a copy of the world you can step for previews without touching the real one.
- **Tests:**
  - `node tools/validate.mjs` runs the checks plus a difficulty report and a benchmark (`--quick` skips them, `--search N` finds par).
  - `node tools/tests/fairness.mjs` reports tightrope fall rates.
  - `node tools/tests/edges.mjs` covers physics edge cases.

---
# Contract v2: round A (2026-09-27): camera swoop, ink drops, new mechanics, sound
v1 still applies. Everything below is **additive and backward compatible**. Nothing existing may be renamed or removed.

## Round A owners
| Work | Owner | Files |
|---|---|---|
| Ink drops, ice, boosts, crumble: physics, level data, balance | physics/levels agent | `src/physics.js`, `src/levels.js`, `tools/**` |
| Side view of drops and mechanics, plus ghost detail | side agent | `src/side.js`, `dev/side-*` |
| Camera swoop transition; first-person drops and mechanics | ride agent | `src/ride.js`, `dev/ride-*` |
| Orchestration: transition, drops HUD, refund stars, sound wiring, settings | app agent | `src/app.js`, `index.html` |
| Sound | audio agent (new) | `src/audio.js`, `dev/audio-*` |

## 1. Ink drops (the ride feeds the score)
- **Level data:** `drops:[{x, y, z=0, v=25}]`. Drops float in the air at (x,y), offset sideways by z in first person.
  - `v` is the ink refunded **for star scoring only**. Refunds never let you draw more.
  - Allowed values: 15 small, 25 normal, 40 risky.
- **World:**
  - `world.drops = [{x,y,z,v, got:false, gotT:null}]`
  - `world.refund`: sum of collected `v`
  - events `{type:'drop', x,y,z,v,t}`
- **Collection:** the rider passes within `DROP.r` in x/y **and** `|rider.z - drop.z| < DROP.hz`. Constant `DROP={r:16, hz:22}`; tune if needed.
- **Stars:** `stars(level, used, refund=0)` scores `max(0, used - refund)`. The old 2-argument call still works.
- **`simulate()`** also returns `refund` and `drops: collected/total`.
- **Autopilot:** `autopilot(world, level, {drops:true})` steers toward reachable drops ahead. Used to prove drops can be collected. Without the option, behaviour is unchanged.

### Balance rules (validate enforces them)
Let **O** = ink of `solutions[0]` (the obvious drawing), **P3** = 3★ par, **gap** = O − P3.
1. Drops are **never required**. 1★ finishes and the cheapest clever drawings get 3★ with zero drops.
2. **Safe drops** (on the obvious path, z≈0) total about **0.4–0.6 × gap**. The obvious drawing plus only safe drops does **not** reach 3★.
3. **All drops** total about **1.0–1.3 × gap**. The obvious drawing plus a great ride (every drop, including risky off-centre or out-of-the-way ones) **does** reach 3★. Riding well upgrades a 2★ drawing to 3★.
4. Every drop is collectible: `autopilot {drops:true}` riding some listed solution gets each drop at least once across solutions. Report the clumsy-rider collection rate per level.
5. Each level has 2–5 drops, each worth 15, 25 or 40, with the risky ones worth more.

## 2. New level mechanics (level elements, not tools)
Existing fields stay the same, and `blocks` stays plain polygons. The new fields are separate arrays, so older code simply ignores them:
- **`ice:[polygon]`:** solid like blocks, seg kind `'ice'`. No friction, steering acceleration ×0.15, no centring, no push or brake. `rider.surface='ice'` while on it. First-person half-width = block (70).
- **`crumble:[polygon]`:** solid, seg kind `'crumble'`.
  - The first contact starts a timer. After `CRUMBLE.delay` (≈0.35 s) the block is gone and its segs stop colliding. Event `{type:'crumble', i, t}`.
  - Crumbled pieces fall for about 0.6 s, purely visual.
  - State lives in `world.crumbles[i] = {poly, touchedAt, gone, k}`, where k runs 0→1 over delay+fall and renderers read it. Each seg has `crumble:i`.
- **`boosts:[{a:[x,y], b:[x,y]}]`:** a pad lying on a surface.
  - While grounded within ~14 units of segment a→b, speed along a→b is driven up to `BOOST.speed` (≈520) with `BOOST.acc`.
  - Event `{type:'boost', t}` on entering.
  - `world.boosts = [{ax,ay,bx,by,tx,ty}]`.
- **Renderers must draw all of these** (side view, first person and the level thumbnails in app.js). Keep to the 3 inks and don't use colour alone:
  - ice: slick diagonal hatching
  - crumble: cracked, dashed outline
  - boost: chevrons

## 3. Camera swoop (the hero moment)
`createRide()` gains:
```js
ride.transitionMs = {full: 1100, quick: 420}
ride.drawTransition(g, world, level, S, t, p) -> {bg:{x,y,scale}, sideAlpha, rideBgAlpha}
```
- `p` is linear progress 0..1; ride.js does its own easing.
- At p=0 the camera matches the side view: far away, looking along +z at the x/y plane with a long lens, so the 3D world looks flat and lines up with the 2D drawing.
- Over the transition the camera swings and swoops down to exactly the first-person (or chase) pose that `draw()` uses at t=0. So at p=1 the handoff to `draw()` is seamless.
- The return value tells the app how to cross-fade: side fg alpha, and side backdrop vs ride backdrop.
- **App rules:**
  - Play the **full** version on the first ride after a level loads, and the **quick** version otherwise.
  - Any key, click or tap skips to p=1.
  - With reduced motion, keep the current fade and never call `drawTransition`.
  - Physics is paused until p=1.
  - If `drawTransition` is missing, fall back to the old wipe (feature-detect).
- The fail → edit return stays **instant (<300 ms)**. No reverse swoop.

## 4. Sound (`src/audio.js`, procedural WebAudio only, no files)
```js
export function createAudio() -> {
  unlock(),                        // call on the first user gesture
  setMuted(bool), setVolume(0..1),
  ui(name),                        // 'press'|'tool'|'undo'|'clear'|'toggle'|'slip'|'locked'|'next'
  draw(tool, phase, speed),        // phase 'start'|'move'|'end'; speed in design units/s
  inkEmpty(),
  transition(p),                   // the swoop whoosh, driven by progress
  ride(world, dt),                 // continuous: rolling (by speed and surface), wind, tightrope creak, boost
  event(e),                        // physics events: jump, land(v), bounce, drop(v), boost, crumble, win, fell, popped, stuck
  stamp(i),                        // 0 = CLEARED!, 1..3 = each star
  stopRide(),
}
```
- **Settings:** `S.settings.sound` (default true) and `S.settings.volume` (default 0.7). The app adds them to the settings panel ("Sound" on/off plus a volume slider).
- **Palette:** it must sound like the look: paper, pencil, rubber stamp, felt, wood, tape. Warm and tactile, **not** chiptune or arcade bleeps.
- **Mix:** a master compressor, no clipping, nothing harsh.

## 5. Stubs
`src/audio.js` exists as a no-op stub with the API above. The audio agent replaces it; the app agent can wire it immediately.
- **Round A data model has landed (2026-09-27):**
  - What's in: `DROP ICE BOOST CRUMBLE` constants, `world.drops/refund/crumbles/boosts`, `rider.surface`, and `seg.kind` 'ice'/'crumble' with `seg.crumble`.
  - Events: `drop`, `boost`, `crumble`.
  - `stars(L, used, refund)`, and `simulate()` now also returns `refund`, `drops` (collected count) and `dropsTotal`.
  - Test levels: `import {DEV_LEVELS} from './levels.js'` gives dev-drops, dev-ice, dev-boost and dev-crumble. Each wins with an empty drawing.
- **Round A behaviour and levels (2026-09-27, physics agent). Contract clarifications:**
  - **`simulate()`** returns `drops` (collected count) and `dropsTotal` (numbers, not a string), plus `refund`. It also accepts `policy:'drops'`, which is the autopilot with `{drops:true}`.
  - **Ground fields:** `rider.groundKind` stays `'block'|'line'|'rope'`. Ice and crumble report `'block'` there, because they're wide roads. Use **`rider.surface`** (`'block'|'line'|'rope'|'ice'|'crumble'|null`) for the material. `rider.boost` is the index of the pad you're on, or −1.
  - **Crumble:** `touchedAt` is set on first contact. The **`crumble` event fires when the block goes** (at `delay`), with `{i,x,y,t}`. `k` runs 0→1 over `delay+fall`, and `gone` segs are skipped by collision and by `groundBelow`.
  - **Events:** `boost` fires once per pad entry with `{i,x,y,t}`. `drop` is `{x,y,z,v,t}`, and the drop's `got` and `gotT` are set.
  - **Constants:**
    - `DROP={r:16,hz:22}`, checked as a swept test so fast riders can't skip a drop.
    - `ICE={steer:.15,damp:.6}`: ice has low lateral damping, so the drift you commit to persists.
    - `BOOST={speed:520,acc:1400,reach:14}`
    - `CRUMBLE={delay:.35,fall:.6}`
  - **New exports:** `dropAim(world)` gives the z a drop-hunting rider should aim for (0 if none). `DEV_LEVELS` is in levels.js.
  - **Hidden world field:** `world.level` is the level object; it's non-enumerable, so `JSON.stringify` skips it.
  - **Levels are now 10.** The 7 above, then three prototypes marked `prototype:true` with "(prototype)" in the name: **8 `boost`, 9 `black-ice`, 10 `crumble`**. Boost comes first because it's the gentlest, so the new tooth dips and then rises.
  - **New level fields:** `curve:'dip'|'rise'` is only read by validate. Every level now has 2–5 `drops`.
  - **Pars changed on every level.** Drop balance ties 3★ to the obvious drawing minus the drops. `solutions[0]` is now always the "obvious" 2★ drawing, which changed on updraft, pull and grand-tour.
  - **For the side agent:** grand-tour's wind route flies above the top of the sheet (y < 0) for a moment, so clamp or indicate the rider there.

---
# Contract v3: round B polish (2026-09-27)
Round A is integrated and verified: all 10 levels win in the real app, the swoop works, drops score correctly. The old prototypes now live in `legacy/` (game.js, fpv.html, styles.html).

## Round B owners
| Work | Owner | Files |
|---|---|---|
| Backdrop art: remove the sunburst, calmer and consistent side backdrops, grain vs dots | art agent (new) | `riso.js`, `dev/art-*` |
| Tightrope that feels thin and scary; raster performance | ride agent | `src/ride.js`, `dev/ride-*` |
| Precise drawing on phones: offset pen and loupe | side agent | `src/side.js`, `dev/side-*` |
| Local fonts, reading the backdrop profile, full UX QA at 375 and 1280 | app agent | `src/app.js`, `index.html`, `fonts/**`, `dev/app-*` |
| Pars back to puzzle-derived values, drops re-scaled, drop placement fixes | physics agent | `src/physics.js`, `src/levels.js`, `tools/**` |

## New touchpoints
- **Backdrop profile** (art agent writes, app agent reads).
  - `Riso.SCENES[name].side = {calm:0..1, pale:0..1}` is the recommended print settings for that scene as a *side-view backdrop*, where `calm` is the `renderScene` calm and `pale` the density multiplier.
  - The app uses it when present; otherwise it keeps the current 0.55 / 0.5.
  - The art agent may also add `Riso.SCENES[name].sideSafe` notes, but the main job is making the scenes themselves quieter where gameplay happens.
- **Fonts** move to `fonts/` as woff2 files with `@font-face` in index.html. Same family names, so canvas code needs no change.
- **Drop values** may now be any multiple of 5 from 10 to 75, so drops can match the gap without inflating pars. Balance rules 1–5 are unchanged.
- **Round B (2026-09-27, physics agent): pars and drops only. No physics behaviour changed.**
  - **3★ pars are puzzle-derived again.** Each one is the cheapest rideable solution found (a decent-human test rider wins at least 6 of 10 runs) plus a small margin. 3★ pars are now:
    - 300 first-line, 120 mind-the-gap, 100 springy, 360 tightrope, 420 updraft
    - 130 pull, 300 grand-tour, 60 boost, 40 black-ice, 110 crumble
  - **Level 1** is marked `parFrom:'no-jump'`: jumping isn't taught until level 2, so its par comes from the cheapest win without a jump (277).
  - **Drops were re-scaled to fit those pars.** Values are now multiples of 5 from 10 to 75. Level 1 has three drops worth 75 each (one safe on the line, two risky off-centre on the landing road). Tightrope drops are 70 and 75. Renderers should size drops by `v` if they show the value.
  - **Placement:** no drop is within 140 units of the start (it blocked the view after the swoop). Risky drops are either at least 30 off-centre (20 over ice), or on the centre line but off the plain path, needing a hop.
  - **Listed solutions:** each level now also lists its cheap clever solutions, so `solutions.length` is now 3–5.
  - **validate** fails if 3★ par is more than 1.6× the cheapest rideable solution when that is under 200 ink. Its DROP BALANCE table has a "par source" column.
- **Gravity wells rebuilt (2026-09-27, physics agent).** The old k/(d²+400) law was negligible where players put wells and violent up close, so small moves flipped the result.
  - **New force law:**
    - Pull toward the well = `WELL.strength·(1 − d/range)^p`, with `WELL={strength:1000, range:320, p:1, core:36, coreDamp:2.5, max:1100, hold:1.2, letGo:1, keepOut:80}`.
    - Inside `core` the pull eases to 0 at the centre, so there's no spike, plus light velocity damping.
    - The summed pull of all wells is capped at `max`.
  - **Exported helper:** `wellForce(d)` returns the acceleration magnitude at distance `d`, and the physics uses it internally. **Draw the pull field with it and `WELL.range`**, so the picture matches exactly.
  - **Wells only act while the rider is airborne,** which removes rocking-on-the-ground traps.
  - **No trap loops:** after `hold` seconds of airborne time inside wells' reach, the pull fades over `letGo` seconds. `rider.wellGrip` goes 1→0, and it resets once you're out of every field. No hovering or looping forever.
  - **Removed WELL fields:** `WELL.k` is gone, and `WELL.max` now means the summed-pull cap. If you read either, switch to `wellForce`.
  - **Push fix (affects everyone):** ↑/push now always drives toward the level's forward direction, the way the camera faces. Before, it pushed along your current velocity, so ↑ while rolling backward sped you backward. Brake (↓) is unchanged. The autopilot pushes forward when a well flings it back.
- **Pull rebuilt:**
  - **New layout:** a ledge at y 120 with start speed 220, and a tunnel mouth at x 400 between a roof at 248–270 and a floor at 430.
  - **Win map:** a single well now wins in one coherent region. It includes the tunnel mouth and "ahead of and above the fall" (smooth 80%, 27% of positions).
  - **Two wells** ride without a jump; this is the 2★ drawing.
  - **One well** needs a jump off the ledge; this is 3★ (130).
  - **Hint:** "Tap to drop a gravity well. It pulls the rider toward it."
  - **validate** now fails any level with the well tool whose single-well win map is speckled (under 60% of winning cells have 3 or more winning neighbours) or has fewer than 25 winning cells. `--maps` prints the maps.
- 2026-09-27 (orchestrator, after the wells fix): 'pull' was tuned so its single-well solutions win **with no jump**, because a tool-intro level must teach one thing only.
  - Ledge extended to x 220; start vx raised to 300.
  - Drops re-placed: safe 50 (0.45×), all 110 (1.00×).
  - Hint now says wells pull "while they're in the air".
  - With no input, 125/607 single-well cells win, smoothness 70%, and all intuitive placements win.
- Side view adds the optional hook `hooks.moved(prevItems)` for drag-moves of wells and rope ends. app.js keeps an undo history (`'add'` or `{prev}`) so Z reverts moves too.

---
# Contract v4: the slingshot replaces the gravity well (2026-09-28)
User feedback: the gravity well "still doesn't feel right", with invisible rules and a confusing intro. Decision: replace it with a **sling**, a ring you place and aim.

## Rules (physics)
- **Item:** `{type:'sling', x, y, a}`, where `a` is the exit angle in radians (0 = right, y down, so −π/2 = straight up). Cost `COST.sling = 120`.
- **Capture:** the rider's centre passes within `SLING.rc` (~34) of (x,y), with `|z| < SLING.rc`, airborne or grounded. It won't re-capture from the same sling within `SLING.cooldown` (~0.5 s) of release.
- **Orbit (kinematic, no gravity, collisions skipped):**
  - Speed `s = clamp(max(entrySpeed, SLING.minSpeed≈320), …, SLING.maxSpeed≈700)`.
  - The rider moves on a circle of radius `SLING.ro` (~0.8·rc) around the centre, turning in the direction set by the entry (sign of cross(r, v)).
  - It sweeps until the tangent equals `a` (at least `SLING.minSweep` ≈ 0.6 rad, less than 2π), and z eases to 0.
- **Release:**
  - Position on the circle at the exit angle; velocity = `unit(a) · s · SLING.boost (≈1.1)`, capped at maxSpeed.
  - Gravity resumes.
  - Events `{type:'sling', i, t}` on capture and `{type:'slingOut', i, t, v}` on release.
- **World and rider:**
  - `world.slings = [{x,y,a,rc,ro}]`
  - `rider.sling` = captured index or −1; `rider.slingK` = orbit progress 0..1; `rider.slingAng` = current polar angle
- **Legacy `well` items still simulate** (so old drafts and tests don't break), but no level offers the well tool any more.
- **Exports:** add `slingPreview(sling, speed=450, t=.45) -> [[x,y],…]`, the release point plus a ballistic arc under gravity for t seconds. The side view uses it so the preview matches the physics exactly.

## Levels
- Level 6 becomes **"Slingshot"** (id `sling`, tools `['sling']`). It's a "watch, then do" intro: the rider falls off a ledge toward spikes, and the ring is up and away. Place a sling in the fall, aim at the ring.
- Grand tour swaps `'well'` for `'sling'` in its tools.
- **validate — sling learnability:** for sling levels, placing a sling anywhere on the natural (no-item) fall path and aiming it straight at the goal must win in a clear majority of those placements. That's the "put it in your path, point it at the ring" rule. Also keep a smoothness check over placement with the best aim. Drops stay balanced.

## Owners (this round)
| Work | Owner |
|---|---|
| physics.js, levels.js, tools/** | physics/levels agent |
| side.js (place, move, aim handle, preview arc, ghost orbit) | side agent |
| ride.js (the sling in first person, the whip camera moment) | ride agent |
| audio.js (capture whoosh, release thwip) | audio agent |
| app.js and index.html (Sling tool button, icon, thumbnails, hints; wells hidden) | app agent |
- **Sling data model and physics landed (2026-09-28, physics agent).** Levels come next.
  - `COST.sling=120`, and `SLING={rc:34, ro:27, minSpeed:320, maxSpeed:700, minSweep:.6, boost:1.1, cooldown:.5, zEase:6}`.
  - `world.slings=[{x,y,a,rc,ro}]`. A missing `a` defaults to −π/4.
  - **Rider fields:** `sling` (−1 or the index), `slingK` (0..1), `slingAng`, and `slingDir` (+1 = angle increasing, which is clockwise on screen since y is down). Also `slingSpeed`, plus `slingLast`/`slingLastT` for the cooldown.
  - **Events:** `{type:'sling', i, x, y, t}` on capture and `{type:'slingOut', i, x, y, t, v}` on release.
  - **Orbit:** hazards don't pop you while you're orbiting. The goal ring and drops still count.
  - **Clarification:** `slingPreview(sling, speed=450, t=.45, dir=1)` takes an optional 4th argument, `dir`. The release point sits on the side of the ring given by the turn direction, and the preview can't know that before the ride. Use +1, or show both sides.
- **Slingshot level and sling tuning (2026-09-28, physics agent). Contract v4 clarifications:**
  - **Fling float:** after release, gravity eases back in over `SLING.float` = 0.6 s (∝ t²). A fling flies almost straight at first, so "point it at the ring" is true in play. `slingPreview` integrates exactly the same way, so previews match.
  - **Tuned constants:** `SLING.minSpeed` is now 380 (release ≥ 418), and the full set is `SLING={rc:34, ro:27, minSpeed:380, maxSpeed:700, minSweep:.6, boost:1.1, cooldown:.5, zEase:6, maxCatches:3, float:.6}`.
  - **No loops:** a sling can't re-catch you until you've left its capture radius (hysteresis), as well as the 0.5 s cooldown. Each sling catches at most 3 times per ride, after which you pass through. Tested straight up, straight down, and into a wall: every ride ends.
  - **New rider field:** `rider.slingFly` is the seconds since release, or 9 when not flying.
  - **Levels:** `pull` is replaced by **`sling`** ("Slingshot", level 6). It's a floating ring (r 40) up and to the right of a ledge you roll off. Grand tour now offers line, wind, rope and sling, and its well solution is gone. No level offers the well any more; legacy wells still simulate.
  - **validate:**
    - A sling learnability check: slings on the fall path, aimed at the goal. It fails under 60% on sling-only levels and is reported on mixed levels.
    - A best-aim smoothness map.
    - The random sampler understands slings.
