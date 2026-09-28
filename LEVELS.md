# Level design plan: levels 11–50 (2026-09-28)

Levels 1–10 teach the game: the line, the jump, the rope, the tightrope, wind, the sling, a mixed level, then boost, ice and crumble. This plan adds **40 more levels in 5 chapters of 8**. They should be varied and never impossible, and they should reward clever drawings without requiring them.

## What the research says (short version)
1. **One idea per level, with a twist.** Nintendo's kishōtenketsu has four steps: introduce, develop, twist, conclude. Use it at two scales, inside one sheet and across a chapter. ([Game Developer](https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design))
2. **Every puzzle has a catch.** The obvious drawing *almost* works, but something (a ceiling, a wall, a crumbling floor) stops it. The player's revelation should happen in the **drawing**. Carrying out the plan in the ride should then be easy. Don't make the catch a precise steering test. (Mark Brown, *What Makes a Good Puzzle?*)
3. **Surprises come from the rules themselves.** Good examples are wind used as a brake, a rope used as a wall, and a crumble block used as a door. Arbitrary gimmicks don't count. (Blow and ten Bosch)
4. **Treat every pair of mechanics as its own element.** Give each important pairing a level where it is the star. Put breathers after hard levels, and give every level a hand-made name. (Matt Rix, Trainyard post-mortem)
5. **Use a sawtooth difficulty curve.** Steady ramps make players blame themselves and quit, so follow a hard level with an easy one. (Puzzledorf)
6. **Players take the laziest path, so reward cleverness with stars.** The obvious drawing earns 1–2★. A clever one, or a great ride that grabs the ink drops, earns 3★. Stars never gate progress. (Crayon Physics' "elegant" challenge, World of Goo's OCD flags)
7. **Remove boring shortcuts that repeat across levels.** If one cheap trick solves every level, the game feels samey. (Arvi Teikari, *Baba Is You*)
8. **Spare parts are fine.** Check only for the goal, never for a set answer. That's how players find solutions the designer never imagined. (The Incredible Machine)

## Physics cheat sheet (measured in the simulator)
- **Lines can't take you up.** A line only redirects energy and loses a little of it, so line-only routes can never end higher than the start (plus a little from start speed). **Energy sources:** wind (carries you at 430), the sling (always launches at 560), boost pads (up to 520), jumps (about 50 units of height each), and **ropes**. A rope is a springy trampoline, and a bounce often returns *more* height than you fell, anywhere from a little to a lot depending on where and how you hit it. (Measured 2026-09-28; the tutorial's Springy and Grand tour rely on it.) **A ring above the start is a puzzle in itself.**
- **Jump reach:** from a flat ledge a jump lands about 60–120 units further than rolling off. At start speed 150 you land around x+110 at 60 below; at 320, around x+280.
- **Ramps must be smooth curves.** A sharp V or valley kills speed at the corner, so the rider rolls back and gets stuck. Players draw freehand and the editor smooths their strokes, so author kickers as 6–10 point curves.
- **A kicker is a line that dips and then turns up.** It converts speed into a launch. A small upturned lip at a ledge edge (about 30 ink) plus a jump is the cheapest way over many gaps. This is the "degenerate trick" to watch for, so don't let it solve every level.
- **Long lines sway.** On one line the sway builds over about 1.6 s. Short lines are safe, and long ones need steering. The clumsy rider is the test.
- **Rope:** a trampoline in any orientation. A steep or vertical rope works as a bumper or backboard. A rope at 45° turns horizontal speed into height (up to v²/1800 units). Cost is 1.5 per unit.
- **Wind:** a 40-unit-radius current that carries you along the stroke at 430 and cancels gravity inside it. When you leave it you fly on at that speed, so a *short* gust can throw you across a gap. Cost is 1.2 per unit.
- **Contacts never add speed.** Fixed 2026-09-28: a line wedged against a block used to launch the rider at about 2200 speed. A sling whose release point would be inside rock now releases from its centre.
- **Sling:** a flat cost of 120. It catches you if you pass within 34 of it (in the air or on the ground), orbits, then flings you at exactly 560 along its arrow, flying almost straight for 0.6 s (about 330 units). It can't be placed within 80 of the goal. Each sling catches at most 3 times.
- **Level elements:**
  - **Boost pads** add energy.
  - **Ice** keeps all your speed but allows no steering.
  - **Crumble** blocks vanish 0.35 s after you first touch them.
  - **Hazards** are spike polylines. Use them for floors, ceilings, walls and pillars; a spiked ceiling is the anti-jump tool.
  - **Blocks** can be anything: ledges, walls, pillars, roofs.

