# Hearth Skeuomorphic Redesign — Design Spec

## Summary

Reskn Hearth's visual language from flat-modern to full skeuomorphic. The material world is **warm plaster & terracotta** — sun-warmed clay walls, hand-thrown pottery, rough linen. All depth is expressed through CSS gradient lighting over real grayscale textures sourced from ambientCG (CC0). Dark mode becomes "night hearth" with firelight from below.

---

## 1. Material System

### Textures (ambientCG CC0, grayscale only)

All textures are downloaded as JPG from ambientCG, desaturated to grayscale with ffmpeg, and saved as WebP to `assets/textures/`. Grayscale ensures they work across all four themes (girl/boy/dayjob-girl/dayjob-boy) without color clash. The CSS palette tokens drive all color; the textures contribute only surface structure.

| File | Source | Use |
|---|---|---|
| `assets/textures/plaster.webp` | ambientCG `Plaster003_1K-JPG.zip` | `.phone` background, `.tabbar` |
| `assets/textures/clay.webp` | ambientCG `Clay001_1K-JPG.zip` | `.tok` quick-action buttons, `.ic-ring`, `.chooser-ic` |
| `assets/textures/linen.webp` | ambientCG `Fabric019_1K-JPG.zip` | `.card`, `.info-card`, `.sheet`, `.chooser-item` |

### CSS Lighting Tokens

Light source: **warm afternoon sun, upper-left** (day mode). Flips to **firelight from below** (night hearth / dark mode).

```css
:root {
  --mat-highlight: oklch(0.98 0.015 80 / 0.55);   /* warm white, top edges */
  --mat-shadow:    oklch(0.38 0.05 48 / 0.20);     /* warm deep shadow */
  --mat-cast:      oklch(0.42 0.06 50 / 0.16);     /* cast shadow below surfaces */
  --mat-glow:      oklch(0.88 0.06 72 / 0.45);     /* ambient warm fill */
  --tex-plaster:   url('assets/textures/plaster.webp');
  --tex-clay:      url('assets/textures/clay.webp');
  --tex-linen:     url('assets/textures/linen.webp');
}

[data-mode="dark"] {
  --mat-highlight: oklch(0.72 0.13 50 / 0.22);    /* ember-warm, bottom edges */
  --mat-shadow:    oklch(0.08 0.02 40 / 0.60);
  --mat-cast:      oklch(0.18 0.04 45 / 0.50);
  --mat-glow:      oklch(0.52 0.15 45 / 0.28);
}
```

---

## 2. New Category Tones

Two new quick-action types require their own tones:

```css
.play, .tone-play { --tc: oklch(0.50 0.09 280); --tcb: oklch(0.90 0.04 285); }
.bath, .tone-bath { --tc: oklch(0.48 0.085 220); --tcb: oklch(0.88 0.04 215); }
```

Dark mode variants:
```css
[data-mode="dark"] .play,  [data-mode="dark"] .tone-play  { --tc: oklch(0.72 0.09 280); --tcb: oklch(0.30 0.05 285); }
[data-mode="dark"] .bath,  [data-mode="dark"] .tone-bath  { --tc: oklch(0.70 0.085 220); --tcb: oklch(0.28 0.05 215); }
```

---

## 3. Component Designs

### `.phone` (plaster background)

Remove the existing SVG `feTurbulence` data URI from `background-image`. Replace with:

```css
.phone {
  background-color: var(--bg);
  background-image:
    radial-gradient(ellipse 80% 60% at 30% 5%, var(--mat-highlight), transparent 65%),
    var(--tex-plaster);
  background-size: 100% 100%, 320px 320px;
  background-blend-mode: normal, soft-light;
}
```

Night hearth — light source flips to below:
```css
[data-mode="dark"] .phone {
  background-image:
    radial-gradient(ellipse 70% 45% at 50% 105%, oklch(0.55 0.15 48 / 0.30), transparent 70%),
    var(--tex-plaster);
  background-size: 100% 100%, 320px 320px;
  background-blend-mode: normal, soft-light;
}
```

### `.card` (linen surface)

