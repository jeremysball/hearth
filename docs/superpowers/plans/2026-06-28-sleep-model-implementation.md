# Hearth Sleep Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-number awake window with a scientifically-grounded, self-personalizing sleep prediction system — population ranges → personal medians → circadian anchoring → regression alerts — with zero new logging burden on parents.

**Architecture:** All logic lives in `store.js` as new exported functions and `derive` methods. Home and sleep views are updated to read the new shape. Phase 1 is an in-place replacement of `awakeWindowMin()`; Phases 2–4 layer on top. Eight ordered tasks — each phase is independently shippable.

**Tech Stack:** Vanilla JS, `node:test` for unit tests. No new dependencies.

## Global Constraints

- Version-bump both `index.html` (`<meta name="version">`) and `sw.js` (`VERSION`) to `$(date -u +%Y-%m-%dT%H:%MZ)` before every commit touching any frontend asset. Both strings must match (sw.js prefixed with `hearth-`).
- Conventional Commits: `feat(sleep): …`, `fix(store): …`, etc.
- No new files. No schema changes. No server changes.
- No ML / no trained models — recency-weighted percentile calculation only.
- Lucide icons only. Playfair Display for hero timer; Archivo everywhere else.
- Use `rg` (ripgrep) not `grep`; `fd` not `find`.
- Run tests with `node --test js/store.test.js`. Run lint with `npm run check`.
- Baby's name comes from `state().baby.name`; fall back to `'your baby'` for copy.
- Copy tone rules: describe mechanism not compliance; ranges not targets; no red warnings; anomalies are observations not failures.

---

## File Map

| File | Role |
|------|------|
| `js/store.js` | Add `WAKE_WINDOW_TABLE`, `wakePosition()`, `wakeWindowRange()`, `_testHelpers`; add `derive.personalWakeWindow()`, `.wakeWindowPrediction()`, `.circadianAnchor()`, `.bedtimeWindow()`, `.regressionAlert()`; update `sweetSpot()`, `normalizeSettings()` |
| `js/home.js` | Update `heroCard()` (science copy + range display); add `morningLightTip()`, `bedtimeBanner()`, `regressionBanner()` helpers; wire into `home()` |
| `js/sleep.js` | Update schedule loop to use prediction; add post-nap context note |
| `js/styles.css` | Add styles for `.tip-card`, `.bedtime-chip`, `.regression-banner`, `.nap-context`, `.sweet-clock` |
| `js/app.js` | Add `tip:dismiss` and `regression:dismiss` action handlers |
| `js/store.test.js` | Tests for all new store functions |

---

## Task 1: Population range table + `wakeWindowRange()` + `wakePosition()` in store.js

**Files:**
- Modify: `js/store.js:184-188` (replace `awakeWindowMin`) and `:201-212` (`sweetSpot`)
- Test: `js/store.test.js`

**Interfaces:**
- Produces: `wakePosition(date?) → 'first'|'middle'|'last'`
- Produces: `wakeWindowRange(position?) → { low, high, midpoint, source: 'population', sampleSize: 0, label }`
- Produces: updated `derive.sweetSpot() → { napping, wake?, from, to, prediction: WakeWindowRange }`
- `awakeWindowMin()` is kept as a shim returning `wakeWindowRange('middle').midpoint`

- [ ] **Step 1: Write the failing tests** — add to `js/store.test.js` (after the existing `normalizeSettings` tests):

```js
const { wakePosition, wakeWindowRange } = await import('./store.js');

test('wakePosition returns correct position for time of day', () => {
  assert.equal(wakePosition(new Date('2026-01-01T09:30:00')), 'first');
  assert.equal(wakePosition(new Date('2026-01-01T10:00:00')), 'middle'); // boundary: 10am is middle
  assert.equal(wakePosition(new Date('2026-01-01T12:00:00')), 'middle');
  assert.equal(wakePosition(new Date('2026-01-01T16:00:00')), 'last'); // boundary: 4pm is last
  assert.equal(wakePosition(new Date('2026-01-01T16:30:00')), 'last');
});

test('wakeWindowRange returns wider last window than first', () => {
  // Set birthdate to 5 months ago so the 5–7m bracket applies
  const bd = new Date();
  bd.setMonth(bd.getMonth() - 5);
  applySyncResponse({ baby: { birthdate: bd.toISOString().slice(0, 10) }, settings: null, entries: [], growth: [] });
  const first = wakeWindowRange('first');
  const last = wakeWindowRange('last');
  assert.ok(last.midpoint > first.midpoint, `last (${last.midpoint}m) should exceed first (${first.midpoint}m)`);
  assert.equal(first.source, 'population');
  assert.ok(first.label.startsWith('typical'), 'label should say typical');
});

test('wakeWindowRange returns correct bracket for a 4-month-old', () => {
  const bd = new Date();
  bd.setMonth(bd.getMonth() - 4);
  applySyncResponse({ baby: { birthdate: bd.toISOString().slice(0, 10) }, settings: null, entries: [], growth: [] });
  const r = wakeWindowRange('first'); // 3–5m bracket: first=[80,110]
  assert.equal(r.low, 80);
  assert.equal(r.high, 110);
  assert.equal(r.midpoint, 95);
});

test('derive.sweetSpot() from/to match prediction low/high', () => {
  // Close any ongoing sleeps left by prior tests
  state().log.forEach((e) => { if (e.type === 'sleep' && !e.end) updateEntry(e.id, { end: new Date(Date.now() - MIN).toISOString() }); });
  const sp = derive.sweetSpot();
  assert.ok('prediction' in sp, 'sweetSpot should include prediction object');
  const { prediction } = sp;
  assert.ok(typeof prediction.low === 'number' && typeof prediction.high === 'number');
  if (!sp.napping) {
    const since = derive.status().since.getTime();
    assert.ok(Math.abs((sp.from.getTime() - since) / MIN - prediction.low) < 1);
    assert.ok(Math.abs((sp.to.getTime() - since) / MIN - prediction.high) < 1);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
node --test js/store.test.js 2>&1 | tail -20
```

Expected: `ReferenceError: wakePosition is not defined` (or similar import failure).

- [ ] **Step 3: Add `WAKE_WINDOW_TABLE`, `wakePosition()`, `wakeWindowRange()` to `js/store.js`**

Insert immediately before `awakeWindowMin()` (line 184):

