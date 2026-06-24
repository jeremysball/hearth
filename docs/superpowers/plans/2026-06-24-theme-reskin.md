# Hearth Theme Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan will be executed by a different, less capable model than the one that wrote it, running unattended via `opencode` in a tmux session.** Every step below is therefore maximally explicit and mechanical on purpose: exact file content for new files, exact before/after text for edits, exact commands with exact expected output. Do not improvise beyond what a step says. If a step's "before" text does not match what's actually in the file, stop and report the mismatch instead of guessing — do not proceed past a step you can't match exactly.
>
> **You (the executor) cannot visually verify this work.** Every task's "Verify" step is a text command with a checkable expected output (grep, test runner). Do not skip these. A human will do the final visual pass separately — your job is to make every mechanical check pass and leave working, tested code at each commit.

**Goal:** Replace Hearth's pastel/Quicksand-Nunito/Phosphor design system with the new system defined in `docs/superpowers/specs/2026-06-24-theme-reskin-design.md`: a warm-olive/cool-sage muted-earth palette, an Archivo+Playfair Display type pairing, and a Lucide SVG-icon-sprite replacing Phosphor — then update `CLAUDE.md` and `theme.txt` to document the new system.

**Architecture:** Five independently-committable layers, in order: palette → typography → icons → layout details (paper grain + all-caps section labels) → docs. Each layer touches `styles.css`/`index.html`/specific `js/*.js` files only, no new dependencies, no build step, no server changes. Every task ends in a fully working, fully tested state — never leave a commit where icons or fonts are half-swapped.

**Tech Stack:** Vanilla JS PWA, plain CSS custom properties, one new static asset (`icons/sprite.svg`), Google Fonts (already used today for the old typefaces, same mechanism for the new ones).

## Global Constraints

- **Version bump on every change, no exceptions.** Before *each* task's commit: run `date -u +%Y-%m-%dT%H:%M` and set that exact value in both `<meta name="version" content="...">` in `index.html` and `const VERSION = 'hearth-<value>'` in `sw.js` — the two must match (`sw.js` just adds the `hearth-` prefix).
- Conventional Commits for every commit message.
- No framework. No new npm dependencies, no build step. The icon sprite is a static asset, not generated.
- Two-typeface discipline: Playfair Display is used for exactly two elements (`.baby`, `.timer`) and nowhere else. Archivo is used for literally everything else (body text and all former-Quicksand structural text).
- Every "Verify" step in this plan is mechanical (grep / test runner) — there is no visual-check step for the executor. Run every verify command and confirm the stated expected output before moving to the next step.

---

### Task 1: Palette — warm-olive and cool-sage, light and dark

**Files:**
- Modify: `styles.css:17-38` (light-mode theme blocks), `styles.css:44` (medicine category tone), `styles.css:147-167` (dark-mode blocks)
- Modify: `index.html:8` (theme-color meta)
- Modify: `js/ui.js` (the `theme.content` line inside `applyTheme()`)

- [ ] **Step 1: Replace the light-mode `girl` theme block**

In `styles.css`, find:
```css
:root, [data-theme="girl"] {
  --page: oklch(0.965 0.018 22); --page-glow: oklch(0.93 0.04 18 / .5);
  --bg: oklch(0.985 0.01 30); --surface: oklch(0.997 0.003 90);
  --ink: oklch(0.36 0.03 25); --soft: oklch(0.52 0.03 25); --muted: oklch(0.66 0.025 28);
  --hair: oklch(0.93 0.015 24);
  --accent: oklch(0.72 0.085 18); --accent-ink: oklch(0.56 0.092 18);
  --accent-soft: oklch(0.92 0.04 18); --accent-tint: oklch(0.965 0.024 22);
  --on-accent: oklch(0.997 0.004 90);
  --good: oklch(0.66 0.08 168); --good-deep: oklch(0.44 0.075 168); --good-halo: oklch(0.9 0.05 168);
  --good-tint: oklch(0.93 0.05 168 / .5); --ring-track: oklch(0.93 0.02 22);
}
```
Replace it with:
```css
:root, [data-theme="girl"] {
  --page: oklch(0.96 0.016 95); --page-glow: oklch(0.91 0.035 88 / .5);
  --bg: oklch(0.985 0.009 95); --surface: oklch(0.996 0.005 95);
  --ink: oklch(0.32 0.035 110); --soft: oklch(0.46 0.032 110); --muted: oklch(0.6 0.028 105);
  --hair: oklch(0.9 0.018 95);
  --accent: oklch(0.42 0.07 125); --accent-ink: oklch(0.34 0.065 125);
  --accent-soft: oklch(0.88 0.035 120); --accent-tint: oklch(0.95 0.02 100);
  --on-accent: oklch(0.98 0.012 95);
  --good: oklch(0.62 0.1 75); --good-deep: oklch(0.46 0.09 70); --good-halo: oklch(0.88 0.06 78);
  --good-tint: oklch(0.92 0.05 78 / .5); --ring-track: oklch(0.91 0.015 95);
}
```

- [ ] **Step 2: Replace the light-mode `boy` theme block**

Find:
```css
[data-theme="boy"] {
  --page: oklch(0.965 0.016 248); --page-glow: oklch(0.92 0.04 250 / .55);
  --bg: oklch(0.985 0.008 250); --surface: oklch(0.997 0.003 250);
  --ink: oklch(0.36 0.028 255); --soft: oklch(0.52 0.028 255); --muted: oklch(0.66 0.022 255);
  --hair: oklch(0.93 0.013 250);
  --accent: oklch(0.66 0.085 252); --accent-ink: oklch(0.52 0.09 252);
  --accent-soft: oklch(0.92 0.038 252); --accent-tint: oklch(0.965 0.02 252);
  --on-accent: oklch(0.997 0.003 250);
  --good: oklch(0.66 0.08 200); --good-deep: oklch(0.45 0.08 205); --good-halo: oklch(0.9 0.045 200);
  --good-tint: oklch(0.93 0.05 200 / .5); --ring-track: oklch(0.93 0.018 250);
}
```
Replace it with:
```css
[data-theme="boy"] {
  --page: oklch(0.96 0.013 135); --page-glow: oklch(0.91 0.028 142 / .5);
  --bg: oklch(0.985 0.008 135); --surface: oklch(0.996 0.004 135);
  --ink: oklch(0.32 0.03 165); --soft: oklch(0.46 0.028 165); --muted: oklch(0.6 0.024 160);
  --hair: oklch(0.9 0.015 142);
  --accent: oklch(0.45 0.06 175); --accent-ink: oklch(0.36 0.055 175);
  --accent-soft: oklch(0.88 0.03 170); --accent-tint: oklch(0.95 0.016 145);
  --on-accent: oklch(0.98 0.008 135);
  --good: oklch(0.6 0.08 90); --good-deep: oklch(0.45 0.075 88); --good-halo: oklch(0.88 0.05 92);
  --good-tint: oklch(0.92 0.045 92 / .5); --ring-track: oklch(0.91 0.013 142);
}
```