```css
.card {
  background-color: var(--surface);
  background-image:
    radial-gradient(ellipse at 15% 10%, var(--mat-highlight), transparent 55%),
    var(--tex-linen);
  background-size: 100% 100%, 260px 260px;
  background-blend-mode: normal, soft-light;
  border: 1px solid oklch(0.88 0.025 70 / 0.5);
  box-shadow:
    0 1px 0 oklch(0.98 0.01 80 / 0.7) inset,
    0 -1px 0 var(--mat-shadow) inset,
    0 8px 28px var(--mat-cast),
    0 2px 6px var(--mat-cast);
}
```

Night hearth — bottom-lit:
```css
[data-mode="dark"] .card {
  background-image:
    radial-gradient(ellipse at 50% 90%, oklch(0.50 0.12 50 / 0.18), transparent 60%),
    var(--tex-linen);
  background-size: 100% 100%, 260px 260px;
  background-blend-mode: normal, soft-light;
  box-shadow:
    0 -2px 0 oklch(0.58 0.12 52 / 0.25) inset,
    0 1px 0 oklch(0.08 0.02 40 / 0.4) inset,
    0 8px 28px oklch(0 0 0 / 0.45);
}
```

### `.info-card` (same material, tighter)

```css
.info-card {
  background-color: var(--surface);
  background-image:
    radial-gradient(ellipse at 10% 15%, var(--mat-highlight), transparent 50%),
    var(--tex-linen);
  background-size: 100% 100%, 260px 260px;
  background-blend-mode: normal, soft-light;
  border: 1px solid oklch(0.88 0.025 70 / 0.45);
  box-shadow:
    0 1px 0 oklch(0.98 0.01 80 / 0.65) inset,
    0 -1px 0 var(--mat-shadow) inset,
    0 6px 20px var(--mat-cast),
    0 1px 4px var(--mat-cast);
}

[data-mode="dark"] .info-card {
  background-image:
    radial-gradient(ellipse at 50% 90%, oklch(0.48 0.10 50 / 0.15), transparent 55%),
    var(--tex-linen);
  background-size: 100% 100%, 260px 260px;
  background-blend-mode: normal, soft-light;
  box-shadow:
    0 -2px 0 oklch(0.55 0.10 50 / 0.20) inset,
    0 1px 0 oklch(0.08 0.02 40 / 0.35) inset,
    0 6px 20px oklch(0 0 0 / 0.40);
}
```

### `.tok` (pressed clay buttons)

Resting state — top-edge highlight, warm cast shadow:
```css
.tok {
  background-color: var(--tcb, var(--accent-soft));
  background-image:
    linear-gradient(155deg, oklch(0.97 0.015 80 / 0.5) 0%, transparent 35%),
    var(--tex-clay);
  background-size: 100% 100%, 128px 128px;
  background-blend-mode: normal, soft-light;
  box-shadow:
    0 2px 0 oklch(0.97 0.01 80 / 0.45) inset,
    0 -1px 0 var(--mat-shadow) inset,
    0 4px 12px var(--mat-cast),
    0 1px 3px var(--mat-cast);
  transition: transform .5s cubic-bezier(0.34, 1.56, 0.64, 1),
              background-color .2s, box-shadow .1s;
}
.act.primary .tok {
  background-color: var(--tc, var(--accent));
}
```

Pressed (`:active`) — deep inset shadow, pushed down:
```css
.act:active .tok {
  background-image:
    linear-gradient(155deg, transparent 0%, oklch(0.25 0.04 45 / 0.12) 100%),
    var(--tex-clay);
  box-shadow:
    0 2px 8px var(--mat-shadow) inset,
    0 1px 0 oklch(0.97 0.01 80 / 0.15) inset;
  transform: scale(0.91) translateY(2px);
  transition: transform 0.06s, box-shadow 0.06s;
}
```

Night hearth — bottom-lit clay:
```css
[data-mode="dark"] .tok {
  background-image:
    linear-gradient(155deg, oklch(0.25 0.04 40 / 0.15) 0%, oklch(0.55 0.12 50 / 0.20) 100%),
    var(--tex-clay);
  background-size: 100% 100%, 128px 128px;
  background-blend-mode: normal, soft-light;
  box-shadow:
    0 -2px 0 oklch(0.58 0.12 52 / 0.35) inset,
    0 1px 0 oklch(0.08 0.02 40 / 0.35) inset,
    0 4px 12px oklch(0 0 0 / 0.40);
}
```

