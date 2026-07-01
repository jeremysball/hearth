# OG Theme Refresh Implementation Plan

> **Status:** COMPLETE — merged to `main`. Hanken Grotesk body font, frosted-glass light cards, and OG (girl/boy) theme polish shipped.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply four polish items to the OG (girl/boy) themes: Hanken Grotesk body font, richer surface chroma, frosted-glass cards in light mode, and fire-synced specular glare on hero/toks/FAB/avatar.

**Architecture:** Pure CSS changes in `styles.css` plus one `<link>` addition in `index.html`. No JS required. All four items layer on the existing fire custom-property system (`--fire-a`, `--fire-b`, `--fire-c`) defined in `styles.css` and animated at `:root`. Dark mode and Day Job themes are explicitly left unchanged.

**Tech Stack:** CSS (oklch, `@property`, `calc()`, `backdrop-filter`, `color-mix()`), Google Fonts (Hanken Grotesk).

## Global Constraints

- Do NOT touch `[data-theme="dayjob"]`, `[data-theme="dayjob-girl"]`, or `[data-theme="dayjob-boy"]` rules except to add `--font-sans` overrides.
- Do NOT change `--page`, `--ink`, `--soft`, `--muted` tokens (text contrast must hold).
- Do NOT add a second ambient animation loop — all new animation must ride existing `--fire-a/b/c` vars.
- Playfair Display stays on `.baby` and `.timer` — do NOT replace those `font-family` declarations.
- Dark mode card/tok rules (`[data-mode="dark"] .card`, etc.) are untouched by Items 3 & 4 except where explicitly stated.
- Version bump is MANDATORY before committing — both `index.html` `<meta name="version">` and `sw.js` `VERSION` must be set to current UTC (`date -u +%Y-%m-%dT%H:%MZ`) and must match (differing only by `hearth-` prefix in sw.js).

---

## File Map

- **`index.html`** — add `Hanken+Grotesk` to Google Fonts `<link>`; version bump.
- **`styles.css`** — all CSS changes: `--font-sans` token, Archivo → `var(--font-sans)` replacements, OG chroma bumps, `--card-bg` token + frosted-glass rules, `--light-x/--light-y` tokens, glare on `.tok`/`.card.hero`/`.today-add`/`.avatar`; version bump in `sw.js`.
- **`sw.js`** — version bump only.

---

## Task 1: Add Hanken Grotesk font + `--font-sans` token

**Files:**
- Modify: `index.html` (line ~18, the Google Fonts `<link>`)
- Modify: `styles.css` (`:root, [data-theme="girl"]` block ~L20, `[data-theme="boy"]` block ~L44, Day Job theme blocks ~L441 & ~L452)

**Interfaces:**
- Produces: `--font-sans` CSS custom property, set to `"Hanken Grotesk"` in OG themes and `"Archivo"` in Day Job themes. Consumed by Task 2.

- [ ] **Step 1: Update the Google Fonts link in `index.html`**

Find line ~18 (the `<link href="https://fonts.googleapis.com/css2?...">` line) and replace it with:

```html
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Hanken+Grotesk:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />
```

- [ ] **Step 2: Add `--font-sans` to the girl/root block**

In `styles.css`, inside the `:root, [data-theme="girl"]` block (around L20–43), add after the last token on its own line:

```css
--font-sans: "Hanken Grotesk", system-ui, sans-serif;
```

- [ ] **Step 3: Add `--font-sans` to the boy block**

Inside `[data-theme="boy"]` (around L44–54), add:

```css
--font-sans: "Hanken Grotesk", system-ui, sans-serif;
```

- [ ] **Step 4: Add `--font-sans` override for Day Job themes**

Inside `:is([data-theme="dayjob"], [data-theme="dayjob-girl"])` block (~L441) and `[data-theme="dayjob-boy"]` block (~L452), add to each:

```css
--font-sans: "Archivo", system-ui, sans-serif;
```

- [ ] **Step 5: Verify font fallback chain**

Run: `rg '--font-sans' styles.css`

Expected: 4 matches — one in `:root`/girl, one in boy, two in Day Job blocks.

---

## Task 2: Replace hardcoded `"Archivo"` with `var(--font-sans)`

