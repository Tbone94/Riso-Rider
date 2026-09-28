# Design direction (2026-09-27)

A physics puzzle: the rider starts moving on its own when you press go. Get it to the goal using tools you place before the run. Ink is limited.

## Tools (each costs ink)
- **Line:** solid ground to roll or slide on. Costs ink per unit of length.
- **Wind:** a current you draw with a direction. It pushes the rider along the stroke.
- **Gravity well:** tap to place it and it pulls the rider in. A later variant could repel.
- **Rope:** a springy line that sags and launches the rider.
- Possible later materials: ice, sticky, boost, and lines that break after one use.

## Level types
- **Classic:** reach the goal with limited ink. You get 1–3 stars depending on ink left.
- **Restricted:** only one or two tools are available (for example, "wind only").
- **Collect:** grab every star in a single run.
- **One stroke:** a single continuous line.
- **Timing:** the goal or platforms move, so you have to launch at the right moment.
- **Two riders:** one layout has to carry both riders home.
- **Dark:** you can only see what's near the rider, and light reveals the page.

## Twist being explored: build side-on, ride first-person (2026-09-27)
Mock in `fpv.html`. You build in side view, then Ride switches to a first-person riso view where you steer and jump.
- Gaps you can't afford to fill with ink become jumps, so leaving gaps is an ink-saving strategy.
- Drawn lines are narrow ribbons in 3D, so they become tightropes that sway. Level blocks are wide roads.
- Ropes are trampolines on the road. Wind and wells still need a first-person design (boost pads? a pull you can see?).
- Open questions: does every level ride first-person, or only some? How much skill vs. planning? Does the side-view sim still predict the ride?

## Difficulty (decided 2026-09-27)
- No global difficulty setting.
- Levels scale on two separate axes, puzzle (planning) and ride (execution), in a sawtooth curve: it rises within a chapter and dips when a new tool is introduced. Never spike both axes on the same level.
- Help comes from forgiveness and feed speed (assist). Mastery comes from 3★ ink par and optional challenges.
- Difficulty is measured by the simulator (solution density, clumsy-bot ride win rate, ink tightness) in `tools/validate.mjs`.
- **Scope:** 7 levels for now. Expand to full chapters (about 8 levels per tool) only after the user has play-tested and approved this build.

## Look: risograph (chosen 2026-09-27)
`styles.html` holds the original five style studies. We chose risograph.

Backgrounds come from `riso-lab.html` + `riso.js`, which simulates a riso printer. Each ink is a density map that gets screened into halftone dots or grain, textured, nudged out of register and multiplied onto paper.
- **Scene recipes:** original backgrounds that borrow the vocabulary of real print traditions: woodblock coast (ukiyo-e), park poster (1930s WPA), Bauhaus, paper cut-outs (Matisse), orbits (Hilma af Klint).
- **Artwork mode:** separates a real image into 2–3 riso inks. Only use public-domain works as direct sources. `art/` holds 10 Hokusai and Hiroshige prints (Art Institute of Chicago, CC0) and 4 WPA park posters (Library of Congress), with credits in `art/SOURCES.md`.
  - *Match colors* reproduces the original with the chosen inks. "Suggest inks" finds the best set.
  - *Tone map* ignores the original hues and splits light → dark tones across the inks, for bold recolors (e.g. the Great Wave in yellow, pink and blue).
  - *Treat aged paper as white* stops a print's yellowed paper from soaking up ink.
  - Wide prints (Hokusai's Thirty-Six Views, Hiroshige's Tokaido) crop well to 16:10. The tall WPA posters don't, so they're better as style reference.
- **Clear center** fades ink out of the playfield so levels stay readable. The game's own lines and rider should print in the darkest ink.
- **Saving:** run `python3 tools/serve.py`, and "Save to project" writes `backgrounds/<name>.png` plus a `.json` recipe. Scene recipes are fully reproducible from the JSON (recipe + seed + inks).
