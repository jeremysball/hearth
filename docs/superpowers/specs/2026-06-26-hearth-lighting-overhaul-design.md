# Hearth Lighting Overhaul — Design Spec

**Date:** 2026-06-26  
**Status:** Approved, ready for implementation planning

---

## Overview

A complete overhaul of the visual material and lighting system. The metaphor: a real hearth burning below the bottom of the screen. The phone surface is a wooden mantelpiece. Quick-action toks are clay tokens sitting on it. Cards are heavy fired-clay slabs. The fire breathes, and every surface responds.

Five distinct problem areas addressed:
1. Light mode feels like marble, not clay/terracotta
2. Lighting is cosmetic (only the phone background glows) — buttons and cards ignore the fire
3. Dark mode is flat and broken (invisible quick-button text, low chroma, no depth)
4. Segmented controls have visual artifacts (shadow sticking, edge flashing, snap-back)
5. No sliding pill animation on segmented controls

---

## 1. Terracotta Material System (Light Mode)

### Problem
Current `--page: oklch(0.875 0.052 50)` with `soft-light` texture blending reads as cool plaster. Too pale, too low-chroma, too white.

### Changes

**Palette:** Push base chromas and hue toward 40–45 (fired terracotta). Deepen `--page` and `--bg` so surfaces read as dense material, not thin wash.

```css
/* girl theme — fired terracotta */
--page:    oklch(0.845 0.068 44);
--bg:      oklch(0.895 0.055 46);
--surface: oklch(0.930 0.038 50);
--hair:    oklch(0.820 0.048 48);
--mat-highlight: oklch(0.86 0.10 58 / 0.40);
--mat-shadow:    oklch(0.28 0.09 40 / 0.32);
--mat-cast:      oklch(0.32 0.03 300 / 0.22);  /* cool-tinted cast — see §2 */
--mat-glow:      oklch(0.80 0.14 52 / 0.50);
```

**Texture blending:** Switch phone shell from `soft-light` → `overlay` on the plaster texture. `overlay` gives craggier, darker grain — reads as rough fired material not smooth marble. Cards keep `soft-light` (subtler for a smaller surface).

**Fire ember palette (new tokens):**
```css
--ember-core: oklch(0.86 0.20 56);    /* hottest: near-white gold */
--ember-mid:  oklch(0.74 0.19 42);    /* true firelight orange — workhorse */
--ember-cool: oklch(0.58 0.16 33);    /* dull red at cool edges */
--ember-rim:  oklch(0.70 0.175 44 / 0.55); /* the alpha rim color elements use */
```

Key principle: as an element dims/recedes, lower L AND rotate hue toward red (hue 56 → 33). This is how real fire dims. Artificial warm lighting keeps constant hue — that's what makes it look fake.

---

## 2. Firelight Directional Shadow System

### Light source geometry
Bottom-left, conceptually at `x: 18%, y: 118%` (below and left of viewport). This is where the current `::before` glow already sits — we commit to it.

**Shadows must fan, not just point up.** Cast shadows offset upward AND to the right (away from the bottom-left source). Offset magnitude increases with element height on screen — elements near the top are geometrically farther from the fire and their shadow rakes harder right.

**Warm-cool shadow split (critical):** Cast shadows are `oklch(0.32 0.03 300 / 0.22)` — slightly blue-violet, very low chroma. Warm light + cool shadow = physically correct firelight. Warm light + warm shadow = sepia filter. This single decision separates the two.

### Animatable fire properties

Register three CSS custom properties on `:root`:

```css
@property --fire-a { syntax: '<number>'; inherits: true; initial-value: 0.06; }
@property --fire-b { syntax: '<number>'; inherits: true; initial-value: 0.04; }
@property --fire-c { syntax: '<number>'; inherits: true; initial-value: 0.10; }
```

Animate with three coprime periods (5.3s, 3.1s, 8.7s) — true repeat period ~140s, imperceptible loop:

```css
:root {
  animation:
    fire-a 5.3s ease-in-out infinite,
    fire-b 3.1s ease-in-out infinite,
    fire-c 8.7s ease-in-out infinite;
}
@keyframes fire-a {
  0%   { --fire-a: 0.06; } 11%  { --fire-a: 0.13; } 23%  { --fire-a: 0.05; }
  34%  { --fire-a: 0.11; } 48%  { --fire-a: 0.15; } 61%  { --fire-a: 0.07; }
  64%  { --fire-a: 0.07; } 67%  { --fire-a: 0.19; } 71%  { --fire-a: 0.09; } /* rare flare */
  72%  { --fire-a: 0.12; } 84%  { --fire-a: 0.04; } 93%  { --fire-a: 0.10; }
  100% { --fire-a: 0.06; }
}
@keyframes fire-b {
  0%   { --fire-b: 0.04; } 28%  { --fire-b: 0.10; } 51%  { --fire-b: 0.03; }
  74%  { --fire-b: 0.09; } 100% { --fire-b: 0.04; }
}
@keyframes fire-c {
  0%   { --fire-c: 0.08; } 30%  { --fire-c: 0.14; } 60%  { --fire-c: 0.07; }
  80%  { --fire-c: 0.12; } 100% { --fire-c: 0.08; }
}
```