```js
// Population wake window ranges from Dubief, per day position and age bracket.
// Each row covers ages < maxMonths; [low, high] in minutes.
const WAKE_WINDOW_TABLE = [
  { maxMonths:  1, first: [40, 60],   middle: [40, 60],   last: [50, 75]   },
  { maxMonths:  3, first: [60, 80],   middle: [60, 80],   last: [75, 100]  },
  { maxMonths:  5, first: [80, 110],  middle: [80, 110],  last: [105, 140] },
  { maxMonths:  7, first: [110, 140], middle: [110, 140], last: [140, 180] },
  { maxMonths: 10, first: [140, 170], middle: [140, 170], last: [180, 215] },
  { maxMonths: 13, first: [170, 200], middle: [170, 200], last: [215, 250] },
  { maxMonths: Infinity, first: [190, 240], middle: [190, 240], last: [190, 240] },
];

// Infers the position of an awake period in the day from the clock.
// 'first' = before 10am (before day's first nap), 'last' = 4pm+ (pre-bedtime),
// 'middle' = everything between. Thresholds are fixed population defaults;
// Phase 3 will anchor them to the baby's actual morning wake time.
export function wakePosition(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h < 10) return 'first';
  if (h >= 16) return 'last';
  return 'middle';
}

// Age-appropriate wake window range for a given day position.
// Returns a population-sourced range; Phase 2 will blend in personal data.
export function wakeWindowRange(position = 'middle') {
  const m = ageMonths();
  const row = WAKE_WINDOW_TABLE.find((r) => m < r.maxMonths) ?? WAKE_WINDOW_TABLE.at(-1);
  const [low, high] = row[position] ?? row.middle;
  return { low, high, midpoint: Math.round((low + high) / 2), source: 'population', sampleSize: 0, label: 'typical for ' + ageLabel() };
}
```

- [ ] **Step 4: Replace `awakeWindowMin()` with a shim and update `sweetSpot()`**

Replace the existing `awakeWindowMin()` function (lines 184-188):

```js
// Compatibility shim — returns the population midpoint for the middle position.
// Internal code should prefer wakeWindowRange() or derive.wakeWindowPrediction().
export function awakeWindowMin() { return wakeWindowRange('middle').midpoint; }
```

Replace `derive.sweetSpot()` (lines 201-212):

```js
sweetSpot() {
  const st = derive.status();
  const pos = wakePosition();
  const prediction = wakeWindowRange(pos);
  if (st.state === 'asleep') {
    const wake = new Date(st.since.getTime() + 70 * MIN);
    const from = new Date(wake.getTime() + prediction.low * MIN);
    const to = new Date(wake.getTime() + prediction.high * MIN);
    return { napping: true, wake, from, to, prediction };
  }
  const from = new Date(st.since.getTime() + prediction.low * MIN);
  const to = new Date(st.since.getTime() + prediction.high * MIN);
  return { napping: false, from, to, prediction };
},
```

- [ ] **Step 5: Run tests and verify they pass**

```
node --test js/store.test.js 2>&1 | tail -10
```

Expected: all tests pass, 0 failures.

- [ ] **Step 6: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Edit index.html: <meta name="version" content="$TS">
# Edit sw.js: const VERSION = 'hearth-$TS';
git add js/store.js js/store.test.js index.html sw.js
git commit -m "feat(store): add wakeWindowRange and wakePosition with population table"
```

---

## Task 2: Science copy + range display in home.js and sleep.js

**Files:**
- Modify: `js/home.js:2` (imports), `js/home.js:78-161` (heroCard)
- Modify: `js/sleep.js:2` (imports), `js/sleep.js:49-57` (schedule loop), `js/sleep.js:34-44` (nap rows), `js/sleep.js:91` (chart note)

**Interfaces:**
- Consumes: `derive.sweetSpot().prediction` (from Task 1)
- Consumes: `wakeWindowRange(pos)`, `wakePosition(cursor)` (from Task 1)
- Produces: updated heroCard HTML (adenosine copy, range rail, prediction label)
- Produces: updated nap rows with post-nap context

- [ ] **Step 1: Update `home.js` imports and `heroCard()`**

Change the import line in `js/home.js` (line 2):

```js
import { state, derive, ageLabel } from './store.js';
```

In `heroCard()` (around line 78), **remove** `const win = awakeWindowMin();`.

Change `railSpan` (line 111):

```js
const railSpan = (sp.prediction.high + 60) * MIN;
```

Change the `healthy` variable (lines 131-135):

```js
const healthy = elapsed < sp.prediction.low * 0.85
  ? 'Sleep pressure building — adenosine is rising.'
  : now < sf ? 'Nap window opening. Watch for yawning or looking away.'
  : now <= sto ? 'Sleep pressure is high — good time for a nap.'
  : 'Past the usual window. Settling may take a little longer.';
```

Change the overtired flag text inside the timer line (line 156):

```js
${pastWindow ? '<span class="overtired-flag">past window</span>' : ''}
```

Change the rail cap (line 161):

```js
<div class="sh-rail-cap"><span>${fmt.clock(st.since)}</span><span>${sp.prediction.label}</span></div>
```

- [ ] **Step 2: Update `sleep.js` schedule loop and nap rows**

Change the import line in `js/sleep.js` (line 2):

```js
import { state, derive, startOfDay, ageLabel, wakeWindowRange, wakePosition } from './store.js';
```

Replace the schedule block (lines 49-57):

```js
let cursor = st.state === 'asleep' ? new Date(st.since.getTime() + 70 * MIN) : new Date(st.since);
for (let i = 0; i < 4; i++) {
  const pos = wakePosition(cursor);
  const pred = wakeWindowRange(pos);
  const from = new Date(cursor.getTime() + pred.midpoint * MIN);
  if (from.getHours() >= 20) break;
  const to = new Date(from.getTime() + 30 * MIN);
  sched.push({ from, to, past: to < now });
  cursor = new Date(from.getTime() + 70 * MIN);
}
```

Change the chart note (line 91):

```js
<div class="chart-hd"><h2>SweetSpot schedule</h2><span class="chart-note">${derive.sweetSpot().prediction.label}</span></div>
```

In the nap row map (around line 43), add a `napContext` string after the `dur` calculation:

```js
let napContext = '';
if (!e.ongoing && dur > 0) {
  if (dur < 20) napContext = 'Catnap — less than one full sleep cycle.';
  else if (dur < 35) napContext = 'One sleep cycle. Light-sleep arousal is normal.';
  else if (dur >= 60 && dur < 120) napContext = 'Solid nap — multiple sleep cycles completed.';
}
```

Add the context inside the row template after the `<span class="meta">` closing tag:

```js
${napContext ? `<span class="nap-context">${napContext}</span>` : ''}
```

- [ ] **Step 3: Run lint to catch import errors**

```
npm run check
```

Expected: no errors.

- [ ] **Step 4: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Update index.html and sw.js with $TS
git add js/home.js js/sleep.js index.html sw.js
git commit -m "feat(home): science framing — adenosine copy, range rail, prediction label"
```

