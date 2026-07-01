# Skeuomorphic Redesign Implementation Plan

> **Status:** COMPLETE — merged to `main`. Plaster/terracotta gradients, page glow, `--ring-track`/`--good-tint` tokens live in `styles.css`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskn Hearth from flat-modern to full skeuomorphic using warm plaster & terracotta materials, CSS gradient lighting, ember glow, and 7 custom filled SVG quick-action icons.

**Architecture:** Three CC0 grayscale textures from ambientCG (plaster, clay, linen) layered under CSS gradient lighting via `background-blend-mode: soft-light`. A material token block (`--mat-*`, `--tex-*`) in `:root` drives all lighting; night hearth dark mode swaps only those tokens. Custom icons replace the 5 existing quick-action Lucide icons plus add 2 new types (play, bath).

**Tech Stack:** Vanilla CSS, vanilla JS, SVG, ffmpeg (for texture processing), curl/unzip

## Global Constraints

- Working directory: `/workspace/hearth/.claude/worktrees/twinkly-weaving-spark`
- Branch: `main` — stay on this branch, do not push
- **BUMP VERSION ON EVERY COMMIT.** Before each `git commit`, run `date -u +%Y-%m-%dT%H:%M` and set:
  - `sw.js` line 2: `const VERSION = 'hearth-<timestamp>';`
  - `index.html` line 9: `<meta name="version" content="<timestamp>" />`
  - The timestamp string must match exactly (sw.js has `hearth-` prefix, index.html does not)
- Conventional Commits format: `feat(...)`, `chore(...)`, `style(...)` etc.
- Never use `git add -A` or `git add .` — always add specific files
- If a find/replace block doesn't match character-for-character, STOP and report — never improvise
- Run every Verify command and read the actual output before moving on
- Do not push, do not open a PR

---

## Task 1: Download and process textures

**Files:**
- Create: `assets/textures/plaster.webp`
- Create: `assets/textures/clay.webp`
- Create: `assets/textures/linen.webp`

**Interfaces:**
- Produces: Three grayscale WebP texture files consumed by Tasks 2–6 via CSS `url()` references

- [ ] **Step 1: Create assets directory**

```bash
mkdir -p assets/textures
```

- [ ] **Step 2: Download ambientCG texture ZIPs**

```bash
curl -L "https://ambientcg.com/get?file=Plaster003_1K-JPG.zip" -o /tmp/plaster.zip
curl -L "https://ambientcg.com/get?file=Clay001_1K-JPG.zip" -o /tmp/clay.zip
curl -L "https://ambientcg.com/get?file=Fabric019_1K-JPG.zip" -o /tmp/linen.zip
```

- [ ] **Step 3: Extract ZIPs and find color map files**

```bash
unzip -o /tmp/plaster.zip -d /tmp/plaster/
unzip -o /tmp/clay.zip    -d /tmp/clay/
unzip -o /tmp/linen.zip   -d /tmp/linen/
ls /tmp/plaster/ /tmp/clay/ /tmp/linen/
```

Identify the color/albedo JPG files. They will be named like `Plaster003_1K_Color.jpg`, `Clay001_1K_Color.jpg`, `Fabric019_1K_Color.jpg`. Note the exact filenames.

- [ ] **Step 4: Desaturate to grayscale and convert to WebP**

Replace `<EXACT_FILENAME>` with the actual filenames found in Step 3:

```bash
ffmpeg -y -i /tmp/plaster/<EXACT_PLASTER_COLOR_FILE> \
  -vf "hue=s=0,scale=512:512" \
  assets/textures/plaster.webp

ffmpeg -y -i /tmp/clay/<EXACT_CLAY_COLOR_FILE> \
  -vf "hue=s=0,scale=256:256" \
  assets/textures/clay.webp

ffmpeg -y -i /tmp/linen/<EXACT_LINEN_COLOR_FILE> \
  -vf "hue=s=0,scale=512:512" \
  assets/textures/linen.webp
```

- [ ] **Step 5: Verify files exist and have reasonable size**

```bash
ls -lh assets/textures/
```

Expected: three `.webp` files, each between 30KB and 300KB.

- [ ] **Step 6: Clean up temp files**

```bash
rm -rf /tmp/plaster/ /tmp/clay/ /tmp/linen/ /tmp/plaster.zip /tmp/clay.zip /tmp/linen.zip
```

- [ ] **Step 7: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%M)
# Edit sw.js line 2 to: const VERSION = 'hearth-<TS>';
# Edit index.html line 9 to: <meta name="version" content="<TS>" />
git add assets/textures/plaster.webp assets/textures/clay.webp assets/textures/linen.webp sw.js index.html
git commit -m "chore(assets): add grayscale plaster, clay, and linen textures from ambientCG CC0"
```

---

## Task 2: Add material token CSS block and new category tones

**Files:**
- Modify: `styles.css`

**Interfaces:**
- Produces: `--mat-highlight`, `--mat-shadow`, `--mat-cast`, `--mat-glow`, `--tex-plaster`, `--tex-clay`, `--tex-linen` CSS variables consumed by Tasks 3–6
- Produces: `.play`, `.bath`, `.tone-play`, `.tone-bath` category tones consumed by Task 5

- [ ] **Step 1: Add material token block to `:root` in styles.css**

In `styles.css`, find the exact line:
```
  --ring-track: oklch(0.90 0.022 65);