**Files:**
- Modify: `styles.css` (13 specific selectors)

**Interfaces:**
- Consumes: `--font-sans` from Task 1.
- Produces: all OG body text uses `var(--font-sans)` (Hanken Grotesk); Day Job inherits its own `--font-sans` override (Archivo).

- [ ] **Step 1: Replace all `"Archivo"` font-family values**

Run this search to confirm targets before editing:

```bash
rg -n '"Archivo"' styles.css
```

Expected lines (verify by content — numbers may drift):
- L10: `body { font-family: "Archivo", system-ui, sans-serif; ... }`
- L199: `.avatar { font-family: "Archivo", sans-serif; ... }`
- L333: `.ic-val { font-family: "Archivo", sans-serif; ... }`
- L334: `.ic-rel { font-family: "Archivo"; ... }`
- L389: `.today-hd h2 { font-family: "Archivo"; ... }`
- L412: `.page-title { font-family: "Archivo"; ... }`
- L604: `.stat-v { font-family: "Archivo"; ... }`
- L607: `.chart-hd h2 { font-family: "Archivo"; ... }`
- L623: `.ring-big { font-family: "Archivo"; ... }`
- L632: `.sched-win { font-family: "Archivo"; ... }`
- L687: `.growth-svg .growth-x { font-family: "Archivo", sans-serif; ... }`
- L786: `.sheet-hd h3 { font-family: "Archivo"; ... }`
- L850: `.entry-title { font-family: "Archivo"; ... }`

For each, replace the `font-family` value with `var(--font-sans)`. Example for L10:

```css
body { font-family: var(--font-sans); font-size: 15px; ... }
```

Example for L199 (`.avatar`):

```css
.avatar {
  ...
  font-family: var(--font-sans); font-size: 20px; font-weight: 700;
  ...
}
```

Apply the same pattern to all 13 occurrences. Do NOT touch the two `"Playfair Display"` lines (~L186, ~L280).

- [ ] **Step 2: Verify no bare `"Archivo"` remains**

Run: `rg '"Archivo"' styles.css`

Expected: zero matches (all replaced with `var(--font-sans)`).

- [ ] **Step 3: Verify Playfair is untouched**

Run: `rg '"Playfair Display"' styles.css`

Expected: exactly 2 matches (`.baby` and `.timer`).

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "feat(css): add Hanken Grotesk as OG body font via --font-sans token"
```

---

## Task 3: Richer OG color — chroma bumps

**Files:**
- Modify: `styles.css` (`:root, [data-theme="girl"]` block ~L20–43; `[data-theme="boy"]` block ~L44–54)

**Interfaces:**
- Produces: updated `--bg`, `--surface`, `--accent-soft`, `--accent-tint`, `--hair` values in girl and boy themes. Consumed visually — no code depends on specific values.

- [ ] **Step 1: Update girl palette tokens**

In `:root, [data-theme="girl"]` (~L20–26), update these tokens to their new values (leave all others unchanged):

```css
--bg:          oklch(0.882 0.120 42);
--surface:     oklch(0.918 0.092 46);
--accent-soft: oklch(0.86 0.082 50);
--accent-tint: oklch(0.905 0.055 54);
--hair:        oklch(0.820 0.062 48);
```

- [ ] **Step 2: Update boy palette tokens**

In `[data-theme="boy"]` (~L44–54), update:

```css
--bg:          oklch(0.950 0.066 172);
--surface:     oklch(0.968 0.050 172);
--accent-soft: oklch(0.85 0.070 180);
--accent-tint: oklch(0.922 0.044 178);
--hair:        oklch(0.88 0.034 178);
```

- [ ] **Step 3: Verify unchanged tokens**

Run: `rg '--page|--ink|--soft|--muted' styles.css | head -10`

Confirm `--page` in girl is still `oklch(0.828 0.125 40)` and `--ink`/`--soft`/`--muted` are unchanged.

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "feat(css): bump OG palette chroma for richer warmer surfaces"
```

---

## Task 4: Frosted-glass cards in OG light mode

**Files:**
- Modify: `styles.css` (`:root, [data-theme="girl"]` block for `--card-bg` token; new OG-light selector after `[data-theme="boy"]`; `.card` ~L214 and `.info-card` ~L303 background-color)