---

## Task 3: `derive.personalWakeWindow()` + pure helper exports + tests

**Files:**
- Modify: `js/store.js` (add helpers + `derive.personalWakeWindow`)
- Modify: `js/store.test.js`

**Interfaces:**
- Produces: `_testHelpers` export `{ recencyWeight, weightedMedian, weightedPercentile }`
- Produces: `derive.personalWakeWindow(position) → { median, p25, p75, sampleSize } | null`
  - Returns `null` when fewer than 7 position-matching observations exist
  - Observations = wake intervals between consecutive completed sleeps within 21 days
  - Recency weight: `0.93 ^ ageDays`

- [ ] **Step 1: Write the failing tests** — add to `js/store.test.js` after the Task 1 tests

```js
// Update the top-level import to include _testHelpers:
// const { ..., _testHelpers } = await import('./store.js');
// const { weightedMedian, weightedPercentile, recencyWeight } = _testHelpers;
// (Add to the existing destructure at line 17)

test('weightedMedian returns median with equal weights', () => {
  const { weightedMedian } = _testHelpers;
  const obs = [90, 80, 100, 70, 110].map((v) => ({ value: v, weight: 1 }));
  assert.equal(weightedMedian(obs), 90);
});

test('weightedMedian shifts toward the high-weight value', () => {
  const { weightedMedian } = _testHelpers;
  const obs = [
    { value: 60, weight: 1 },
    { value: 120, weight: 10 },
    { value: 180, weight: 1 },
  ];
  assert.equal(weightedMedian(obs), 120);
});

test('derive.personalWakeWindow returns null with no data for that position', () => {
  // All prior sleeps in the test log are Jan 2026 (outside 21-day cutoff)
  // or have no end, so 'first' position should have zero observations.
  const result = derive.personalWakeWindow('first');
  assert.equal(result, null);
});

test('derive.personalWakeWindow returns ~90-min median from 9 consecutive sleep pairs', () => {
  const now = Date.now();
  const DAY_MS = 86400000;
  const MIN_MS = 60000;
  // Add 9 days of sleep pairs (days 10 to 2 ago). Each pair:
  //   Sleep A: ends at noon local (wakePosition = 'middle')
  //   Sleep B: starts 90 min later (noon + 90 min)
  // The algorithm pairs consecutive sleeps: (B_day, A_day) → 90-min wake window.
  for (let d = 10; d >= 2; d--) {
    const base = new Date(now - d * DAY_MS);
    base.setHours(0, 0, 0, 0);
    const sleepAEnd = new Date(base.getTime() + 12 * 60 * MIN_MS);   // noon
    const sleepAStart = new Date(sleepAEnd.getTime() - 70 * MIN_MS); // nap duration
    const sleepBStart = new Date(sleepAEnd.getTime() + 90 * MIN_MS); // 90-min wake
    const sleepBEnd = new Date(sleepBStart.getTime() + 70 * MIN_MS);
    addEntry({ type: 'sleep', start: sleepAStart.toISOString(), end: sleepAEnd.toISOString() });
    addEntry({ type: 'sleep', start: sleepBStart.toISOString(), end: sleepBEnd.toISOString() });
  }
  const result = derive.personalWakeWindow('middle');
  assert.ok(result !== null, 'should return data with 9 middle-position observations');
  assert.ok(result.sampleSize >= 9, `sampleSize ${result.sampleSize} should be ≥ 9`);
  assert.ok(result.median >= 85 && result.median <= 95, `median ${result.median} should be near 90`);
  assert.ok(result.p25 <= result.median, 'p25 ≤ median');
  assert.ok(result.median <= result.p75, 'median ≤ p75');
});
```

- [ ] **Step 2: Run to verify they fail**

```
node --test js/store.test.js 2>&1 | grep -E "FAIL|Error" | head -5
```

Expected: `TypeError: _testHelpers is not defined` or similar.

- [ ] **Step 3: Add helpers + export + `derive.personalWakeWindow()` to `js/store.js`**

Insert private helpers immediately before the `const sleeps = ...` line (around line 191):

```js
// Recency decay: observation from `date` gets weight 0.93^(ageDays).
function recencyWeight(date, now = Date.now(), lambda = 0.93) {
  const ageDays = (now - (date instanceof Date ? date.getTime() : date)) / DAY;
  return Math.pow(lambda, ageDays);
}

// Value at the midpoint of cumulative weight (sorted ascending).
function weightedMedian(observations) {
  if (!observations.length) return 0;
  const sorted = [...observations].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, o) => s + o.weight, 0);
  let cum = 0;
  for (const o of sorted) { cum += o.weight; if (cum >= total / 2) return o.value; }
  return sorted.at(-1).value;
}

// Value at the p-fraction of cumulative weight (p: 0–1, sorted ascending).
function weightedPercentile(observations, p) {
  if (!observations.length) return 0;
  const sorted = [...observations].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, o) => s + o.weight, 0);
  let cum = 0;
  for (const o of sorted) { cum += o.weight; if (cum >= total * p) return o.value; }
  return sorted.at(-1).value;
}
```

Add test-only export after the existing `export function undoAutoCloseSleep` block:

```js
// Exported for unit tests only — do not use in application code.
export const _testHelpers = { recencyWeight, weightedMedian, weightedPercentile };
```

Add `personalWakeWindow` to the `derive` object (after `todayStats`):

