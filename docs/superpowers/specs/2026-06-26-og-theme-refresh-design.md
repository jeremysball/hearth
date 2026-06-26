# OG Theme Refresh — Implementation Spec (follow-up)

**Date:** 2026-06-26
**Status:** Approved, ready for implementation planning
**Audience:** This spec is written to be executed by a model that may make weaker
judgment calls. Every change lists exact selectors, exact values, and a
screenshot-checkable acceptance criterion. Do not improvise visual values beyond
the ranges given. When a step says "verify," actually take the screenshot.

---

## Context

This builds on two things that are **already done and committed** — do NOT redo them:

1. **`docs/superpowers/specs/2026-06-26-hearth-lighting-overhaul-design.md`** — the
   skeuomorphic firelight system (fire `@property` vars, per-element shadows,
   sliding seg pill in *sheets*, dark-mode palette). This is the live baseline.
2. **commit `9d7e8f2` `feat(css): warm linen background, dark-mode pill, reactive glare`** —
   the three hardest items, verified working via screenshots:
   - **Background de-marbled.** `.phone` now uses `var(--tex-linen)` + a
     `color`-blend warm wash + `soft-light` weave instead of the grey
     `plaster`/`soft-light` stack that read as cold marble. (`styles.css` `.phone`.)
   - **Dark-mode pill renders + slides.** `segBind()` in `js/profile.js` now emits
     a leading `<div class="seg-thumb"></div>`; `initThumbs()` is exported from
     `js/ui.js` and called from `router.go()` in `js/app.js` so the pill positions
     on tab views, not only in sheets.
   - **Moving specular glare on the pill.** A registered `@property --glare`
     (`styles.css`) drives a specular streak on `.seg-thumb`; `positionThumb()` in
     `js/ui.js` sets `--glare` from the active option index, and the thumb
     `transition` includes `--glare` so the streak sweeps during the 0.42s slide.
     The streak's brightness is modulated by `var(--fire-a)` so it also breathes
     with the fire.

This spec covers the **four remaining items**, all deterministic:

1. OG body font → **Hanken Grotesk** (Day Job keeps Archivo).
2. **Richer color** across the OG (girl/boy) palette.
3. **Light-mode card transparency** (frosted glass over the warm linen).
4. **Extend the reactive glare vocabulary** to the hero card + primary actions
   (fire-pulse sheen — these elements do not slide, so no moving streak).

The "lighting metaphor" is unchanged and must be honored: **the fire is the
single ambient light source.** Everything new reflects it; do not add a second
independent ambient animation loop (CLAUDE.md rule).

---

## Item 1 — OG body font → Hanken Grotesk

### 1a. Load the font

In `index.html`, replace the Google Fonts `<link>` (currently line ~18):

```html
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Hanken+Grotesk:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />
```

(Adds `Hanken+Grotesk:wght@400;500;600;700;800`; Archivo and Playfair stay.)

### 1b. Introduce a `--font-sans` token

The font must be **theme-scoped** so Day Job keeps Archivo. Use a CSS variable that
defaults to Archivo and is overridden only for the OG themes.

In `styles.css`, in the `:root, [data-theme="girl"]` block, add:

```css
--font-sans: "Hanken Grotesk", system-ui, sans-serif;
```

In the `[data-theme="boy"]` block, add the same line.

In the **Day Job** theme blocks (`:is([data-theme="dayjob"], [data-theme="dayjob-girl"])`
and `[data-theme="dayjob-boy"]`, around lines 439 and 450), add:

```css
--font-sans: "Archivo", system-ui, sans-serif;
```

> Note: `:root` already starts the girl block, so `--font-sans` defaults to Hanken
> Grotesk. Day Job themes are separate `data-theme` values, so their override wins
> for them. There is no need to touch the generic `body` fallback chain.

### 1c. Replace the hardcoded `"Archivo"` body usages with `var(--font-sans)`

Replace `"Archivo"` (and `"Archivo", system-ui/sans-serif`) with `var(--font-sans)`
at these `styles.css` lines (verify each by content, line numbers may drift):