**Interfaces:**
- Produces: `--card-bg` token; `.card` and `.info-card` use `--card-bg` for background-color; OG light mode adds `backdrop-filter` blur and drops the clay texture layer.

- [ ] **Step 1: Define `--card-bg` token**

In `:root, [data-theme="girl"]` block (~L20–43), add:

```css
--card-bg: var(--surface);
```

This defaults to opaque — dark mode and Day Job are unaffected.

- [ ] **Step 2: Apply `--card-bg` to `.card` and `.info-card`**

In `.card` (~L214), change:
```css
background-color: var(--surface);
```
to:
```css
background-color: var(--card-bg);
```

In `.info-card` (~L303), change:
```css
background-color: var(--surface);
```
to:
```css
background-color: var(--card-bg);
```

- [ ] **Step 3: Add OG-light-only override block**

After the `[data-theme="boy"]` closing `}` (~L54), add:

```css
:is([data-theme="girl"], [data-theme="boy"]):not([data-mode="dark"]) {
  --card-bg: color-mix(in oklch, var(--surface) 80%, transparent);
}

:is([data-theme="girl"], [data-theme="boy"]):not([data-mode="dark"]) :is(.card, .info-card) {
  backdrop-filter: blur(7px) saturate(1.15);
  -webkit-backdrop-filter: blur(7px) saturate(1.15);
  background-image:
    radial-gradient(ellipse at 12% 8%, var(--mat-highlight), transparent 52%);
  background-size: 100% 100%;
  background-blend-mode: normal;
}
```

> This second rule replaces the card `background-image` in OG light mode with only the `--mat-highlight` sheen (no `--tex-clay` layer), so the translucent card-bg lets the linen show through. The clay texture in dark mode is untouched — `[data-mode="dark"] .card` rule still overrides independently.

- [ ] **Step 4: Verify dark mode cards are unaffected**

Run: `rg '\[data-mode="dark"\] .card' styles.css`

Confirm the dark card rule still references `var(--tex-clay)` and has no `backdrop-filter`.

- [ ] **Step 5: Commit**

```bash
git add styles.css
git commit -m "feat(css): frosted-glass cards in OG light mode via --card-bg token"
```

---

## Task 5: Reactive glare on hero, toks, FAB, avatar

**Files:**
- Modify: `styles.css` (`:root` block for `--light-x/--light-y`; `.tok` ~L354; new `.card.hero` rule; `.today-add` ~L393; `.avatar` ~L193)

**Interfaces:**
- Consumes: `--fire-a`, `--fire-c` from existing `:root` animation.
- Produces: fire-pulsed specular sheen on `.tok`, `.card.hero`, `.today-add`, `.avatar`.

- [ ] **Step 1: Add light-source position tokens to `:root`**

Inside `:root, [data-theme="girl"]` block (~L20), add:

```css
--light-x: 30%; --light-y: 6%;
```

- [ ] **Step 2: Make the tok top-sheen pulse with fire**

In `.tok` background-image (~L354), the first radial-gradient currently reads:

```css
radial-gradient(ellipse 120% 90% at 50% 8%, oklch(0.97 0.012 70 / 0.45) 0%, transparent 42%),
```

Change the alpha `0.45` to a fire-driven calc:

```css
radial-gradient(ellipse 120% 90% at 50% 8%, oklch(0.99 0.012 70 / calc(0.30 + var(--fire-a, 0.08) * 1.8)) 0%, transparent 42%),
```

- [ ] **Step 3: Add pulsing glint to `.card.hero`**

`.card.hero` has no own `background-image` rule today (it inherits `.card`). Add after the `.hero { padding: 22px; }` line (~L235):

```css
.card.hero {
  background-image:
    radial-gradient(ellipse 60% 40% at var(--light-x) var(--light-y),
      oklch(0.99 0.01 70 / calc(0.12 + var(--fire-c, 0.10) * 1.2)) 0%, transparent 60%),
    radial-gradient(ellipse at 12% 8%, var(--mat-highlight), transparent 52%),
    var(--tex-clay);
  background-size: 100% 100%, 100% 100%, 180px 180px;
  background-blend-mode: normal, normal, soft-light;
}
```