```
(this is the last line inside the `:root` block, in the girl theme section)

After that line, insert (inside `:root`, before the closing `}`):
```css
  /* material system */
  --mat-highlight: oklch(0.98 0.015 80 / 0.55);
  --mat-shadow:    oklch(0.38 0.05 48 / 0.20);
  --mat-cast:      oklch(0.42 0.06 50 / 0.16);
  --mat-glow:      oklch(0.88 0.06 72 / 0.45);
  --tex-plaster:   url('assets/textures/plaster.webp');
  --tex-clay:      url('assets/textures/clay.webp');
  --tex-linen:     url('assets/textures/linen.webp');
```

- [ ] **Step 2: Add night hearth token overrides to dark mode block**

In `styles.css`, find the exact block:
```
[data-mode="dark"] {
  --bg: oklch(0.215 0.016 55); --surface: oklch(0.26 0.018 55);
  --ink: oklch(0.93 0.016 65); --soft: oklch(0.78 0.02 58); --muted: oklch(0.62 0.022 56);
  --hair: oklch(0.34 0.018 55);
}
```

Replace with:
```css
[data-mode="dark"] {
  --bg: oklch(0.215 0.016 55); --surface: oklch(0.26 0.018 55);
  --ink: oklch(0.93 0.016 65); --soft: oklch(0.78 0.02 58); --muted: oklch(0.62 0.022 56);
  --hair: oklch(0.34 0.018 55);
  /* night hearth — firelight from below */
  --mat-highlight: oklch(0.72 0.13 50 / 0.22);
  --mat-shadow:    oklch(0.08 0.02 40 / 0.60);
  --mat-cast:      oklch(0.18 0.04 45 / 0.50);
  --mat-glow:      oklch(0.52 0.15 45 / 0.28);
}
```

- [ ] **Step 3: Add play and bath category tones**

In `styles.css`, find the exact line:
```
.note,.tone-note { --tc: var(--muted); --tcb: var(--hair); }
```

After that line, add:
```css
.play,.tone-play { --tc: oklch(0.50 0.09 280); --tcb: oklch(0.90 0.04 285); }
.bath,.tone-bath { --tc: oklch(0.48 0.085 220); --tcb: oklch(0.88 0.04 215); }
```

- [ ] **Step 4: Add dark mode overrides for play and bath tones**

In `styles.css`, find the exact block for dark mode cards:
```
[data-mode="dark"] .card { box-shadow: 0 8px 24px oklch(0 0 0 / .35); }
```

Before that line, add:
```css
[data-mode="dark"] .play, [data-mode="dark"] .tone-play { --tc: oklch(0.72 0.09 280); --tcb: oklch(0.30 0.05 285); }
[data-mode="dark"] .bath, [data-mode="dark"] .tone-bath { --tc: oklch(0.70 0.085 220); --tcb: oklch(0.28 0.05 215); }
```

- [ ] **Step 5: Verify CSS parses with no errors**

Open `index.html` in a browser and check the console for CSS parse errors. Alternatively, run:
```bash
node -e "const fs = require('fs'); const css = fs.readFileSync('styles.css','utf8'); console.log('CSS length:', css.length, 'chars — no JS error means file loaded ok');"
```

- [ ] **Step 6: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%M)
# Edit sw.js and index.html version as described in Global Constraints
git add styles.css sw.js index.html
git commit -m "feat(style): add material token system and play/bath category tones"
```

---

## Task 3: Reskn page background and cards

**Files:**
- Modify: `styles.css`

**Interfaces:**
- Consumes: `--mat-highlight`, `--mat-shadow`, `--mat-cast`, `--tex-plaster`, `--tex-linen` from Task 2
- Produces: Textured `.phone`, `.card`, `.info-card`, `.sheet`, `.chooser-item` surfaces

- [ ] **Step 1: Replace `.phone` background with plaster texture**

Find the exact block in `styles.css`:
```
.phone {
  --pad: 22px; width: 100%; max-width: 432px; height: 100%; flex: 1; min-height: 0;
  background: var(--bg);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncA type='linear' slope='0.05'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  display: flex; flex-direction: column; overflow: hidden;
  transition: background .4s ease; position: relative;
}
```

Replace with:
```css
.phone {
  --pad: 22px; width: 100%; max-width: 432px; height: 100%; flex: 1; min-height: 0;
  background-color: var(--bg);
  background-image:
    radial-gradient(ellipse 80% 60% at 30% 5%, var(--mat-highlight), transparent 65%),
    var(--tex-plaster);
  background-size: 100% 100%, 320px 320px;
  background-blend-mode: normal, soft-light;
  display: flex; flex-direction: column; overflow: hidden;
  transition: background-color .4s ease; position: relative;
}
```