- [ ] **Step 3: Retune the medicine category tone away from violet**

Find:
```css
.med,.tone-med { --tc: oklch(0.52 0.1 300); --tcb: oklch(0.93 0.045 300); }
```
Replace it with:
```css
.med,.tone-med { --tc: oklch(0.5 0.09 35); --tcb: oklch(0.92 0.045 40); }
```
(`.sleep`/`.tone-sleep` and `.feed`/`.tone-feed` derive from `--good`/`--accent` and retint automatically from Steps 1-2. `.diaper`/`.tone-diaper` and `.note`/`.tone-note` are unchanged — leave them exactly as they are.)

- [ ] **Step 4: Replace the shared dark-mode block**

Find:
```css
[data-mode="dark"] {
  --page: oklch(0.15 0.012 52); --page-glow: oklch(0.22 0.02 48 / .6);
  --bg: oklch(0.18 0.014 50); --surface: oklch(0.22 0.014 50);
  --ink: oklch(0.92 0.01 70); --soft: oklch(0.72 0.012 65); --muted: oklch(0.67 0.012 64);
  --hair: oklch(0.28 0.014 52);
  --ring-track: oklch(0.26 0.015 52);
}
```
Replace it with:
```css
[data-mode="dark"] {
  --page: oklch(0.22 0.016 95); --page-glow: oklch(0.28 0.03 88 / .4);
  --bg: oklch(0.18 0.012 95); --surface: oklch(0.24 0.014 95);
  --ink: oklch(0.92 0.02 90); --soft: oklch(0.78 0.022 90); --muted: oklch(0.6 0.02 90);
  --hair: oklch(0.32 0.018 95);
  --ring-track: oklch(0.3 0.015 95);
}
```

- [ ] **Step 5: Replace the dark-mode `girl` accent/good overrides**

Find:
```css
[data-mode="dark"][data-theme="girl"] {
  --accent: oklch(0.75 0.09 18); --accent-ink: oklch(0.85 0.07 20);
  --accent-soft: oklch(0.28 0.04 20); --accent-tint: oklch(0.24 0.025 22);
  --on-accent: oklch(0.16 0.01 50);
  --good: oklch(0.68 0.09 168); --good-deep: oklch(0.78 0.07 165); --good-halo: oklch(0.28 0.06 165);
  --good-tint: oklch(0.25 0.05 165 / .6);
}
```
Replace it with:
```css
[data-mode="dark"][data-theme="girl"] {
  --accent: oklch(0.68 0.09 125); --accent-ink: oklch(0.78 0.08 125);
  --accent-soft: oklch(0.32 0.05 122); --accent-tint: oklch(0.28 0.03 110);
  --on-accent: oklch(0.18 0.01 95);
  --good: oklch(0.7 0.1 78); --good-deep: oklch(0.55 0.09 75); --good-halo: oklch(0.34 0.06 78);
  --good-tint: oklch(0.3 0.05 78 / .5);
}
```

- [ ] **Step 6: Replace the dark-mode `boy` accent/good overrides**

Find:
```css
[data-mode="dark"][data-theme="boy"] {
  --accent: oklch(0.70 0.09 252); --accent-ink: oklch(0.82 0.07 252);
  --accent-soft: oklch(0.26 0.04 252); --accent-tint: oklch(0.22 0.025 252);
  --on-accent: oklch(0.16 0.01 250);
  --good: oklch(0.68 0.09 200); --good-deep: oklch(0.78 0.07 198); --good-halo: oklch(0.28 0.06 200);
  --good-tint: oklch(0.25 0.05 200 / .6);
}
```
Replace it with:
```css
[data-mode="dark"][data-theme="boy"] {
  --accent: oklch(0.68 0.075 175); --accent-ink: oklch(0.78 0.065 175);
  --accent-soft: oklch(0.32 0.04 172); --accent-tint: oklch(0.28 0.025 150);
  --on-accent: oklch(0.18 0.008 140);
  --good: oklch(0.68 0.085 92); --good-deep: oklch(0.53 0.078 90); --good-halo: oklch(0.34 0.05 92);
  --good-tint: oklch(0.3 0.045 92 / .5);
}
```

- [ ] **Step 7: Update the static `theme-color` meta in `index.html`**

Find:
```html
<meta name="theme-color" content="#f5e1dc" />
```
Replace it with:
```html
<meta name="theme-color" content="#f3eee0" />
```

- [ ] **Step 8: Update the dynamic `theme-color` values in `js/ui.js`**

Inside `applyTheme()`, find:
```js
  if (meta) meta.content = mode === 'dark' ? (t === 'boy' ? '#1b2230' : '#241a1c') : (t === 'boy' ? '#dce6f5' : '#f5e1dc');
```
Replace it with:
```js
  if (meta) meta.content = mode === 'dark' ? (t === 'boy' ? '#1c1f1b' : '#211f17') : (t === 'boy' ? '#eef0e4' : '#f3eee0');
```

- [ ] **Step 9: Bump the version**

Run `date -u +%Y-%m-%dT%H:%M` and set that value in `index.html`'s `<meta name="version">` and as `hearth-<value>` in `sw.js`'s `VERSION` constant.

- [ ] **Step 10: Verify**

Run:
```bash
node js/store.test.js
```
Expected: the summary line reads `fail 0` (the exact `pass` count depends on whether an unrelated, separately-tracked plan has already added its own tests to this file — only `fail 0` matters here). This task touches no JS logic, so any failure means a typo broke something unrelated; stop and fix before continuing.

Run:
```bash
rg -n "oklch\(0.72 0.085 18\)|oklch\(0.66 0.085 252\)|oklch\(0.52 0.1 300\)" styles.css
```
Expected: no output (the old coral/periwinkle/violet values are gone).

- [ ] **Step 11: Commit**

```bash
git add styles.css index.html js/ui.js sw.js
git commit -m "feat(theme): retune palette to warm-olive/cool-sage muted-earth system"
```

---

### Task 2: Typography — Archivo + Playfair Display

**Files:**
- Modify: `index.html:17` (Google Fonts link)
- Modify: `styles.css` (14 `font-family` declarations)

**Interfaces:** Depends on nothing from Task 1. Task 3 (icons) does not touch any `font-family` line, so this task and Task 3 cannot conflict.

- [ ] **Step 1: Swap the Google Fonts link**

In `index.html`, find:
```html
<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&family=Nunito:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
```
Replace it with:
```html
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />
```

- [ ] **Step 2: Move the body and two SVG-text rules from Nunito to Archivo**