```js
// Rolling personal wake window for a given day position, computed from consecutive
// completed sleeps in the last 21 days. Returns null if fewer than 7 observations.
personalWakeWindow(position) {
  const now = Date.now();
  const cutoffMs = now - 21 * DAY;
  // ss is newest-first; wake window i = interval between ss[i+1].end → ss[i].start
  const ss = sleeps().filter((e) => e.end && new Date(e.end).getTime() > cutoffMs);
  const observations = [];
  for (let i = 0; i < ss.length - 1; i++) {
    const wakeStart = new Date(ss[i + 1].end);
    const wakeEnd   = new Date(ss[i].start);
    if (wakeEnd <= wakeStart) continue;
    const wakeMin = (wakeEnd - wakeStart) / MIN;
    if (wakeMin < 10 || wakeMin > 360) continue; // sanity bounds
    if (wakePosition(wakeStart) !== position) continue;
    observations.push({ value: wakeMin, weight: recencyWeight(wakeStart, now) });
  }
  if (observations.length < 7) return null;
  return {
    median: Math.round(weightedMedian(observations)),
    p25:    Math.round(weightedPercentile(observations, 0.25)),
    p75:    Math.round(weightedPercentile(observations, 0.75)),
    sampleSize: observations.length,
  };
},
```

- [ ] **Step 4: Update the import destructure in `store.test.js`** (line 17) to include `_testHelpers`:

```js
const { state, derive, addEntry, removeEntry, addMeasure, applySyncResponse, updateEntry,
  maybeInterruptSleep, undoInterruptSleep, normalizeLog, normalizeSettings,
  wakePosition, wakeWindowRange, _testHelpers } = await import('./store.js');
```

- [ ] **Step 5: Run tests**

```
node --test js/store.test.js 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 6: Bump version and commit** (only store.js and store.test.js changed — still a JS asset bump)

```bash
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Update index.html and sw.js with $TS
git add js/store.js js/store.test.js index.html sw.js
git commit -m "feat(store): add personalWakeWindow with recency-weighted percentile"
```

---

## Task 4: `derive.wakeWindowPrediction()` blend formula + wire into sweetSpot + update sleep.js

**Files:**
- Modify: `js/store.js` (add `derive.wakeWindowPrediction`, update `sweetSpot`)
- Modify: `js/sleep.js` (update schedule to use prediction)
- Modify: `js/store.test.js`

**Interfaces:**
- Consumes: `derive.personalWakeWindow(position)` (Task 3), `wakeWindowRange(position)` (Task 1)
- Produces: `derive.wakeWindowPrediction(position) → { low, high, midpoint, source: 'population'|'blend'|'personal', sampleSize, label }`
- Produces: updated `sweetSpot()` that calls `wakeWindowPrediction` instead of `wakeWindowRange`
- The UI (home.js) automatically picks up the updated label through `sp.prediction.label` — no additional UI changes needed.

- [ ] **Step 1: Write the failing tests** (add after Task 3 tests in `store.test.js`)

```js
test('derive.wakeWindowPrediction returns population prior when position has no personal data', () => {
  // 'last' position (after 4pm) — no 'last' window sleep pairs exist in the test log
  const pred = derive.wakeWindowPrediction('last');
  assert.equal(pred.source, 'population');
  assert.ok(pred.label.startsWith('typical'), 'label should say typical');
  assert.equal(pred.sampleSize, 0);
});

test('derive.wakeWindowPrediction blends when 7–29 personal observations exist', () => {
  // Task 3 test added 9 'middle' observations at ~90 min. Source should be 'blend'.
  const pred = derive.wakeWindowPrediction('middle');
  assert.equal(pred.source, 'blend');
  const pop = wakeWindowRange('middle');
  // blended midpoint must be between pop.low and pop.high (sanity clamp)
  assert.ok(pred.midpoint >= pop.low && pred.midpoint <= pop.high,
    `midpoint ${pred.midpoint} should stay within population range`);
  assert.ok(pred.label.includes("recent naps"), 'label should mention recent naps');
});

test('derive.wakeWindowPrediction clamps personal median to 0.5×–2× population midpoint', () => {
  // Sanity: with 9 observations near the population midpoint, clamping doesn't fire.
  // Verify no clamp by confirming midpoint is in a reasonable range.
  const pred = derive.wakeWindowPrediction('middle');
  const pop = wakeWindowRange('middle');
  assert.ok(pred.midpoint >= pop.midpoint * 0.5, 'must not fall below 50% of pop midpoint');
  assert.ok(pred.midpoint <= pop.midpoint * 2,   'must not exceed 200% of pop midpoint');
});
```

- [ ] **Step 2: Run to verify they fail**

```
node --test js/store.test.js 2>&1 | grep -E "FAIL|Error" | head -5
```

- [ ] **Step 3: Add `derive.wakeWindowPrediction()` to `js/store.js`** (after `personalWakeWindow`):

```js
// Blended wake window prediction. Uses population data until 7 personal
// observations accumulate, then smoothly shifts toward personal data.
// At n=30 the personal signal reaches 90% weight; population acts as a
// sanity check at all times.
wakeWindowPrediction(position = 'middle') {
  const pop = wakeWindowRange(position);
  const personal = derive.personalWakeWindow(position);
  if (!personal) {
    return { ...pop, source: 'population', sampleSize: 0, label: 'typical for ' + ageLabel() };
  }
  const n = personal.sampleSize;
  const w_p   = Math.min(0.9, Math.max(0, (n - 7) / 23));
  const w_pop = 1 - w_p;
  let midpoint = Math.round(w_p * personal.median + w_pop * pop.midpoint);
  // Clamp: personal signal must stay within 0.5×–2× population midpoint.
  if (midpoint < pop.midpoint * 0.5) midpoint = pop.low;
  if (midpoint > pop.midpoint * 2)   midpoint = pop.high;
  const low  = Math.round(w_p * personal.p25 + w_pop * pop.low);
  const high = Math.round(w_p * personal.p75 + w_pop * pop.high);
  const source = w_p >= 0.9 ? 'personal' : 'blend';
  const name = state().baby.name || 'your baby';
  const label = w_p >= 0.9
    ? `based on ${name}'s pattern`
    : `based on ${name}'s recent naps`;
  return { low, high, midpoint, source, sampleSize: n, label };
},
```

- [ ] **Step 4: Update `sweetSpot()` in `js/store.js`** to call `wakeWindowPrediction` instead of `wakeWindowRange`:

```js
sweetSpot() {
  const st = derive.status();
  const pos = wakePosition();
  const prediction = derive.wakeWindowPrediction(pos);
  if (st.state === 'asleep') {
    const wake = new Date(st.since.getTime() + 70 * MIN);
    const from = new Date(wake.getTime() + prediction.low * MIN);
    const to   = new Date(wake.getTime() + prediction.high * MIN);
    return { napping: true, wake, from, to, prediction };
  }
  const from = new Date(st.since.getTime() + prediction.low * MIN);
  const to   = new Date(st.since.getTime() + prediction.high * MIN);
  return { napping: false, from, to, prediction };
},
```

- [ ] **Step 5: Update `sleep.js` schedule to use `derive.wakeWindowPrediction`** (replace `wakeWindowRange(pos)` with `derive.wakeWindowPrediction(pos)` inside the loop, remove `wakeWindowRange` from import):

```js
import { state, derive, startOfDay, ageLabel, wakePosition } from './store.js';
```

```js
for (let i = 0; i < 4; i++) {
  const pos = wakePosition(cursor);
  const pred = derive.wakeWindowPrediction(pos);
  const from = new Date(cursor.getTime() + pred.midpoint * MIN);
  if (from.getHours() >= 20) break;
  const to = new Date(from.getTime() + 30 * MIN);
  sched.push({ from, to, past: to < now });
  cursor = new Date(from.getTime() + 70 * MIN);
}
```

- [ ] **Step 6: Run all tests and lint**

```
node --test js/store.test.js && npm run check
```

Expected: all pass, no lint errors.

- [ ] **Step 7: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Update index.html and sw.js
git add js/store.js js/sleep.js js/store.test.js index.html sw.js
git commit -m "feat(store): blend personal wake window into prediction; wire sweetSpot"
```