## Rules for every new level
- **Goal:** the empty drawing fails, and every listed solution wins under the autopilot (`tools/validate.mjs`).
- **At least 3 listed solutions.** `solutions[0]` is the **obvious, generous** drawing. At least one is the cheap clever one. On levels with 2 or more tools, the solutions use **at least 2 different tool sets**, so the level really can be solved more than one way.
- **Ink budget:** about 1.5–2× the obvious drawing. A level may *restrict the tools* (that is the hook), but it never starves the ink.
- **Ride fairness:** `solutions[0]` should win for the clumsy rider at assist 1 in at least 85% of runs (validate warns otherwise). Don't spike the puzzle and the ride on the same level.
- **Par and drops come from `tools/tune.mjs`,** so pars stay puzzle-derived and drops balanced. Don't hand-tune them.
- **No dominant tool.** Check the tuner's "search by tools" line. On a multi-tool level, at least two tool sets should show random wins. If only the sling wins, the geometry needs rework.
- **The level must look distinct:** a one-line hook, a hand-made name, and a landmark shape (a wall, a chimney, a keyhole, a staircase…).
- **Hint:** one or two plain sentences in the second person that name the catch without spelling out the answer. No print jargon (see UI.md).
- **Coordinates:** a sheet is 800×500 with y pointing down. The spike floor is usually `[[0,486],[800,486]]`. Keep the start at least 150 units from any drop (the tuner enforces this). Keep the goal ring inside the sheet with r 26 (or up to 40 for a floating sling target).

## Authoring workflow
```bash
node tools/peek.mjs --file src/levels/chN.js --level <id> --out /tmp/x.png       # picture: geometry + every solution's ride
node tools/peek.mjs --file src/levels/chN.js --level <id> --sol 9 --items '[{"type":"line","pts":[[130,153],[200,190]]}]'   # try a drawing
node tools/tune.mjs --file src/levels/chN.js --level <id> --write                 # derive par + place drops (rewrites the file)
node tools/validate.mjs --file src/levels/chN.js                                  # the real checks + difficulty report
```
Author the geometry, ink and solutions with `par:[0,0]` and `drops:[]`, then run the tuner with `--write`. It may add the cheapest search win to `solutions`. Look at that drawing: if it's a cheese you don't like, change the geometry so it no longer works.

## The chapters
Each chapter follows the same shape: slot 1 is an easy intro (a dip), slots 2–3 develop the idea, slot 4 is a breather or set piece, slots 5–6 twist it, slot 7 is a breather, and slot 8 is the finale (a landmark sheet that mixes the chapter). Every chapter opens easier than the previous chapter's finale.

The tool sets across the 40 levels are deliberately mixed:
- about 13 single-tool levels
- about 14 two-tool levels
- about 6 three-tool levels
- about 7 all-four-tool levels

### Chapter 2 · Ground Rules (11–18) · LINE and ROPE · scene `park`
The chapter uses blocks, spike ceilings and crumble. The theme: *there's more than one way to cross.*

| # | id / name | tools | hook (the catch) | solutions that should work |
|---|---|---|---|---|
| 11 | `the-wall` The Wall | line | A wall between ledge and ring. **Built as the worked example.** | Line down onto the wall top; a smooth kicker over it; a short line and jump; a tiny lip at the ledge edge (33 ink) |
| 12 | `low-ceiling` Low Ceiling | line | A spiked ceiling hangs low over a wide gap, so **jumping pops you**. The fix is to fall *under* it instead. | A long flat bridge (it sways, so steer); a short line, then roll off and fall onto the landing without jumping; a ramp angled down to skim under |
| 13 | `stepping-stones` Stepping Stones | line | Three small floating stones step down across a spike lake. The gaps are a bit too wide to roll across. | Several short bridges (no sway); one long line over everything (sways); lips plus hops |
| 14 | `bank-shot` Bank Shot | rope | The ring is tucked back under the start ledge, low and to the left. The rider flies right, fast, towards a tall wall. | A steep or vertical rope on the wall as a backboard; an angled rope low in the pit that bounces back up and left |
| 15 | `high-low` High Road, Low Road | line + rope | A spiked mesa splits the sheet. Up top is a gap in the mesa; below is a tunnel under it. | High: a line bridge over the mesa gap. Low: a rope bounce into the tunnel mouth. Mixed: a short line to the tunnel. |
| 16 | `the-chute` The Chute | line + rope | You roll off into a deep, narrow shaft. The ring is out the side at the bottom, through a tunnel mouth. | A J-curve line that turns the fall into a run; an angled rope at the bottom that bounces you out sideways |
| 17 | `trapdoor` Trapdoor | line + rope | The ring sits in a closed pocket under a **crumble lid**. The crumble is the door: land on it and it drops you in. | A line to the lid; a rope bounce onto the lid; a precise line through a narrow side slot |
| 18 | `canyon` Canyon Crossing (finale) | line + rope | A wide canyon with a mid pillar and a spiked overhang: the whole chapter in one sheet. | One long swaying line; two short rope hops via the pillar; a line then a rope |

