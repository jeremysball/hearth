# Prediction Source Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show parents, via a small tappable icon next to the SweetSpot prediction caption, whether the nap-window prediction is a generic population estimate, a blend, or personalized to their baby's own logged naps.

**Architecture:** A new pure function `predictionSourceInfo(prediction)` in `js/sleep.js` maps the existing `source`/`sampleSize` fields (already returned by `derive.wakeWindowPrediction()` in `js/store.js`) to display copy and a CSS class. Both `js/home.js` (hero rail) and `js/sleep.js` (SweetSpot schedule header) render a small `#info`-icon button next to their existing caption text, styled by that class. A new `prediction:info` delegated click action in `js/app.js` opens a `sheet.open()` popup with the mapped copy.

**Tech Stack:** Vanilla JS ES modules, existing `sheet.open()`/`data-action` patterns, no new dependencies.

## Global Constraints

- Reuse the existing `#info` sprite icon in `index.html` — do not vendor a new icon.
- `data-action` values follow the `verb:noun` convention already used throughout `app.js`.
- Run `scripts/bump-version.sh` before the final commit — this branch touches cached frontend assets (`js/`, `styles.css`).
- Test commands to run for touched files: `node --test js/store.test.js js/sleep.test.js js/home.test.js`, and `npm run check`.

---

### Task 1: `predictionSourceInfo()` helper + unit tests

**Files:**
- Modify: `js/sleep.js` (add function near top, after imports)
- Test: `js/sleep.test.js` (append new tests)

**Interfaces:**
- Produces: `predictionSourceInfo(prediction)` — exported function. Takes a `prediction` object shaped like the return of `derive.wakeWindowPrediction()`: `{ source: 'population'|'blend'|'personal'|undefined, sampleSize: number|undefined }` (other fields ignored). Returns `{ cls: string, heading: string, body: string }`. Reads `state().baby.name` internally (falls back to `'your baby'`).

- [ ] **Step 1: Write the failing tests**

Add to `js/sleep.test.js` (after the existing imports, alongside the other `test(...)` blocks):

```js
test('predictionSourceInfo: population source reads as generic estimate', () => {
  reset();
  const info = predictionSourceInfo({ source: 'population', sampleSize: 0 });
  assert.equal(info.cls, 'src-generic');
  assert.equal(info.heading, 'Generic estimate');
  assert.match(info.body, /typical timing for this age/);
});

test('predictionSourceInfo: blend source reads as learning and reports sample size', () => {
  reset();
  state().baby.name = 'Rae';
  const info = predictionSourceInfo({ source: 'blend', sampleSize: 9 });
  assert.equal(info.cls, 'src-learning');
  assert.equal(info.heading, "Learning Rae's pattern");
  assert.match(info.body, /9 naps logged/);
});

test('predictionSourceInfo: blend source uses singular "nap" for sampleSize of 1', () => {
  reset();
  const info = predictionSourceInfo({ source: 'blend', sampleSize: 1 });
  assert.match(info.body, /1 nap logged/);
  assert.doesNotMatch(info.body, /1 naps logged/);
});

test('predictionSourceInfo: personal source reads as personalized and reports sample size', () => {
  reset();
  state().baby.name = 'Rae';
  const info = predictionSourceInfo({ source: 'personal', sampleSize: 32 });
  assert.equal(info.cls, 'src-personal');
  assert.equal(info.heading, "Personalized to Rae");
  assert.match(info.body, /32 naps logged/);
});

test('predictionSourceInfo: missing/unknown source falls back to generic', () => {
  reset();
  const info = predictionSourceInfo({});
  assert.equal(info.cls, 'src-generic');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test js/sleep.test.js`
Expected: FAIL — `predictionSourceInfo is not defined` (not yet imported/exported).

- [ ] **Step 3: Implement `predictionSourceInfo()` in `js/sleep.js`**

