# Hero sky scene — realism & craft pass

**Applies to:** `js/sky.js` — the hero card's sun/moon/star/ridge scene.

## Direction: painterly realism, not photoreal

The scene's architecture (moon-phase math, sun-position mapping, palette interpolation) is sound; the rendering was flat — a sticker moon, uniform-noise stars, two flat ridge bands. This spec fixes *how layers are painted*, not the underlying math.

The resolved direction is **painterly realism**: the believable atmosphere of a Firewatch matte painting, not a flat illustration and not a literal photograph. A photoreal sky would read as a stock photo dropped into a hand-built clay-and-ember interior — it wouldn't belong to the app's material. Realism here means real depth, real light, real atmosphere, rendered in the app's own material.

## Binding constraint: one light, two sides of the glass

The hero card is a window in a firelit room. The scene must share that fire:

- The hearth-window glow in the scene and the app's ember material (`--ember-core/-mid/-cool`, `--mat-glow`) are the same warm source. Low horizon glow warms toward ember amber (oklch hue ~45–70) so the sky's bottom and the app's firelit chrome read as continuous. Night stays plum-silver above, ember-warm at the sill.
- Reuse existing texture assets (`--tex-linen`, `--tex-clay`, `plaster.webp`) at low opacity for grain, rather than a separate `feTurbulence` noise layer — literal shared material beats a lookalike.
- `--light-x/--light-y` stays wired to the moon/sun position so card highlights and the Playfair timer's shadow track the brightest body.
- The near ridge and the ember rail meet as one ground plane; a faint valley haze warmed by the rail seals the seam.

## Three principles behind every layer

1. **Atmosphere between layers** — haze, not hard silhouette edges. Depth is drawn with light, not darker fills.
2. **Light that spills** — the moon lifts the sky around it and silvers ridge tops; nothing is a self-contained shape.
3. **Non-uniform detail** — star fields, tree lines, and lunar surfaces are clustered and irregular; uniform randomness reads as noise.

Applied per layer: the moon is a modeled surface with warm-cool body and a two-part glow (tight corona + wide sky-lifting halo), not a flat disc; stars follow a magnitude power-law (mostly faint, a few bright, coupling size to brightness) with a density gradient toward the zenith, not uniform dots; ridgelines are 3–4 depth layers with rim haze and an irregular near silhouette, not two smooth curves.

## Constraints (unchanged from the original scene design)

- No new dependencies, no WebGL.
- All continuous motion is compositor-only (`transform`/`opacity`); bodies reposition once a minute — a clock, not an animation.
- `prefers-reduced-motion` → fully static scene. Low battery → particles/parallax off, drift slowed, scene stays beautiful static.
- Text contrast (timer, state line) must stay legible over the brightest sky in every state — verify, don't assume.

## Self-critique this spec applied

Deliberately avoided the generic AI-default "near-black + one acid accent" night — the night here is plum-silver above, warming to ember at the sill, derived from the app's own fire rather than a generic dark theme. The one bold risk taken: the moon becomes a real light source that lifts the surrounding sky and silvers the ridges, while stars, hills, and grade stay quiet around it.