In `styles.css`, find:
```css
  font-family: "Nunito", system-ui, sans-serif;
```
Replace it with:
```css
  font-family: "Archivo", system-ui, sans-serif;
```

Find:
```css
.ic-rel { font-family: "Nunito"; font-size: 12px; font-weight: 700; color: var(--muted); margin-left: 4px; }
```
Replace it with:
```css
.ic-rel { font-family: "Archivo"; font-size: 12px; font-weight: 700; color: var(--muted); margin-left: 4px; }
```

Find:
```css
.growth-svg .growth-x { font-size: 11px; font-family: "Nunito", sans-serif; font-weight: 700; fill: var(--muted); }
```
Replace it with:
```css
.growth-svg .growth-x { font-size: 11px; font-family: "Archivo", sans-serif; font-weight: 700; fill: var(--muted); }
```

- [ ] **Step 3: Give `.baby` and `.timer` the new proud voice, Playfair Display**

Find:
```css
.baby { font-family: "Quicksand", sans-serif; font-size: 28px; font-weight: 700; margin: 1px 0 0; line-height: 1.05; letter-spacing: -.015em; }
```
Replace it with:
```css
.baby { font-family: "Playfair Display", serif; font-size: 28px; font-weight: 700; margin: 1px 0 0; line-height: 1.05; letter-spacing: -.015em; }
```

Find:
```css
.timer { font-family: "Quicksand", sans-serif; font-size: 50px; font-weight: 700; line-height: 1; margin: 13px 0 6px; letter-spacing: -.02em; }
```
Replace it with:
```css
.timer { font-family: "Playfair Display", serif; font-size: 50px; font-weight: 700; line-height: 1; margin: 13px 0 6px; letter-spacing: -.02em; }
```

- [ ] **Step 4: Move every remaining Quicksand rule to Archivo**

