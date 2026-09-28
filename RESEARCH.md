# Research brief: making Drift beautiful, addictive and shareable (2026-09-27)

Three research passes (virality, game feel and UX, art direction) plus a creative synthesis.
Claims marked (unverified) came from weak or secondary sources.

## The one-line pitch
Draw a track on a risograph print. Press Ride, and you fall *into* the print and ride it in first person.

## 1. Art direction: stop looking like "retro AI", start looking printed

### What to cut
- **Grid floor + sunburst sky** in the first-person view. The neon grid and striped sun are the defining symbols of synthwave, sold as merch everywhere. It reads as generic. (aesdes.org/2024/01/24/aesthetics-exploration-synthwave)
- **Halftone dots on everything.** A riso's *native* texture is Grain Touch: random, dispersed grain. Even AM halftone dots are a separate "screen" mode and read as pop-art comic, not riso. Keep dots for deliberate shading only. (libguides.reed.edu/c.php?g=1339150&p=9870131)
- Evenly spread detail, symmetric centred compositions, smooth rainbow gradients, glossy bloom. (Synthesis, not sourced consensus.)

### What respected print-styled games do
- **Fix one hard constraint before any content.** Lorelei decided on black and white plus one red before the game existed. (simogo.com)
- **Copy a real archive.** Pentiment's art follows the Nuremberg Chronicle's move from manuscript to woodcut, and its fonts carry character voice. (gamedeveloper.com, "Deep Dive: The Art of Pentiment")
- **Make the medium part of the fiction.** Tunic's in-game manual is a physical object.
- **Spider-Verse replaced depth of field with colour misregistration.** It has no motion blur and animates on twos. (fxguide.com)
- **Readability comes first.** Sable layered lighting, then shadows, then distance fog; outlines fade with distance. (gamedeveloper.com)

### Signatures for this game, taken from real riso craft
1. **Every level is one riso sheet.**
   - The edges carry crop marks, registration crosshairs, a colour bar, and a slug line: `SHEET 03 · SUNFLOWER / ORANGE / FEDERAL BLUE · RUN 0412`.
   - The page number is the level number.
   - Between levels the sheet feeds out and the next one feeds in, leaving roller tire-tracks.
   - The UI is printed on the sheet: the ink meter is the colour bar and the tools are rubber stamps.
2. **Grain, not dots.** Switch the base texture to stochastic grain. Show real, named defects sparingly, each with a physical cause:
   - tire tracks from the rollers
   - a dry, patchy drum
   - ghosting
   - one seeded "beauty mark" repeated on every sheet, which gives the machine an identity
3. **First person happens between the ink layers.** No floor grid:
   - Each drum is a parallax sheet at its own depth: back ink far, track ink near, paper behind everything.
   - Misregistration works as depth of field: far plates are offset, the near plate is sharp.
4. **A split-fountain sky.** One two-ink horizontal blend with uneven roller banding that shifts slightly between runs. (Classic split-fountain printing; doing it on riso drums is unverified.)
5. **Speed shows as misregistration.**
   - Faster means the plates drift further apart, each in its own direction.
   - **A crash snaps everything into perfect register for one held frame: a "clean proof."** That's the signature GIF moment.
6. **Ink starvation is visible.** As your ink budget runs out, your strokes go streaky and patchy like a dry drum. The failure language matches the resource.
7. **Ghost prints.** Your last ride shows as a faint misfeed ghost on the sheet.
8. **Inks overprint.** Translucent overlaps make a third colour (fluoro pink over federal blue is the iconic one). The *last drum printed tints everything*, so drum order sets each chapter's mood. (stencil.wiki/wiki/Ink_layer_order)
9. **Motion on twos.** Hold texture and line jitter at 12 fps so it reads as deliberate. Unstable jitter at 60 fps "reads like a bug."
10. **Typography with a voice.** Use a real display face plus a typewriter slug, not system fonts.

