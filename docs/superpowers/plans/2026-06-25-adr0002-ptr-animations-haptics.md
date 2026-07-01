# ADR-0002 Implementation Plan: Pull-to-refresh, Chart Enter Animations, Spinner Haptics

> **Status:** COMPLETE — merged to `main`. `tests/adr0002-{ptr,animations,haptics}.test.js` pass; `.ptr-wrap`/`.ptr-spinner` and spinner haptics live.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three interaction-polish features from ADR 0002 — spinner per-row haptics, chart enter animations, and pull-to-refresh.

**Architecture:** Three independent tasks, each with its own commit. Haptics is a one-liner in sheets.js. Animations add an `animateGrow` helper to fx.js and enter hooks called from `router.go()` in app.js (not `refresh()` — see Constraint §4). PTR adds a gesture listener plus `#ptr` indicator div to app.js, and the `refresh-cw` Lucide symbol to index.html's sprite.

**Tech Stack:** Vanilla JS, Web Animations API (`element.animate()`), CSS `@keyframes`, `navigator.vibrate()`, Playwright for tests.

## Global Constraints

- **No framework.** Vanilla JS only. No new npm packages.
- **Lucide icons only**, vendored as inline SVG symbols in `index.html`'s `<body>` sprite. Do not use `<img src>` or `<link>` for icons.
- **Fonts:** Playfair Display for baby name/hero timer; Archivo for everything else. No new font faces.
- **Version bump every commit** — update `<meta name="version">` in `index.html` AND `const VERSION` in `sw.js` to `date -u +%Y-%m-%dT%H:%M`. The two values must match, differing only by the `hearth-` prefix in `sw.js`. Run `date -u +%Y-%m-%dT%H:%M` to get the current timestamp right before each commit.
- **Animations go in `router.go()` only, NOT `router.refresh()`.** `refresh()` fires after every save/sync (30s interval, SSE messages, every sheet close). Animating there would replay charts on every edit, not just tab switches. The ADR's "every tab switch" intent maps to `go()`.
- **`prefers-reduced-motion`:** The drag-proportional PTR rotation is exempt (directly tied to touch input, same treatment as drag-to-reorder). The continuous PTR "refreshing" spin must respect it. `animateGrow` already respects it via `fx.js`'s existing `reducedMotion` const.
- **Test runner:** `node tests/run.js` runs all suites. Each new test file goes in `tests/`. Tests start their own server via `helpers.js`. All three new test files are independent (each calls `startServer()` on its own port).

---

## File Map

| File | Action | What changes |
|---|---|---|
| `js/sheets.js` | Modify | Add `navigator.vibrate(3)` in `render()` on row-crossing |
| `js/fx.js` | Modify | Export `animateGrow(el, keyframes, delayMs)` |
| `js/app.js` | Modify | Add `enterTrends/enterSleep/enterGrowth` functions; call from `router.go()`; add PTR gesture; update `shell()` to include `#ptr` |
| `styles.css` | Modify | Add `.bar { transform-origin: bottom }`, `.growth-svg circle { transform-box: fill-box; transform-origin: center }`, `.ptr-wrap` + `@keyframes spin` + `@keyframes ptr-pulse` |
| `index.html` | Modify | Add `<symbol id="refresh-cw">` to sprite; version bump each commit |
| `sw.js` | Modify | Version bump each commit |
| `tests/adr0002-haptics.test.js` | Create | Playwright test for spinner per-row vibration |
| `tests/adr0002-animations.test.js` | Create | Playwright test for chart WAAPI animations |
| `tests/adr0002-ptr.test.js` | Create | Playwright test for pull-to-refresh |

---

## Task 1: Spinner Per-Row Haptics

**Files:**
- Modify: `js/sheets.js` (line 72–87, the `render()` function inside `openSpinner`)
- Create: `tests/adr0002-haptics.test.js`
- Modify: `index.html` (version bump)
- Modify: `sw.js` (version bump)

**Interfaces:**
- Consumes: `navigator.vibrate` (guarded with `if (navigator.vibrate)`)
- Produces: nothing new — purely additive to existing `render()` in `openSpinner`

---

- [ ] **Step 1: Write the failing test**

Create `tests/adr0002-haptics.test.js`:

```js
// tests/adr0002-haptics.test.js — per-row haptic on spinner drag.
const { startServer, launchBrowser, onboard, check, tally, resetCounters } = require('./helpers');

(async () => {
  const server = await startServer(18791);
  let exitCode = 0;
  try { exitCode = await runSuite(server.base); }
  catch (e) { console.error(e); exitCode = 1; }
  finally { server.close(); }
  process.exit(exitCode);
})().catch((e) => { console.error(e); process.exit(1); });

async function runSuite(base) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  // Mock navigator.vibrate before any app code runs.
  await page.addInitScript(() => {
    window.__vibrations = [];
    Object.defineProperty(window.navigator, 'vibrate', {
      value: (ms) => { window.__vibrations.push(ms); return true; },
      configurable: true
    });
  });

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await onboard(page);
  await page.waitForTimeout(300);

  resetCounters();

  // Open spinner via bottle log sheet.
  async function openSpinner() {
    await page.click('[data-action="log:open"][data-type="bottle"]');
    await page.waitForTimeout(400);
    await page.click('.stepper-val');
    await page.waitForTimeout(300);
    return await page.$('.spinner-overlay');
  }
  async function closeOverlay() {
    await page.evaluate(() => {
      const o = document.querySelector('.spinner-overlay');
      if (o) { o._closed = true; o.classList.remove('show'); setTimeout(() => o.remove(), 200); }
      const s = document.querySelector('#scrim');
      if (s) { s.classList.remove('show'); setTimeout(() => { if (s) s.innerHTML = ''; }, 280); }
    });
    await page.waitForTimeout(350);
  }

  // ---------- per-row vibrate fires at 3ms ----------
  console.log('--- Haptics: per-row vibrate(3) on drag ---');
  await page.evaluate(() => { window.__vibrations = []; });
  const overlay = await openSpinner();
  const win = await (await overlay.$('.spinner-window')).boundingBox();
  const cx = win.x + win.width / 2;
  const cy = win.y + win.height / 2;
  const itemH = (await (await overlay.$('.spinner-item')).boundingBox()).height;

  // Drag up exactly 3 item heights (3 rows) in small steps to ensure row-crossing events fire.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 3; i++) {
    await page.mouse.move(cx, cy - i * itemH, { steps: 8 });
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);

  const vibs = await page.evaluate(() => window.__vibrations);
  console.log('  vibrations recorded:', vibs);
  check('vibrate fired >= 3 times (once per row crossing)', vibs.length >= 3, vibs.length);
  check('all vibrations are 3ms (not 12ms long-press)', vibs.every(v => v === 3), vibs.join(','));
  await closeOverlay();

  // ---------- no vibrate on tap (no row crossing) ----------
  console.log('\n--- Haptics: no vibrate on tap-without-drag ---');
  await page.evaluate(() => { window.__vibrations = []; });
  const overlay2 = await openSpinner();
  const win2 = await (await overlay2.$('.spinner-window')).boundingBox();
  await page.mouse.move(win2.x + win2.width / 2, win2.y + win2.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const vibsTap = await page.evaluate(() => window.__vibrations);
  console.log('  vibrations after tap:', vibsTap);
  check('no vibrate on tap', vibsTap.length === 0, vibsTap.length);
  await closeOverlay();

  // ---------- vibrate is bounded: fling across many rows produces discrete ticks ----------
  console.log('\n--- Haptics: fling fires per-row, not per-frame ---');
  await page.evaluate(() => { window.__vibrations = []; });
  const overlay3 = await openSpinner();
  const win3 = await (await overlay3.$('.spinner-window')).boundingBox();
  const cx3 = win3.x + win3.width / 2, cy3 = win3.y + win3.height / 2;
  await page.mouse.move(cx3, cy3 + 20);
  await page.mouse.down();
  await page.mouse.move(cx3, cy3 - 40, { steps: 2 });
  await page.mouse.move(cx3, cy3 - 200, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const flingVal = await page.$eval('.stepper-val', el => parseFloat(el.dataset.value));
  const vibsFling = await page.evaluate(() => window.__vibrations);
  const expectedRows = Math.round(Math.abs(flingVal - 120) / 5); // step=5, default=120
  console.log('  fling val:', flingVal, 'expected rows:', expectedRows, 'vibrations:', vibsFling.length);
  check('fling haptic count matches row count (within 1)', Math.abs(vibsFling.length - expectedRows) <= 1, `${vibsFling.length} vs ${expectedRows}`);
  await closeOverlay();

  exitCode = tally() === 0 ? 0 : 1;
  await browser.close();
  return exitCode;
}
```

- [ ] **Step 2: Run test to confirm it fails**

```
node tests/adr0002-haptics.test.js
```

Expected: FAIL — `vibrate fired >= 3 times` fails (0 vibrations recorded), since `render()` in sheets.js has no `navigator.vibrate` call yet.

- [ ] **Step 3: Add `navigator.vibrate(3)` to `render()` in `js/sheets.js`**

In `js/sheets.js`, find the `render(offset)` function inside `openSpinner` (around line 72). Change:

```js
  function render(offset) {
    const raw = pxToVal(offset);
    const center = Math.round(raw / step) * step;
    if (center !== lastCenter) {
      lastCenter = center;
      items.innerHTML = trackHTML(center);
    }
```

To:

```js
  function render(offset) {
    const raw = pxToVal(offset);
    const center = Math.round(raw / step) * step;
    if (center !== lastCenter) {
      lastCenter = center;
      items.innerHTML = trackHTML(center);
      if (navigator.vibrate) navigator.vibrate(3);
    }
```

- [ ] **Step 4: Run test to confirm it passes**

```
node tests/adr0002-haptics.test.js
```

Expected: all 3 checks PASS.

- [ ] **Step 5: Bump version and commit**

```bash
# Get current timestamp
TS=$(date -u +%Y-%m-%dT%H:%M)
# Update index.html meta version
sed -i "s|content=\"[^\"]*\">\(\s*\)<!-- Must match VERSION in sw.js -->|content=\"${TS}\"><!-- Must match VERSION in sw.js -->|" index.html
# Update sw.js VERSION constant
sed -i "s|const VERSION = 'hearth-[^']*'|const VERSION = 'hearth-${TS}'|" sw.js
# Verify both match
grep 'name="version"' index.html
grep 'const VERSION' sw.js
```

Then commit:

```bash
git add js/sheets.js tests/adr0002-haptics.test.js index.html sw.js
git commit -m "feat(sheets): add per-row haptic vibration to spinner"
```

---

## Task 2: Chart Enter Animations