Find each of these 9 lines and replace `"Quicksand"` with `"Archivo"` in place, leaving every other character on the line untouched:
```css
.avatar { width: 48px; height: 48px; border-radius: 50%; flex: 0 0 auto; background: radial-gradient(circle at 35% 30%, var(--accent-soft), var(--accent)); color: var(--on-accent); display: flex; align-items: center; justify-content: center; font-family: "Quicksand", sans-serif; font-size: 20px; font-weight: 700; background-size: cover; background-position: center; }
```
```css
.ic-val { font-family: "Quicksand", sans-serif; font-size: 18px; font-weight: 700; margin-top: 2px; }
```
```css
.today-hd h2 { font-family: "Quicksand"; font-size: 18px; font-weight: 700; margin: 0; letter-spacing: -.01em; }
```
```css
.page-title { font-family: "Quicksand"; font-size: 26px; font-weight: 700; margin: 0; letter-spacing: -.02em; }
```
```css
.stat-v { font-family: "Quicksand"; font-size: 24px; font-weight: 700; margin-top: 3px; }
```
```css
.chart-hd h2 { font-family: "Quicksand"; font-size: 16px; font-weight: 700; margin: 0; }
```
```css
.ring-big { font-family: "Quicksand"; font-size: 38px; font-weight: 700; letter-spacing: -.02em; }
```
```css
.sched-win { font-family: "Quicksand"; font-weight: 700; font-size: 15px; }
```
```css
.sheet-hd h3 { font-family: "Quicksand"; font-size: 19px; font-weight: 700; margin: 0; }
```
```css
.entry-title { font-family: "Quicksand"; font-size: 18px; font-weight: 700; }
```
```css
.onb-title { font-family: "Quicksand"; font-size: 26px; font-weight: 700; margin: 0; letter-spacing: -.02em; }
```
(That's 11 lines listed — `.avatar` through `.onb-title` — each gets only its `"Quicksand"` token changed to `"Archivo"`; every other token on each line stays exactly as shown.)

- [ ] **Step 5: Bump the version** per Global Constraints.

- [ ] **Step 6: Verify**

Run:
```bash
rg -n "Quicksand|Nunito" styles.css index.html
```
Expected: no output.

Run:
```bash
rg -c "Playfair Display" styles.css
```
Expected: `2` (only `.baby` and `.timer`).

Run:
```bash
node js/store.test.js && npm test
```
Expected: all tests pass (this task touches no JS, so a failure means something else broke — fix before continuing).

- [ ] **Step 7: Commit**

```bash
git add styles.css index.html sw.js
git commit -m "feat(theme): swap Quicksand/Nunito for Archivo/Playfair Display"
```

---

### Task 3: Icon system — Lucide SVG sprite replacing Phosphor

**Files:**
- Modify: `index.html` (inline `<svg>` sprite added to `<body>`; remove the `phosphor.css` link)
- Modify: `sw.js` (remove the two Phosphor entries from `SHELL`)
- Delete: `fonts/Phosphor.woff2`, `fonts/phosphor.css`
- Modify: `styles.css` (add `.icon` rule)
- Modify: `js/ui.js`, `js/app.js`, `js/home.js`, `js/sheets.js`, `js/sleep.js`, `js/growth.js`, `js/profile.js`, `js/onboarding.js`, `js/join.js` (every `<i class="ph ph-...">` call site)

**Why inline, not a separate sprite file:** WebKit (iOS Safari, which this app explicitly targets per `CLAUDE.md`) has a long history of not reliably supporting `<use>` references into an *external* SVG document — that's the entire reason the `svg4everybody` polyfill exists. A same-document `<use href="#name">` reference, by contrast, is universally supported. Inlining the sprite as a single `<svg style="display:none">` block in `index.html`'s `<body>` — as a sibling of `#app`, not inside it — means it survives every `$('#app').innerHTML = ...` view swap (`router.go`, `router.refresh`, onboarding, join) without needing to be re-inserted, since none of those touch anything outside `#app`.

**Interfaces:** Independent of Tasks 1-2 (touches no palette or font-family lines). This task must land as a single atomic commit — do not split it across multiple commits, because a partially-completed sweep would leave some icons rendering as blank Phosphor-font glyphs that no longer exist.

- [ ] **Step 1: Inline the icon sprite into `index.html`**

In `index.html`, find:
```html
<body data-theme="girl">
  <div id="app"></div>
```
Replace it with (the `<svg>` block goes immediately before `<div id="app">`, as its sibling):
```html
<body data-theme="girl">
<svg style="display:none">
<!-- Lucide icons, ISC license: https://lucide.dev -->
<symbol id="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
</symbol>
<symbol id="moon-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M18 5h4" />
  <path d="M20 3v4" />
  <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
</symbol>
<symbol id="house" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
  <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
</symbol>
<symbol id="chart-bar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 3v16a2 2 0 0 0 2 2h16" />
  <path d="M7 16h8" />
  <path d="M7 11h12" />
  <path d="M7 6h3" />
</symbol>
<symbol id="ruler" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
  <path d="m14.5 12.5 2-2" />
  <path d="m11.5 9.5 2-2" />
  <path d="m8.5 6.5 2-2" />
  <path d="m17.5 15.5 2-2" />
</symbol>
<symbol id="user" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
  <circle cx="12" cy="7" r="4" />
</symbol>
<symbol id="circle-user" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10" />
  <circle cx="12" cy="10" r="3" />
  <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
</symbol>
<symbol id="droplet" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
</symbol>
<symbol id="baby" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5" />
  <path d="M15 12h.01" />
  <path d="M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1" />
  <path d="M9 12h.01" />
</symbol>
<symbol id="milk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 2h8" />
  <path d="M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2" />
  <path d="M7 15a6.472 6.472 0 0 1 5 0 6.47 6.47 0 0 0 5 0" />
</symbol>
<symbol id="pill" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
  <path d="m8.5 8.5 7 7" />
</symbol>
<symbol id="notebook-pen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
  <path d="M2 6h4" />
  <path d="M2 10h4" />
  <path d="M2 14h4" />
  <path d="M2 18h4" />
  <path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
</symbol>
<symbol id="undo-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9 14 4 9l5-5" />
  <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
</symbol>
<symbol id="camera" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
  <circle cx="12" cy="13" r="3" />
</symbol>
<symbol id="share-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="18" cy="5" r="3" />
  <circle cx="6" cy="12" r="3" />
  <circle cx="18" cy="19" r="3" />
  <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
  <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
</symbol>
<symbol id="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M20 6 9 17l-5-5" />
</symbol>
<symbol id="ellipsis" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="1" />
  <circle cx="19" cy="12" r="1" />
  <circle cx="5" cy="12" r="1" />
</symbol>
<symbol id="heart" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
</symbol>
<symbol id="minus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 12h14" />
</symbol>
<symbol id="pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
  <path d="m15 5 4 4" />
</symbol>
<symbol id="plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 12h14" />
  <path d="M12 5v14" />
</symbol>
<symbol id="sliders-horizontal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 5H3" />
  <path d="M12 19H3" />
  <path d="M14 3v4" />
  <path d="M16 17v4" />
  <path d="M21 12h-9" />
  <path d="M21 19h-5" />
  <path d="M21 5h-7" />
  <path d="M8 10v4" />
  <path d="M8 12H3" />
</symbol>
<symbol id="trash-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 11v6" />
  <path d="M14 11v6" />
  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  <path d="M3 6h18" />
  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
</symbol>
<symbol id="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M18 6 6 18" />
  <path d="m6 6 12 12" />
</symbol>
</svg>
  <div id="app"></div>
```

- [ ] **Step 2: Remove the Phosphor link from `index.html`**

Find and delete this line entirely:
```html
<link rel="stylesheet" href="fonts/phosphor.css" />
```

- [ ] **Step 3: Remove the two Phosphor entries from `sw.js`'s precache list — required before deleting the files**

In `sw.js`, find:
```js
  './icons/apple-touch-icon.png',
  './fonts/phosphor.css',
  './fonts/Phosphor.woff2',
  './js/app.js',
```
Replace it with:
```js
  './icons/apple-touch-icon.png',
  './js/app.js',
```
This is not optional cleanup — `SHELL` is passed to `caches.open(VERSION).then((c) => c.addAll(SHELL))` on service-worker install, and `addAll` fails atomically if *any* entry 404s. Deleting the Phosphor files in Step 4 below while they're still listed here would break the service worker install for every user on their next visit.

- [ ] **Step 4: Delete the Phosphor font assets and add the `.icon` CSS rule**

```bash
git rm fonts/Phosphor.woff2 fonts/phosphor.css
```

In `styles.css`, find:
```css
input, select, textarea, button { font-family: inherit; }
```
Replace it with (adding the new icon-sizing rule right after the existing line, keeping the existing line unchanged):
```css
input, select, textarea, button { font-family: inherit; }
.icon { width: 1em; height: 1em; display: inline-block; vertical-align: -0.15em; flex-shrink: 0; }
```

- [ ] **Step 5: Update `js/ui.js`'s `TYPES` table, `icon()` fallback map, and direct icon usage**

Find:
```js
export const TYPES = {
  sleep: { icon: 'moon', label: 'Sleep', tone: 'sleep' },
  feed: { icon: 'drop', label: 'Nursing', tone: 'feed' },
  bottle: { icon: 'baby-bottle', label: 'Bottle', tone: 'feed' },
  diaper: { icon: 'baby', label: 'Diaper', tone: 'diaper' },
  medicine: { icon: 'pill', label: 'Medicine', tone: 'med' },
  pump: { icon: 'drop-half', label: 'Pump', tone: 'feed' },
  note: { icon: 'note-pencil', label: 'Note', tone: 'note' }
};
```
Replace it with:
```js
export const TYPES = {
  sleep: { icon: 'moon', label: 'Sleep', tone: 'sleep' },
  feed: { icon: 'droplet', label: 'Nursing', tone: 'feed' },
  bottle: { icon: 'baby-bottle', label: 'Bottle', tone: 'feed' },
  diaper: { icon: 'baby', label: 'Diaper', tone: 'diaper' },
  medicine: { icon: 'pill', label: 'Medicine', tone: 'med' },
  pump: { icon: 'drop-half', label: 'Pump', tone: 'feed' },
  note: { icon: 'note-pencil', label: 'Note', tone: 'note' }
};
```
(Only `feed`'s value changed, from `'drop'` to `'droplet'`. `baby-bottle`, `drop-half`, and `note-pencil` are intentionally left as-is here — they are not real icon names in either the old or new system, they're keys translated by `icon()` below.)

Find:
```js
export function icon(name) {
  const map = { 'baby-bottle': 'baby', 'drop-half': 'drop', 'pill': 'pill', 'note-pencil': 'note-pencil' };
  return map[name] || name;
}
```
Replace it with:
```js
export function icon(name) {
  const map = { 'baby-bottle': 'milk', 'drop-half': 'droplet', 'pill': 'pill', 'note-pencil': 'notebook-pen' };
  return map[name] || name;
}
```

Find:
```js
        ${opts.title ? `<div class="sheet-hd"><h3>${esc(opts.title)}</h3><button class="x" data-action="sheet:close" aria-label="Close"><i class="ph ph-x"></i></button></div>` : ''}
```
Replace it with:
```js
        ${opts.title ? `<div class="sheet-hd"><h3>${esc(opts.title)}</h3><button class="x" data-action="sheet:close" aria-label="Close"><svg class="icon"><use href="#x"></use></svg></button></div>` : ''}
```

- [ ] **Step 6: Sweep `js/app.js`**

Find each line and replace it exactly as shown (7 occurrences):

```js
    <nav class="tabbar">${TABS.map((t) => `<button class="tab" data-action="nav:${t.v}" data-tab="${t.v}" aria-label="${t.label}"><i class="ph ph-${t.icon}"></i></button>`).join('')}</nav>
```
→
```js
    <nav class="tabbar">${TABS.map((t) => `<button class="tab" data-action="nav:${t.v}" data-tab="${t.v}" aria-label="${t.label}"><svg class="icon"><use href="#${t.icon}"></use></svg></button>`).join('')}</nav>
```

```js
      <span class="ic-ring ${s.tone}"><i class="ph ph-${s.icon}"></i></span>
```
→
```js
      <span class="ic-ring ${s.tone}"><svg class="icon"><use href="#${s.icon}"></use></svg></span>
```

```js
    <button class="btn-primary" data-action="entry:edit" data-id="${e.id}"><i class="ph ph-pencil-simple"></i> Edit entry</button>
```
→
```js
    <button class="btn-primary" data-action="entry:edit" data-id="${e.id}"><svg class="icon"><use href="#pencil"></use></svg> Edit entry</button>
```

```js
    <button class="btn-ghost danger" data-action="entry:delete" data-id="${e.id}"><i class="ph ph-trash"></i> Delete entry</button>`,
```
→
```js
    <button class="btn-ghost danger" data-action="entry:delete" data-id="${e.id}"><svg class="icon"><use href="#trash-2"></use></svg> Delete entry</button>`,
```

```js
    <button class="btn-primary" data-action="baby:photo-edit"><i class="ph ph-camera"></i> Change photo</button>`,
```
→
```js
    <button class="btn-primary" data-action="baby:photo-edit"><svg class="icon"><use href="#camera"></use></svg> Change photo</button>`,
```

```js
    <button class="btn-primary danger-btn" data-action="app:reset-confirm"><i class="ph ph-trash"></i> Reset everything</button>
```
→
```js
    <button class="btn-primary danger-btn" data-action="app:reset-confirm"><svg class="icon"><use href="#trash-2"></use></svg> Reset everything</button>
```

The invite-link button is the one call site that may already have been changed by a separate, independently-approved plan (it replaces "Copy link" with "Share link"). Check what's currently there:
```bash
rg -n 'data-action="cg:invite-' js/app.js
```
- If you see `data-action="cg:invite-copy"` with `<i class="ph ph-copy"></i> Copy link`, replace that whole line with:
  ```js
      <button class="btn-primary" data-action="cg:invite-copy" data-url="${esc(url)}"><svg class="icon"><use href="#share-2"></use></svg> Copy link</button>`,
  ```
  (keep the `cg:invite-copy` action name and "Copy link" text exactly as found — only the icon markup changes here; the action/label rename is the other plan's job, not this one's.)
- If you see `data-action="cg:invite-share"` with `<i class="ph ph-share"></i> Share link` (i.e. the other plan already ran), replace just the icon:
  ```js
      <button class="btn-primary" data-action="cg:invite-share" data-url="${esc(url)}"><svg class="icon"><use href="#share-2"></use></svg> Share link</button>`,
  ```
- Either way, the end state for this line is: same action name and button text as you found, `<i class="ph ph-...">` replaced by `<svg class="icon"><use href="#share-2"></use></svg>`.

- [ ] **Step 7: Sweep `js/onboarding.js`**

```js
      <div class="onb-mark"><i class="ph ph-moon-stars"></i></div>
```
→
```js
      <div class="onb-mark"><svg class="icon"><use href="#moon-star"></use></svg></div>
```

```js
        <span class="avatar lg"><i class="ph ph-camera"></i></span>
```
→
```js
        <span class="avatar lg"><svg class="icon"><use href="#camera"></use></svg></span>
```

```js
    <button class="btn-primary onb-go" data-action="onboard:finish"><i class="ph ph-heart-straight"></i> Create Hearth</button>
```
→
```js
    <button class="btn-primary onb-go" data-action="onboard:finish"><svg class="icon"><use href="#heart"></use></svg> Create Hearth</button>
```

- [ ] **Step 8: Sweep `js/join.js`**

```js
      <div class="onb-mark"><i class="ph ph-heart-straight"></i></div>
```
→
```js
      <div class="onb-mark"><svg class="icon"><use href="#heart"></use></svg></div>
```

```js
    <button class="btn-primary onb-go" data-action="join:finish" data-token="${token}"><i class="ph ph-heart-straight"></i> Join family</button>
```
→
```js
    <button class="btn-primary onb-go" data-action="join:finish" data-token="${token}"><svg class="icon"><use href="#heart"></use></svg> Join family</button>
```

- [ ] **Step 9: Sweep `js/home.js`**

```js
      <span class="row-ic tone-${s.tone}"><i class="ph ph-${s.icon}"></i></span>
      <span class="row-txt"><span class="what">${esc(s.label)}</span><span class="when">${esc(s.detail)}</span></span>
      <button class="row-act edit" data-action="entry:edit" data-id="${e.id}" aria-label="Edit"><i class="ph ph-pencil-simple"></i></button>
      <button class="row-act del" data-action="entry:delete" data-id="${e.id}" aria-label="Delete"><i class="ph ph-trash"></i></button>
    </div>`;
  }
  return `<div class="row" data-action="entry:open" data-id="${e.id}">
    <span class="row-ic tone-${s.tone}"><i class="ph ph-${s.icon}"></i></span>
```
→
```js
      <span class="row-ic tone-${s.tone}"><svg class="icon"><use href="#${s.icon}"></use></svg></span>
      <span class="row-txt"><span class="what">${esc(s.label)}</span><span class="when">${esc(s.detail)}</span></span>
      <button class="row-act edit" data-action="entry:edit" data-id="${e.id}" aria-label="Edit"><svg class="icon"><use href="#pencil"></use></svg></button>
      <button class="row-act del" data-action="entry:delete" data-id="${e.id}" aria-label="Delete"><svg class="icon"><use href="#trash-2"></use></svg></button>
    </div>`;
  }
  return `<div class="row" data-action="entry:open" data-id="${e.id}">
    <span class="row-ic tone-${s.tone}"><svg class="icon"><use href="#${s.icon}"></use></svg></span>
```

