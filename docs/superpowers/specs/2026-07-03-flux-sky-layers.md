# FLUX-Layered Sky: Clouds and Sun

**Date:** 2026-07-03 · **Branch:** `feat/ember-horizon-sky` · **Status:** draft for review

## Why

The hero sky's clouds are three blurred SVG ellipses filled with a linear gradient — uniform
lobes, no internal shading, no relationship to where the sun actually sits. The sun's ray
field is a procedural CSS conic-gradient. Both work, but both look drawn, not lit.

FLUX.1 [pro] can paint real cloud volume and a real light burst that procedural CSS can't
cheaply fake. The risk this spec manages: the sky is fully parametric (color driven by
`skyPalette()`/elevation, re-graded every render), so a plain FLUX raster would fight that —
it can't re-grade across sky states. The fix, validated with working mockups this session:
use FLUX output as a **luminance mask**, not a final-color image. Shape comes from FLUX;
color still comes 100% from the existing palette math.

## What was tried and ruled out

- **Grain/noise via FLUX** — attempted twice, both times FLUX smoothed away the fine
  independent per-pixel randomness that makes grain read as grain. Diffusion models are the
  wrong tool for this specific texture. The procedural `feTurbulence` grain filter stays
  as-is; no further FLUX spend here.
- **CSS `mask-image` with an alpha-baked WebP** — the first cloud mockup rendered as flat
  rectangles. Root cause: CSS `mask-image` defaults to **alpha**-channel masking, and the
  opaque grayscale WebP had no alpha variation, so the mask was 100% opaque everywhere.
  Moot once the SVG approach (below) was chosen, but worth recording: don't re-introduce
  CSS `mask-image` for this without baking luminance into alpha first.
- **A free "auto-flip toward the sun" trick** — considered as a zero-asset way to fake
  directionality by mirroring the cloud shape. Dropped: the hotspot layer (below) already
  provides directional lighting, and mirroring an asymmetric painted shape risks looking
  wrong as often as right. Simpler to not do it.

## Mechanism: SVG luminance masks, not CSS masks

`js/sky.js`'s existing `moonSVG()` already establishes the pattern this spec follows: a
painterly raster asset lives at `assets/sky/*.webp` and is referenced via `<image href="...">`
inside inline SVG. This spec extends that pattern rather than introducing a second one.

The key technical fact that simplifies the whole pipeline: **SVG `<mask>` defaults to
luminance masking** (opacity = luminance × alpha), unlike CSS `mask-image` (defaults to
alpha masking). Since every FLUX cloud/sun PNG is opaque (alpha = 1 everywhere) with the
shape painted in luminance, an SVG mask can use the **raw FLUX grayscale export directly** —
no alpha-baking step, no separate mask-vs-texture asset. One file per shape does double duty:

1. **Silhouette** — the file, used inside an SVG `<mask>`, cuts the shape out of a rect
   filled with the existing `--cloud-hi/--cloud-mid/--cloud-sh` gradient (unchanged from
   today — this is exactly why color stays palette-driven).
2. **Shading overlay** — the *same* file, rendered a second time directly (not inside a
   mask) with `mix-blend-mode: soft-light`, clipped to the same mask. This reintroduces
   FLUX's own painted lobes/crevices as real tonal shading on top of the flat gradient fill,
   instead of discarding that detail once the silhouette is cut.
3. **Directional hotspot** — a warm radial fill, `mix-blend-mode: screen`, clipped to the
   same mask, positioned via a new `--hotspot-x: var(--sun-x, 50%)` custom property so the
   warm bloom sits on whichever side of the cloud the sun currently occupies. Recalculated
   once a minute along with the rest of the scene (not continuously animated) — consistent
   with how `--sun-x` itself already updates.

All three stages were built and screenshotted this session (golden hour + midday, current
vs. FLUX-masked) and approved.

## Assets

Four new files under `assets/sky/`, alongside the existing `moon.webp`:

| File | Source (already generated, in scratchpad) | Used for |
|---|---|---|
| `assets/sky/cloud-tower.webp` | dramatic vertical cumulus | `c1` (near) |
| `assets/sky/cloud-classic.webp` | flat-bottomed postcard puff | `c2` (mid) |
| `assets/sky/cloud-hazybank.webp` | low, flat, low-contrast bank | `c3` (far) |
| `assets/sky/sun-starburst.webp` | sharp radiating starburst | sun ray field |