### How to render it in first person
- **Surface-Stable Fractal Dithering** (Rune Skovbo Johansen) keeps grain stuck to surfaces while you move. Obra Dinn never solved forward motion. (runevision.com/tech/dither3d, github.com/runevision/Dither3D)
- **Lock the paper to the screen, since the paper is the screen.** Anchor the ink grain to the world. That avoids the "shower-door" effect.
- **References for a WebGL riso pipeline:** github.com/chuwd19/overprint, and tympanus.net/codrops/2024/06/27/digital-meets-physical-risograph-printing-with-webgl
- **Recommendation:** keep the side view in canvas 2D, and move first person to WebGL (three.js is fine).

## 2. Fun, feel and UX

### The retry loop (the most important thing)
- **Super Meat Boy's rule:** no lives, instant respawn, short levels, goal always in sight. On a clear it replays every attempt at once. (gamedeveloper.com, Super Meat Boy postmortem)
- **Trackmania:** separate reset-to-checkpoint and reset-to-start keys, plus a personal-best ghost. (wiki, unverified detail)
- **Line Rider:** onion-skin path, timeline scrubbing, and flags to start a ride midway.
- **For us:**
  - A fall snaps back to the side view in under 300 ms, drawing intact.
  - An X marks where you fell, and a ghost path shows where you went, coloured for jumped, slowed and fell.
  - R to re-ride, E to edit.

### Planning vs skill (the risk in this concept)
- **The IKEA effect only works if your build succeeds.** A planner who hits a skill wall in first person loses it.
- **Forgiveness, as in Celeste:**
  - coyote time
  - jump buffering
  - softer gravity at the top of a jump
  - a gentle pull toward the middle of the ribbon
  (maddymakesgames.com, "Celeste and forgiveness")
- **Depth for landing:**
  - a blob shadow on the ribbon under you
  - the camera tilts down while falling, as in Jumping Flash!
  - a side-view inset during the ride with the next gap marked
- **Judgment-free assist after 3–4 falls:** slow-mo or auto-ride that still earns ink stars, like Celeste's Assist Mode and Sayonara's skip.
- **Comfort:**
  - FOV slider (default about 90)
  - no head bob, plus an option to turn off shake
  - chase-cam option
  - respect `prefers-reduced-motion`
  (Xbox Accessibility Guideline 117)

### Drawing feel
- **Smoothing:**
  - `getCoalescedEvents()` for smooth input
  - streamline smoothing while drawing, then a Chaikin smoothing pass when the pen lifts (perfect-freehand is a good reference)
  - snap to line ends within about 12 px