### `.ic-ring` and `.chooser-ic` (clay circles)

```css
.ic-ring {
  background-image: linear-gradient(155deg, oklch(0.97 0.01 80 / 0.35) 0%, transparent 40%);
  background-color: var(--tcb);
  box-shadow:
    0 1px 0 oklch(0.97 0.01 80 / 0.4) inset,
    0 2px 6px var(--mat-cast);
}
.chooser-ic {
  background-image: linear-gradient(155deg, oklch(0.97 0.01 80 / 0.3) 0%, transparent 40%);
  background-color: var(--tcb);
  box-shadow: 0 1px 0 oklch(0.97 0.01 80 / 0.35) inset, 0 2px 6px var(--mat-cast);
}
```

### `.chooser-item` (linen card)

```css
.chooser-item {
  background-color: var(--surface);
  background-image:
    radial-gradient(ellipse at 20% 10%, var(--mat-highlight), transparent 50%),
    var(--tex-linen);
  background-size: 100% 100%, 260px 260px;
  background-blend-mode: normal, soft-light;
  box-shadow:
    0 1px 0 oklch(0.97 0.01 80 / 0.6) inset,
    0 4px 12px var(--mat-cast);
}
```

### `input, select, textarea` (sunken into plaster)

```css
input, select, textarea {
  background-color: var(--bg);
  background-image: linear-gradient(180deg, oklch(0.50 0.04 55 / 0.08) 0%, transparent 25%);
  border: 1px solid oklch(0.80 0.03 65 / 0.6);
  border-top-color: oklch(0.68 0.04 58 / 0.5);
  box-shadow:
    0 2px 8px var(--mat-shadow) inset,
    0 1px 0 oklch(0.97 0.01 80 / 0.5);
}
input:focus, select:focus, textarea:focus {
  border-color: var(--accent);
  border-top-color: oklch(from var(--accent) calc(l - 0.08) c h);
}
```

### `.tabbar` (plaster shelf, cast shadow above)

Remove existing `border-top`. Replace with:
```css
.tabbar {
  background-color: var(--surface);
  background-image:
    linear-gradient(180deg, oklch(0.97 0.01 80 / 0.4) 0%, transparent 15%),
    var(--tex-plaster);
  background-size: 100% 100%, 320px 320px;
  background-blend-mode: normal, soft-light;
  border-top: none;
  box-shadow:
    0 -6px 24px var(--mat-cast),
    0 -1px 0 oklch(0.97 0.01 80 / 0.4);
}

[data-mode="dark"] .tabbar {
  background-image:
    linear-gradient(180deg, oklch(0.48 0.10 50 / 0.12) 0%, transparent 20%),
    var(--tex-plaster);
  background-size: 100% 100%, 320px 320px;
  background-blend-mode: normal, soft-light;
  box-shadow:
    0 -6px 24px oklch(0 0 0 / 0.40),
    0 -1px 0 oklch(0.50 0.10 50 / 0.20);
}
```

### `.btn-primary` (raised clay full-width button)

```css
.btn-primary {
  background-image: linear-gradient(155deg,
    oklch(from var(--accent) calc(l + 0.12) c h) 0%,
    var(--accent) 50%,
    oklch(from var(--accent) calc(l - 0.08) c h) 100%
  );
  box-shadow:
    0 2px 0 oklch(0.97 0.01 80 / 0.22) inset,
    0 -1px 0 oklch(0.20 0.04 45 / 0.25) inset,
    0 6px 18px var(--mat-cast);
  text-shadow: 0 1px 0 oklch(0.25 0.04 45 / 0.18);
}
.btn-primary:active {
  box-shadow:
    0 2px 6px oklch(0.25 0.04 45 / 0.22) inset,
    0 1px 0 oklch(0.97 0.01 80 / 0.12) inset;
  transform: translateY(1px) scale(0.99);
}
```

### `.switch` (toggle with depth)