```js
    <div class="ic-ring sleep"><i class="ph ph-moon-stars"></i></div>
```
→
```js
    <div class="ic-ring sleep"><svg class="icon"><use href="#moon-star"></use></svg></div>
```

```js
    <button class="ic-edit" data-action="card:edit" data-card="sweetspot" aria-label="Edit"><i class="ph ph-sliders-horizontal"></i></button>
```
→
```js
    <button class="ic-edit" data-action="card:edit" data-card="sweetspot" aria-label="Edit"><svg class="icon"><use href="#sliders-horizontal"></use></svg></button>
```

```js
    <div class="ic-ring feed"><i class="ph ph-${icon('baby-bottle')}"></i></div>
```
→
```js
    <div class="ic-ring feed"><svg class="icon"><use href="#${icon('baby-bottle')}"></use></svg></div>
```

```js
    <button class="ic-edit" data-action="card:edit" data-card="bottle" aria-label="Edit"><i class="ph ph-sliders-horizontal"></i></button>
```
→
```js
    <button class="ic-edit" data-action="card:edit" data-card="bottle" aria-label="Edit"><svg class="icon"><use href="#sliders-horizontal"></use></svg></button>
```

```js
    <div class="ic-ring med"><i class="ph ph-${icon('pill')}"></i></div>
```
→
```js
    <div class="ic-ring med"><svg class="icon"><use href="#${icon('pill')}"></use></svg></div>
```