### Chapter 3 · Weather (19–26) · WIND with ice and boost · scene `cutouts`
The theme: *wind is energy, and energy is how you go up.*

| # | id / name | tools | hook | solutions |
|---|---|---|---|---|
| 19 | `chimney` Chimney | wind | The ring is straight up a vertical shaft above the start area. Generous: the chapter's dip. | A straight updraft; a curved one; a short gust that throws you up |
| 20 | `ferry` Ferry | wind | A long spike lake with the ring on the far shore. | A long ferry current across (costly); a **short launch gust** that throws you over (cheap: the aha) |
| 21 | `ski-jump` Ski Jump | wind + line | A long ice run (no steering, keeps all speed) ends below a ring on a high perch. | A line kicker at the end of the ice (ice speed makes it a ski jump); a wind lift; both |
| 22 | `headwind` Headwind | wind + line | A boost pad throws you too fast. Right after the ring is a spiked wall, so you overshoot. | A **backwards wind as a brake**; an uphill line curve that bleeds speed; a catch line (twist: wind against you) |
| 23 | `updraft-stairs` Updraft Stairs | wind | Ledges climb in steps to the upper right, with spikes below. | Many short gusts from step to step (cheap); one long rising current |
| 24 | `crosswind` Crosswind (breather) | wind + line | An open, generous road with gaps and plenty of drops. A ride that feels good. | Wind bridges; line bridges; a mix |
| 25 | `hairpin` Hairpin | wind + line + rope | The ring is above and *behind* where you arrive (goal.x must stay > start.x). | A wind U-turn loop; a rope backboard into a short updraft; a line and rope combination |
| 26 | `storm-front` Storm Front (finale) | wind + line + rope | Boost, then ice, then a gust, up to a high perch. | Several routes |

### Chapter 4 · Slingshot (27–34) · SLING with crumble · scene `orbits`
The theme: *aim.*

| # | id / name | tools | hook | solutions |
|---|---|---|---|---|
| 27 | `keyhole` Keyhole | sling | The ring is behind a wall with a window in it. Generous: the chapter's dip. | A sling in the fall path aimed through the window (many placements win) |
| 28 | `moonshot` Moonshot | sling | A floating ring high in the far corner, well above the start. | One sling anywhere along the fall, aimed up and right |
| 29 | `relay` Relay | sling | The ring is behind an overhang, so one fling can't reach it. It needs two changes of direction. | Two slings; or one sling plus a lucky wall line-up (only if it's fair) |
| 30 | `floor-gives-way` Floor Gives Way | sling + line | **The start ledge is crumble.** It drops you almost at once into a spiked pit. | A sling in the fall; a line that catches you and carries you to the ring |
| 31 | `ricochet` Ricochet | sling + rope | The ring hides behind a block. Fling into a rope wall and bank in. | Sling plus rope bank; two slings (costlier); a rope-only route if there is a fair one |
| 32 | `slalom` Slalom | sling + wind | Spike posts stand in a row, with the ring past them, low. | Wind weaving between them; a sling over them; a mix |
| 33 | `mail-slot` Mail Slot | sling + line | The ring is in a narrow horizontal slot between spike ceilings. You need a **flat** approach. | A flat fling; a line into the slot |
| 34 | `orrery` Orrery (finale) | sling + rope + line | A pinball sheet: several stages and bumpers. | Several routes |

### Chapter 5 · Overprint (35–42) · pairs as new elements · scene `bauhaus`
Ink is a little tighter here, but every level keeps a generous 1★ route.