> Uses `--fire-c` (8.7s slow period) so the large hero card breathes gently. The existing `.card` box-shadow and border still apply — this only overrides `background-image`.

- [ ] **Step 4: Add inset highlight to `.today-add` and `.avatar`**

`.today-add` (~L393) currently has:
```css
box-shadow: 0 2px 5px oklch(0 0 0 / .15), inset 0 1px 0 oklch(1 0 0 / .28);
```

Append the fire-driven inset line:
```css
box-shadow: 0 2px 5px oklch(0 0 0 / .15), inset 0 1px 0 oklch(1 0 0 / .28), inset 0 1px 0 oklch(1 0 0 / calc(0.25 + var(--fire-a, 0.08) * 1.4));
```

`.avatar` (~L201) currently has:
```css
box-shadow:
  0 2px 0 oklch(0.97 0.01 80 / 0.4) inset,
  0 4px 14px var(--mat-cast);
```

Append:
```css
box-shadow:
  0 2px 0 oklch(0.97 0.01 80 / 0.4) inset,
  0 4px 14px var(--mat-cast),
  inset 0 1px 0 oklch(1 0 0 / calc(0.25 + var(--fire-a, 0.08) * 1.4));
```

- [ ] **Step 5: Verify reduced motion leaves sheens static**

Run: `rg 'prefers-reduced-motion' styles.css`

Confirm the existing rule sets `--fire-a: 0.09; --fire-b: 0.06; --fire-c: 0.10;` and removes animations. The `calc()` expressions will evaluate to their static fire values — no additional work needed.

- [ ] **Step 6: Commit**

```bash
git add styles.css
git commit -m "feat(css): fire-reactive specular glare on hero, toks, FAB, avatar"
```

---

## Task 6: Version bump + final verification

**Files:**
- Modify: `index.html` (`<meta name="version">`)
- Modify: `sw.js` (`VERSION` constant)

- [ ] **Step 1: Get current UTC timestamp**

```bash
date -u +%Y-%m-%dT%H:%MZ
```

Note the output (e.g., `2026-06-26T15:30Z`).

- [ ] **Step 2: Bump version in `index.html`**

Find `<meta name="version" content="...">` and set `content` to the timestamp from Step 1.

- [ ] **Step 3: Bump version in `sw.js`**

Find `const VERSION = 'hearth-...'` and set it to `hearth-` + the same timestamp.

- [ ] **Step 4: Verify both match**

Run:
```bash
rg 'version' index.html sw.js
```

The `content` value and the part after `hearth-` must be identical strings.

- [ ] **Step 5: Run the app and screenshot**

```bash
cd /workspace/hearth/server && PORT=9878 STATIC_DIR=/workspace/hearth \
  DB_PATH=/tmp/hearth-run.db \
  CERT_FILE=/workspace/hearth/certs/pi-agent-4.bass-procyon.ts.net.crt \
  KEY_FILE=/workspace/hearth/certs/pi-agent-4.bass-procyon.ts.net.key \
  go run . &
sleep 5; curl -sk -o /dev/null -w "%{http_code}\n" https://localhost:9878/
```

Expected: `200`

Use the `run` skill to take screenshots via Playwright (viewport 390×844, `--ignore-certificate-errors`). Complete onboarding with Girl theme. Capture:
- OG-girl home in light mode
- OG-girl home in dark mode (`document.body.setAttribute('data-mode','dark')`)
- Day Job home (font check)

- [ ] **Step 6: Acceptance checklist**

- [ ] OG body text is Hanken Grotesk (rounder than Archivo); Day Job body text is still Archivo; name/timer still Playfair.
- [ ] OG cards/pills visibly more saturated; `.ic-rel` small grey text still legible.
- [ ] OG **light** cards show linen faintly through them (frosted); text crisp. Dark/DayJob cards unchanged opaque.
- [ ] Hero card, action toks, FAB, avatar carry a subtle fire-synced top sheen; one coherent light source.
- [ ] `prefers-reduced-motion`: no animation; sheens sit at a static pleasant brightness.
- [ ] Version strings in `index.html` and `sw.js` match and are current UTC.

- [ ] **Step 7: Final commit**

```bash
git add index.html sw.js
git commit -m "chore: version bump for OG theme refresh"
```