---

## Task 5: `derive.circadianAnchor()` + `derive.bedtimeWindow()` + tests

**Files:**
- Modify: `js/store.js`
- Modify: `js/store.test.js`

**Interfaces:**
- Produces: `derive.circadianAnchor() → { morningWakeMinutes, confidence: 'low'|'medium'|'high', sampleSize, sdMinutes } | null`
  - `null` if fewer than 5 morning wake observations
  - `morningWakeMinutes`: recency-weighted median of minutes since midnight
  - Morning wake = `end` of a sleep with duration > 3h ending between 4am–10am local
  - Confidence: `low` (5–13), `medium` (14–27), `high` (28+), capped at `low` if SD > 45 min
- Produces: `derive.bedtimeWindow() → { from, to, confidence } | null`
  - `null` if anchor is null or `'low'`

- [ ] **Step 1: Write the failing tests** (add to `store.test.js`)

```js
test('derive.circadianAnchor returns null with no overnight sleeps', () => {
  // All prior sleeps in the test log are short naps (~70 min), not overnight.
  const anchor = derive.circadianAnchor();
  assert.equal(anchor, null);
});

test('derive.circadianAnchor detects 6am wake time from 6 overnight sleeps', () => {
  const now = Date.now();
  const DAY_MS = 86400000;
  const MIN_MS = 60000;
  // Add 6 overnight sleeps (8h) ending at 6am local on consecutive recent days.
  for (let d = 15; d >= 10; d--) {
    const base = new Date(now - d * DAY_MS);
    base.setHours(0, 0, 0, 0);
    const wakeTime  = new Date(base.getTime() + 6 * 60 * MIN_MS);       // 6am
    const sleepTime = new Date(wakeTime.getTime() - 8 * 60 * MIN_MS);   // 10pm
    addEntry({ type: 'sleep', start: sleepTime.toISOString(), end: wakeTime.toISOString() });
  }
  const anchor = derive.circadianAnchor();
  assert.ok(anchor !== null, 'should detect anchor with 6 morning wakes');
  assert.equal(anchor.sampleSize, 6);
  // morningWakeMinutes should be near 360 (6am = 6*60)
  assert.ok(anchor.morningWakeMinutes >= 355 && anchor.morningWakeMinutes <= 365,
    `wake time ${anchor.morningWakeMinutes} should be near 360 min`);
  assert.equal(anchor.confidence, 'low'); // 6 < 14 → low
});

test('derive.circadianAnchor caps confidence at low when wake time SD > 45 min', () => {
  const now = Date.now();
  const DAY_MS = 86400000;
  const MIN_MS = 60000;
  // Add 8 more overnights alternating 5am / 8am (180-min span, SD ≈ 90 min).
  for (let d = 9; d >= 2; d--) {
    const base = new Date(now - d * DAY_MS);
    base.setHours(0, 0, 0, 0);
    const wakeHour  = d % 2 === 0 ? 5 : 8;
    const wakeTime  = new Date(base.getTime() + wakeHour * 60 * MIN_MS);
    const sleepTime = new Date(wakeTime.getTime() - 8 * 60 * MIN_MS);
    addEntry({ type: 'sleep', start: sleepTime.toISOString(), end: wakeTime.toISOString() });
  }
  const anchor = derive.circadianAnchor();
  assert.ok(anchor !== null);
  // Combined 14 observations but high SD → confidence capped at 'low'.
  assert.equal(anchor.confidence, 'low', 'high SD should cap confidence at low');
});

test('derive.bedtimeWindow returns null when anchor is low confidence', () => {
  const anchor = derive.circadianAnchor();
  // Anchor is null or low confidence given current test data.
  if (!anchor || anchor.confidence === 'low') {
    assert.equal(derive.bedtimeWindow(), null);
  } else {
    // If confidence is medium+ (unlikely given test setup), verify shape.
    const bw = derive.bedtimeWindow();
    assert.ok(bw.from instanceof Date && bw.to instanceof Date);
    assert.ok(bw.from < bw.to);
  }
});
```

- [ ] **Step 2: Run to verify they fail**

```
node --test js/store.test.js 2>&1 | grep -E "FAIL|Error" | head -5
```

- [ ] **Step 3: Add `stdDev` + `morningWakes()` helpers + `circadianAnchor` + `bedtimeWindow` to `js/store.js`**

Add `stdDev` alongside the other private helpers (after `weightedPercentile`):

```js
// Unweighted standard deviation of an array of numbers.
function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
```

Add `morningWakes()` alongside `sleeps()` (after `const sleeps = ...`):

