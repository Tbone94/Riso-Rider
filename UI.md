# UI language: print-shop look, plain words (v2, 2026-09-27)

Every menu, button, popup and label *looks* like a real object from a small risograph shop: paper, stamps, slips, clips. Nothing is a generic app widget. The words stay plain game language (see "Words" below).

## Banned: this is what makes UI read as AI or template
- **Shapes and effects:** pill buttons, full-radius capsules, rounded-2xl cards, glassmorphism, blur backdrops, soft drop shadows, gradients, glow.
- **Brutalism:** the chunky black-border "neo-brutalist" offset-shadow card. We had it; it's now a trend cliché. Replace it with ink misregistration (below).
- **Fonts:** Inter, Space Grotesk, Space Mono, IBM Plex, Poppins, Montserrat, system-ui for display.
- **Icons and effects:** emoji as icons, Material or Lucide icon look, springy bouncy easing, confetti.
- **Layout:** centered modal plus dimmed overlay as the default popup pattern.

## Type: two families, no more
- **Big Shoulders Stencil** (Google Fonts: `Big Shoulders Stencil Display`, weights 400–900). Used for headings, buttons, labels and numbers. A riso *is* a stencil duplicator (it burns a stencil master), so the stencil face is the machine's own voice.
- **Cutive Mono** (Google Fonts). Used for the typewriter voice on slips, tickets, hints, toasts and slug lines.
- **Sizes:** big display numbers set tight. Labels in stencil caps with wide tracking (0.12–0.2em). Mono is always sentence case.
- **Misregistered headline:** mid ink offset 2–3 px behind key ink, via text-shadow with no blur, `text-shadow:2px 1.5px 0 var(--mid)`. This is the only "shadow" style in the game.
- **In-canvas text** (ghost X label, ride HUD, stamps) uses the same two families. Load them with `document.fonts.load` before the first draw.

## Shapes
- **Paper, not cards.** Straight-cut rectangles with a faint paper grain. Corners are square. Edges are either clean-cut, perforated (a row of little half-circles via CSS mask) or torn (only on slips).
- **Hand-placed tilt.** Each paper element gets a seeded tilt of ±0.4–1.2°, so nothing is perfectly square. The seed comes from the element's name, so it's stable between visits.
- **Real fasteners.** Staples, one paperclip, and punched holes are drawn as tiny key-ink SVGs. Use them sparingly, one per element at most.
- **Registration marks** (the crosshair-in-circle) sit at the stage corners. A colour bar strip shows the 3 inks plus their overprints.

## Components
| Component | Print-shop object | Details |
|---|---|---|
| **Level select** | Printed thumbnails clipped to a line | Each level is a mini thumbnail printed in its own inks, with its number ("03"), its name in mono, and earned stars as small stamp impressions. Locked levels show just the number on blank paper, labelled "locked". |
| **Buttons** | **Rubber stamps** | Stencil caps inside a stamp frame (single or double rule, square corners), ink slightly uneven (speckle mask). Pressing is a stamp: a 2-frame hold (scale .97, ink darker), no easing bounce. The primary action (RIDE) is the only solid-filled stamp; others are outlined. |
| **Tool picker** | A tray of stamps, labelled TOOLS | Four stamp faces showing the tool's *mark*: solid line, dashed rope, streaked wind, ringed well, so tools are never distinguished by colour alone. The active stamp is "inked" (filled) and nudged up 2 px. The key number sits beside it in mono. |
| **Ink meter** | **The colour bar** along the sheet edge | A strip of ink patches that empty from right to left as you draw. The 3★ and 2★ pars are registration ticks labelled ★★★ and ★★. It must read as a printer's control strip, not a progress bar. |
| **Toasts** | Paper slips | A narrow slip slides out from the top edge, typed in mono, with a simple line icon. Holds for 1.4 s, then slides back. |
| **Fail feedback** | Slip plus stamped X | The slip says why ("Popped!", "Fell off the tightrope.", "Stuck.") with an icon: down arrow, burst or pause. The side view's stamped X marks where it happened. |
| **Retry hint** | Typed on the slip | "R ride again · E edit your drawing". |
| **Win** | A stamp on the stage | "CLEARED!" is stamped in big stencil, with three star stamps landing one at a time (thunk, 2-frame hold each). Ink used vs par, time, jumps and falls are typed on a ticket stub below. Next = "NEXT LEVEL →". No overlay-and-card modal. |
| **Assist offer** | A paperclipped note | After 3 falls: "Having trouble? Try slow-mo. You still earn full stars." Buttons: SLOW-MO (assist 1), AUTO-RIDE (assist 2), NO THANKS. |
| **Settings** | A panel styled like a machine's control strip | Stencil labels, readouts in little inset windows ("90°"), two-position switches. Names: Field of view, Camera (First person / Chase), Head bob, Reduce motion, Ride assist (Off / Slow-mo / Auto-ride). |
| **Loading** | "LOADING LEVEL 03…" | A paper strip with a scrolling stripe. |
| **HUD in the ride** | **Minimal slug lines** | The in-canvas key hint is a slug line in mono along the bottom edge that fades out. |