Add this function after the existing imports in `js/sleep.js` (below `import { fmt } from './ui.js';`), and export it:

```js
export function predictionSourceInfo(prediction) {
  const name = state().baby.name || 'your baby';
  const n = prediction?.sampleSize || 0;
  if (prediction?.source === 'personal') {
    return {
      cls: 'src-personal',
      heading: `Personalized to ${name}`,
      body: `Based on ${name}'s own nap pattern from the last 21 days (${n} naps logged).`,
    };
  }
  if (prediction?.source === 'blend') {
    return {
      cls: 'src-learning',
      heading: `Learning ${name}'s pattern`,
      body: `Blending ${name}'s own naps with typical ranges for this age (${n} nap${n === 1 ? '' : 's'} logged in the last 21 days). Personalizes further as you log more.`,
    };
  }
  return {
    cls: 'src-generic',
    heading: 'Generic estimate',
    body: `Not enough naps logged yet, so this window uses typical timing for this age. Log a few more naps to personalize it.`,
  };
}
```

Also update the test file's import line to include the new export:

```js
const { sleep, predictionSourceInfo } = await import('./sleep.js');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test js/sleep.test.js`
Expected: PASS — all 5 new tests plus existing `sleep.test.js` tests green.

- [ ] **Step 5: Commit**

```bash
git add js/sleep.js js/sleep.test.js
git commit -m "feat(sleep): add predictionSourceInfo helper for SweetSpot source copy"
```

---

### Task 2: Wire the indicator into the sleep view's SweetSpot schedule header

**Files:**
- Modify: `js/sleep.js:127` (the `.chart-hd` line inside the `sched-card`)
- Modify: `js/app.js` (add `derive` to the `store.js` import, add `openPredictionInfo()`, add `prediction:info` to the action map)
- Test: `js/sleep.test.js` (append new test)

**Interfaces:**
- Consumes: `predictionSourceInfo(prediction)` from Task 1 (same file, no import needed inside `sleep.js` itself).
- Consumes: `sheet.open(html, opts)` from `js/ui.js` (already imported in `app.js` as `sheet`).
- Consumes: `derive.sweetSpot()` from `js/store.js` — returns `{ ..., prediction }`.
- Produces: `openPredictionInfo()` in `js/app.js` — no params, reads current `derive.sweetSpot().prediction`, opens a sheet. Later tasks (Task 3) reuse the same `prediction:info` action, so this function must handle being called from either view without needing view-specific args.

- [ ] **Step 1: Write the failing test**

Add to `js/sleep.test.js`:

```js
test('sleep view renders a prediction source info button in the SweetSpot schedule header', () => {
  reset();
  const html = withMockedNow('2026-01-01T09:00:00', () => sleep());

  assert.match(html, /data-action="prediction:info"/);
  assert.match(html, /class="src-info-btn src-generic"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test js/sleep.test.js`
Expected: FAIL — no `data-action="prediction:info"` in output yet.

- [ ] **Step 3: Update the `.chart-hd` markup in `js/sleep.js`**

Replace this line (currently at `js/sleep.js:127`):

```js
      <div class="chart-hd"><h2>SweetSpot schedule</h2><span class="chart-note">${derive.sweetSpot().prediction?.label || 'sleep clock active'}</span></div>
```

with:

```js
      <div class="chart-hd"><h2>SweetSpot schedule</h2><span class="chart-note">${derive.sweetSpot().prediction?.label || 'sleep clock active'}${derive.sweetSpot().prediction ? `<button class="src-info-btn ${predictionSourceInfo(derive.sweetSpot().prediction).cls}" data-action="prediction:info" aria-label="About this prediction"><svg class="icon"><use href="#info"></use></svg></button>` : ''}</span></div>
```

- [ ] **Step 4: Add `prediction:info` handling in `js/app.js`**

In `js/app.js`, update the `store.js` import (currently line 2) to include `derive`:

```js
import { state, save, reset, addEntry, removeEntry, removeMeasure, enqueueBabySync, enqueueSettingsSync, applySyncResponse, markSynced, setSyncTrigger, derive } from './store.js';
```

Update the `sleep.js` import (currently line 8) to include the new named export:

```js
import { sleep, predictionSourceInfo } from './sleep.js';
```

Add a new function near `openBabyPhoto()` (around `js/app.js:160`):

```js
function openPredictionInfo() {
  const prediction = derive.sweetSpot().prediction;
  if (!prediction) return;
  const info = predictionSourceInfo(prediction);
  sheet.open(`<p>${esc(info.body)}</p>`, { title: info.heading });
}
```

Add to the `map` object inside the click delegation handler (near the other `entry:*`/`baby:*` entries, e.g. after `'baby:photo': () => openBabyPhoto(),`):

```js
    'prediction:info': () => openPredictionInfo(),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test js/sleep.test.js`
Expected: PASS

- [ ] **Step 6: Manual smoke check**

Run: `npm run check` (catches syntax errors from the multi-line template edit)
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add js/sleep.js js/app.js js/sleep.test.js
git commit -m "feat(sleep): show prediction source indicator on SweetSpot schedule"
```

---

### Task 3: Wire the indicator into the home hero rail

**Files:**
- Modify: `js/home.js:265` (the `.sh-rail-cap` line inside `heroCard()`)
- Test: `js/home.test.js` (append new test)

**Interfaces:**
- Consumes: `predictionSourceInfo(prediction)` — import from `./sleep.js` into `js/home.js`.
- Consumes: `prediction:info` action already wired in `js/app.js` (Task 2) — no changes needed there since `openPredictionInfo()` re-derives the current prediction from `derive.sweetSpot()` rather than taking a passed-in value.

- [ ] **Step 1: Write the failing test**

`js/home.test.js` currently has no `withMockedNow` helper and no `reset`/`home` imports — it only imports `bathDaysSinceLabel`. Add the helper (copy the exact implementation already used in `js/sleep.test.js:19-29`) and extend the import line.

Change this line (currently `js/home.test.js:11`):

```js
const { bathDaysSinceLabel } = await import('./home.js');
```

to:

```js
const { bathDaysSinceLabel, home } = await import('./home.js');
const { reset } = await import('./store.js');
```

Add this helper after the import lines (same implementation as `js/sleep.test.js:19-29`):

```js
function withMockedNow(iso, fn) {
  const OrigDate = global.Date;
  const nowMs = new OrigDate(iso).getTime();
  class MockDate extends OrigDate {
    constructor(...args) { super(...(args.length ? args : [nowMs])); }
    static now() { return nowMs; }
  }
  global.Date = MockDate;
  try { return fn(); }
  finally { global.Date = OrigDate; }
}
```

Then add the test. A fresh `reset()` state has no birthdate, so `ageWeeks()` returns `null` and `derive.sweetSpot()`'s newborn check (`w !== null && w < 6`) is skipped; at `09:00` `wakePosition()` returns `'first'` (not `'night'`), and with no logged sleep `derive.status()` defaults to awake since `Date.now() - 80min` — so `heroCard()` reaches the awake/non-night/non-newborn branch that renders `.sh-rail-cap`:

```js
test('home hero rail renders a prediction source info button while awake', () => {
  reset();
  const html = withMockedNow('2026-01-01T09:00:00', () => home());

  assert.match(html, /data-action="prediction:info"/);
  assert.match(html, /class="src-info-btn src-generic"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test js/home.test.js`
Expected: FAIL — no `data-action="prediction:info"` in output yet.

- [ ] **Step 3: Update the import and `.sh-rail-cap` markup in `js/home.js`**

Update the `sleep.js` import — currently `js/home.js` does not import from `sleep.js` at all, so add a new import line near the top (after the existing `store.js`/`ui.js` imports):

```js
import { predictionSourceInfo } from './sleep.js';
```

Replace this line (currently at `js/home.js:265`):

```js
      <div class="sh-rail-cap"><span>${fmt.clock(st.since)}</span><span>${sp.prediction.label}</span></div>
```

with:

```js
      <div class="sh-rail-cap"><span>${fmt.clock(st.since)}</span><span>${sp.prediction.label}<button class="src-info-btn ${predictionSourceInfo(sp.prediction).cls}" data-action="prediction:info" aria-label="About this prediction"><svg class="icon"><use href="#info"></use></svg></button></span></div>
```

(`sp.prediction` is guaranteed non-null in this branch of `heroCard()` — it's only reached after the `sp.night`, `sp.newborn`, and `asleep` early returns above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test js/home.test.js`
Expected: PASS

- [ ] **Step 5: Check for an import cycle**

`js/sleep.js` does not import from `js/home.js`, so `js/home.js` importing from `js/sleep.js` is a one-directional edge and safe. Confirm with:

Run: `rg -n "from './home.js'" js/sleep.js`
Expected: no output (empty)

- [ ] **Step 6: Commit**

```bash
git add js/home.js js/home.test.js
git commit -m "feat(home): show prediction source indicator on hero rail"
```

---

### Task 4: Styles, full test run, version bump

**Files:**
- Modify: `styles.css` (add new rules near the existing `.chart-note` / `.sh-rail-cap` rules)

**Interfaces:**
- Consumes: `.src-info-btn`, `.src-generic`, `.src-learning`, `.src-personal` class names produced by `predictionSourceInfo()` (Task 1) and rendered in Tasks 2–3.

- [ ] **Step 1: Add CSS rules**

Add after the `.chart-note` rule (`styles.css:649`):

```css
.src-info-btn { all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; width: 1.4em; height: 1.4em; margin-left: 4px; vertical-align: -0.3em; font-size: inherit; }
.src-info-btn .icon { width: 0.9em; height: 0.9em; }
.src-generic { color: var(--muted); opacity: 0.55; }
.src-learning { color: oklch(0.70 0.15 70); opacity: 0.8; }
.src-personal { color: oklch(0.78 0.15 85); opacity: 1; }
```

- [ ] **Step 2: Visual check**

Run: `/run` (the Hearth dev-server skill) or start the server manually and open the app in a browser. Confirm:
- Home screen hero rail shows a small info icon after the SweetSpot caption while awake (not asleep/night/newborn).
- Sleep tab's "SweetSpot schedule" card header shows the same icon.
- Tapping either opens a sheet with a heading and one sentence of body copy.
- With a fresh/reset app (no logged naps), the icon renders dim/muted (`src-generic`).

- [ ] **Step 3: Run the full touched-file test suite**

Run: `node --test js/store.test.js js/sleep.test.js js/home.test.js`
Expected: all PASS

Run: `npm run check`
Expected: no errors

- [ ] **Step 4: Run relevant Playwright suites**

Check which Playwright suites under `tests/` touch `home.js` or `sleep.js` rendering (e.g. anything asserting on hero rail or sched-card markup):

Run: `rg -l "sh-rail-cap|sched-card|SweetSpot" tests/*.test.js`

For each match, run it individually, e.g.:

Run: `node tests/<matched-file>.test.js`
Expected: all PASS (or pre-existing failures confirmed unchanged via `git stash` + re-run, per project convention)

- [ ] **Step 5: Bump version**

Run: `scripts/bump-version.sh`
Expected: prints updated `index.html` and `sw.js` version lines.

- [ ] **Step 6: Commit**

```bash
git add styles.css index.html sw.js
git commit -m "feat(sleep): style prediction source indicator icon states"
```

---

## Post-plan

After Task 4, hand off to `superpowers:finishing-a-development-branch` to decide how to merge (this branch is `feat/prediction-source-indicator`, based on `main`).