- L10  `body { font-family: "Archivo", system-ui, sans-serif; ... }` → `var(--font-sans)`
- L199 `.baby-sub`/hero label (`font-family: "Archivo", sans-serif;`) → `var(--font-sans)`
- L333 `.ic-val`
- L334 `.ic-rel`
- L389 `.today-hd h2`
- L412 `.page-title`
- L604 `.stat-v`
- L607 `.chart-hd h2`
- L623 `.ring-big`
- L632 `.sched-win`
- L687 `.growth-svg .growth-x`
- L786 `.sheet-hd h3`
- L850 `.entry-title`

**Do NOT change** the `"Playfair Display"` usages (`.baby` name, `.timer` hero — lines
~184, ~278). The baby's name and hero timer stay Playfair (CLAUDE.md rule).

> Day Job's own type treatment (uppercase, tracking, angular cards — the
> `:is([data-theme="dayjob"...])` rules around lines 588–596) already overrides
> sizes/spacing on top of `--font-sans`; leave those rules intact.

### 1d. Acceptance

Run the app (see Verification). On an OG theme (girl), body text (`Good evening`,
card labels, values) renders in Hanken Grotesk (rounder, warmer than Archivo).
Switch to Day Job girl — body text is still Archivo. The name and hero timer are
Playfair in both.

---

## Item 2 — Richer OG color

Goal: the OG UI should "color the whole surface more" — currently surfaces read
near-neutral cream. Bump **chroma** (the middle oklch value) on the girl/boy
palette. Keep lightness (first value) and hue (third value) as-is so text contrast
holds. These are the target values:

### girl (`:root, [data-theme="girl"]`)

| token            | from                          | to                            |
|------------------|-------------------------------|-------------------------------|
| `--bg`           | `oklch(0.882 0.100 42)`       | `oklch(0.882 0.120 42)`       |
| `--surface`      | `oklch(0.922 0.070 46)`       | `oklch(0.918 0.092 46)`       |
| `--accent-soft`  | `oklch(0.86 0.06 50)`         | `oklch(0.86 0.082 50)`        |
| `--accent-tint`  | `oklch(0.91 0.038 54)`        | `oklch(0.905 0.055 54)`       |
| `--hair`         | `oklch(0.820 0.048 48)`       | `oklch(0.820 0.062 48)`       |

### boy (`[data-theme="boy"]`)

| token            | from                          | to                            |
|------------------|-------------------------------|-------------------------------|
| `--bg`           | `oklch(0.956 0.048 172)`      | `oklch(0.950 0.066 172)`      |
| `--surface`      | `oklch(0.978 0.032 172)`      | `oklch(0.968 0.050 172)`      |
| `--accent-soft`  | `oklch(0.85 0.05 180)`        | `oklch(0.85 0.070 180)`       |
| `--accent-tint`  | `oklch(0.93 0.028 178)`       | `oklch(0.922 0.044 178)`      |
| `--hair`         | `oklch(0.88 0.02 178)`        | `oklch(0.88 0.034 178)`       |

Do **not** change `--page` (already tuned in commit 9d7e8f2), `--ink`, `--soft`,
`--muted` (text colors — changing them risks contrast).

### Acceptance

Side-by-side before/after on the home screen: cards and pills read visibly warmer
/ more saturated, not grey-cream. Body text (`--ink` on `--surface`) is still
clearly legible — eyeball the smallest grey text (`.ic-rel`, `typical 3h 35m`). If
any text looks washed out, the bump went too far on `--surface`; reduce that one
chroma by `0.01` and re-shoot. No other knob.

---

## Item 3 — Light-mode card transparency (frosted glass)

Goal: in OG **light** mode, cards should let the warm linen glow through, the way
dark-mode cards sit over the fire glow. Approach: **frosted glass** — translucent
surface + `backdrop-filter` blur so the linen reads through while text stays
legible. Dark mode and Day Job are unaffected.

### 3a. Token