**Files:**
- Modify: `js/fx.js` (add `animateGrow` export)
- Modify: `js/app.js` (import `animateGrow`; add `enterTrends`, `enterSleep`, `enterGrowth`; call from `router.go`)
- Modify: `styles.css` (add `transform-origin` rules for bars and growth circles)
- Create: `tests/adr0002-animations.test.js`
- Modify: `index.html` (version bump)
- Modify: `sw.js` (version bump)

**Interfaces:**
- Consumes from Task 1: nothing (independent)
- Produces: `animateGrow(el, keyframes, delayMs?)` exported from `js/fx.js`; `enterTrends/enterSleep/enterGrowth` private functions in `js/app.js`

---

- [ ] **Step 1: Write the failing test**

Create `tests/adr0002-animations.test.js`:

```js
// tests/adr0002-animations.test.js — WAAPI enter animations on tab switch.
const { startServer, launchBrowser, onboard, check, tally, resetCounters } = require('./helpers');

(async () => {
  const server = await startServer(18792);
  let exitCode = 0;
  try { exitCode = await runSuite(server.base); }
  catch (e) { console.error(e); exitCode = 1; }
  finally { server.close(); }
  process.exit(exitCode);
})().catch((e) => { console.error(e); process.exit(1); });

async function runSuite(base) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await onboard(page);
  await page.waitForTimeout(300);

  resetCounters();

  // ---- Seed growth data so the chart renders ----
  // (lineChart() requires at least 2 measurements)
  await page.evaluate(() => {
    const KEY = 'hearth.state.v1';
    const st = JSON.parse(localStorage.getItem(KEY) || '{}');
    st.growth = [
      { id: 'g1', date: '2025-06-01', weightKg: 3.5, heightCm: 52, headCm: null, note: '' },
      { id: 'g2', date: '2025-08-01', weightKg: 5.2, heightCm: 60, headCm: null, note: '' }
    ];
    localStorage.setItem(KEY, JSON.stringify(st));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await onboard(page);
  await page.waitForTimeout(300);

  // ---------- Trends: bars animate scaleY on tab switch ----------
  console.log('--- Animations: Trends bars animate on tab switch ---');
  await page.click('[data-action="nav:trends"]');
  await page.waitForTimeout(50); // check early — animations run for 450ms+stagger

  const barAnimCount = await page.evaluate(() => {
    const bars = [...document.querySelectorAll('.bar')];
    return bars.reduce((n, b) => n + b.getAnimations().length, 0);
  });
  console.log('  active bar animations immediately after nav:', barAnimCount);
  check('trends bars have active WAAPI animations after tab switch', barAnimCount > 0, barAnimCount);

  // Wait for all animations to finish (450ms + 6*35ms stagger ≈ 660ms total)
  await page.waitForTimeout(900);
  const barsDone = await page.evaluate(() => {
    const bars = [...document.querySelectorAll('.bar')];
    const anims = bars.flatMap(b => b.getAnimations());
    return { total: anims.length, finished: anims.filter(a => a.playState === 'finished').length };
  });
  console.log('  bar animation states after 900ms:', barsDone);
  // finished + running <= total; finished > 0 means at least some ran
  check('bar animations complete (not stuck)', barsDone.finished === barsDone.total || barsDone.total === 0, JSON.stringify(barsDone));

  // ---------- Trends: second tab switch replays the animation ----------
  console.log('\n--- Animations: replay on every tab switch ---');
  await page.click('[data-action="nav:home"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="nav:trends"]');
  await page.waitForTimeout(50);
  const barAnimCount2 = await page.evaluate(() => {
    return [...document.querySelectorAll('.bar')].reduce((n, b) => n + b.getAnimations().length, 0);
  });
  check('trends bars animate again on second tab switch', barAnimCount2 > 0, barAnimCount2);

  // ---------- Sleep: ring segments animate stroke-dasharray ----------
  console.log('\n--- Animations: Sleep ring segments animate ---');
  // Add a sleep entry so at least one ring segment renders
  await page.evaluate(() => {
    const KEY = 'hearth.state.v1';
    const st = JSON.parse(localStorage.getItem(KEY) || '{}');
    const now = new Date();
    const start = new Date(now.getTime() - 90 * 60 * 1000).toISOString(); // 90min ago
    const end = new Date(now.getTime() - 30 * 60 * 1000).toISOString();   // 30min ago
    st.log = [...(st.log || []), { id: 'sl1', type: 'sleep', start, end, quality: 'Good' }];
    localStorage.setItem(KEY, JSON.stringify(st));
  });
  await page.click('[data-action="nav:home"]');
  await page.waitForTimeout(100);
  await page.click('[data-action="nav:sleep"]');
  await page.waitForTimeout(50);

  const ringAnimCount = await page.evaluate(() => {
    const circles = [...document.querySelectorAll('.ringwrap svg circle[stroke-dasharray]')];
    return circles.reduce((n, c) => n + c.getAnimations().length, 0);
  });
  console.log('  active ring segment animations:', ringAnimCount);
  check('sleep ring segments have active WAAPI animations', ringAnimCount > 0, ringAnimCount);

  // ---------- Growth: polyline and circles animate ----------
  console.log('\n--- Animations: Growth polyline and dots animate ---');
  await page.click('[data-action="nav:growth"]');
  await page.waitForTimeout(50);

  const growthAnims = await page.evaluate(() => {
    const poly = document.querySelector('.growth-svg polyline');
    const circles = [...document.querySelectorAll('.growth-svg circle')];
    const polygon = document.querySelector('.growth-svg polygon');
    return {
      poly: poly?.getAnimations().length ?? 0,
      circles: circles.reduce((n, c) => n + c.getAnimations().length, 0),
      polygon: polygon?.getAnimations().length ?? 0
    };
  });
  console.log('  growth animation counts:', growthAnims);
  check('growth polyline animates', growthAnims.poly > 0, growthAnims.poly);
  check('growth dots animate', growthAnims.circles > 0, growthAnims.circles);
  check('growth area polygon animates', growthAnims.polygon > 0, growthAnims.polygon);

  // ---------- refresh() does NOT trigger animations ----------
  console.log('\n--- Animations: refresh() does NOT replay animations ---');
  await page.click('[data-action="nav:trends"]');
  await page.waitForTimeout(700); // let initial tab-switch animations finish
  await page.evaluate(async () => {
    const mod = await import('/js/app.js');
    mod.router.refresh();
  });
  await page.waitForTimeout(50);
  const barAnimAfterRefresh = await page.evaluate(() => {
    return [...document.querySelectorAll('.bar')].reduce((n, b) => n + b.getAnimations().length, 0);
  });
  console.log('  bar animations after router.refresh():', barAnimAfterRefresh);
  check('router.refresh() does NOT trigger bar animations', barAnimAfterRefresh === 0, barAnimAfterRefresh);

  // ---------- Reduced motion: no animations ----------
  console.log('\n--- Animations: prefers-reduced-motion suppresses all animations ---');
  const page2 = await browser.newPage();
  await page2.emulateMedia({ reducedMotion: 'reduce' });
  await page2.goto(base + '/', { waitUntil: 'networkidle' });
  await page2.waitForTimeout(500);
  await onboard(page2);
  await page2.waitForTimeout(300);

  await page2.click('[data-action="nav:trends"]');
  await page2.waitForTimeout(100);
  const reducedBarAnims = await page2.evaluate(() => {
    return [...document.querySelectorAll('.bar')].reduce((n, b) => n + b.getAnimations().length, 0);
  });
  console.log('  bar animations under reduced-motion:', reducedBarAnims);
  check('no bar animations under prefers-reduced-motion', reducedBarAnims === 0, reducedBarAnims);
  await page2.close();

  exitCode = tally() === 0 ? 0 : 1;
  await browser.close();
  return exitCode;
}
```