| # | id / name | tools | hook | solutions |
|---|---|---|---|---|
| 35 | `kite` Kite | rope + wind | Bounce up into a current that carries you to a high ring. | A rope then wind; wind alone (costlier); a rope-only line-up? |
| 36 | `through-the-floor` Through the Floor | rope + line | A crumble floor sits over a pit and the ring floats *above* the floor. Fall through, bounce on a rope, and come back up through the hole. | A rope under the floor; a line route around |
| 37 | `ice-bank` Ice Bank | rope + line | An ice run ends at a wall. You can't steer, so bounce off it. | A rope backboard at the wall; a line kicker before it |
| 38 | `sail` Sail | wind | A long ice field where **wind is your only steering**. | Short gusts; one long current |
| 39 | `afterburner` Afterburner | sling + line | Boost pads everywhere. The sling always launches at 560, so the puzzle is *where* you meet it. | A line into the sling; a line kicker off the boost; a sling-only route |
| 40 | `pendulum` Pendulum | rope + sling | Bounce between facing walls, then leave. | Two ropes; a rope then a sling |
| 41 | `ink-detour` Ink Detour | line + wind | The obvious route is cheap and dull. The ink drops sit on a scenic detour worth 3★. | A cheap line; the long scenic loop |
| 42 | `double-print` Double Print (finale) | all four | Two separate halves, each asking for a different pair of tools. | Several routes |

### Chapter 6 · Full Bleed (43–50) · mastery, open sheets · scene `woodblock`
Every tool is available on almost every level, so several routes are the point.

| # | id / name | tools | hook | solutions |
|---|---|---|---|---|
| 43 | `crossroads` Crossroads | all | A high route and a low route to the same ring: pick one. | A route per tool set |
| 44 | `castle-keep` Castle Keep | all | The ring sits inside walls that are open only at the top. You have to come down into it. | A sling lob; a wind arc; a rope bounce over the wall |
| 45 | `gauntlet` Gauntlet | line + rope | A ride challenge: tightropes over spikes, with tools to shorten them. | A long line (sways); a rope bounce shortcut |
| 46 | `cavern` Cavern | all | Low spiked ceilings all the way through: flat, fast routes only. | Flat lines; low gusts; flat flings |
| 47 | `coast` Breather Coast | all | A wide-open, generous downhill that's a joy to ride, with lots of drops. | Anything |
| 48 | `machine` The Machine | all | A Rube Goldberg sheet whose *obvious* drawing uses all four tools, one per section. | A four-tool chain; a cheaper chain that skips a section |
| 49 | `avalanche` Avalanche | all | A long ice-and-crumble slope ends at a spiked spire: turn all that speed into a leap and drop into the hollow behind it. | A line ramp; a rope launcher; a wind puff; a small kicker (3★) |
| 50 | `last-proof` Last Proof (finale) | all | A callback to *The Wall* (level 11), with the same wall now guarded by a spiked ceiling, crumble and a high ring. The old solution breaks, and you need everything you've learned. | Several |

## Chapter looks
Each chapter uses one backdrop scene and a small family of ink sets. Keep the key ink (the third one) dark so tracks read clearly.
- **ch2 park:** ['Sunflower','Orange','Federal Blue'], ['Mint','Aqua','Teal'], ['Yellow','Green','Hunter Green'], ['Sunflower','Bright Red','Federal Blue']
- **ch3 cutouts:** ['Sunflower','Bright Red','Medium Blue'], ['Aqua','Fluorescent Pink','Medium Blue'], ['Yellow','Orange','Blue'], ['Mint','Coral','Teal']
- **ch4 orbits:** ['Coral','Violet','Federal Blue'], ['Yellow','Fluorescent Pink','Purple'], ['Mint','Violet','Burgundy'], ['Sunflower','Coral','Purple']
- **ch5 bauhaus:** ['Yellow','Fluorescent Pink','Blue'], ['Aqua','Red','Federal Blue'], ['Sunflower','Orange','Black'], ['Mint','Fluorescent Pink','Purple']
- **ch6 woodblock:** ['Flat Gold','Bright Red','Medium Blue'], ['Sunflower','Brick','Federal Blue'], ['Mint','Coral','Hunter Green'], ['Flat Gold','Orange','Burgundy']

Vary the `seed` on every level so no two sheets print alike.