In `styles.css`, define a card-background token that defaults to opaque (so dark
mode + Day Job keep today's look), in the `:root, [data-theme="girl"]` block:

```css
--card-bg: var(--surface);
```

Add an OG-light-only override (place near the theme blocks, after `[data-theme="boy"]`):

```css
:is([data-theme="girl"], [data-theme="boy"]):not([data-mode="dark"]) {
  --card-bg: color-mix(in oklch, var(--surface) 80%, transparent);
}
```

> `[data-mode]` and `[data-theme]` are both set on `<body>` (see existing
> `[data-mode="dark"][data-theme="girl"]` rules), so this selector matches. Light
> and "auto-resolved-light" both lack `data-mode="dark"`, so `:not(...)` covers
> both.

### 3b. Apply the token + frosted blur to cards

Change `background-color: var(--surface);` → `background-color: var(--card-bg);` in:

- `.card` (L214)
- `.info-card` (L303)
- `.card.stat` region surface (L162 — verify it is the stat/section surface)
- the surface at L571 (verify which block; apply only if it is a card-like panel)

Then add the blur **only** in OG light mode (cards over the linen):

```css
:is([data-theme="girl"], [data-theme="boy"]):not([data-mode="dark"]) :is(.card, .info-card) {
  backdrop-filter: blur(7px) saturate(1.15);
  -webkit-backdrop-filter: blur(7px) saturate(1.15);
}
```

> The cards currently also paint an opaque clay/mat `background-image`. With a
> translucent `--card-bg` the texture layer would still block the linen. In OG
> light mode, **soften the card texture** so the frosted linen reads: in the same
> OG-light rule above, also set the card texture layer's contribution down — set
> `background-blend-mode: normal` and drop the `var(--tex-clay)`/`--tex-*` layer
> from `.card`/`.info-card` *in light mode only*, keeping the top `--mat-highlight`
> sheen radial. (Dark mode keeps its existing textured slabs untouched.)

### 3c. Legibility guard

After applying, verify `--ink` text on the now-translucent cards still passes a
casual read at the dimmest fire trough. If text shimmers/looks low-contrast,
raise the surface mix from `80%` toward `88%` (less transparent) until clean. Do
not go below `80%` (too see-through) or you lose legibility.

### Acceptance

OG light home screen: the warm linen weave is faintly visible *through* the cards
(frosted), giving depth; all card text remains crisp. Toggle dark mode: cards are
unchanged opaque slabs. Switch to Day Job: cards unchanged opaque.

---

## Item 4 — Extend reactive glare to hero + primary actions

Scope (confirmed): **`.card.hero`** (home timer card), **`.tok`** (the action
circles, including `.act.primary .tok`), **`.today-add`** (the small FAB), and
**`.avatar`** (identity circle). These do not slide, so they get the
**pulse-reactive** behavior only: a specular top sheen whose brightness breathes
with the fire. Reuse the existing vocabulary — the seg-thumb and `.tok` already
modulate with `var(--fire-a)`; generalize that.

### Shared light-source vars (optional but preferred)

In `:root`, add (documents the key-light position the sheens point from):

```css
--light-x: 30%; --light-y: 6%;
```

### 4a. `.tok` — make the existing top sheen pulse

The `.tok` `background-image` (L~350) already has a top sheen radial:
`radial-gradient(ellipse 120% 90% at 50% 8%, oklch(0.97 0.012 70 / 0.45) 0%, transparent 42%)`.
Change its alpha from the constant `0.45` to a fire-driven value:

```css
oklch(0.99 0.012 70 / calc(0.30 + var(--fire-a, 0.08) * 1.8)) 0%, transparent 42%
```

(The existing fire rim in `.tok`'s `box-shadow` already pulses; this adds a top
glint that breathes in sync.)

### 4b. `.card.hero` — add a pulsing top-left glint

Add to `.card.hero` a specular highlight layer (prepend to its `background-image`,
or add one if it has none). Use the key-light position:

```css
.card.hero {
  background-image:
    radial-gradient(ellipse 60% 40% at var(--light-x) var(--light-y),
      oklch(0.99 0.01 70 / calc(0.12 + var(--fire-c, 0.10) * 1.2)) 0%, transparent 60%),
    /* …keep any existing .card.hero background layers after this… */ ;
}
```

If `.card.hero` has no own `background-image` today, this single-layer rule is
fine. Use `--fire-c` (the slow component) here so the large hero breathes gently,
not jitterily.

### 4c. `.today-add` (FAB) and `.avatar` — small pulsing glint

Both are small circles with a gradient already. Add a fire-driven inset top
highlight via `box-shadow` (append to existing `box-shadow`, do not replace):

```css
.today-add, .avatar {
  box-shadow:
    /* …existing shadows… */,
    inset 0 1px 0 oklch(1 0 0 / calc(0.25 + var(--fire-a, 0.08) * 1.4));
}
```

(Keep each element's current shadows; only append the inset highlight line.)

### 4d. Reduced motion

No new work: `--fire-a/b/c` are already frozen at comfortable mid values under
`@media (prefers-reduced-motion: reduce)` (existing rule ~L147). The sheens then
sit at a pleasant static brightness. **Verify** nothing animates under reduced
motion.

### Acceptance

With motion on, record/observe the home screen for ~10s: a subtle highlight
breathes on the hero card, the action circles, the FAB, and the avatar, all in
time with the fire (strongest when the bottom glow flares). It must read as
*one* light source pulsing — not several independent twinkles. Under
`prefers-reduced-motion`, everything is still. Performance: scrolling stays smooth
on a mid mobile device (these are paint-only changes; no new JS loop).

---

## Version bump (MANDATORY — do this last, before committing)

Per CLAUDE.md, set both to the same current UTC timestamp (`date -u +%Y-%m-%dT%H:%MZ`):

- `index.html` → `<meta name="version" content="…Z">`
- `sw.js` → `const VERSION = 'hearth-…Z';`

They must match except the `hearth-` prefix.

---

## Files changed

- `index.html` — font `<link>` (Item 1a), version bump.
- `styles.css` — `--font-sans` token + usages (Item 1b/1c), OG chroma bumps
  (Item 2), `--card-bg` + frosted-glass (Item 3), glare sheens (Item 4),
  `--light-x/--light-y`.
- `sw.js` — version bump.

No changes to `js/` are required for these four items (the JS for the pill/glare
already landed in commit 9d7e8f2).

---

## Verification (use the `run` skill)

1. Launch:
   ```bash
   cd /workspace/hearth/server && PORT=9878 STATIC_DIR=/workspace/hearth \
     DB_PATH=/tmp/hearth-run.db \
     CERT_FILE=/workspace/hearth/certs/pi-agent-4.bass-procyon.ts.net.crt \
     KEY_FILE=/workspace/hearth/certs/pi-agent-4.bass-procyon.ts.net.key \
     go run . &
   sleep 5; curl -sk -o /dev/null -w "%{http_code}\n" https://localhost:9878/   # expect 200
   ```
2. Screenshot with Playwright (`node_modules/playwright`, viewport 390×844,
   `--ignore-certificate-errors`), completing onboarding with the **Girl** theme to
   reach home. Capture: OG-girl home (light), OG-girl home (dark, via
   `document.body.setAttribute('data-mode','dark')`), the settings/Profile tab, and
   a Day-Job-girl home for the font-scope check.
3. Check each item's Acceptance section against the screenshots.

## Acceptance checklist (all must pass)

- [ ] OG body text is Hanken Grotesk; Day Job body text is still Archivo; name/timer still Playfair.
- [ ] OG cards/pills read visibly more saturated; small grey text still legible.
- [ ] OG **light** cards show warm linen frosted through them; text crisp. Dark/Day-Job cards unchanged.
- [ ] Hero, action circles, FAB, avatar carry a subtle fire-synced sheen; one coherent light source.
- [ ] `prefers-reduced-motion`: no animation; sheens static.
- [ ] Version strings in `index.html` and `sw.js` match and are current UTC.
- [ ] `git ls-files '*.js' | xargs -P4 -I{} node --check {}` passes (no JS touched, but cheap to confirm).

## Out of scope

- Day Job restyle (it keeps Archivo + its angular treatment).
- Dark-mode palette/quick-button work (handled by the lighting-overhaul spec).
- Plaster texture removal elsewhere (only the page surface swapped to linen; small
  elements may keep plaster/clay where it reads correctly).
- Any new ambient animation loop (violates the one-ambient-concept rule).
- Particle/ember effects, heat haze.