```js
    <button class="ic-edit" data-action="card:edit" data-card="medicine" aria-label="Edit"><i class="ph ph-sliders-horizontal"></i></button>
```
→
```js
    <button class="ic-edit" data-action="card:edit" data-card="medicine" aria-label="Edit"><svg class="icon"><use href="#sliders-horizontal"></use></svg></button>
```

```js
  return `<div class="hidden-row">${hidden.map((k) => `<button class="chip" data-action="card:show" data-card="${k}"><i class="ph ph-plus"></i> ${names[k]}</button>`).join('')}</div>`;
```
→
```js
  return `<div class="hidden-row">${hidden.map((k) => `<button class="chip" data-action="card:show" data-card="${k}"><svg class="icon"><use href="#plus"></use></svg> ${names[k]}</button>`).join('')}</div>`;
```

```js
          <span class="tok tone-${c.tone}"><i class="ph ph-${icon(c.icon)}"></i></span><span class="act-lbl">${c.label}</span></button>`;
```
→
```js
          <span class="tok tone-${c.tone}"><svg class="icon"><use href="#${icon(c.icon)}"></use></svg></span><span class="act-lbl">${c.label}</span></button>`;
```

```js
      <button class="act" data-action="log:more"><span class="tok"><i class="ph ph-dots-three"></i></span><span class="act-lbl">More</span></button>
```
→
```js
      <button class="act" data-action="log:more"><span class="tok"><svg class="icon"><use href="#ellipsis"></use></svg></span><span class="act-lbl">More</span></button>
```

- [ ] **Step 10: Sweep `js/sheets.js`**

```js
    <button type="button" class="stepper-btn" data-action="stepper:down" data-target="${id}" aria-label="Decrease"><i class="ph ph-minus"></i></button>
```
→
```js
    <button type="button" class="stepper-btn" data-action="stepper:down" data-target="${id}" aria-label="Decrease"><svg class="icon"><use href="#minus"></use></svg></button>
```

```js
    <button type="button" class="stepper-btn" data-action="stepper:up" data-target="${id}" aria-label="Increase"><i class="ph ph-plus"></i></button>
```
→
```js
    <button type="button" class="stepper-btn" data-action="stepper:up" data-target="${id}" aria-label="Increase"><svg class="icon"><use href="#plus"></use></svg></button>
```

```js
    FORMS[type]() + `<button class="btn-primary" data-action="log:save" data-type="${type}" data-id="${editing ? entry.id : ''}"><i class="ph ph-check"></i> ${editing ? 'Save changes' : 'Log ' + cfg.label.toLowerCase()}</button>` +
      (editing ? `<button class="btn-ghost danger" data-action="entry:delete" data-id="${entry.id}"><i class="ph ph-trash"></i> Delete</button>` : ''),
```
→
```js
    FORMS[type]() + `<button class="btn-primary" data-action="log:save" data-type="${type}" data-id="${editing ? entry.id : ''}"><svg class="icon"><use href="#check"></use></svg> ${editing ? 'Save changes' : 'Log ' + cfg.label.toLowerCase()}</button>` +
      (editing ? `<button class="btn-ghost danger" data-action="entry:delete" data-id="${entry.id}"><svg class="icon"><use href="#trash-2"></use></svg> Delete</button>` : ''),
```

```js
        <span class="chooser-ic tone-${c.tone}"><i class="ph ph-${icon(c.icon)}"></i></span>
```
→
```js
        <span class="chooser-ic tone-${c.tone}"><svg class="icon"><use href="#${icon(c.icon)}"></use></svg></span>
```

```js
      <button class="btn-primary" data-action="card:save-bottle"><i class="ph ph-check"></i> Save</button>
```
→
```js
      <button class="btn-primary" data-action="card:save-bottle"><svg class="icon"><use href="#check"></use></svg> Save</button>
```

```js
    <button class="btn-ghost" data-action="med:add"><i class="ph ph-plus"></i> Add medicine</button>
    <button class="btn-primary" data-action="card:save-meds"><i class="ph ph-check"></i> Save</button>
```
→
```js
    <button class="btn-ghost" data-action="med:add"><svg class="icon"><use href="#plus"></use></svg> Add medicine</button>
    <button class="btn-primary" data-action="card:save-meds"><svg class="icon"><use href="#check"></use></svg> Save</button>
```

```js
      <button class="med-del" data-action="med:remove" data-mid="${m.id}" aria-label="Remove"><i class="ph ph-trash"></i></button>
```
→
```js
      <button class="med-del" data-action="med:remove" data-mid="${m.id}" aria-label="Remove"><svg class="icon"><use href="#trash-2"></use></svg></button>
```

```js
    <button class="btn-primary" data-action="measure:save" data-id="${id || ''}"><i class="ph ph-check"></i> ${id ? 'Save changes' : 'Add measurement'}</button>
    ${id ? `<button class="btn-ghost danger" data-action="measure:delete" data-id="${id}"><i class="ph ph-trash"></i> Delete</button>` : ''}`,
```
→
```js
    <button class="btn-primary" data-action="measure:save" data-id="${id || ''}"><svg class="icon"><use href="#check"></use></svg> ${id ? 'Save changes' : 'Add measurement'}</button>
    ${id ? `<button class="btn-ghost danger" data-action="measure:delete" data-id="${id}"><svg class="icon"><use href="#trash-2"></use></svg> Delete</button>` : ''}`,
```

- [ ] **Step 11: Sweep `js/profile.js`**

```js
        <span class="photo-edit"><i class="ph ph-camera"></i></span>
```
→
```js
        <span class="photo-edit"><svg class="icon"><use href="#camera"></use></svg></span>
```

```js
      <button class="add-row" data-action="cg:invite"><i class="ph ph-plus"></i> Invite a caregiver</button>
```
→
```js
      <button class="add-row" data-action="cg:invite"><svg class="icon"><use href="#plus"></use></svg> Invite a caregiver</button>
```

```js
    <button class="btn-ghost danger" data-action="app:reset"><i class="ph ph-arrow-counter-clockwise"></i> Reset app & start over</button>
```
→
```js
    <button class="btn-ghost danger" data-action="app:reset"><svg class="icon"><use href="#undo-2"></use></svg> Reset app & start over</button>
```

