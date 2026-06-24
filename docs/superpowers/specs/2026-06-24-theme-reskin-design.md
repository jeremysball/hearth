# Hearth Theme Reskin — Design

## Context

`todo.txt` asked to "try to implement theme.txt theme." `theme.txt` (in its current, uncommitted working-tree state) is a teardown of *Secret Nature*, a cannabis-dispensary e-commerce brand built by the studio Day Job: a cream-paper background, a deep olive/forest green, a heavy-grotesque + high-contrast-serif type pairing, pill buttons, generous whitespace, all-caps letter-spaced section labels, and a faint paper-grain texture.

An earlier pass scoped this down to just the paper-grain texture, since a literal conversion conflicts with `CLAUDE.md`'s design rules (Phosphor icons, Quicksand/Nunito, OKLCH pastel palette). The user has since asked for the **full conversion**, including updating `CLAUDE.md` itself to describe the new system. This spec defines exactly what that conversion is.

Decisions already made (via direct Q&A, not re-litigated here):
- **Theme variants**: keep the existing two-hue-variant mechanism (`data-theme="girl"|"boy"`, same CSS variable *roles*, same picker), retuned to two moods of the new earth palette instead of pastel coral/periwinkle. The `girl`/`boy` data values and the baby-data-model/onboarding code that reads them are unchanged — only what each value *looks like* changes.
- **Fonts**: free Google-Fonts-hosted stack (no Sharp Type license) — **Archivo** (grotesque) + **Playfair Display** (high-contrast serif) — loaded the same way Quicksand/Nunito are today.
- **Icons**: full library swap, not just restyling Phosphor. Replacement set confirmed below.
- **Rollout shape (Approach 2, approved)**: ordered, independently-verifiable layers — palette → typography → icons → layout details — each its own commit, each checked live via `/run` before the next.

## What's NOT changing