Remove the existing separate `hearth-flicker-a/b` opacity animations from `.phone::before/after`. Replace with opacity driven by `--fire-a` and `--fire-b` directly. The two pseudo-elements stay, but they're now in sync with the same properties that drive everything else.

### Phase offset by screen position

Elements closer to the fire flicker first; top elements lag. Applied via `animation-delay` on the elements themselves:

- `.tabbar`: `animation-delay: 0s` (nearest fire)
- `.tok`, `.act`: `animation-delay: -0.15s` (slightly above tabbar)
- `.card`, `.info-card`: `animation-delay: -0.28s`
- Top-of-screen elements: `animation-delay: -0.40s`

Negative delays mean elements are mid-cycle on load — no cold start.

### Per-element shadow recipe

**Tok buttons (46px circles, low lift ~3px):**
```css
.tok {
  box-shadow:
    /* convex crown: top inset highlight */
    0 1.5px 0 oklch(0.98 0.01 75 / 0.50) inset,
    /* underside in shade: inset bottom darkening */
    0 -3px 4px -2px oklch(0.30 0.06 44 / 0.35) inset,
    /* fire rim: animated, bottom edge */
    0 2px calc(5px + var(--fire-a) * 4px) -1px var(--ember-rim),
    /* cast shadow: upward + rightward, cool-tinted */
    3px 5px 8px var(--mat-cast);
  background-image:
    radial-gradient(ellipse 120% 90% at 50% 8%, oklch(0.97 0.012 70 / 0.45) 0%, transparent 42%),
    radial-gradient(circle at 32% 118%, var(--ember-core) 0%, transparent 50%),
    var(--tex-clay);
  background-blend-mode: normal, screen, soft-light;
}
```

Active/press state: fire rim shrinks, cast collapses (object moves toward surface). Spring bezier `cubic-bezier(0.34, 1.56, 0.64, 1)` on release (small object, light bounce). Fast `.06s` press.

**Cards (heavy slabs, lift ~8-10px):**
```css
.card {
  box-shadow:
    0 1px 0 oklch(0.97 0.01 80 / 0.65) inset,   /* top highlight, broad + dim */
    0 -1px 0 var(--mat-shadow) inset,             /* underside darkening */
    0 1px 0 oklch(0.30 0.06 44 / 0.4),           /* slab thickness hairline */
    6px 14px 28px var(--mat-cast);               /* long soft cast */
}
```

Cards use gentle `cubic-bezier(0.2, 0.8, 0.2, 1)` — heavy slabs don't bounce.

**Tabbar (closest to fire, strongest rim):**
```css
.tabbar {
  box-shadow:
    0 -10px 24px oklch(0.55 0.18 44 / calc(var(--fire-a) + var(--fire-c))),  /* up-cast */
    0 -1px 0 oklch(0.70 0.16 46 / 0.35);   /* amber rim along top edge */
}
```

### Lit hierarchy (do not flatten)
Tabbar > primary action tok (hero sheen) > secondary toks > cards > top-screen elements. Some elements should sit mostly in shade — contrast between lit and unlit is the lighting.

### Phone shell
Keep `::before`/`::after` pseudo-elements. Switch from `mix-blend-mode: screen` to `mix-blend-mode: overlay` for denser fire-on-terracotta interaction.

---

## 3. Dark Mode Fixes

### A. Quick button text invisible

Add dark-mode tone overrides for all categories. Currently only `.play` and `.bath` have them. Every category needs a dark-appropriate `--tc` (icon color) and `--tcb` (circle background) — deep saturated backgrounds with bright icons:

```css
[data-mode="dark"] .sleep,  [data-mode="dark"] .tone-sleep  { --tc: oklch(0.80 0.12 145); --tcb: oklch(0.22 0.06 143); }
[data-mode="dark"] .feed,   [data-mode="dark"] .tone-feed   { --tc: oklch(0.82 0.10 52);  --tcb: oklch(0.24 0.06 48);  }
[data-mode="dark"] .diaper, [data-mode="dark"] .tone-diaper { --tc: oklch(0.80 0.12 70);  --tcb: oklch(0.22 0.06 68);  }
[data-mode="dark"] .med,    [data-mode="dark"] .tone-med    { --tc: oklch(0.78 0.12 35);  --tcb: oklch(0.22 0.06 33);  }
[data-mode="dark"] .note,   [data-mode="dark"] .tone-note   { --tc: oklch(0.75 0.02 55);  --tcb: oklch(0.24 0.02 52);  }
```

### B. Palette depth

Dark mode base chromas are too low (0.016–0.022), reading as generic grey. Push toward warm walnut:

```css
[data-mode="dark"][data-theme="girl"] {
  --page: oklch(0.15 0.025 46);
  --bg:   oklch(0.195 0.022 48);
  --surface: oklch(0.240 0.020 50);
}
```

### C. Vertical luminance gradient (dark mode page background)

Replace flat `--page` with a gradient — warm and brighter at the bottom (near fire), sinking to near-black at top:

```css
[data-mode="dark"] body {
  background: linear-gradient(
    0deg,
    oklch(0.26 0.05 46) 0%,
    oklch(0.17 0.018 55) 55%,
    oklch(0.13 0.012 50) 100%
  );
}
```

### D. Dark mode fire

Double the multipliers — fire is the dominant light source in a near-dark room. Rim chroma up to `oklch(0.88 0.22 56)` for `--ember-core`. Cast shadows near-invisible (dark-on-dark is wasted; absence of rim is the shadow).

**Vignette top corners:**
```css
[data-mode="dark"] .phone::after {
  /* in addition to fire glow: */
  background: radial-gradient(ellipse at 50% -10%, transparent 40%, oklch(0.10 0.01 50 / 0.6));
}
```

---

## 4. Sliding Pill Segmented Controls

### Architecture

Inject a `.seg-thumb` div as the first child of every `.segctl` at render time (in the `seg()` template function in `sheets.js`). One absolute-positioned element physically slides across the track. The `.seg-opt` buttons become transparent overlays — only their text color changes on `.on`.

### CSS

**Track (recessed channel — carved into the surface):**
```css
.segctl {
  position: relative;
  overflow: hidden;   /* clips thumb cleanly at edges — fixes edge flash */
  box-shadow: 0 1px 3px var(--mat-shadow) inset, 0 -1px 0 var(--mat-highlight) inset;
  background-color: var(--accent-tint);
  /* cooler/darker than surrounding surface — a groove is in shade */
}
```

**Pill (raised clay tile sitting in the channel):**
```css
.seg-thumb {
  position: absolute;
  top: 4px; bottom: 4px; left: 0;
  border-radius: 10px;
  pointer-events: none;
  background-color: var(--surface);
  background-image:
    radial-gradient(ellipse 110% 85% at 50% 10%, oklch(0.97 0.012 70 / 0.5) 0%, transparent 45%),
    radial-gradient(circle at 30% 115%, var(--ember-rim) 0%, transparent 50%);
  box-shadow:
    0 1.5px 0 oklch(0.98 0.01 75 / 0.6) inset,   /* convex crown */
    0 -2px 3px -1px oklch(0.30 0.06 44 / 0.25) inset,  /* underside shade */
    0 2px 6px var(--mat-cast),                     /* drop shadow (raised) */
    0 calc(2px + var(--fire-a) * 3px) calc(5px + var(--fire-a) * 3px) -1px var(--ember-rim); /* fire rim */
  transition:
    transform 0.42s cubic-bezier(0.34, 1.4, 0.5, 1),
    width 0.42s cubic-bezier(0.34, 1.4, 0.5, 1);
}
```

**Reduced motion:** `transition: transform 0.12s ease, width 0.12s ease;`

**Seg-opt (transparent, text only):**
```css
.seg-opt { color: var(--soft); background: none; box-shadow: none; }
.seg-opt.on { color: var(--accent-ink); background: none; box-shadow: none; }
```

### JS — thumb positioning

In `app.js` global click delegation, after updating `.on` class:

```js
function positionThumb(group) {
  const thumb = group.querySelector('.seg-thumb');
  const active = group.querySelector('.seg-opt.on');
  if (!thumb || !active) return;
  const firstOpt = group.querySelector('.seg-opt');
  thumb.style.width = active.offsetWidth + 'px';
  thumb.style.transform = `translateX(${active.offsetLeft - firstOpt.offsetLeft}px)`;
}
```

On sheet open: inject thumb, call `positionThumb` with `data-no-transition` set on thumb (or `transition: none` inline), then remove on `requestAnimationFrame`. Subsequent clicks slide.

```js
// After injecting thumb:
thumb.style.transition = 'none';
positionThumb(group);
requestAnimationFrame(() => { thumb.style.transition = ''; });
```

### Snap-back fix

Snap-back was a visual artifact of per-element shadow transitions conflicting with class toggling. With the thumb as the sole moving element, there is no conflicting transition. `overflow: hidden` on `.segctl` prevents edge clipping artifacts.

---

## 5. Accessibility

- `prefers-reduced-motion`: freeze `--fire-a`, `--fire-b`, `--fire-c` at comfortable mid values (not minimum — a still fire looks warm, not dead). Pill transition snaps to `.12s ease`.
- Text never sits on a fire-driven background color — always on `--surface` or `--bg` which only changes with `--bg` palette, not flicker.
- Verify contrast at the *trough* (dimmest flicker point), not average. Rims and glows must not undercut text legibility.

---

## Files Changed

- `styles.css` — palette tokens, material system, fire properties + keyframes, tok/card/tabbar shadows, dark mode fixes, segctl/thumb styles
- `js/sheets.js` — inject `.seg-thumb` into `seg()` template, initial no-transition positioning
- `js/app.js` — `positionThumb()` helper, call after click updates `.on`, call on sheet open

---

## Out of Scope

- Ember particle effects (violates one-ambient-animation rule)
- Heat haze on hero timer (separate animation, address independently)
- Per-element vertical-position shadow angle variation (desirable but adds complexity; start with three coarse buckets if time allows)