```js
    <i class="ph ph-user-circle"></i>
```
→
```js
    <svg class="icon"><use href="#circle-user"></use></svg>
```

- [ ] **Step 12: Sweep `js/growth.js`**

```js
    <span class="row-ic tone-med"><i class="ph ph-ruler"></i></span>
```
→
```js
    <span class="row-ic tone-med"><svg class="icon"><use href="#ruler"></use></svg></span>
```

```js
    <div class="today-hd"><h2>History</h2><button class="today-add" data-action="measure:open" data-id="" aria-label="Add measurement"><i class="ph ph-plus"></i></button></div>
```
→
```js
    <div class="today-hd"><h2>History</h2><button class="today-add" data-action="measure:open" data-id="" aria-label="Add measurement"><svg class="icon"><use href="#plus"></use></svg></button></div>
```

- [ ] **Step 13: Sweep `js/sleep.js`**

```js
      <span class="row-ic tone-sleep"><i class="ph ph-moon"></i></span>
```
→
```js
      <span class="row-ic tone-sleep"><svg class="icon"><use href="#moon"></use></svg></span>
```

```js
      ${night ? `<div class="night-strip"><i class="ph ph-moon-stars"></i> Last night · <b>${fmt.dur(night.dur)}</b> · ${fmt.clock(night.s)}–${fmt.clock(night.en)}</div>` : ''}
```
→
```js
      ${night ? `<div class="night-strip"><svg class="icon"><use href="#moon-star"></use></svg> Last night · <b>${fmt.dur(night.dur)}</b> · ${fmt.clock(night.s)}–${fmt.clock(night.en)}</div>` : ''}
```

```js
      <div class="today-hd"><h2>Today's sleep</h2><button class="today-add" data-action="log:open" data-type="sleep" aria-label="Log sleep"><i class="ph ph-plus"></i></button></div>
```
→
```js
      <div class="today-hd"><h2>Today's sleep</h2><button class="today-add" data-action="log:open" data-type="sleep" aria-label="Log sleep"><svg class="icon"><use href="#plus"></use></svg></button></div>
```

- [ ] **Step 14: Bump the version** per Global Constraints.

- [ ] **Step 15: Verify**

Run:
```bash
rg -n 'class="ph |icons/sprite\.svg' js/*.js index.html styles.css sw.js
```
Expected: no output — every Phosphor-pattern call site and every external-sprite-file reference is gone (the sprite is inline now, referenced only as `href="#name"`).

Run:
```bash
test ! -f fonts/Phosphor.woff2 && test ! -f fonts/phosphor.css && echo "deleted"
```
Expected: `deleted`.

Run:
```bash
rg -n "phosphor" sw.js
```
Expected: no output — confirms `SHELL` no longer references the deleted files.

Run:
```bash
node js/store.test.js && npm test
```
Expected: all tests pass. `tests/spinner.test.js` and `tests/persistence.test.js` both load real pages in a real browser and log any `pageerror` — if an icon edit introduced a JS syntax error, or the inline sprite broke `index.html`'s markup, these will fail or print `PAGEERROR:` lines; if you see any, find and fix the exact line before continuing.

- [ ] **Step 16: Commit**

```bash
git add styles.css index.html sw.js js/ui.js js/app.js js/onboarding.js js/join.js js/home.js js/sheets.js js/profile.js js/growth.js js/sleep.js
git commit -m "feat(icons): replace Phosphor with an inline Lucide SVG sprite"
```

---

### Task 4: Layout details — paper grain texture and all-caps section labels

**Files:**
- Modify: `styles.css:48-52` (`.phone`), `styles.css:121-122` (`.today-hd`, `.today-hd h2`), `styles.css:184-185` (`.chart-hd`, `.chart-hd h2`)

**Interfaces:** Independent of Tasks 1-3, but the font-family values on `.today-hd h2`/`.chart-hd h2` were already changed to `"Archivo"` by Task 2 — this task only adds size/spacing/case properties to those same two rules, it does not touch `font-family` again.

- [ ] **Step 1: Add the paper-grain texture to `.phone`**

Find:
```css
.phone {
  --pad: 22px; width: 100%; max-width: 432px; height: 100%; flex: 1; min-height: 0;
  background: var(--bg); display: flex; flex-direction: column; overflow: hidden;
  transition: background .4s ease; position: relative;
}
```
Replace it with:
```css
.phone {
  --pad: 22px; width: 100%; max-width: 432px; height: 100%; flex: 1; min-height: 0;
  background: var(--bg);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncA type='linear' slope='0.05'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  display: flex; flex-direction: column; overflow: hidden;
  transition: background .4s ease; position: relative;
}
```

- [ ] **Step 2: Turn "Today" into an all-caps letter-spaced section label with a rule**

Find:
```css
.today-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
```
Replace it with:
```css
.today-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--hair); }
```

Find:
```css
.today-hd h2 { font-family: "Archivo"; font-size: 18px; font-weight: 700; margin: 0; letter-spacing: -.01em; }
```
Replace it with:
```css
.today-hd h2 { font-family: "Archivo"; font-size: 12px; font-weight: 700; margin: 0; letter-spacing: .07em; text-transform: uppercase; }
```

- [ ] **Step 3: Turn "SweetSpot schedule" into an all-caps letter-spaced section label with a rule**

Find:
```css
.chart-hd { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
```
Replace it with:
```css
.chart-hd { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--hair); }
```

Find:
```css
.chart-hd h2 { font-family: "Archivo"; font-size: 16px; font-weight: 700; margin: 0; }
```
Replace it with:
```css
.chart-hd h2 { font-family: "Archivo"; font-size: 12px; font-weight: 700; margin: 0; letter-spacing: .07em; text-transform: uppercase; }
```

- [ ] **Step 4: Bump the version** per Global Constraints.

- [ ] **Step 5: Verify**

Run:
```bash
rg -c "feTurbulence" styles.css
```
Expected: `1`.

Run:
```bash
rg -c "text-transform: uppercase" styles.css
```
Expected: `2`.

Run:
```bash
node js/store.test.js && npm test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add styles.css index.html sw.js
git commit -m "style: add paper-grain texture and all-caps section labels"
```

---

### Task 5: Update `CLAUDE.md` and rewrite `theme.txt`

**Files:**
- Modify: `CLAUDE.md`
- Modify: `theme.txt` (full rewrite)

- [ ] **Step 1: Update the icon/type rule in `CLAUDE.md`**

In `CLAUDE.md`, find:
```
- Phosphor icons only, Quicksand for display type, Nunito for body.
```
Replace it with:
```
- Lucide icons only (vendored locally as an inline SVG sprite in `index.html`'s `<body>`), Playfair Display for the baby's name and the hero timer, Archivo for everything else.
```