- **Ink meter under the pen,** with star thresholds marked, so you see the cost before committing.
- **Local previews only:** a bounce arc off a rope, arrows along a wind lane. Never the whole solution (Peggle's approach).
- **Never use colour alone:** each tool also gets a dash or pattern (Poly Bridge's black-and-white stress view).

### Juice, in keeping with the print world
- Stars stamp in with a print-press *thunk*.
- About 60 ms hitstop on landing (unverified number).
- Pencil and paper sounds change per material: line, rope, wind.
- Tiny Wings-style streaks: three clean landings in a row gives a boost.

### Progression and replay
- **Every level adds exactly one new interaction** (Baba Is You).
- **Ink stars for everyone, plus optional mastery flags per level:** no jumps, one stroke, time par. These come from Crayon Physics' "Elegant" and "Old School" challenges.
- **Several valid solutions per puzzle** (Zach Gage / Puzzmo). Our level search already confirms that.
- **Daily sheet** with a spoiler-free share string, e.g. `SHEET #42 ★★☆ ink 63% · 18.4s · 3 jumps`. This is Wordle's growth engine.

## 3. Going viral on Reddit

### What worked for others
- **Viewfinder** is the closest analog: one surprising 2D-to-3D moment in first person. Its prototype tweet reportedly got 200k+ views and became a full game (secondary press). The dev said what worked was "visually interesting and surprising."
- **Poly Bridge** had a one-click GIF of *your own funny failure*, which made it "a Reddit sensation."
- **Line Rider** spread through finished rides, not the tool: 11M views, and DoodleChaos music-synced rides reached about 150M.
- **Tiny Glade** found that tech posts attracted developers, not players. Show the game.
- **Laysara:** a 30 s r/gaming clip with a personal-story title got 73k upvotes, 3.2M views and 11k wishlists in 24 h. The poster had a real account history first.
- **Browser games spread through things players can share:**
  - share strings (Wordle)
  - labels that make a result special (Infinite Craft's "First Discovery")
  - level URLs (Sandspiel)
  - instant play with no install

### The hero clip (8–15 s, no sound needed, loops)
1. **0–1.5 s:** a doodled track on a riso sheet in side view, finger lifts.
2. **1.5 s:** press Ride. The camera plunges *through the paper* between the ink plates.
3. **About 8 s:** the ride, with the plates drifting apart as speed builds, then a jump.
4. **Either a landing, or a crash that snaps into register** (a Poly Bridge-style funny failure).
5. **Cut back to the sheet,** so the clip loops.

- **Title:** a plain first-person statement of the surprise, no call to action. For example, "I made a game where you draw a track in 2D, then ride it in first person (it's printed like a risograph)".

### Where and how to post
- **Skip r/InternetIsBeautiful:** it explicitly bans web games.
- **r/gamedev** is only for a technical write-up (e.g. the riso shader breakdown).
- **Playable link to r/WebGames.**
- **Development clip to r/IndieDev and r/playmygame.**
- **Hero clip to large general subreddits.**
- **Pacing:** space posts days apart, never crosspost to many at once, and keep about 10:1 real participation to self-promotion. Warm the account up weeks ahead; many subreddits need about a week of account age and about 20 karma.
- **Killers:**
  - wishlist or ad language
  - new accounts
  - posting too often
  - **looking AI-generated:** r/Art banned an artist whose hand-made work "looked AI." A visible process (defects, a shader breakdown, sketches) protects you.

### Be ready for the spike
- Static hosting on a CDN, a fast first load, and no sign-in.
- Somewhere to capture interest: a newsletter or Discord, with the link in the game and comments rather than the post title.
- Stay in the thread replying for the first few hours.

## 4. Ranked build plan
1. **One game, not two prototypes.** Merge the side-view levels with the first-person ride, so every level is draw, then Ride.
2. **The retry loop.** Instant return to the editor, an X where you fell, a coloured ghost path, and R/E keys.
3. **First-person fairness.**
   - blob shadow, falling camera tilt
   - coyote time and jump buffering, pull toward centre
   - side-view inset
   - assist after repeated falls
   - comfort options
4. **Art pass, part 1 (side view).**
   - the sheet frame (crop marks, slug, colour bar)
   - grain instead of dots
   - ink starvation as the ink runs out
   - motion on twos
   - a real typeface
5. **Art pass, part 2 (first person in WebGL).**
   - plates as parallax sheets, split-fountain sky
   - speed shown as misregistration
   - the clean-proof crash, surface-stable grain
6. **Drawing feel and sound.** Smoothing, snapping, the ink meter under the pen, per-material sounds, the press thunk.
7. **Sharing.**
   - track codes in the URL (the ink limit keeps them tiny)
   - the ride printed as a downloadable poster, and a GIF of each ride
   - the daily sheet with a share string
8. **Launch.** Record the hero clip, warm up the account, set up hosting and a place to capture interest, then post in the planned order.

### Still to design
- What wind and gravity wells *are* in first person. Current thinking: wind is a tailwind lane that lifts and speeds you, and a well bends the ribbon you ride.
- Whether every level ends in a ride, or some are pure side-view puzzles.
- **The name.** "Drift" is a placeholder and is probably taken. Print puns worth checking: *Print Run*, *Overprint*, *Misregister*.