- [ ] **Step 2: Run test to confirm it fails**

```
node tests/adr0002-animations.test.js
```

Expected: FAIL — "trends bars have active WAAPI animations" fails (0 animations, since `animateGrow` doesn't exist yet).

- [ ] **Step 3: Add `animateGrow` to `js/fx.js`**

Append to `js/fx.js` after the `confetti` function:

```js
export function animateGrow(el, keyframes, delayMs = 0) {
  if (reducedMotion) return;
  el.animate(keyframes, { duration: 450, delay: delayMs, easing: 'ease-out', fill: 'backwards' });
}
```

- [ ] **Step 4: Add CSS transform-origin rules to `styles.css`**

Find the `.bar` rule (line ~250):
```css
.bar { width: 100%; border-radius: 7px 7px 4px 4px; background: var(--tcb); min-height: 4px; transition: height .4s; }
```

Change to:
```css
.bar { width: 100%; border-radius: 7px 7px 4px 4px; background: var(--tcb); min-height: 4px; transition: height .4s; transform-origin: bottom; }
```

Find (or add after) `.growth-svg .growth-x`:
```css
.growth-svg .growth-x { font-size: 11px; font-family: "Archivo", sans-serif; font-weight: 700; fill: var(--muted); }
```

Add a new rule immediately after:
```css
.growth-svg circle { transform-box: fill-box; transform-origin: center; }
```

- [ ] **Step 5: Add enter functions to `js/app.js` and call from `router.go()`**

Add the import at the top of `app.js` (line 1, alongside the existing imports):

Find the line:
```js
import { enableNotifs, notify } from './reminders.js';
```

Add the import for `animateGrow`:
```js
import { animateGrow } from './fx.js';
```

Then add the three enter functions before the `shell()` function definition (around line 25):

```js
function enterTrends() {
  const bars = [...document.querySelectorAll('#view .bar')];
  bars.forEach((b, i) => {
    animateGrow(b, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], i * 35);
  });
}

function enterSleep() {
  const C = 2 * Math.PI * 86;
  const circles = [...document.querySelectorAll('#view .ringwrap svg circle[stroke-dasharray]')];
  circles.forEach((c, i) => {
    const finalDA = c.getAttribute('stroke-dasharray');
    animateGrow(c, [
      { strokeDasharray: `0 ${C.toFixed(2)}` },
      { strokeDasharray: finalDA }
    ], i * 35);
  });
}

function enterGrowth() {
  const poly = document.querySelector('#view .growth-svg polyline');
  if (poly) {
    const len = poly.getTotalLength();
    animateGrow(poly, [
      { strokeDasharray: String(len), strokeDashoffset: len },
      { strokeDasharray: String(len), strokeDashoffset: 0 }
    ], 0);
  }
  const polygon = document.querySelector('#view .growth-svg polygon');
  if (polygon) {
    animateGrow(polygon, [{ opacity: 0 }, { opacity: 0.5 }], 200);
  }
  const dots = [...document.querySelectorAll('#view .growth-svg circle')];
  dots.forEach((d, i) => {
    animateGrow(d, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], 200 + i * 50);
  });
}
```

Then update `router.go()` to call the appropriate enter function after setting innerHTML. Find:

```js
  go(view) {
    exitTodayEditMode();
    exitCardEditMode();
    current = view;
    const v = $('#view');
    if (!v) { router.boot(); }
    $('#view').innerHTML = VIEWS[view]();
    $('#view').scrollTop = 0;
    $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === view));
  },
```

Change to:

```js
  go(view) {
    exitTodayEditMode();
    exitCardEditMode();
    current = view;
    const v = $('#view');
    if (!v) { router.boot(); }
    $('#view').innerHTML = VIEWS[view]();
    $('#view').scrollTop = 0;
    $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === view));
    if (view === 'trends') enterTrends();
    else if (view === 'sleep') enterSleep();
    else if (view === 'growth') enterGrowth();
  },
```

- [ ] **Step 6: Run test to confirm it passes**

```
node tests/adr0002-animations.test.js
```

Expected: all checks PASS.

If `growth polyline animates` fails, verify `poly.getTotalLength()` returns non-zero. The polyline must have at least 2 points (`lineChart` guard: `if (pts0.length < 2) return empty`). The test seeds 2 measurements — confirm they are present by checking `st.growth.length` in `localStorage` in the test.

- [ ] **Step 7: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%M)
sed -i "s|content=\"[^\"]*\">\(\s*\)<!-- Must match VERSION in sw.js -->|content=\"${TS}\"><!-- Must match VERSION in sw.js -->|" index.html
sed -i "s|const VERSION = 'hearth-[^']*'|const VERSION = 'hearth-${TS}'|" sw.js
grep 'name="version"' index.html
grep 'const VERSION' sw.js
```

```bash
git add js/fx.js js/app.js styles.css tests/adr0002-animations.test.js index.html sw.js
git commit -m "feat(fx): add animateGrow helper and chart enter animations"
```

---

## Task 3: Pull-to-Refresh Gesture

**Files:**
- Modify: `index.html` (add `<symbol id="refresh-cw">` to sprite; version bump)
- Modify: `js/app.js` (update `shell()` to include `#ptr` div; add PTR gesture code; expose `syncOnce` to PTR handler)
- Modify: `styles.css` (add `.ptr-wrap` styles, `@keyframes spin`, `@keyframes ptr-pulse`)
- Modify: `sw.js` (version bump)
- Create: `tests/adr0002-ptr.test.js`