- [ ] **Step 2: Add night hearth `.phone` override**

In `styles.css`, find the exact line:
```
[data-mode="dark"] .phone { box-shadow: 0 0 0 1px oklch(0.3 0.01 50); }
```

Replace with:
```css
[data-mode="dark"] .phone {
  box-shadow: 0 0 0 1px oklch(0.3 0.01 50);
  background-image:
    radial-gradient(ellipse 70% 45% at 50% 105%, oklch(0.55 0.15 48 / 0.30), transparent 70%),
    var(--tex-plaster);
  background-size: 100% 100%, 320px 320px;
  background-blend-mode: normal, soft-light;
}
```

- [ ] **Step 3: Reskn `.card`**

Find the exact line:
```
.card { background: var(--surface); border-radius: 26px; box-shadow: 0 8px 24px oklch(0.6 0.05 20 / .07); }
```

Replace with:
```css
.card {
  background-color: var(--surface);
  background-image:
    radial-gradient(ellipse at 15% 10%, var(--mat-highlight), transparent 55%),
    var(--tex-linen);
  background-size: 100% 100%, 260px 260px;
  background-blend-mode: normal, soft-light;
  border-radius: 26px;
  border: 1px solid oklch(0.88 0.025 70 / 0.5);
  box-shadow:
    0 1px 0 oklch(0.98 0.01 80 / 0.7) inset,
    0 -1px 0 var(--mat-shadow) inset,
    0 8px 28px var(--mat-cast),
    0 2px 6px var(--mat-cast);
}
```

- [ ] **Step 4: Reskn `.info-card`**

Find the exact line:
```
.info-card { background: var(--surface); border-radius: 20px; padding: 13px 15px; display: flex; align-items: center; gap: 13px; box-shadow: 0 6px 18px oklch(0.6 0.05 20 / .06); cursor: pointer; transition: transform .5s cubic-bezier(0.34, 1.56, 0.64, 1); }
```

Replace with:
```css
.info-card {
  background-color: var(--surface);
  background-image:
    radial-gradient(ellipse at 10% 15%, var(--mat-highlight), transparent 50%),
    var(--tex-linen);
  background-size: 100% 100%, 260px 260px;
  background-blend-mode: normal, soft-light;
  border-radius: 20px; padding: 13px 15px; display: flex; align-items: center; gap: 13px;
  border: 1px solid oklch(0.88 0.025 70 / 0.45);
  box-shadow:
    0 1px 0 oklch(0.98 0.01 80 / 0.65) inset,
    0 -1px 0 var(--mat-shadow) inset,
    0 6px 20px var(--mat-cast),
    0 1px 4px var(--mat-cast);
  cursor: pointer; transition: transform .5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

- [ ] **Step 5: Add dark mode card overrides**

Find the exact block:
```
[data-mode="dark"] .card { box-shadow: 0 8px 24px oklch(0 0 0 / .35); }
[data-mode="dark"] .info-card { box-shadow: 0 4px 14px oklch(0 0 0 / .3); }
```

Replace with:
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

- [ ] **Step 6: Reskn `.sheet`**

Find the exact line:
```
.sheet { width: 100%; max-width: 432px; background: var(--bg); border-radius: 28px 28px 0 0; padding: 8px 22px calc(26px + env(safe-area-inset-bottom)); transform: translateY(102%); transition: transform .3s cubic-bezier(.2,.8,.2,1); max-height: 88%; overflow-y: auto; touch-action: pan-y; }
```

Replace with:
```css
.sheet {
  width: 100%; max-width: 432px;
  background-color: var(--bg);
  background-image:
    radial-gradient(ellipse at 25% 0%, var(--mat-highlight), transparent 50%),
    var(--tex-linen);
  background-size: 100% 100%, 260px 260px;
  background-blend-mode: normal, soft-light;
  border-radius: 28px 28px 0 0; padding: 8px 22px calc(26px + env(safe-area-inset-bottom)); transform: translateY(102%); transition: transform .3s cubic-bezier(.2,.8,.2,1); max-height: 88%; overflow-y: auto; touch-action: pan-y;
}
```

- [ ] **Step 7: Add dark mode sheet override**

Find the exact line:
```
[data-mode="dark"] .sheet { background: var(--bg); }
```

Replace with:
```css
[data-mode="dark"] .sheet {
  background-color: var(--bg);
  background-image:
    radial-gradient(ellipse at 50% 100%, oklch(0.48 0.10 50 / 0.15), transparent 55%),
    var(--tex-linen);
  background-size: 100% 100%, 260px 260px;
  background-blend-mode: normal, soft-light;
}
```

- [ ] **Step 8: Reskn `.chooser-item`**

Find the exact line:
```
.chooser-item { all: unset; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 6px; border-radius: 18px; background: var(--surface); font-size: 12px; font-weight: 700; color: var(--soft); }
```

Replace with:
```css
.chooser-item {
  all: unset; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 6px; border-radius: 18px;
  background-color: var(--surface);
  background-image:
    radial-gradient(ellipse at 20% 10%, var(--mat-highlight), transparent 50%),
    var(--tex-linen);
  background-size: 100% 100%, 260px 260px;
  background-blend-mode: normal, soft-light;
  font-size: 12px; font-weight: 700; color: var(--soft);
  box-shadow:
    0 1px 0 oklch(0.97 0.01 80 / 0.6) inset,
    0 4px 12px var(--mat-cast);
}
```

- [ ] **Step 9: Remove dayjob paper grain pseudo-element**

Find the exact block:
```
body:is([data-theme="dayjob"], [data-theme="dayjob-girl"], [data-theme="dayjob-boy"])::before {
  content: '';
  position: fixed; z-index: 0; inset: 0; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='grain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncA type='linear' slope='0.03'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23grain)'/%3E%3C/svg%3E");
}
@media (prefers-reduced-motion: reduce) {
  body:is([data-theme="dayjob"], [data-theme="dayjob-girl"], [data-theme="dayjob-boy"])::before { background-image: none; }
}
```

Delete this entire block (the `body::before` rule and the `@media` wrapper for it). The plaster texture on `.phone` replaces it.

- [ ] **Step 10: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%M)
git add styles.css sw.js index.html
git commit -m "feat(style): apply plaster and linen textures to page, cards, and sheets"
```

