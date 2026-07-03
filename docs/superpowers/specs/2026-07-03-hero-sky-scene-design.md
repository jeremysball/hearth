# Hero Sky Scene — Design

**Date:** 2026-07-03 · **Branch:** `feat/hero-sky-scene` · **Status:** approved pending user review

## Concept

The hero card becomes a window seen from inside a firelit room. The app around it is
the hearth-warm interior (light mode's clay cream, dark mode's ember maroon); through
the window is a living landscape whose day/night cycle runs on **sleep-pressure time**,
not wall-clock time. The sun's position *is* the wake-window prediction: it rises when
the baby wakes and sets at the sweetspot. The scene doesn't decorate the prediction —
it is the prediction.

## Composition (sky over hearth)

Top ~70% of the card is sky; below it, two or three silhouette ridgelines
(Firewatch-style layered hills with atmospheric perspective) descend to the existing
ember rail, which becomes the nearest ground plane. Timer, state line, and sub-text
overlay the sky. The card grows modestly taller. Shape, radius, and grid position are
unchanged.

```
┌──────────────────────────────┐
│ ✦     ✦      ☾ halo      ✦  │  sky gradient + grain
│ ● Awake since 2:10           │
│ 1h 24m          (Playfair)   │
│ Sleep pressure is high…      │
│ ~~~~~~ far ridge (haze) ~~~~ │  parallax 0.3
│  ~~~ near ridge ~~ ⌂ window  │  parallax 0.6 · signature
│ ▁▂▃ ember rail (hearth) ▃▂▁ │  ground plane
│ 2:10          window ~2h ⓘ  │
└──────────────────────────────┘
```

## Signature element: the hearth-light

A tiny silhouette house on the near ridge with one warm lit window and an occasional
wisp of chimney smoke. You are inside one hearth-lit home looking out at another. At
golden hour it is a warm point against the glow; in overtired twilight it becomes the
brightest thing in the frame; at night it glows beneath the moon. This is the one
bold element — everything around it stays quiet.

## Scene states

Driven by `derive.status()` + `derive.sweetSpot()`. Sun arc position =
`elapsed / prediction.high`, mapped right (east) → left (west) across a shallow arc.
Position and palette update once per minute with the existing timer refresh.

| State | Sky |
|---|---|
| Awake, early window | Morning: sun low right, milk-sky wash, long soft light |
| Mid window | Day: sun cresting, quiet cerulean-cream, drifting clouds |
| Entering / in sweetspot | Golden hour: sun descending left, rose-amber, underlit clouds, fireflies |
| Past window (overtired) | Deepening twilight: sun set, ember afterglow → dusk, first stars; hearth-light dominant. Replaces the red overtired pulse. |
| Asleep (any time) | Night: starfield, real-phase moon. Baby's world, not the wall clock. |
| Circadian night (12–6 am) | Deep night: dimmer, sparser motion, moon prominent |
| Newborn (< 6 weeks) | Fixed gentle mid-morning sky — no window to map |

## Palette

Painterly, desaturated, warm-graded (Ghibli-adjacent, never weather-app blue). One
interpolation function: sun elevation → oklch stops (zenith, horizon, glow). All scene
colors derive from it, so state transitions are continuous. Night zenith sits at plum-
violet (oklch hue ≈ 300, warm undertone) to harmonize with dark mode's maroon firelight;
moonlight stays silver for the cool-through-the-glass contrast. Light-mode day skies
stay inside the app's peach-cream family. Ridge tints = horizon color darkened by
depth (atmospheric perspective).

The light source position feeds the existing `--light-x`/`--light-y`, so card material
highlights and the Playfair timer's text-shadow follow the sun/moon. The scene grade
must guarantee text contrast in every state.

## Celestial bodies

- **Moon:** real lunar phase — days since a known new-moon epoch mod 29.53 — rendered
  as SVG circle + offset ellipse mask (geometrically correct terminator, correct
  waxing/waning side), with 3–4 stacked halo layers.
- **Sun:** SVG disc with stacked bloom halos; grows and warms at low elevation. Glow
  tints nearby cloud edges.
- **Stars:** one seeded-random `box-shadow` field on a single element, plus a few bright
  stars with staggered twinkle. At night, the baby's birth constellation (from
  `baby.dob`) is faintly traced — slightly brighter points, hairline lines at ~8%
  opacity. Never announced; discovered.

## Layers (back → front)

sky gradient → stars/constellation → sun/moon SVG → far clouds → near clouds →
ridgelines + house → **canvas** (smoke, fireflies, shooting stars, birds render in
front of the hills; shooting stars fade before reaching the ridgeline) → ember rail →
text content → grain + grade.

- **Clouds:** 2–3 blurred SVG blob clusters drifting at coprime durations (the
  `fire-a/b/c` trick). Undersides inherit the palette.
- **Grain:** one static `feTurbulence` noise layer, low opacity, `overlay` blend. Kills
  gradient banding; matches the app's linen/clay material world.
- **Grade:** one wash layer (soft vignette + palette-driven blend-mode tint) unifying
  the scene like a film LUT.
- **Parallax:** depth-scaled `transform` from device tilt (`deviceorientation`; iOS
  permission-gated on gesture, graceful fallback) plus a very slow autonomous drift.

## Canvas particle layer

One small canvas, DPR capped at 2, sparse particles only (tens):

- **Chimney smoke** wisps from the house (occasional)
- **Fireflies** over the dark hills — sweetspot only
- **Shooting stars** with fading trails — night, rare
- **Birds** crossing on a curved path — daytime, a few times an hour

The rAF loop runs **only while a particle event is live**; otherwise the canvas is idle.

## Performance & degradation

- 60 fps: all continuous motion (drift, twinkle, parallax) is compositor-only
  (`transform`/`opacity`); nothing animates layout or paint. Sun/moon reposition once
  a minute — a clock, not an animation.
- Canvas ticks only while the home view is visible (Page Visibility + view-change hook).
- `navigator.getBattery()` (where available): low battery → particles and parallax off,
  cloud drift slowed. Static painterly scene remains.
- `prefers-reduced-motion`: fully static scene.
- Hills, house, grain, constellation, grade: static layers, zero runtime cost.

## Code structure

New module `js/sky.js`: scene HTML builder, palette interpolation, moon-phase and
sun-position math, minute-tick updater, particle engine. `home.js` `heroCard()` calls
it. Scene CSS in `styles.css`. No new dependencies. Version bump required (user-facing
assets change). Update `docs/codebase-quickref.md` (new file, hero behavior).

## Testing

- **Unit (node:test):** moon-phase math at known dates, sun-position mapping at window
  fractions, palette interpolation at anchor elevations.
- **Playwright:** each scene state renders (drive via injected state); reduced-motion
  variant renders static.
- **Manual:** `/run` screenshots across all states × light/dark for the beauty pass.

## Out of scope

Other cards, sleep view, WebGL (possible later behind a setting), weather data,
geolocation.