- App structure, routing, data model, server, sync — this is CSS + one asset file + icon-name strings in JS, nothing behavioral.
- The girl/boy picker mechanism itself, dark-mode toggle mechanism, or any JS logic in `store.js`/`sheets.js`/etc.
- "Round everything" (pills, big radii, circles) and "one ambient animation at a time" — both already true today and both compatible with `theme.txt`'s own pill-button, rounded-card recommendations. No changes needed there beyond color.
- The paper-grain texture mechanism designed earlier (`.phone`'s `feTurbulence` SVG data-URI) — reused verbatim as the "layout details" layer, just riding on the new palette instead of the old one.

## 1. Palette

Two hue variants of one "muted earth" system, each still spanning light + dark mode, using the **same CSS variable names** that exist today (`--page`, `--bg`, `--surface`, `--ink`, `--soft`, `--muted`, `--hair`, `--accent`, `--accent-ink`, `--accent-soft`, `--accent-tint`, `--on-accent`, `--good`, `--good-deep`, `--good-halo`, `--good-tint`, `--ring-track`) — only the values change, so every component that already themes itself via these variables (cards, buttons, the sleep ring, category tone tints) retints automatically with zero component-level changes.

Discipline carried over from the current palette (and from `theme.txt`'s own analysis of *why* it works): stay in a narrow lightness/chroma band, never pure white, never pure black.

**`girl` slot → "Warm Olive"** (cream-leaning paper, forest-olive accent, ochre-gold sleep ring):

| Variable | Light | Dark |
|---|---|---|
| `--page` | `oklch(0.96 0.016 95)` | `oklch(0.22 0.016 95)` |
| `--page-glow` | `oklch(0.91 0.035 88 / .5)` | `oklch(0.28 0.03 88 / .4)` |
| `--bg` | `oklch(0.985 0.009 95)` | `oklch(0.18 0.012 95)` |
| `--surface` | `oklch(0.996 0.005 95)` | `oklch(0.24 0.014 95)` |
| `--ink` | `oklch(0.32 0.035 110)` | `oklch(0.92 0.02 90)` |
| `--soft` | `oklch(0.46 0.032 110)` | `oklch(0.78 0.022 90)` |
| `--muted` | `oklch(0.6 0.028 105)` | `oklch(0.6 0.02 90)` |
| `--hair` | `oklch(0.9 0.018 95)` | `oklch(0.32 0.018 95)` |
| `--accent` | `oklch(0.42 0.07 125)` | `oklch(0.68 0.09 125)` |
| `--accent-ink` | `oklch(0.34 0.065 125)` | `oklch(0.78 0.08 125)` |
| `--accent-soft` | `oklch(0.88 0.035 120)` | `oklch(0.32 0.05 122)` |
| `--accent-tint` | `oklch(0.95 0.02 100)` | `oklch(0.28 0.03 110)` |
| `--on-accent` | `oklch(0.98 0.012 95)` | `oklch(0.18 0.01 95)` |
| `--good` | `oklch(0.62 0.1 75)` | `oklch(0.7 0.1 78)` |
| `--good-deep` | `oklch(0.46 0.09 70)` | `oklch(0.55 0.09 75)` |
| `--good-halo` | `oklch(0.88 0.06 78)` | `oklch(0.34 0.06 78)` |
| `--good-tint` | `oklch(0.92 0.05 78 / .5)` | `oklch(0.3 0.05 78 / .5)` |
| `--ring-track` | `oklch(0.91 0.015 95)` | `oklch(0.3 0.015 95)` |

**`boy` slot → "Cool Sage"** (cooler oat paper, sage/slate accent, slightly greener gold sleep ring):

| Variable | Light | Dark |
|---|---|---|
| `--page` | `oklch(0.96 0.013 135)` | `oklch(0.22 0.013 140)` |
| `--page-glow` | `oklch(0.91 0.028 142 / .5)` | `oklch(0.28 0.026 145 / .4)` |
| `--bg` | `oklch(0.985 0.008 135)` | `oklch(0.18 0.01 140)` |
| `--surface` | `oklch(0.996 0.004 135)` | `oklch(0.24 0.012 140)` |
| `--ink` | `oklch(0.32 0.03 165)` | `oklch(0.92 0.016 135)` |
| `--soft` | `oklch(0.46 0.028 165)` | `oklch(0.78 0.018 135)` |
| `--muted` | `oklch(0.6 0.024 160)` | `oklch(0.6 0.016 135)` |
| `--hair` | `oklch(0.9 0.015 142)` | `oklch(0.32 0.015 140)` |
| `--accent` | `oklch(0.45 0.06 175)` | `oklch(0.68 0.075 175)` |
| `--accent-ink` | `oklch(0.36 0.055 175)` | `oklch(0.78 0.065 175)` |
| `--accent-soft` | `oklch(0.88 0.03 170)` | `oklch(0.32 0.04 172)` |
| `--accent-tint` | `oklch(0.95 0.016 145)` | `oklch(0.28 0.025 150)` |
| `--on-accent` | `oklch(0.98 0.008 135)` | `oklch(0.18 0.008 140)` |
| `--good` | `oklch(0.6 0.08 90)` | `oklch(0.68 0.085 92)` |
| `--good-deep` | `oklch(0.45 0.075 88)` | `oklch(0.53 0.078 90)` |
| `--good-halo` | `oklch(0.88 0.05 92)` | `oklch(0.34 0.05 92)` |
| `--good-tint` | `oklch(0.92 0.045 92 / .5)` | `oklch(0.3 0.045 92 / .5)` |
| `--ring-track` | `oklch(0.91 0.013 142)` | `oklch(0.3 0.013 140)` |

**Category tones**: `.sleep`/`.tone-sleep` and `.feed`/`.tone-feed` already derive from `--good`/`--accent` and retint automatically. `.diaper`/`.tone-diaper`'s current amber is already earth-toned and stays as-is. `.med`/`.tone-med`'s current violet (`oklch(0.52 0.1 300)`) is a jewel tone that clashes with a muted-earth system — replace with a muted clay/terracotta: `--tc: oklch(0.5 0.09 35); --tcb: oklch(0.92 0.045 40);`. `.note`/`.tone-note` derives from `--muted`/`--hair` and stays as-is.

## 2. Typography

`theme.txt`'s pairing logic is "structure/authority" (grotesque) vs. "heritage/craft, felt not read" (high-contrast serif). `CLAUDE.md` already has its own typeface discipline worth preserving through this change: **exactly two typefaces, one proud, one quiet** — today that's Quicksand (proud) / Nunito (quiet). The reskin keeps that discipline, recast as serif-proud / grotesque-quiet:

- **Playfair Display (proud, serif)** — reserved for exactly the two moments designed to be *felt before read*: the baby's name (`.baby`) and the big hero asleep/awake timer (`.timer`). Nothing else. (Page titles and sheet titles move to grotesque, below — they're wayfinding chrome a tired parent reads quickly, not a lingered-on moment, and Playfair's calligraphic numerals are a poor fit for the *other* big numbers in the app like `.stat-v`/`.ring-big`.)
- **Archivo (quiet, grotesque)** — everything else: body copy, all labels, both `.stat-v`/`.ring-big` numeric readouts, `.page-title`, `.sheet-hd h3`, `.onb-title`, `.today-hd h2`/`.chart-hd h2`, buttons, nav. This replaces Nunito's body job *and* the rest of Quicksand's old structural job, so the app still has only two voices total, never three.

Font loading replaces the existing Google Fonts `<link>` 1:1 — `Archivo:wght@400;500;600;700;800` (covers the full range Quicksand 500/600/700 + Nunito 400–800 used between them) + `Playfair+Display:wght@600;700` (only ever used bold).

## 3. Iconography

Hearth's entire icon vocabulary is small and enumerable — **24 distinct icons** across every JS file (verified by grep, including ones only reachable through the `TYPES`/`icon()` indirection in `js/ui.js`). Replacing Phosphor with **Lucide** (ISC-licensed, thin 2px-stroke line icons — the exact register `theme.txt` calls for) is scoped to exactly these 24.

Delivery: Phosphor today is a single self-hosted ligature webfont (`fonts/Phosphor.woff2`, zero build step). The replacement keeps that "one local asset, no build step, no CDN" property, but as an **inline SVG sprite** — a single `<svg style="display:none">` block of `<symbol>`s (real Lucide path data fetched and verified, not generated) placed directly in `index.html`'s `<body>`, as a sibling of `#app` — instead of a font. It must be inline rather than a separate `icons/sprite.svg` file: WebKit (iOS Safari, which this app explicitly targets) has a long history of not reliably supporting `<use>` references into an *external* SVG document — that's the entire reason the `svg4everybody` polyfill exists — whereas same-document `<use href="#name">` is universally supported. Living outside `#app` also means the sprite survives every `$('#app').innerHTML = ...` view swap without needing to be re-inserted. Every `<i class="ph ph-NAME">` call site becomes `<svg class="icon"><use href="#NAME"></use></svg>`; a `.icon { width: 1em; height: 1em; display: inline-block; vertical-align: -0.15em; flex-shrink: 0; }` rule replaces the deleted `.ph` font-sizing rule, so every existing `font-size`-based icon sizing in `styles.css` keeps working unchanged (icons size off `1em` exactly like the ligature font did). The service worker's `SHELL` precache list must also drop its two now-deleted Phosphor entries — `Cache.addAll()` fails atomically if any entry 404s, so leaving them in would break offline install entirely.

Confirmed old → new name mapping (fetched and diffed against the live Lucide package, not guessed):

| Old (Phosphor) | New (Lucide) | Where used |
|---|---|---|
| `moon` | `moon` *(unchanged)* | TYPES.sleep, Sleep tab, nav |
| `moon-stars` | `moon-star` | SweetSpot card icon |
| `house` | `house` *(unchanged)* | nav |
| `chart-bar` | `chart-bar` *(unchanged)* | nav (Trends) |
| `ruler` | `ruler` *(unchanged)* | nav (Growth) |
| `user` | `user` *(unchanged)* | nav (Profile) |
| `user-circle` | `circle-user` | Profile avatar fallback |
| `drop` | `droplet` | TYPES.feed |
| `drop-half` (icon() fallback → `drop`) | `droplet` (icon() fallback unchanged in effect) | TYPES.pump |
| `baby` | `baby` *(unchanged)* | TYPES.diaper |
| `baby-bottle` (icon() fallback → `baby`) | `milk` — a real upgrade, Lucide has an actual bottle-shaped glyph so the fallback-to-`baby` hack goes away | TYPES.bottle, bottle card |
| `pill` | `pill` *(unchanged)* | TYPES.medicine, medicine card |
| `note-pencil` | `notebook-pen` | TYPES.note |
| `arrow-counter-clockwise` | `undo-2` | reset confirm |
| `camera` | `camera` *(unchanged)* | photo edit |
| `copy` **or** `share` | `share-2` | invite link |
| `check` | `check` *(unchanged)* | save buttons |
| `dots-three` | `ellipsis` | "More" action |
| `heart-straight` | `heart` | notification test toast |
| `minus` / `plus` | `minus` / `plus` *(unchanged)* | steppers |
| `pencil-simple` | `pencil` | edit actions |
| `sliders-horizontal` | `sliders-horizontal` *(unchanged)* | card edit |
| `trash` | `trash-2` (Lucide's fuller "lid" glyph) | delete actions |
| `x` | `x` *(unchanged)* | sheet close |

`js/ui.js`'s `icon()` fallback function and the `TYPES` table keep their exact current structure and role — only the string *values* inside them change, per the table above. No call-site logic changes, only the icon-name strings flowing through the existing indirection.

Note on sequencing: a separate, already-approved punch-list plan independently changes the invite-link button from "Copy link" (`ph-copy`) to "Share link" (a Phosphor `share` icon). That plan may or may not have run yet by the time this reskin is implemented. The implementation plan for this reskin must not assume either way — it should target the invite-link button directly and set it to `share-2` regardless of which Phosphor class name is on disk when the icon-sweep task runs.

## 4. Layout details

- **Paper-grain texture**: reuse the already-designed `.phone` background-image `feTurbulence` data-URI verbatim (from the earlier punch-list plan) — it was deliberately built to ride on `var(--bg)` rather than hardcoded colors, so it needs zero changes to work with the new palette.
- **All-caps letter-spaced section labels with a rule**, the one purely-cosmetic `theme.txt` device not yet covered: apply to the two existing section-heading classes, `.today-hd h2` and `.chart-hd h2` ("Today", "SweetSpot schedule") — `text-transform: uppercase; letter-spacing: .07em; font-size: 12px;` plus a `border-bottom: 1px solid var(--hair); padding-bottom: 6px;` on the row. No new markup, no new classes.
- Pills, rounded cards, circular avatars: already fully compliant with `theme.txt`'s own recommendations; no changes.

## 5. `CLAUDE.md` and `theme.txt`

- `CLAUDE.md`'s rules line `Phosphor icons only, Quicksand for display type, Nunito for body.` becomes `Lucide icons only (vendored locally as an SVG sprite), Playfair Display for the baby's name and the hero timer, Archivo for everything else.`
- `theme.txt` currently holds the *Secret Nature* research notes (uncommitted) that this whole conversion was sourced from — it has served its purpose. Once the conversion ships, `theme.txt` is rewritten back into its original role: Hearth's own design-language breakdown, now documenting *this* system (the cream/sage-or-olive palette, the Archivo/Playfair pairing, Lucide icons) the same way it used to document the old pastel/Quicksand/Nunito one. The Secret Nature research itself isn't preserved anywhere in the repo afterward — it was reference material, not a deliverable.

## Testing / verification

This is a CSS + static-asset + icon-name-string change with no new business logic, so there's nothing here for the existing unit tests (`node js/store.test.js`) or the Playwright E2E suite (`npm test`) to exercise *for this change specifically* — both should simply stay green throughout (a regression there would mean an unrelated JS mistake, e.g. a broken import while editing `js/ui.js`'s `TYPES` table). Real verification is visual: every screen, both theme variants, both light and dark mode, checked live via `/run`.