Each source PNG (2752×1536) gets resized down (~800–900px wide is plenty at card scale,
matching the existing `moon.webp`'s 512×512 for reference) and converted to WebP as part of
implementation — same asset weight class as the existing texture/moon assets, not a
meaningfully new bandwidth cost.

**Non-goal:** unlike the birth constellation, cloud and sun shapes are fixed art assets —
they do not vary per install or per baby. Only their color (palette) and position (sun/time
math) are parametric, exactly as today.

## Cloud rendering changes (`js/sky.js`)

`cloudsHTML(mode)` changes from three `<ellipse>` shapes per puff to, per puff:

```
<mask id="cloud-{cls}-mask"><image href="assets/sky/{shape}.webp" .../></mask>
<rect mask="url(#cloud-{cls}-mask)" fill="url(#cloud-{cls}-gradient)"/>            <!-- silhouette + palette fill -->
<image href="assets/sky/{shape}.webp" mask="url(#cloud-{cls}-mask)" class="cloud-shade"/>  <!-- soft-light shading -->
<rect mask="url(#cloud-{cls}-mask)" class="cloud-hotspot"/>                        <!-- screen-blended hotspot -->
```

`c1`/`c2`/`c3` keep their existing scale/opacity/drift/bob CSS exactly as today — only the
fill mechanism inside each layer changes. Layer→shape assignment: `c1` = tower, `c2` =
classic, `c3` = hazy bank (matches today's near/mid/far depth ordering).

The `.cloud-hotspot` fill is a radial gradient positioned at `--hotspot-x` (defaults to 50%
when no sun renders, e.g. `night`), warm color, low-to-moderate opacity scaled by the
existing `--sun-warm` var so the hotspot fades out near midday (when there's no strong
directional low sun) and strengthens at golden hour/morning (matching how `--sun-warm`
already drives the sun's own scale/warmth).

## Sun rendering changes

`.sun-rays`' current CSS `conic-gradient` background is replaced by an SVG-or-masked-div
layer using `sun-starburst.webp` as a luminance mask over a warm, screen-blended fill.
**Rotation and breathe animations are unchanged** (`sun-rays-rot` 240s linear,
`sun-rays-breathe` 19s ease-in-out) — only what's being rotated changes, from a procedural
gradient to a masked raster. Reduced-motion and low-power gating (already present for
`.sun-rays`) cover the new version without changes.

## Z-order: sun stays behind clouds (explicit, protected)

Checked against the current code: `skyScene()` already concatenates `bodies` (sun + moon)
into the returned markup **before** `cloudsHTML()` (`js/sky.js:308-329`), so in DOM paint
order clouds already render on top of the sun, and cloud opacity (`.62/.46/.32`) lets the
sun/rays partially show through — the physically correct look. This spec's changes must not
invert that. Concretely:
- No new `z-index` on `.sun-rays`, `.sky-sun`, or any cloud layer — stacking stays purely
  DOM-order-driven, as today.
- A new test in `js/sky.test.js` asserts source order directly: the returned HTML string's
  `sky-sun` (or `sky-moon`) marker index is lower than its `sky-clouds` marker index, so a
  future edit that reorders the markup fails a test instead of silently regressing.

## Non-goals / constraints (unchanged from the realism pass)

- No new dependencies, no WebGL.
- All continuous motion stays compositor-only (`transform`/`opacity`); the hotspot's
  position is a once-a-minute recalculation, not a continuous animation.
- `prefers-reduced-motion` and `.sky-low-power` gating extend to cover the starburst
  rotation exactly as they already do for the current ray field.
- Text contrast over the sky must not regress — verify in the brightest states (day,
  golden) since the hotspot and shading overlay add luminance to the scene.
- Version bump before commit (cached assets change). Update `docs/codebase-quickref.md`'s
  asset list.

## Verification

- **Unit:** new/updated `js/sky.test.js` coverage for the changed `cloudsHTML()` output
  (mask/gradient/shade/hotspot markup present) and the sun/cloud DOM-order assertion above.
- **Playwright:** existing per-state render tests stay green; add a screenshot check that
  `.sky-sun`/`.sky-moon` remain visually behind `.sky-clouds` isn't practical to assert
  pixel-wise, so the DOM-order unit test is the enforcement mechanism instead.
- **Manual beauty pass (`/run`):** screenshot golden hour, day, morning, twilight — the bar
  is the layered-lighting demo already approved this session (shading overlay + hotspot),
  now integrated into the real scene instead of a standalone mockup.

## Self-critique against generic defaults

- Didn't reach for "swap the cloud for a full-color FLUX photo" — that was the exact trap
  flagged going in (can't re-grade across sky states, can't vary — though these particular
  shapes don't need to vary). Mask-only keeps every mode's re-grade working unchanged.
- The hotspot is a deliberate small risk: it's a new moving part wired to sun position where
  none existed before. Justified because it's the one piece of this spec that makes the
  cloud lighting *respond to the scene's own physics* rather than being static regardless of
  time of day — the same principle the moon's bloom and the card's `--light-x/-y` already
  follow elsewhere in this scene.
- Explicitly protected the sun-behind-clouds z-order with a test rather than trusting visual
  review alone, since it's exactly the kind of thing an unrelated future edit could invert
  silently (e.g., moving clouds earlier in the markup for an unrelated reason).