---

## Task 4: Reskn interactive elements

**Files:**
- Modify: `styles.css`

**Interfaces:**
- Consumes: `--mat-highlight`, `--mat-shadow`, `--mat-cast`, `--tex-clay` from Task 2
- Produces: Skeuomorphic `.tok`, `.ic-ring`, `.chooser-ic`, `.btn-primary`, `.switch`, `.avatar`, `.tabbar`, `.track`, `.segctl`, `.seg-opt.on`, `input/select/textarea`

- [ ] **Step 1: Reskn `.tok` (pressed clay)**

Find the exact line:
```
.tok { width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; background: var(--tcb, var(--accent-soft)); color: var(--tc, var(--accent-ink)); transition: transform .5s cubic-bezier(0.34, 1.56, 0.64, 1), background .2s, color .2s; }
```

Replace with:
```css
.tok {
  width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px;
  color: var(--tc, var(--accent-ink));
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
  transition: transform .5s cubic-bezier(0.34, 1.56, 0.64, 1), background-color .2s, color .2s, box-shadow .1s;
}
```

- [ ] **Step 2: Reskn `.act.primary .tok`**

Find the exact line:
```
.act.primary .tok { background: var(--tc, var(--accent)); color: var(--on-accent); }
```

Replace with:
```css
.act.primary .tok { background-color: var(--tc, var(--accent)); color: var(--on-accent); }
```

- [ ] **Step 3: Reskn `.act:active .tok`**

Find the exact line:
```
.act:active .tok { transform: scale(.88); transition: transform 0.06s; }
```

Replace with:
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

- [ ] **Step 4: Add dark mode `.tok` override**

Find the section with `[data-mode="dark"] .card { box-shadow:` — add after it:
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

- [ ] **Step 5: Reskn `.ic-ring`**

Find the exact line:
```
.ic-ring { width: 42px; height: 42px; border-radius: 50%; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; font-size: 20px; background: var(--tcb); color: var(--tc); }
```

Replace with:
```css
.ic-ring {
  width: 42px; height: 42px; border-radius: 50%; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center; font-size: 20px;
  color: var(--tc);
  background-color: var(--tcb);
  background-image: linear-gradient(155deg, oklch(0.97 0.01 80 / 0.35) 0%, transparent 40%);
  box-shadow:
    0 1px 0 oklch(0.97 0.01 80 / 0.4) inset,
    0 2px 6px var(--mat-cast);
}
```

- [ ] **Step 6: Reskn `.chooser-ic`**

Find the exact line:
```
.chooser-ic { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 21px; background: var(--tcb); color: var(--tc); }
```

Replace with:
```css
.chooser-ic {
  width: 44px; height: 44px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 21px;
  color: var(--tc);
  background-color: var(--tcb);
  background-image: linear-gradient(155deg, oklch(0.97 0.01 80 / 0.3) 0%, transparent 40%);
  box-shadow: 0 1px 0 oklch(0.97 0.01 80 / 0.35) inset, 0 2px 6px var(--mat-cast);
}
```

- [ ] **Step 7: Reskn `.btn-primary`**

Find the exact line:
```
.btn-primary { all: unset; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--accent); color: var(--on-accent); font-weight: 800; font-size: 15px; padding: 15px; border-radius: 16px; margin-top: 4px; transition: transform .1s; }
```