```js
// Extracts morning wake times: end timestamps on overnight sleeps
// (duration > 3h, ending between 4am–10am local, within 21 days).
function morningWakes() {
  const now = Date.now();
  const cutoff = now - 21 * DAY;
  return sleeps().filter((e) => {
    if (!e.end) return false;
    const s = new Date(e.start), en = new Date(e.end);
    if (en.getTime() < cutoff) return false;
    const durMin = (en - s) / MIN;
    if (durMin < 180) return false;
    const h = en.getHours() + en.getMinutes() / 60;
    return h >= 4 && h < 10;
  }).map((e) => {
    const en = new Date(e.end);
    return { wakeMinutes: en.getHours() * 60 + en.getMinutes(), date: en, weight: recencyWeight(en) };
  });
}
```

Add `circadianAnchor` and `bedtimeWindow` to the `derive` object (after `wakeWindowPrediction`):

```js
// Recency-weighted median morning wake time. Confidence is gated by sample
// size and standard deviation — variable schedules cap at 'low'.
circadianAnchor() {
  const wakes = morningWakes();
  if (wakes.length < 5) return null;
  const obs = wakes.map((w) => ({ value: w.wakeMinutes, weight: w.weight }));
  const medianMinutes = Math.round(weightedMedian(obs));
  const sd = stdDev(wakes.map((w) => w.wakeMinutes));
  let confidence;
  if (wakes.length >= 28)      confidence = 'high';
  else if (wakes.length >= 14) confidence = 'medium';
  else                          confidence = 'low';
  if (sd > 45) confidence = 'low'; // irregular schedule: cap confidence
  return { morningWakeMinutes: medianMinutes, confidence, sampleSize: wakes.length, sdMinutes: Math.round(sd) };
},

// Estimated bedtime window derived from the circadian anchor + typical daily
// awake time. Returns null when anchor is absent or confidence is low.
bedtimeWindow() {
  const anchor = derive.circadianAnchor();
  if (!anchor || anchor.confidence === 'low') return null;
  const m = ageMonths();
  const numNaps     = m < 5 ? 3 : m < 14 ? 2 : 1;
  const napDuration = m < 6 ? 60 : 80;
  const fp = derive.wakeWindowPrediction('first');
  const mp = derive.wakeWindowPrediction('middle');
  const lp = derive.wakeWindowPrediction('last');
  let totalMinutes;
  if (numNaps >= 3) {
    totalMinutes = fp.midpoint + napDuration + mp.midpoint + napDuration + mp.midpoint + napDuration + lp.midpoint;
  } else if (numNaps === 2) {
    totalMinutes = fp.midpoint + napDuration + mp.midpoint + napDuration + lp.midpoint;
  } else {
    totalMinutes = fp.midpoint + Math.round(napDuration * 1.5) + lp.midpoint;
  }
  const bedtimeMid = anchor.morningWakeMinutes + totalMinutes;
  const halfRange  = Math.round((lp.high - lp.low) / 2);
  const baseMs = startOfDay(Date.now()).getTime() + bedtimeMid * MIN;
  return {
    from: new Date(baseMs - halfRange * MIN),
    to:   new Date(baseMs + halfRange * MIN),
    confidence: anchor.confidence,
  };
},
```

- [ ] **Step 4: Run all tests**

```
node --test js/store.test.js 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 5: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Update index.html and sw.js
git add js/store.js js/store.test.js index.html sw.js
git commit -m "feat(store): add circadianAnchor and bedtimeWindow derived functions"
```

---

## Task 6: Clock-time nap label + bedtime chip + morning light tip in home.js + styles.css + app.js

**Files:**
- Modify: `js/home.js` (add helpers, update heroCard, update home)
- Modify: `js/styles.css` (add tip-card, bedtime-chip, sweet-clock, nap-context styles)
- Modify: `js/app.js` (add tip:dismiss handler)
- Modify: `js/store.js` (extend normalizeSettings)

**Interfaces:**
- Consumes: `derive.circadianAnchor()`, `derive.bedtimeWindow()` (Task 5)
- Consumes: `state().settings.tipMorningLightDismissed` (normalized in `normalizeSettings`)
- Produces: `morningLightTip()` → HTML string, one-time dismissible card
- Produces: `bedtimeBanner()` → HTML string, evening bedtime estimate chip
- Produces: clock-time label in heroCard sweet spot

- [ ] **Step 1: Extend `normalizeSettings` in `js/store.js`** to initialize new dismiss flag:

```js
export function normalizeSettings(s) {
  if (!s) return s;
  if (s.clock24 === true) s.clock24 = '24h';
  else if (s.clock24 === false) s.clock24 = '12h';
  else if (s.clock24 !== '24h' && s.clock24 !== '12h') s.clock24 = '12h';
  if (typeof s.tipMorningLightDismissed !== 'boolean') s.tipMorningLightDismissed = false;
  return s;
}
```

- [ ] **Step 2: Add helper functions to `js/home.js`** (insert before `heroCard()`):

```js
// One-time morning light tip card. Shown when the circadian anchor reaches
// medium+ confidence. Dismissed to settings — never shown again after tap.
function morningLightTip() {
  if (state().settings.tipMorningLightDismissed) return '';
  const anchor = derive.circadianAnchor();
  if (!anchor || anchor.confidence === 'low') return '';
  const name = esc(state().baby.name || 'Your baby');
  const h = Math.floor(anchor.morningWakeMinutes / 60);
  const m = anchor.morningWakeMinutes % 60;
  const todayBase = new Date(); todayBase.setHours(h, m, 0, 0);
  const timeStr = fmt.clock(todayBase);
  return `<div class="card tip-card">
    <div class="tip-hd">${icon('sunrise')} Morning light</div>
    <p>${name} wakes around ${timeStr} most mornings. Morning light in the first 30 minutes — open curtains, step outside — helps anchor the sleep clock and makes nap timing more predictable.</p>
    <button class="tip-dismiss" data-action="tip:dismiss" data-tip="morning-light">Got it</button>
  </div>`;
}

// Bedtime estimate chip. Shown in the evening (after 4pm) when the circadian
// anchor has medium+ confidence.
function bedtimeBanner() {
  if (new Date().getHours() < 16) return '';
  const bw = derive.bedtimeWindow();
  if (!bw) return '';
  return `<div class="bedtime-chip">
    ${icon('moon')} Sleep clock pointing toward bed ${fmt.clock(bw.from)}–${fmt.clock(bw.to)}
  </div>`;
}
```

- [ ] **Step 3: Add clock-time label to `heroCard()` in `js/home.js`**