```css
.switch {
  background-color: var(--hair);
  background-image: linear-gradient(180deg, oklch(0.78 0.03 65 / 0.8), transparent);
  box-shadow: 0 1px 5px var(--mat-shadow) inset;
}
.switch.on {
  background-color: var(--accent);
  background-image: linear-gradient(180deg, oklch(from var(--accent) calc(l + 0.08) c h / 0.8) 0%, transparent 100%);
  box-shadow: 0 1px 0 oklch(0.97 0.01 80 / 0.25) inset;
}
.switch .knob {
  background-image: linear-gradient(180deg, oklch(0.99 0.005 80), oklch(0.93 0.015 75));
  box-shadow:
    0 2px 5px oklch(0.30 0.04 50 / 0.30),
    0 1px 0 oklch(0.97 0.01 80 / 0.8) inset;
}
```

### `.avatar` (glazed ceramic)

```css
.avatar {
  background-image:
    radial-gradient(circle at 30% 20%, oklch(0.97 0.01 80 / 0.5) 0%, transparent 45%),
    radial-gradient(circle at 35% 30%, var(--accent-soft), var(--accent));
  box-shadow:
    0 2px 0 oklch(0.97 0.01 80 / 0.4) inset,
    0 4px 14px var(--mat-cast);
}
```

### `.timer` and `.baby` (embossed text)

```css
.timer {
  text-shadow:
    0 2px 0 oklch(0.78 0.04 65 / 0.5),
    0 -1px 0 oklch(0.97 0.01 80 / 0.35);
}
.baby {
  text-shadow:
    0 1.5px 0 oklch(0.80 0.04 65 / 0.4),
    0 -1px 0 oklch(0.97 0.01 80 / 0.28);
}
```

### `.track` (inset channel)

```css
.track {
  box-shadow: 0 1px 5px var(--mat-shadow) inset, 0 1px 0 oklch(0.97 0.01 80 / 0.3);
}
.track i {
  box-shadow: 0 1px 0 oklch(0.97 0.01 80 / 0.3) inset;
}
```

### `.segctl` (inset tray) and `.seg-opt.on` (raised tab)

```css
.segctl {
  background-color: var(--accent-tint);
  background-image: linear-gradient(180deg, oklch(0.50 0.04 55 / 0.06) 0%, transparent 25%);
  box-shadow: 0 1px 4px var(--mat-shadow) inset;
}
.seg-opt.on {
  background-image: linear-gradient(180deg, oklch(0.97 0.01 80 / 0.55) 0%, var(--surface) 100%);
  background-color: var(--surface);
  box-shadow:
    0 1px 0 oklch(0.97 0.01 80 / 0.75) inset,
    0 2px 8px var(--mat-cast);
}
```

### `.sheet` (linen bottom sheet)

```css
.sheet {
  background-color: var(--bg);
  background-image:
    radial-gradient(ellipse at 25% 0%, var(--mat-highlight), transparent 50%),
    var(--tex-linen);
  background-size: 100% 100%, 260px 260px;
  background-blend-mode: normal, soft-light;
}

[data-mode="dark"] .sheet {
  background-image:
    radial-gradient(ellipse at 50% 100%, oklch(0.48 0.10 50 / 0.15), transparent 55%),
    var(--tex-linen);
  background-size: 100% 100%, 260px 260px;
  background-blend-mode: normal, soft-light;
}
```

### Remove dayjob paper grain pseudo-element

The existing `body::before` paper grain for dayjob themes is superseded by the plaster texture on `.phone`. Remove this entire rule block.

---

## 4. Ember Glow (replaces livedot pulse)

Remove `@keyframes pulse`. Add:

```css
.livedot {
  background: radial-gradient(circle at 35% 30%, oklch(0.94 0.14 78), oklch(0.68 0.17 45));
  box-shadow:
    0 0 5px 1px oklch(0.80 0.14 62 / 0.65),
    0 0 10px 3px oklch(0.65 0.12 50 / 0.35);
  animation: ember-glow 2.8s ease-in-out infinite;
}
.livedot.sleeping {
  background: radial-gradient(circle at 35% 30%, oklch(0.82 0.07 280), oklch(0.56 0.10 292));
  box-shadow:
    0 0 5px 1px oklch(0.70 0.08 285 / 0.55),
    0 0 10px 3px oklch(0.52 0.09 290 / 0.30);
  animation: ember-glow-cool 2.8s ease-in-out infinite;
}

@keyframes ember-glow {
  0%, 100% {
    box-shadow: 0 0 5px 1px oklch(0.80 0.14 62 / 0.65), 0 0 10px 3px oklch(0.65 0.12 50 / 0.35);
  }
  50% {
    box-shadow: 0 0 7px 2px oklch(0.85 0.16 65 / 0.80), 0 0 14px 5px oklch(0.68 0.13 52 / 0.45);
  }
}
@keyframes ember-glow-cool {
  0%, 100% {
    box-shadow: 0 0 5px 1px oklch(0.70 0.08 285 / 0.55), 0 0 10px 3px oklch(0.52 0.09 290 / 0.30);
  }
  50% {
    box-shadow: 0 0 7px 2px oklch(0.75 0.09 285 / 0.65), 0 0 14px 5px oklch(0.56 0.10 290 / 0.40);
  }
}
```