Replace with:
```css
.btn-primary {
  all: unset; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
  background-color: var(--accent);
  background-image: linear-gradient(155deg,
    oklch(from var(--accent) calc(l + 0.12) c h) 0%,
    var(--accent) 50%,
    oklch(from var(--accent) calc(l - 0.08) c h) 100%
  );
  color: var(--on-accent); font-weight: 800; font-size: 15px; padding: 15px; border-radius: 16px; margin-top: 4px;
  box-shadow:
    0 2px 0 oklch(0.97 0.01 80 / 0.22) inset,
    0 -1px 0 oklch(0.20 0.04 45 / 0.25) inset,
    0 6px 18px var(--mat-cast);
  text-shadow: 0 1px 0 oklch(0.25 0.04 45 / 0.18);
  transition: transform .1s, box-shadow .1s;
}
```

Find the exact line:
```
.btn-primary:active { transform: scale(.98); }
```

Replace with:
```css
.btn-primary:active {
  box-shadow:
    0 2px 6px oklch(0.25 0.04 45 / 0.22) inset,
    0 1px 0 oklch(0.97 0.01 80 / 0.12) inset;
  transform: translateY(1px) scale(0.99);
}
```

- [ ] **Step 8: Reskn `.tabbar`**

Find the exact line:
```
.tabbar { flex: 0 0 auto; display: flex; justify-content: space-around; align-items: center; padding: 6px 0 calc(8px + env(safe-area-inset-bottom)); border-top: 1px solid var(--hair); background: var(--surface); }
```

Replace with:
```css
.tabbar {
  flex: 0 0 auto; display: flex; justify-content: space-around; align-items: center;
  padding: 6px 0 calc(8px + env(safe-area-inset-bottom));
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
```

Find the exact line:
```
[data-mode="dark"] .tabbar { background: var(--surface); border-color: var(--hair); }
```