- [ ] **Step 2: Rewrite `theme.txt` to document the new system**

`theme.txt` currently holds research notes about an unrelated brand (Secret Nature) that this reskin used as inspiration. Replace its entire contents with Hearth's own design-language breakdown, describing the system actually implemented in Tasks 1-4:

```markdown
# Hearth: A Design-Language Breakdown

## TL;DR
- Hearth's look is "modern apothecary, not pastel nursery": a muted-earth
  palette (cream/oat paper, deep olive or sage accent), a two-voice type
  system (Playfair Display for the two moments meant to be felt, Archivo
  for everything else), a local Lucide icon sprite, and a barely-visible
  paper-grain texture.
- Two palettes ship — a warm "girl" olive theme and a cool "boy" sage
  theme — built from the *same* set of CSS variable roles (page, surface,
  ink, accent, good), so swapping one out never reshuffles the layout,
  just the mood.
- Type does two jobs: **Playfair Display** is the proud one (baby's name,
  the big sleep timer) and **Archivo** is the quiet one (everything else,
  including every other number and heading in the app). Lucide's thin
  line icons sit on top, one stroke weight, never shouting.
- Pills, big-radius cards, and circular avatars are unchanged from before
  this reskin — "round everything" was already true and theme.txt's own
  source material recommended the same shapes.

## 1. Palette — "Muted Earth, Two Moods"
Both themes share the same *roles*; only the hue shifts. Values are OKLCH
straight from `:root`/`[data-theme]` in `styles.css`:

| Role | What it's for | Girl (warm olive) | Boy (cool sage) |
|---|---|---|---|
| `--page` | app backdrop | `oklch(0.96 0.016 95)` cream | `oklch(0.96 0.013 135)` oat |
| `--ink` | primary text | `oklch(0.32 0.035 110)` | `oklch(0.32 0.03 165)` |
| `--accent` | buttons, baby's avatar | `oklch(0.42 0.07 125)` forest-olive | `oklch(0.45 0.06 175)` sage |
| `--good` | sleep ring, live-dot | `oklch(0.62 0.1 75)` ochre-gold | `oklch(0.6 0.08 90)` cooler gold |

Dark mode relights the same roles into a shared deep charcoal-olive
backdrop (never pure black), then nudges `--accent`/`--good` brighter per
theme so they still read against the dark surface.

Category tones: diaper stays amber, medicine moved from violet to a muted
clay/terracotta (`oklch(0.5 0.09 35)`) to stay inside the earth-tone
family, note stays tied to `--muted`/`--hair`.

**Why it works:** every color sits in the same narrow lightness/chroma
band, and neither palette goes near pure white or pure black — the same
discipline the old pastel system used, just recentered on cream and olive
instead of blush and powder blue.

## 2. Typography — One Proud Voice, One Quiet One
- **Playfair Display** (high-contrast calligraphic serif) is reserved for
  exactly two elements: the baby's name (`.baby`) and the big sleep/awake
  timer (`.timer`) — the two things designed to be *felt* before they're
  read.
- **Archivo** (grotesque) is everything else: body copy, every stat
  number, every page/sheet/section title, every label, every button. It
  replaced both Quicksand's old structural job and Nunito's old body job,
  so the app still has exactly two type voices, never three.
- **Lucide** (thin 2px-stroke line icons, vendored locally as an inline
  `<svg>` sprite in `index.html`'s `<body>`, referenced via `<svg
  class="icon"><use href="#name"></use></svg>` — same-document references
  only, since cross-document `<use>` into an external file is unreliable
  on iOS Safari) supplies every glyph.

**Why the pairing works:** a heavy grotesque next to a high-contrast
serif is a classic "editorial" move — the grotesque supplies structure
and the serif supplies a felt, proud moment — but Hearth only ever lets
the serif own two elements, so it reads as a quiet accent, not a second
competing voice.

## 3. Layout & Shape — Unchanged From Before
- Phone-shaped shell, pill controls, big-radius cards, circular avatars —
  all exactly as before this reskin. Nothing here needed to change to
  match the new design language.
- New: a near-invisible SVG `feTurbulence` paper-grain texture on `.phone`
  (alpha baked into the filter itself via `feComponentTransfer`, not a
  CSS blend mode, so it looks correct across both palettes and both
  light/dark modes automatically).
- New: section labels ("Today", "SweetSpot schedule") are all-caps,
  letter-spaced, and sit above a 1px `--hair` rule — a print-derived
  sectioning device.

## 4. Iconography
Lucide's regular line-icon set, one stroke weight, vendored as a single
inline `<svg>` sprite in `index.html`'s `<body>` — no font, no CDN, no
build step, no external file (same-document `<use>` is what's reliable
across browsers, including iOS Safari). The icon vocabulary is
enumerated in `js/ui.js`'s `TYPES` table and `icon()` fallback map.

## 5. Vocabulary — Named Moves Worth Reusing
- **Shared-role, swap-the-hue theming** — unchanged mechanism from before
  this reskin, just retuned values.
- **One loud face, one quiet face** — now Playfair-for-feeling,
  Archivo-for-reading, never the reverse.
- **Bake opacity into the filter, not the blend mode** — the paper-grain
  texture's alpha lives inside its own SVG filter so it never needs
  separate per-theme/per-mode tuning.

## Recommendations (for the next theme, or the next contributor)
1. **New themes inherit the role list, not the values** — same rule as
   before this reskin, see `styles.css`'s `:root`/`[data-theme]` blocks.
2. **Keep the two-typeface rule.** If a third typeface ever shows up, it
   should replace a job (proud or quiet), not add a third voice.
3. **New icons go in the inline sprite in `index.html`'s `<body>` as a
   `<symbol>`,** sourced from Lucide (ISC license) to match the existing
   stroke weight and grid.
```

- [ ] **Step 3: Bump the version** per Global Constraints.

- [ ] **Step 4: Verify**

Run:
```bash
rg -n "Phosphor|Quicksand|Nunito" CLAUDE.md
```
Expected: no output.

Run:
```bash
rg -n "Secret Nature|Day Job|cannabis" theme.txt
```
Expected: no output.

Run:
```bash
node js/store.test.js && npm test
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md theme.txt index.html sw.js
git commit -m "docs: update CLAUDE.md and theme.txt for the new design system"
```

---

## Final note for the supervising session (not for the executor)

Once all 5 tasks are committed, a human (or the Claude Code session that dispatched this run) does the visual pass this plan's executor cannot do: `/run` the app, check every screen in both theme variants and both light/dark modes, confirm the paper grain is subtle rather than muddy, confirm Playfair Display renders correctly on `.baby`/`.timer` and nowhere else, and confirm every icon in the sprite renders (no missing/blank glyphs from a typo'd `#name`).