---

## 5. Quick Actions — New Types and Grid

### Grid change

From `repeat(6, 1fr)` (5 actions + More = 6) to `repeat(4, 1fr)` (7 actions + More = 8, 2 rows × 4 columns):

```css
.actions { grid-template-columns: repeat(4, 1fr); }
```

### New TYPES in `js/ui.js`

```js
play: { icon: 'icon-play', label: 'Play', tone: 'play' },
bath: { icon: 'icon-bath', label: 'Bath', tone: 'bath' },
```

Also update existing 5 quick-action types to use custom icon IDs:
```js
sleep:    { icon: 'icon-sleep',    label: 'Sleep',    tone: 'sleep' },
feed:     { icon: 'icon-feed',     label: 'Nursing',  tone: 'feed'  },
bottle:   { icon: 'icon-bottle',   label: 'Bottle',   tone: 'feed'  },
diaper:   { icon: 'icon-diaper',   label: 'Diaper',   tone: 'diaper'},
medicine: { icon: 'icon-medicine', label: 'Medicine', tone: 'med'   },
pump:     { icon: 'drop-half',     label: 'Pump',     tone: 'feed'  },  /* keep Lucide */
note:     { icon: 'note-pencil',   label: 'Note',     tone: 'note'  },  /* keep Lucide */
```

Update `diaperIcon()`:
```js
export function diaperIcon(kind) {
  if (kind === 'Dirty') return 'turtle';
  if (kind === 'Mixed') return 'layers';
  return 'icon-diaper';
}
```

### QUICK array in `js/home.js`

```js
const QUICK = [
  { t: 'sleep', primary: true }, { t: 'feed' }, { t: 'bottle' }, { t: 'diaper' },
  { t: 'medicine' }, { t: 'play' }, { t: 'bath' }
];
```

---

## 6. Custom SVG Icons

Seven `<symbol>` elements, added to the inline SVG sprite in `index.html` (after existing symbols, before `</svg>`). Style: **filled solid with white highlight detail**. ViewBox 24×24. `fill="currentColor"` for main shape; `fill="white" fill-opacity="0.28–0.45"` for highlights.

### `icon-sleep` (filled crescent moon + stars)
```svg
<symbol id="icon-sleep" viewBox="0 0 24 24">
  <path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  <circle fill="white" fill-opacity="0.45" cx="16.5" cy="5" r="0.85"/>
  <circle fill="white" fill-opacity="0.30" cx="19.2" cy="8.5" r="0.60"/>
  <circle fill="white" fill-opacity="0.20" cx="14.8" cy="3.5" r="0.45"/>
</symbol>
```

### `icon-feed` (filled droplet)
```svg
<symbol id="icon-feed" viewBox="0 0 24 24">
  <path fill="currentColor" d="M12 2c-.5 2.5-2 4.9-4 6.5C6 10.1 5 12 5 14a7 7 0 0 0 14 0c0-2-1-3.9-3-5.5C14 6.9 12.5 4.5 12 2z"/>
  <path fill="white" fill-opacity="0.35" d="M10.5 10a6.3 6.3 0 0 0-1.8 4 7 7 0 0 1-.2-2c0-1.4.5-2.7 1.4-3.7a9 9 0 0 0 .6-.3z"/>
</symbol>
```