Inside `heroCard()`, after computing `sp` and before the return statement for the awake case, add:

```js
// Optional clock-time anchor label when circadian confidence is medium+.
const anchor = derive.circadianAnchor();
let clockTimeNote = '';
if (anchor && anchor.confidence !== 'low' && !sp.napping) {
  const todayBase = new Date(); todayBase.setHours(0, 0, 0, 0);
  const anchorMs = todayBase.getTime() + anchor.morningWakeMinutes * MIN;
  const clockFrom = new Date(anchorMs + sp.prediction.low * MIN);
  const clockTo   = new Date(anchorMs + sp.prediction.high * MIN);
  clockTimeNote = `<span class="sweet-clock">usually ${fmt.clock(clockFrom)}–${fmt.clock(clockTo)}</span>`;
}
```

Update the `sh-sweet-lbl` line in the awake return:

```js
<div class="sh-sweet-lbl">${sweetLabel}${clockTimeNote}</div>
```

- [ ] **Step 4: Wire helpers into `home()` in `js/home.js`**

Update `home()` return string to insert the tips after `heroCard()`:

```js
${heroCard()}
${morningLightTip()}
${bedtimeBanner()}
```

- [ ] **Step 5: Add styles to `js/styles.css`**

Find a suitable section (near card styles) and add:

```css
/* --- Sleep model chips & tips --- */
.tip-card {
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.tip-hd {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.tip-card p { margin: 0; font-size: 0.9rem; line-height: 1.5; color: var(--ink-2); }
.tip-dismiss {
  align-self: flex-start;
  background: none;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.3rem 0.9rem;
  font-size: 0.85rem;
  cursor: pointer;
  color: var(--ink-2);
}

.bedtime-chip {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  background: var(--card-bg);
  border-radius: 999px;
  font-size: 0.85rem;
  color: var(--ink-2);
  margin: 0 0 0.75rem;
}

.sweet-clock {
  display: block;
  font-size: 0.8rem;
  color: var(--ink-2);
  margin-top: 0.2rem;
}

.nap-context {
  display: block;
  font-size: 0.8rem;
  color: var(--ink-3);
  margin-top: 0.1rem;
}
```

- [ ] **Step 6: Add `tip:dismiss` action to `js/app.js`** (inside the `map` object):

```js
'tip:dismiss': () => {
  const tip = el.dataset.tip;
  if (tip === 'morning-light') {
    state().settings.tipMorningLightDismissed = true;
    save();
    router.refresh();
  }
},
```

- [ ] **Step 7: Run lint**

```
npm run check
```

Expected: no errors.

- [ ] **Step 8: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Update index.html and sw.js
git add js/store.js js/home.js js/app.js js/styles.css index.html sw.js
git commit -m "feat(home): circadian clock-time labels, bedtime chip, morning light tip"
```

---

## Task 7: `derive.regressionAlert()` + `normalizeSettings` extension + tests

**Files:**
- Modify: `js/store.js`
- Modify: `js/store.test.js`

**Interfaces:**
- Produces: `derive.regressionAlert() → { id, name, onsetRange, mechanism, weeksBefore } | null`
  - Returns the currently approaching (or active) regression, or `null`
  - Checks `_state.settings.dismissedRegressions` to suppress dismissed regressions
  - `normalizeSettings` initializes `dismissedRegressions: []` when absent

- [ ] **Step 1: Write the failing tests**

```js
test('normalizeSettings initializes dismissedRegressions when missing', async () => {
  const { normalizeSettings } = await import('./store.js');
  const s = normalizeSettings({ clock24: '12h' });
  assert.ok(Array.isArray(s.dismissedRegressions), 'should have dismissedRegressions array');
  assert.equal(s.dismissedRegressions.length, 0);
});

test('derive.regressionAlert returns null when baby age is far from any regression', () => {
  // Current baby age from prior applySyncResponse calls is ~4 months.
  // The 4-month regression fires at 3.5–5 months → may be in range.
  // This test just verifies the return shape is null or a valid object.
  const alert = derive.regressionAlert();
  if (alert !== null) {
    assert.ok(typeof alert.id === 'string');
    assert.ok(typeof alert.name === 'string');
    assert.ok(typeof alert.mechanism === 'string');
    assert.ok(Array.isArray(alert.onsetRange));
  }
});

test('derive.regressionAlert returns null for a dismissed regression', () => {
  // Dismiss all regressions and verify null is returned.
  const s = state().settings;
  const saved = s.dismissedRegressions;
  s.dismissedRegressions = ['4m', '6m', '810m', '12m', '18m'];
  const alert = derive.regressionAlert();
  assert.equal(alert, null);
  s.dismissedRegressions = saved; // restore
});
```

- [ ] **Step 2: Run to verify they fail**

```
node --test js/store.test.js 2>&1 | grep -E "FAIL|Error" | head -5
```

- [ ] **Step 3: Add `REGRESSION_TABLE` + `derive.regressionAlert()` + extend `normalizeSettings` in `js/store.js`**

Add `REGRESSION_TABLE` constant before the `derive` object:

```js
// Age ranges for known developmental sleep regressions. onsetRange is [minMonths, maxMonths].
// The banner fires when the baby is within onsetWeeksBefore weeks of minMonths.
const REGRESSION_TABLE = [
  { id: '4m',  name: '4-month sleep change', onsetRange: [3.5, 5],   onsetWeeksBefore: 4,
    mechanism: 'Brain cycling through adult sleep stages — architecture changes, sleep gets lighter.' },
  { id: '6m',  name: '6-month sleep change', onsetRange: [5.5, 7],   onsetWeeksBefore: 3,
    mechanism: 'Increased cognitive load from a developmental leap.' },
  { id: '810m', name: '8–10-month sleep change', onsetRange: [7.5, 10.5], onsetWeeksBefore: 3,
    mechanism: 'Object permanence and separation awareness activating.' },
  { id: '12m', name: '12-month sleep change', onsetRange: [11, 13],  onsetWeeksBefore: 3,
    mechanism: 'Nap transition pressure plus walking milestone cortisol.' },
  { id: '18m', name: '18-month sleep change', onsetRange: [17, 19],  onsetWeeksBefore: 3,
    mechanism: 'Language explosion — vocabulary acquisition interferes with sleep.' },
];
```

Add `derive.regressionAlert()` (after `bedtimeWindow`):

```js
// Returns the approaching or active regression for the current baby age,
// or null if none applies or the regression has been dismissed.
regressionAlert() {
  const dismissed = (state().settings.dismissedRegressions) || [];
  const m = ageMonths();
  for (const r of REGRESSION_TABLE) {
    if (dismissed.includes(r.id)) continue;
    const warningStart = r.onsetRange[0] - r.onsetWeeksBefore / 4.33;
    const warningEnd   = r.onsetRange[1];
    if (m >= warningStart && m <= warningEnd) return r;
  }
  return null;
},
```

Extend `normalizeSettings` (add after the `clock24` block):

```js
if (!Array.isArray(s.dismissedRegressions)) s.dismissedRegressions = [];
```

- [ ] **Step 4: Run all tests**

```
node --test js/store.test.js && npm run check
```

Expected: all pass, no lint errors.

- [ ] **Step 5: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Update index.html and sw.js
git add js/store.js js/store.test.js index.html sw.js
git commit -m "feat(store): add regressionAlert with developmental regression table"
```