Replace with:
```css
[data-mode="dark"] .tabbar {
  background-color: var(--surface);
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

- [ ] **Step 9: Reskn `input, select, textarea`**

Find the exact line:
```
input, select, textarea { box-sizing: border-box; border: 1.5px solid var(--hair); background: var(--bg); border-radius: 13px; padding: 11px 13px; font-size: 14px; font-weight: 600; color: var(--ink); outline: none; transition: border-color .15s; width: 100%; min-width: 0; max-width: 100%; }
```

Replace with:
```css
input, select, textarea {
  box-sizing: border-box;
  border: 1px solid oklch(0.80 0.03 65 / 0.6);
  border-top-color: oklch(0.68 0.04 58 / 0.5);
  background-color: var(--bg);
  background-image: linear-gradient(180deg, oklch(0.50 0.04 55 / 0.08) 0%, transparent 25%);
  border-radius: 13px; padding: 11px 13px; font-size: 14px; font-weight: 600; color: var(--ink); outline: none;
  box-shadow:
    0 2px 8px var(--mat-shadow) inset,
    0 1px 0 oklch(0.97 0.01 80 / 0.5);
  transition: border-color .15s; width: 100%; min-width: 0; max-width: 100%;
}
```

Find the exact line:
```
input:focus, select:focus, textarea:focus { border-color: var(--accent); }
```

Replace with:
```css
input:focus, select:focus, textarea:focus {
  border-color: var(--accent);
  border-top-color: oklch(from var(--accent) calc(l - 0.08) c h);
}
```

- [ ] **Step 10: Reskn `.switch`**

Find the exact line:
```
.switch { all: unset; cursor: pointer; width: 46px; height: 28px; border-radius: 999px; background: var(--hair); position: relative; transition: background .2s; flex: 0 0 auto; }
```

Replace with:
```css
.switch {
  all: unset; cursor: pointer; width: 46px; height: 28px; border-radius: 999px;
  background-color: var(--hair);
  background-image: linear-gradient(180deg, oklch(0.78 0.03 65 / 0.8), transparent);
  box-shadow: 0 1px 5px var(--mat-shadow) inset;
  position: relative; transition: background-color .2s; flex: 0 0 auto;
}
```

Find the exact line:
```
.switch.on { background: var(--accent); }
```

Replace with:
```css
.switch.on {
  background-color: var(--accent);
  background-image: linear-gradient(180deg, oklch(from var(--accent) calc(l + 0.08) c h / 0.8) 0%, transparent 100%);
  box-shadow: 0 1px 0 oklch(0.97 0.01 80 / 0.25) inset;
}
```

Find the exact line:
```
.switch .knob { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: left .2s; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
```

Replace with:
```css
.switch .knob {
  position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%;
  background-image: linear-gradient(180deg, oklch(0.99 0.005 80), oklch(0.93 0.015 75));
  transition: left .2s;
  box-shadow:
    0 2px 5px oklch(0.30 0.04 50 / 0.30),
    0 1px 0 oklch(0.97 0.01 80 / 0.8) inset;
}
```

- [ ] **Step 11: Reskn `.avatar`**

Find the exact line:
```
.avatar { width: 48px; height: 48px; border-radius: 50%; flex: 0 0 auto; background: radial-gradient(circle at 35% 30%, var(--accent-soft), var(--accent)); color: var(--on-accent); display: flex; align-items: center; justify-content: center; font-family: "Archivo", sans-serif; font-size: 20px; font-weight: 700; background-size: cover; background-position: center; transition: transform .5s cubic-bezier(0.34, 1.56, 0.64, 1); }
```

Replace with:
```css
.avatar {
  width: 48px; height: 48px; border-radius: 50%; flex: 0 0 auto;
  background-image:
    radial-gradient(circle at 30% 20%, oklch(0.97 0.01 80 / 0.5) 0%, transparent 45%),
    radial-gradient(circle at 35% 30%, var(--accent-soft), var(--accent));
  color: var(--on-accent); display: flex; align-items: center; justify-content: center;
  font-family: "Archivo", sans-serif; font-size: 20px; font-weight: 700;
  background-size: cover; background-position: center;
  box-shadow:
    0 2px 0 oklch(0.97 0.01 80 / 0.4) inset,
    0 4px 14px var(--mat-cast);
  transition: transform .5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

- [ ] **Step 12: Add text shadows to `.timer` and `.baby`**

Find the exact line:
```
.timer { font-family: "Playfair Display", serif; font-size: 50px; font-weight: 700; line-height: 1; margin: 13px 0 6px; letter-spacing: -.02em; }
```

Replace with:
```css
.timer {
  font-family: "Playfair Display", serif; font-size: 50px; font-weight: 700;
  line-height: 1; margin: 13px 0 6px; letter-spacing: -.02em;
  text-shadow:
    0 2px 0 oklch(0.78 0.04 65 / 0.5),
    0 -1px 0 oklch(0.97 0.01 80 / 0.35);
}
```

Find the exact line:
```
.baby { font-family: "Playfair Display", serif; font-size: 28px; font-weight: 700; margin: 1px 0 0; line-height: 1.05; letter-spacing: -.015em; }
```

Replace with:
```css
.baby {
  font-family: "Playfair Display", serif; font-size: 28px; font-weight: 700;
  margin: 1px 0 0; line-height: 1.05; letter-spacing: -.015em;
  text-shadow:
    0 1.5px 0 oklch(0.80 0.04 65 / 0.4),
    0 -1px 0 oklch(0.97 0.01 80 / 0.28);
}
```

- [ ] **Step 13: Reskn `.track`**

Find the exact line:
```
.track { height: 9px; border-radius: 6px; background: var(--accent-soft); margin-top: 18px; overflow: hidden; }
```

Replace with:
```css
.track {
  height: 9px; border-radius: 6px; background: var(--accent-soft); margin-top: 18px; overflow: hidden;
  box-shadow: 0 1px 5px var(--mat-shadow) inset, 0 1px 0 oklch(0.97 0.01 80 / 0.3);
}
```

Find the exact line:
```
.track i { display: block; height: 100%; background: var(--accent); border-radius: 6px; transition: width .4s; }
```

Replace with:
```css
.track i {
  display: block; height: 100%; background: var(--accent); border-radius: 6px; transition: width .4s;
  box-shadow: 0 1px 0 oklch(0.97 0.01 80 / 0.3) inset;
}
```

- [ ] **Step 14: Reskn `.segctl` and `.seg-opt.on`**

Find the exact line:
```
.segctl { display: flex; gap: 4px; background: var(--accent-tint); border-radius: 13px; padding: 4px; }
```

Replace with:
```css
.segctl {
  display: flex; gap: 4px; border-radius: 13px; padding: 4px;
  background-color: var(--accent-tint);
  background-image: linear-gradient(180deg, oklch(0.50 0.04 55 / 0.06) 0%, transparent 25%);
  box-shadow: 0 1px 4px var(--mat-shadow) inset;
}
```

Find the exact line:
```
.seg-opt.on { background: var(--surface); color: var(--accent-ink); box-shadow: 0 2px 6px oklch(0.6 0.05 20 / .12); }
```

Replace with:
```css
.seg-opt.on {
  background-color: var(--surface);
  background-image: linear-gradient(180deg, oklch(0.97 0.01 80 / 0.55) 0%, var(--surface) 100%);
  color: var(--accent-ink);
  box-shadow:
    0 1px 0 oklch(0.97 0.01 80 / 0.75) inset,
    0 2px 8px var(--mat-cast);
}
```

- [ ] **Step 15: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%M)
git add styles.css sw.js index.html
git commit -m "feat(style): apply pressed-clay depth to buttons, inputs, tabs, and controls"
```

---

## Task 5: Replace pulse with ember glow

**Files:**
- Modify: `styles.css`

**Interfaces:**
- Consumes: Nothing from prior tasks
- Produces: `ember-glow` / `ember-glow-cool` animations on `.livedot`

- [ ] **Step 1: Replace `.livedot` and `@keyframes pulse`**

Find the exact block:
```
.livedot { width: 9px; height: 9px; border-radius: 50%; background: var(--good); animation: pulse 2.4s ease-out infinite; }
.livedot.sleeping { background: oklch(0.6 0.09 300); }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 var(--good-halo); } 70% { box-shadow: 0 0 0 8px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
```

Replace with:
```css
.livedot {
  width: 9px; height: 9px; border-radius: 50%;
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

- [ ] **Step 2: Also update the `@media (prefers-reduced-motion)` block for ptr**

Find the exact block:
```
@media (prefers-reduced-motion: reduce) {
  .ptr-spinning .ptr-spinner { animation: ptr-pulse 1.2s ease-in-out infinite; }
}
```

This block should remain unchanged. Verify it is still present after the edit in Step 1.

- [ ] **Step 3: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%M)
git add styles.css sw.js index.html
git commit -m "feat(style): replace pulse animation with ember glow on live dot"
```

---

## Task 6: Add custom icons, new types, and quick-action grid

**Files:**
- Modify: `index.html` (SVG sprite)
- Modify: `js/ui.js` (TYPES, diaperIcon)
- Modify: `js/home.js` (QUICK array)
- Modify: `styles.css` (actions grid)

**Interfaces:**
- Consumes: `.tone-play`, `.tone-bath` from Task 2
- Produces: `icon-sleep`, `icon-feed`, `icon-bottle`, `icon-diaper`, `icon-medicine`, `icon-play`, `icon-bath` SVG symbols; updated TYPES; updated QUICK; 4-column actions grid

- [ ] **Step 1: Add 7 custom icon symbols to the SVG sprite in index.html**

In `index.html`, find the exact line:
```
</svg>
```
(this is the closing tag of the inline SVG sprite, the line just before `  <div id="app"></div>`)

Insert the following 7 symbol blocks BEFORE that closing `</svg>` tag:

```svg
<symbol id="icon-sleep" viewBox="0 0 24 24">
  <path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  <circle fill="white" fill-opacity="0.45" cx="16.5" cy="5" r="0.85"/>
  <circle fill="white" fill-opacity="0.30" cx="19.2" cy="8.5" r="0.60"/>
  <circle fill="white" fill-opacity="0.20" cx="14.8" cy="3.5" r="0.45"/>
</symbol>
<symbol id="icon-feed" viewBox="0 0 24 24">
  <path fill="currentColor" d="M12 2c-.5 2.5-2 4.9-4 6.5C6 10.1 5 12 5 14a7 7 0 0 0 14 0c0-2-1-3.9-3-5.5C14 6.9 12.5 4.5 12 2z"/>
  <path fill="white" fill-opacity="0.35" d="M10.5 10a6.3 6.3 0 0 0-1.8 4 7 7 0 0 1-.2-2c0-1.4.5-2.7 1.4-3.7a9 9 0 0 0 .6-.3z"/>
</symbol>
<symbol id="icon-bottle" viewBox="0 0 24 24">
  <path fill="currentColor" d="M8 2h8v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 14 10.212V20a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-9.788a4 4 0 0 1 .672-2.22l.656-.983A4 4 0 0 0 8 4.788V2z"/>
  <path fill="white" fill-opacity="0.28" d="M9 2h2.5v.6H9z"/>
  <line x1="9" y1="15.5" x2="14" y2="15.5" stroke="white" stroke-opacity="0.40" stroke-width="1.5" stroke-linecap="round"/>
</symbol>
<symbol id="icon-diaper" viewBox="0 0 24 24">
  <path fill="currentColor" d="M3 5c-.5 0-1 .5-1 1v3l4 3-4 3v3c0 .5.5 1 1 1h18c.5 0 1-.5 1-1v-3l-4-3 4-3V6c0-.5-.5-1-1-1H3z"/>
  <path fill="white" fill-opacity="0.28" d="M3 5h18c.5 0 1 .5 1 1v2l-4 3H6L2 8V6c0-.5.5-1 1-1z"/>
</symbol>
<symbol id="icon-medicine" viewBox="0 0 24 24">
  <path fill="currentColor" d="M10.5 3.5a7 7 0 0 1 9.9 9.9l-10 10a7 7 0 1 1-9.9-9.9l10-10z"/>
  <path fill="white" fill-opacity="0.28" d="M10.5 3.5a7 7 0 0 0-4.95 11.95l11.95-11.95A7 7 0 0 0 10.5 3.5z"/>
  <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" stroke="white" stroke-opacity="0.35" stroke-width="1.2"/>
</symbol>
<symbol id="icon-play" viewBox="0 0 24 24">
  <circle fill="currentColor" cx="12" cy="12" r="4.5"/>
  <path stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none" d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5.05 5.05l1.77 1.77M17.18 17.18l1.77 1.77M5.05 18.95l1.77-1.77M17.18 6.82l1.77-1.77"/>
  <circle fill="white" fill-opacity="0.38" cx="10.5" cy="10.5" r="1.5"/>
</symbol>
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

- [ ] **Step 2: Update TYPES in js/ui.js**

In `js/ui.js`, find the exact block:
```
export const TYPES = {
  sleep: { icon: 'moon', label: 'Sleep', tone: 'sleep' },
  feed: { icon: 'droplet', label: 'Nursing', tone: 'feed' },
  bottle: { icon: 'baby-bottle', label: 'Bottle', tone: 'feed' },
  diaper: { icon: 'droplet', label: 'Diaper', tone: 'diaper' },
  medicine: { icon: 'pill', label: 'Medicine', tone: 'med' },
  pump: { icon: 'drop-half', label: 'Pump', tone: 'feed' },
  note: { icon: 'note-pencil', label: 'Note', tone: 'note' }
};
```

Replace with:
```js
export const TYPES = {
  sleep:    { icon: 'icon-sleep',    label: 'Sleep',    tone: 'sleep'  },
  feed:     { icon: 'icon-feed',     label: 'Nursing',  tone: 'feed'   },
  bottle:   { icon: 'icon-bottle',   label: 'Bottle',   tone: 'feed'   },
  diaper:   { icon: 'icon-diaper',   label: 'Diaper',   tone: 'diaper' },
  medicine: { icon: 'icon-medicine', label: 'Medicine', tone: 'med'    },
  pump:     { icon: 'drop-half',     label: 'Pump',     tone: 'feed'   },
  note:     { icon: 'note-pencil',   label: 'Note',     tone: 'note'   },
  play:     { icon: 'icon-play',     label: 'Play',     tone: 'play'   },
  bath:     { icon: 'icon-bath',     label: 'Bath',     tone: 'bath'   },
};
```

- [ ] **Step 3: Update diaperIcon() in js/ui.js**

Find the exact block:
```
export function diaperIcon(kind) {
  if (kind === 'Dirty') return 'turtle';
  if (kind === 'Mixed') return 'layers';
  return 'droplet'; // Wet or default
}
```

Replace with:
```js
export function diaperIcon(kind) {
  if (kind === 'Dirty') return 'turtle';
  if (kind === 'Mixed') return 'layers';
  return 'icon-diaper';
}
```

- [ ] **Step 4: Update QUICK array in js/home.js**

Find the exact block:
```
const QUICK = [
  { t: 'sleep', primary: true }, { t: 'feed' }, { t: 'bottle' }, { t: 'diaper' }, { t: 'medicine' }
];
```

Replace with:
```js
const QUICK = [
  { t: 'sleep', primary: true }, { t: 'feed' }, { t: 'bottle' }, { t: 'diaper' },
  { t: 'medicine' }, { t: 'play' }, { t: 'bath' }
];
```

- [ ] **Step 5: Update `.actions` grid to 4 columns in styles.css**

Find the exact line:
```
.actions { display: grid; grid-template-columns: repeat(6, 1fr); gap: 7px; }
```

Replace with:
```css
.actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
```

- [ ] **Step 6: Verify**

Open `index.html` in a browser. Check:
1. The home screen shows 8 action buttons (7 types + More) in a 2×4 grid
2. Sleep, feed, bottle, diaper, medicine buttons show the new filled icons
3. Play (sun) and Bath (tub) buttons appear with lavender and blue tones respectively
4. No console errors about missing SVG symbols

Cannot visually verify icon appearance without a browser — note this in the completion report.

- [ ] **Step 7: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%M)
git add index.html js/ui.js js/home.js styles.css sw.js
git commit -m "feat(ui): add custom illustrated icons and play/bath quick actions"
```

---

## Task 7: Update service worker cache

**Files:**
- Modify: `sw.js`

**Interfaces:**
- Consumes: `assets/textures/plaster.webp`, `assets/textures/clay.webp`, `assets/textures/linen.webp` from Task 1
- Produces: Offline-capable texture serving

- [ ] **Step 1: Add texture paths to SHELL array in sw.js**

Find the exact block:
```
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
```

Replace with:
```js
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './assets/textures/plaster.webp',
  './assets/textures/clay.webp',
  './assets/textures/linen.webp',
```

- [ ] **Step 2: Verify SHELL array looks correct**

```bash
grep -A 12 "const SHELL" sw.js
```

Expected output shows the three texture paths immediately after `manifest.webmanifest`.

- [ ] **Step 3: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%M)
git add sw.js index.html
git commit -m "chore(sw): cache texture assets for offline PWA support"
```

---

## Final report

After all tasks complete, provide:
1. `git log --oneline -10` output
2. List of any find/replace steps that did NOT match (if any were skipped or improvised — be explicit)
3. Confirm all 7 texture files processed and committed
4. Note that visual verification of icon rendering and texture appearance requires a browser — cannot be confirmed headlessly