## Words: plain game language (decided 2026-09-27)
The *look* borrows from a print shop. The *words* never do: the user found print jokes and jargon confusing ("jobs", "spoils", "feed speed", "OK TO PRINT", proofreader's marks). Use plain game words everywhere:

| Thing | Say |
|---|---|
| Level | Level (LEVEL 01) |
| Level list | Levels |
| Failed attempts | Falls |
| Assist | Ride assist: Off / Slow-mo / Auto-ride |
| Win stamp | CLEARED! |
| Loading | LOADING LEVEL 03… |
| Fail notes | Popped! / Fell off the tightrope. / Stuck. With a simple icon: down arrow, burst, pause. No proofreader's marks. |
| Settings | Field of view, Camera (First person / Chase), Head bob, Reduce motion, Ride assist |
| Shelves (2026-10-03) | Levels · Time trials · Make · Community |
| Time trials | TRIAL 02, Checkpoint (CP 2), respawn ("Back to checkpoint 2."), Best, medals: Author / Gold / Silver / Bronze |
| Maker | Make, New puzzle, New time trial, Pieces (Slab, Box, Spikes, Boost, Line, Wind, Rope, Sling, Drop, Check, Move, Erase), Solid / Ice / Crumble, Free / Grid, Details, Test, Share, Back to maker |
| Clear check | "Beat your level to share it." · "Clear check passed" · "Changed since your clear." |
| Sharing | Level code, Copy code, Copy link, Open level ("Paste a level code someone shared with you.") |

## Motion
- **Paper moves like paper.** It slides from a feed (straight line, ease-out), drops flat, and never bounces or springs.
- **Stamps.** Instant down, a 2-frame hold, then up. Held frames beat smooth tweens here; the research calls this animating on twos.
- **Reduced motion:** swap slides for a 120 ms fade, and have stamps appear without the hold.

## Colour
- **Reprinting per level.** The UI uses only the current level's 3 inks (CSS vars `--light`, `--mid`, `--key`) plus the paper colour, so the whole interface reprints in each level's inks. That's the cohesion.
- **Grain.** A subtle grain overlay (the same speckle as the game) on paper UI elements, via a small noise PNG or SVG `feTurbulence`, kept static.

## v7 additions (2026-10-03): time trials, the maker, sharing
All of these reuse the components above, and nothing new looks like an app widget:
- **Shelves:** index tabs over the level strip. They're square, stencil caps, outlined; the open one is inked.
- **The pieces tray:** a second stamp tray labelled PIECES, the same as TOOLS. Each piece shows its mark (a slab, a box, spikes, chevrons, the tool marks, a drop, a dashed ring, a move cross, an erase X). Material and grid are two-position switches.
- **Details and Share:** paper sheets built like the settings panel (screws, square, tilted), in the layout and never as a modal. Text fields are typed on an underline. Pickers are the panel's inset windows. The level code sits in a dashed box.
- **Medals:** stamps (Author has the double rule), inked once earned. On a trial win the time is stamped where CLEARED! goes, and the medal stamps land one at a time like stars.
- **The clock:** big stencil numbers with the misregistered mid ink, top centre. The checkpoint split under it is typed.
- **Your own levels print in your own inks and paper.** The whole interface reprints in them, exactly as for campaign levels.