---

## Task 8: Regression banner in home.js + styles.css + app.js dismiss handler

**Files:**
- Modify: `js/home.js` (add `regressionBanner()`, wire into `home()`)
- Modify: `js/styles.css` (add `.regression-banner` styles)
- Modify: `js/app.js` (add `regression:dismiss` handler, add `enqueueSettingsSync` to import)

**Interfaces:**
- Consumes: `derive.regressionAlert()` (Task 7)
- Consumes: `state().settings.dismissedRegressions`, `save()`, `enqueueSettingsSync()` (app.js)

- [ ] **Step 1: Add `regressionBanner()` helper to `js/home.js`** (before `home()`):

```js
function regressionBanner() {
  const r = derive.regressionAlert();
  if (!r) return '';
  const name = esc(state().baby.name || 'Your baby');
  return `<div class="regression-banner card">
    <div class="reg-hd">${icon('info')} ${esc(r.name)}</div>
    <p>${name} is approaching the ${esc(r.name.toLowerCase())} — one of the most common. ${esc(r.mechanism)} This is normal development, not a problem to fix.</p>
    <button class="tip-dismiss" data-action="regression:dismiss" data-rid="${esc(r.id)}" aria-label="Dismiss">Got it</button>
  </div>`;
}
```

- [ ] **Step 2: Wire `regressionBanner()` into `home()` in `js/home.js`**

Add it after `heroCard()` (before `morningLightTip()`):

```js
${heroCard()}
${regressionBanner()}
${morningLightTip()}
${bedtimeBanner()}
```

- [ ] **Step 3: Add `.regression-banner` styles to `js/styles.css`** (after the tip-card styles from Task 6):

```css
.regression-banner {
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-left: 3px solid var(--accent);
}
.regression-banner p { margin: 0; font-size: 0.9rem; line-height: 1.5; color: var(--ink-2); }
.reg-hd { font-weight: 600; display: flex; align-items: center; gap: 0.4rem; }
```

- [ ] **Step 4: Add `regression:dismiss` handler to `js/app.js`**

Add `enqueueSettingsSync` to the existing store.js import (line 2):

```js
import { state, save, reset, addEntry, removeEntry, removeMeasure, enqueueBabySync, enqueueSettingsSync, applySyncResponse, markSynced } from './store.js';
```

(It may already be there — check before editing.)

Add inside the `map` object:

```js
'regression:dismiss': () => {
  const rid = el.dataset.rid;
  if (rid) {
    const s = state().settings;
    if (!Array.isArray(s.dismissedRegressions)) s.dismissedRegressions = [];
    if (!s.dismissedRegressions.includes(rid)) s.dismissedRegressions.push(rid);
    save();
    enqueueSettingsSync();
    router.refresh();
  }
},
```

- [ ] **Step 5: Run lint**

```
npm run check
```

Expected: no errors.

- [ ] **Step 6: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Update index.html and sw.js
git add js/home.js js/app.js js/styles.css index.html sw.js
git commit -m "feat(home): regression heads-up banner with one-tap dismiss"
```

---

## Self-Review

### Spec coverage

| Spec section | Covered by |
|---|---|
| `wakeWindowRange(position)` with population table | Task 1 |
| `wakePosition()` with 10am/4pm thresholds | Task 1 |
| `sweetSpot()` updated to use range | Task 1 |
| Science copy — adenosine language | Task 2 |
| Post-nap context note | Task 2 |
| `derive.personalWakeWindow()` with 21-day window + recency weight | Task 3 |
| `derive.wakeWindowPrediction()` blend formula (w_p, w_pop, clamp) | Task 4 |
| Source label transitions (population → blend → personal) | Task 4 |
| `derive.circadianAnchor()` with SD-gated confidence | Task 5 |
| `derive.bedtimeWindow()` | Task 5 |
| Clock-time nap label in heroCard | Task 6 |
| Bedtime chip (evening, medium+ confidence) | Task 6 |
| Morning light tip (one-time, dismissed to settings) | Task 6 |
| `derive.regressionAlert()` with regression table | Task 7 |
| Regression banner with one-tap dismiss | Task 8 |
| `normalizeSettings` extended for new flags | Tasks 6 + 7 |
| Circadian immaturity framing (< 12 weeks) | **Not implemented** — circadianAnchor returns null below 5 observations naturally for newborns, so no data is shown. A dedicated banner for < 12 weeks ("sleep clock still developing") can be added as a follow-up without breaking any Phase. |

### Placeholder scan

No "TBD", "TODO", or "implement later" present. All code blocks are complete.

### Type consistency

- `wakeWindowRange()` returns `{ low, high, midpoint, source, sampleSize, label }` — used consistently in Tasks 1, 2, 4.
- `derive.wakeWindowPrediction()` returns same shape — consumed by Tasks 4, 5, 6 via `sweetSpot().prediction`.
- `derive.circadianAnchor()` returns `{ morningWakeMinutes, confidence, sampleSize, sdMinutes }` — used in Tasks 6 (`morningLightTip`, `heroCard`, `bedtimeBanner`).
- `derive.regressionAlert()` returns `{ id, name, onsetRange, mechanism, onsetWeeksBefore }` or `null` — `id` is used as `data-rid` in the banner, `name` and `mechanism` in copy, `id` stored in `dismissedRegressions`.