**Interfaces:**
- Consumes: `syncOnce()` (already defined in `app.js`, just needs to be reachable from PTR handler — it's already in the same file)
- Produces: `#ptr` element in the DOM (flex child of `.phone`, before `#view`); CSS classes `.ptr-wrap`, `.ptr-spinning`

---

- [ ] **Step 1: Write the failing test**

Create `tests/adr0002-ptr.test.js`:

```js
// tests/adr0002-ptr.test.js — pull-to-refresh gesture.
const { startServer, launchBrowser, onboard, check, tally, resetCounters } = require('./helpers');

(async () => {
  const server = await startServer(18793);
  let exitCode = 0;
  try { exitCode = await runSuite(server.base); }
  catch (e) { console.error(e); exitCode = 1; }
  finally { server.close(); }
  process.exit(exitCode);
})().catch((e) => { console.error(e); process.exit(1); });

// Dispatch a touch pointer event on the .screen element.
async function touchPtrEvent(page, type, clientX, clientY, pointerId = 1) {
  await page.evaluate(({ type, clientX, clientY, pointerId }) => {
    const screen = document.querySelector('.screen');
    if (!screen) return;
    const e = new PointerEvent(type, {
      bubbles: true, cancelable: true,
      pointerType: 'touch', clientX, clientY, pointerId
    });
    screen.dispatchEvent(e);
  }, { type, clientX, clientY, pointerId });
}

async function runSuite(base) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  // Mock navigator.vibrate.
  await page.addInitScript(() => {
    window.__vibrations = [];
    Object.defineProperty(window.navigator, 'vibrate', {
      value: (ms) => { window.__vibrations.push(ms); return true; },
      configurable: true
    });
  });

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await onboard(page);
  await page.waitForTimeout(300);

  resetCounters();

  // Navigate to trends — any tab works, PTR is global.
  await page.click('[data-action="nav:trends"]');
  await page.waitForTimeout(200);

  // ---------- #ptr indicator exists in DOM ----------
  console.log('--- PTR: DOM structure ---');
  const ptrExists = await page.$('#ptr') !== null;
  check('#ptr element exists in DOM', ptrExists);
  if (!ptrExists) {
    tally();
    await browser.close();
    return 1;
  }

  // ---------- Short pull (below threshold): indicator appears, no vibration, no sync ----------
  console.log('\n--- PTR: short pull below threshold collapses without sync ---');
  await page.evaluate(() => { window.__vibrations = []; window.__syncCalled = false; });
  await page.route('/api/sync*', async (route) => {
    await page.evaluate(() => { window.__syncCalled = true; });
    await route.continue();
  });

  // Get screen center for dispatch coordinates.
  const screenBox = await page.$eval('.screen', el => {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + 40 };
  });
  const { cx, cy } = screenBox;

  // Pull 30px (below PTR_THRESHOLD of 70px).
  await touchPtrEvent(page, 'pointerdown', cx, cy, 1);
  await touchPtrEvent(page, 'pointermove', cx, cy + 20, 1);
  await touchPtrEvent(page, 'pointermove', cx, cy + 30, 1);
  await page.waitForTimeout(50);

  const ptrHeight30 = await page.$eval('#ptr', el => parseFloat(el.style.height) || 0);
  console.log('  #ptr height at 30px raw pull:', ptrHeight30);
  check('#ptr has positive height during short pull', ptrHeight30 > 0, ptrHeight30);

  await touchPtrEvent(page, 'pointerup', cx, cy + 30, 1);
  await page.waitForTimeout(400);

  const ptrHeightAfter = await page.$eval('#ptr', el => parseFloat(el.style.height) || 0);
  const vibsShort = await page.evaluate(() => window.__vibrations);
  const syncCalledShort = await page.evaluate(() => window.__syncCalled);
  console.log('  #ptr height after release:', ptrHeightAfter, 'vibrations:', vibsShort, 'sync called:', syncCalledShort);
  check('#ptr collapses to 0 after below-threshold release', ptrHeightAfter === 0, ptrHeightAfter);
  check('no vibration on below-threshold pull', vibsShort.length === 0, vibsShort.length);
  check('no sync on below-threshold pull', !syncCalledShort);
  await page.unroute('/api/sync*');

  // ---------- Full pull past threshold: vibrate(12) fires once, sync called ----------
  console.log('\n--- PTR: full pull past threshold triggers sync ---');
  await page.evaluate(() => { window.__vibrations = []; window.__syncCalled = false; });
  await page.route('/api/sync*', async (route) => {
    await page.evaluate(() => { window.__syncCalled = true; });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ serverTime: '', log: [], growth: [], baby: null, settings: null }) });
  });

  // Pull 120px raw → dist = 40 + (120-40)*0.5 = 80 > threshold (70), so armed.
  await page.evaluate(() => { window.__vibrations = []; });
  await touchPtrEvent(page, 'pointerdown', cx, cy, 2);
  for (let dy = 0; dy <= 120; dy += 15) {
    await touchPtrEvent(page, 'pointermove', cx, cy + dy, 2);
    await page.waitForTimeout(15);
  }
  const vibsAtThreshold = await page.evaluate(() => window.__vibrations);
  console.log('  vibrations while pulling (should be 1 at threshold crossing):', vibsAtThreshold);
  check('vibrate(12) fires exactly once at threshold crossing', vibsAtThreshold.length === 1 && vibsAtThreshold[0] === 12, vibsAtThreshold.join(','));

  await touchPtrEvent(page, 'pointerup', cx, cy + 120, 2);
  await page.waitForTimeout(400);
  const syncCalledFull = await page.evaluate(() => window.__syncCalled);
  check('sync triggered after full pull release', syncCalledFull);

  // Indicator should collapse after sync
  await page.waitForTimeout(500);
  const ptrHeightPost = await page.$eval('#ptr', el => parseFloat(el.style.height) || 0);
  check('#ptr collapses to 0 after sync completes', ptrHeightPost === 0, ptrHeightPost);
  await page.unroute('/api/sync*');

  // ---------- PTR does not fire when screen is scrolled down ----------
  console.log('\n--- PTR: no trigger when screen is scrolled ---');
  await page.evaluate(() => { window.__vibrations = []; });
  // Navigate to home which has a longer log (or just scroll via evaluate)
  await page.evaluate(() => {
    const screen = document.querySelector('.screen');
    if (screen) screen.scrollTop = 50;
  });
  await page.waitForTimeout(100);

  await touchPtrEvent(page, 'pointerdown', cx, cy, 3);
  for (let dy = 0; dy <= 120; dy += 15) {
    await touchPtrEvent(page, 'pointermove', cx, cy + dy, 3);
  }
  await touchPtrEvent(page, 'pointerup', cx, cy + 120, 3);
  await page.waitForTimeout(300);
  const ptrWhenScrolled = await page.$eval('#ptr', el => parseFloat(el.style.height) || 0);
  console.log('  #ptr height when screen scrolled (should be 0):', ptrWhenScrolled);
  check('#ptr does not trigger when screen is scrolled', ptrWhenScrolled === 0, ptrWhenScrolled);

  // Reset scroll
  await page.evaluate(() => { const s = document.querySelector('.screen'); if (s) s.scrollTop = 0; });

  // ---------- Timeout: hanging sync collapses indicator within 4.5s ----------
  console.log('\n--- PTR: timeout collapses indicator if sync hangs ---');
  await page.evaluate(() => { window.__vibrations = []; });
  await page.route('/api/sync*', async () => { /* hang — never resolve */ });

  await touchPtrEvent(page, 'pointerdown', cx, cy, 4);
  for (let dy = 0; dy <= 120; dy += 15) {
    await touchPtrEvent(page, 'pointermove', cx, cy + dy, 4);
    await page.waitForTimeout(10);
  }
  await touchPtrEvent(page, 'pointerup', cx, cy + 120, 4);
  await page.waitForTimeout(200);

  const ptrSpinning = await page.evaluate(() => document.getElementById('ptr')?.classList.contains('ptr-spinning'));
  console.log('  ptr-spinning class present while sync hangs:', ptrSpinning);
  check('#ptr has ptr-spinning class while sync is in-flight', ptrSpinning);

  // Wait past the 4s timeout
  await page.waitForTimeout(4400);
  const ptrAfterTimeout = await page.$eval('#ptr', el => ({
    height: parseFloat(el.style.height) || 0,
    spinning: el.classList.contains('ptr-spinning')
  }));
  console.log('  #ptr after 4.4s timeout:', ptrAfterTimeout);
  check('#ptr collapses after 4s timeout', ptrAfterTimeout.height === 0, ptrAfterTimeout.height);
  check('ptr-spinning class removed after timeout', !ptrAfterTimeout.spinning);
  await page.unroute('/api/sync*');

  exitCode = tally() === 0 ? 0 : 1;
  await browser.close();
  return exitCode;
}
```

- [ ] **Step 2: Run test to confirm it fails**

```
node tests/adr0002-ptr.test.js
```

Expected: FAIL on `#ptr element exists in DOM` (the `#ptr` div doesn't exist in `shell()` yet).

- [ ] **Step 3: Add `refresh-cw` symbol to the SVG sprite in `index.html`**

The sprite is in `index.html`'s `<body>`. Find the last `</symbol>` before `</svg>` (currently the `#x` symbol, line ~157). Insert the new symbol immediately before `</svg>`:

The exact SVG paths for Lucide `refresh-cw`:
```html
<symbol id="refresh-cw" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
  <path d="M21 3v5h-5" />
  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
  <path d="M8 16H3v5" />
</symbol>
```

Insert this before the closing `</svg>` of the sprite.

- [ ] **Step 4: Update `shell()` in `js/app.js` to include `#ptr`**

Find:

```js
function shell() {
  return `<main class="phone app">
    <div id="view" class="screen"></div>
    <nav class="tabbar">${TABS.map((t) => `<button class="tab" data-action="nav:${t.v}" data-tab="${t.v}" aria-label="${t.label}"><svg class="icon"><use href="#${t.icon}"></use></svg></button>`).join('')}</nav>
  </main>`;
}
```

Change to:

```js
function shell() {
  return `<main class="phone app">
    <div id="ptr" class="ptr-wrap"><svg class="icon ptr-spinner"><use href="#refresh-cw"></use></svg></div>
    <div id="view" class="screen"></div>
    <nav class="tabbar">${TABS.map((t) => `<button class="tab" data-action="nav:${t.v}" data-tab="${t.v}" aria-label="${t.label}"><svg class="icon"><use href="#${t.icon}"></use></svg></button>`).join('')}</nav>
  </main>`;
}
```

- [ ] **Step 5: Add PTR CSS to `styles.css`**

Find the `@keyframes pulse` rule (line ~87) in `styles.css`. Add the PTR styles and spin keyframe right after it:

```css
/* ---- pull-to-refresh ---- */
.ptr-wrap { flex: 0 0 auto; height: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; transition: height .3s ease-out; }
.ptr-spinner { font-size: 22px; color: var(--muted); }
.ptr-spinning .ptr-spinner { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .ptr-spinning .ptr-spinner { animation: ptr-pulse 1.2s ease-in-out infinite; }
}
@keyframes ptr-pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
```

- [ ] **Step 6: Add PTR gesture code to `js/app.js`**

Add the following block after the drag-to-reorder section (after the `['pointerup', 'pointercancel'].forEach(...)` for drag-to-reorder, around line 238). Insert before the `// change/input binders` comment:

```js
// ---------- pull-to-refresh ----------
let ptrActive = false, ptrPid = null, ptrStartY = 0, ptrArmed = false, ptrSyncing = false, ptrTimeout = null;
const PTR_THRESHOLD = 70; // visual px to arm refresh
const PTR_MAX = 80;       // visual px cap

function ptrDist(raw) {
  // Two-phase resistance: 1:1 until 40px, then 0.5 damping.
  // Threshold (70px) reached at raw=100; cap (80px) at raw=120.
  return raw <= 40 ? raw : 40 + (raw - 40) * 0.5;
}

function ptrReset() {
  const ptr = document.getElementById('ptr');
  if (!ptr) return;
  ptr.classList.remove('ptr-spinning');
  const spinner = ptr.querySelector('.ptr-spinner');
  if (spinner) spinner.style.transform = '';
  ptr.style.transition = 'height .3s ease-out';
  ptr.style.height = '0';
}

function ptrCollapse() {
  if (!ptrSyncing) return;
  ptrSyncing = false;
  clearTimeout(ptrTimeout);
  ptrReset();
}

document.addEventListener('pointerdown', (e) => {
  if (ptrSyncing || e.pointerType === 'mouse') return;
  const screen = e.target.closest('.screen');
  if (!screen || screen.scrollTop > 0) return;
  ptrActive = true; ptrPid = e.pointerId; ptrStartY = e.clientY; ptrArmed = false;
});
document.addEventListener('pointermove', (e) => {
  if (!ptrActive || e.pointerId !== ptrPid) return;
  const raw = e.clientY - ptrStartY;
  if (raw <= 0) { ptrActive = false; return; }
  const dist = Math.min(PTR_MAX, ptrDist(raw));
  const ptr = document.getElementById('ptr');
  if (!ptr) return;
  ptr.style.transition = 'none';
  ptr.style.height = dist + 'px';
  const spinner = ptr.querySelector('.ptr-spinner');
  if (spinner) spinner.style.transform = `rotate(${(dist / PTR_MAX) * 270}deg)`;
  if (!ptrArmed && dist >= PTR_THRESHOLD) {
    ptrArmed = true;
    if (navigator.vibrate) navigator.vibrate(12);
  }
});
['pointerup', 'pointercancel'].forEach((evt) => document.addEventListener(evt, (e) => {
  if (!ptrActive || e.pointerId !== ptrPid) return;
  ptrActive = false; ptrPid = null;
  if (ptrArmed && !ptrSyncing) {
    ptrArmed = false;
    ptrSyncing = true;
    document.getElementById('ptr')?.classList.add('ptr-spinning');
    ptrTimeout = setTimeout(ptrCollapse, 4000);
    syncOnce().then(ptrCollapse);
  } else {
    ptrArmed = false;
    ptrReset();
  }
}));
```

- [ ] **Step 7: Run test to confirm it passes**

```
node tests/adr0002-ptr.test.js
```

Expected: all checks PASS.

If `#ptr collapses to 0 after below-threshold release` fails: check that `ptrReset()` is wired into the non-armed `pointerup` path.

If `vibrate(12) fires exactly once at threshold crossing` fails: verify `ptrArmed` is set only once per gesture (the `if (!ptrArmed && dist >= PTR_THRESHOLD)` guard).

If `#ptr collapses after 4s timeout` fails: the timeout is 4000ms and the test waits 4400ms. If test timing is flaky, increase the test wait to 4600ms.

- [ ] **Step 8: Run the full test suite to check for regressions**

```
node tests/run.js
```

Expected: all existing suites (spinner, persistence, etc.) still pass. The new test files (`adr0002-*.test.js`) are auto-discovered by `tests/run.js` because it scans for `*.test.js`.

- [ ] **Step 9: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%M)
sed -i "s|content=\"[^\"]*\">\(\s*\)<!-- Must match VERSION in sw.js -->|content=\"${TS}\"><!-- Must match VERSION in sw.js -->|" index.html
sed -i "s|const VERSION = 'hearth-[^']*'|const VERSION = 'hearth-${TS}'|" sw.js
grep 'name="version"' index.html
grep 'const VERSION' sw.js
```

```bash
git add js/app.js styles.css index.html sw.js tests/adr0002-ptr.test.js
git commit -m "feat(app): pull-to-refresh gesture with push-down indicator"
```

---

## Self-Review

### Spec coverage

| ADR requirement | Task |
|---|---|
| Pull-to-refresh gesture, pointerdown/pointermove/pointerup on `.screen` | Task 3 |
| Gate on `scrollTop === 0` | Task 3, Step 6 |
| Two-phase resistance (1:1 to 40px, 0.5 after, cap 80px) | Task 3, Step 6 `ptrDist()` |
| Trigger at 70px | Task 3, Step 6 `PTR_THRESHOLD = 70` |
| `navigator.vibrate(12)` at threshold crossing (fires once) | Task 3, Step 6 |
| Indicator pushes content down (not overlay) | Task 3 — `#ptr` as flex sibling before `#view` |
| `refresh-cw` icon, rotating proportionally to pull | Task 3 — `rotate(dist/PTR_MAX * 270deg)` |
| Continuous spin while syncing | Task 3 — `.ptr-spinning` class + `@keyframes spin` |
| 4s safety timeout | Task 3 — `setTimeout(ptrCollapse, 4000)` |
| Reduced-motion: spin replaced by pulse, drag-rotation exempt | Task 3 — `@media (prefers-reduced-motion: reduce)` CSS |
| Calls `syncOnce()` — no new sync logic | Task 3 — `syncOnce().then(ptrCollapse)` |
| No library, no per-view wiring | Task 3 — single `document.addEventListener` block in app.js |
| `animateGrow` helper in `fx.js` | Task 2 |
| `.bar` scaleY(0→1) staggered 35ms/bar | Task 2 `enterTrends()` |
| Ring circles strokeDasharray 0→finalDA staggered | Task 2 `enterSleep()` |
| Growth polyline stroke-dashoffset draw-on | Task 2 `enterGrowth()` |
| Growth area polygon fade | Task 2 `enterGrowth()` polygon opacity |
| Growth dots fade+scale staggered | Task 2 `enterGrowth()` dots |
| Replay on every tab switch, not just first | Task 2 — in `router.go()` unconditionally |
| `prefers-reduced-motion` skips WAAPI | Task 2 — `animateGrow` checks `reducedMotion` |
| Spinner `vibrate(3)` per row crossing | Task 1 |
| 3ms < 12ms (subtle tick) | Task 1 — explicit value |
| Only haptic (no sound per row) | Task 1 — only `vibrate`, no `tick()` call |

### Placeholder scan

No TBD, no "similar to Task N", no steps without code. ✓

### Type consistency

- `animateGrow(el, keyframes, delayMs?)` — same signature used in app.js. ✓
- `ptrCollapse()` — called by both `setTimeout` and `syncOnce().then()`. Guard `if (!ptrSyncing) return` prevents double-run. ✓
- `enterTrends/Sleep/Growth` — all query `#view` descendents after innerHTML is set. ✓
- `polyline.getTotalLength()` — standard DOM API; `lineChart()` returns the HTML string with `<polyline>` element. ✓
- `circle.getAttribute('stroke-dasharray')` — attribute is set in inline HTML from `sleep.js`; always present on the segment circles. ✓