### `icon-bottle` (filled milk bottle)
```svg
<symbol id="icon-bottle" viewBox="0 0 24 24">
  <path fill="currentColor" d="M8 2h8v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 14 10.212V20a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-9.788a4 4 0 0 1 .672-2.22l.656-.983A4 4 0 0 0 8 4.788V2z"/>
  <path fill="white" fill-opacity="0.28" d="M9 2h2.5v.6H9zm.3 4.8A4 4 0 0 1 8 9.2l-.4.6v2.4l-.3-.3v-2.4l.5-.7A4 4 0 0 0 9.3 7z"/>
  <line x1="9" y1="15.5" x2="14" y2="15.5" stroke="white" stroke-opacity="0.40" stroke-width="1.5" stroke-linecap="round"/>
</symbol>
```

### `icon-diaper` (hourglass diaper silhouette)
```svg
<symbol id="icon-diaper" viewBox="0 0 24 24">
  <path fill="currentColor" d="M3 5c-.5 0-1 .5-1 1v3l4 3-4 3v3c0 .5.5 1 1 1h18c.5 0 1-.5 1-1v-3l-4-3 4-3V6c0-.5-.5-1-1-1H3z"/>
  <path fill="white" fill-opacity="0.28" d="M3 5h18c.5 0 1 .5 1 1v2l-4 3H6L2 8V6c0-.5.5-1 1-1z"/>
</symbol>
```

### `icon-medicine` (filled pill capsule)
```svg
<symbol id="icon-medicine" viewBox="0 0 24 24">
  <path fill="currentColor" d="M10.5 3.5a7 7 0 0 1 9.9 9.9l-10 10a7 7 0 1 1-9.9-9.9l10-10z"/>
  <path fill="white" fill-opacity="0.28" d="M10.5 3.5a7 7 0 0 0-4.95 11.95l11.95-11.95A7 7 0 0 0 10.5 3.5z"/>
  <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" stroke="white" stroke-opacity="0.35" stroke-width="1.2"/>
</symbol>
```

### `icon-play` (filled sun — daytime play)
```svg
<symbol id="icon-play" viewBox="0 0 24 24">
  <circle fill="currentColor" cx="12" cy="12" r="4.5"/>
  <path stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none"
    d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5.05 5.05l1.77 1.77M17.18 17.18l1.77 1.77M5.05 18.95l1.77-1.77M17.18 6.82l1.77-1.77"/>
  <circle fill="white" fill-opacity="0.38" cx="10.5" cy="10.5" r="1.5"/>
</symbol>
```

### `icon-bath` (filled bathtub with bubbles)
```svg
<symbol id="icon-bath" viewBox="0 0 24 24">
  <path fill="currentColor" d="M5 13h14v3a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5v-3z"/>
  <rect fill="currentColor" x="2" y="11" width="20" height="3" rx="1.5"/>
  <path stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" d="M8 20.5v2M16 20.5v2"/>
  <path fill="currentColor" d="M4 11V8.5a2.5 2.5 0 0 1 5 0V11H4z"/>
  <circle fill="currentColor" cx="10" cy="8" r="1.2"/>
  <circle fill="currentColor" cx="14" cy="6.5" r="0.9"/>
  <circle fill="currentColor" cx="17" cy="8.5" r="0.7"/>
  <path fill="white" fill-opacity="0.30" d="M2 11h20v1.5H2z"/>
</symbol>
```

---

## 7. Service Worker Cache

Add to `SHELL` array in `sw.js`:
```js
'./assets/textures/plaster.webp',
'./assets/textures/clay.webp',
'./assets/textures/linen.webp',
```

---

## 8. Version Bump

Every commit must bump `VERSION` in `sw.js` and `<meta name="version">` in `index.html` to the current UTC timestamp (`date -u +%Y-%m-%dT%H:%M`). The two strings must match, differing only by the `hearth-` prefix in `sw.js`.

---

## 9. Constraints

- No new JS frameworks. Vanilla JS + CSS only.
- All textures remain local (vendored) for offline PWA support.
- The dayjob paper grain `body::before` pseudo-element is removed — superseded by plaster texture.
- The single ambient animation is **ember-glow** only. The old `pulse` keyframe is removed.
- Lucide icons stay for all non-quick-action UI elements (tabs, edit buttons, close buttons, etc.).
- Custom icons are used for the 5 existing quick-action types + 2 new ones (play, bath).
- CSS relative color syntax `oklch(from var(--x) calc(l ± n) c h)` is valid for all target browsers (Safari 16.4+, Chrome 119+, Firefox 128+).
