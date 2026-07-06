# Dispersion-Aware Shrinkage Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `wakeWindowPrediction`'s sample-count-only blend weight with a precision-weighted (dispersion-aware) shrinkage weight, so a baby with a consistent pattern earns trust in her own data faster than a baby with a scattered one, at the same sample size.

**Architecture:** Two new pure helper functions in `js/store.js` (`weightedVariance`, `shrinkageWeight`) sit alongside the existing `recencyWeight`/`weightedMedian`/`weightedPercentile`/`stdDev` helpers. `derive.personalWakeWindow` gains a `variance` field computed from the same recency-weighted observations it already builds. `derive.wakeWindowPrediction` swaps its `w_p = Math.min(0.9, Math.max(0, (n - 7) / 23))` ramp for `shrinkageWeight(personal.variance, n, priorVariance)`, where `priorVariance` is estimated from the width of the existing `wakeWindowRange` output. This is this plan's only feature scope — the four Insights derivations described in the spec are separate, later plans.

**Tech Stack:** Vanilla JS (ES modules), `node --test` for unit tests. No new dependencies.

## Global Constraints

- `derive.wakeWindowPrediction`'s return shape (`{low, high, midpoint, source, sampleSize, label}`) does not change — this is an internal math fix, not a new feature or UI change.
- The existing sanity clamp (personal midpoint must stay within 0.5×–2× of the population midpoint) stays in place unchanged.
- The blend weight stays capped at 0.9 — population data is never fully discarded.
- No new dependencies. Reuse `recencyWeight`, `weightedMedian`, `weightedPercentile`, `stdDev` already in `js/store.js` — do not reimplement equivalents.
- Run `node --test js/store.test.js` after every task; all tests must pass before moving to the next task.
- Follow Conventional Commits for every commit message (this repo's convention).
- `js/store.js` is a cached, user-served asset — run `scripts/bump-version.sh` before the final commit (see Task 4).
- Add a `js/changelog.js` entry for this change (see Task 4) — it changes a value parents see (the SweetSpot prediction).

---

### Task 1: Add `weightedVariance` and `shrinkageWeight` helpers

**Files:**
- Modify: `js/store.js:183` (the `_testHelpers` export), `js/store.js:298` (insert new functions after `stdDev`)
- Test: `js/store.test.js` (insert after the existing `weightedMedian` tests, i.e. after line 382)

**Interfaces:**
- Produces: `weightedVariance(observations: {value: number, weight: number}[]): number | null` — recency-weighted variance of the same `{value, weight}` observation shape `weightedMedian`/`weightedPercentile` already use. Returns `null` with fewer than 2 observations.
- Produces: `shrinkageWeight(personalVariance: number, n: number, priorVariance: number, cap: number = 0.9): number` — precision-weighted blend weight in `[0, cap]`.
- Both exported via `_testHelpers` for direct unit testing, same pattern as the existing helpers.

- [ ] **Step 1: Write the failing tests**

Insert into `js/store.test.js` immediately after the `weightedMedian shifts toward the high-weight value` test (currently ending at line 382):

```js
test('weightedVariance returns null with fewer than 2 observations', () => {
  const { weightedVariance } = _testHelpers;
  assert.equal(weightedVariance([{ value: 90, weight: 1 }]), null);
});

test('weightedVariance is small for a tight cluster', () => {
  const { weightedVariance } = _testHelpers;
  const obs = [88, 90, 89, 91, 90].map((v) => ({ value: v, weight: 1 }));
  assert.ok(weightedVariance(obs) < 2, `variance ${weightedVariance(obs)} should be small`);
});

test('weightedVariance is large for a scattered set', () => {
  const { weightedVariance } = _testHelpers;
  const obs = [40, 140, 60, 160, 90].map((v) => ({ value: v, weight: 1 }));
  assert.ok(weightedVariance(obs) > 1000, `variance ${weightedVariance(obs)} should be large`);
});

test('shrinkageWeight gives a consistent series more trust than a scattered one at equal n', () => {
  const { shrinkageWeight } = _testHelpers;
  const priorVariance = 400; // illustrative population spread
  const tight = shrinkageWeight(4, 9, priorVariance);        // SD = 2 min
  const scattered = shrinkageWeight(2500, 9, priorVariance); // SD = 50 min
  assert.ok(tight > scattered, `tight-cluster weight ${tight} should exceed scattered weight ${scattered}`);
});

test('shrinkageWeight never exceeds the cap', () => {
  const { shrinkageWeight } = _testHelpers;
  const w = shrinkageWeight(0.0001, 1000, 400);
  assert.ok(w <= 0.9, `weight ${w} should be capped at 0.9`);
});

test('shrinkageWeight approaches 0 with huge personal variance', () => {
  const { shrinkageWeight } = _testHelpers;
  const w = shrinkageWeight(1e9, 9, 400);
  assert.ok(w < 0.05, `weight ${w} should be near 0 with huge personal variance`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test js/store.test.js`
Expected: FAIL — `_testHelpers.weightedVariance is not a function` (and same for `shrinkageWeight`).

- [ ] **Step 3: Implement the helpers**

In `js/store.js`, after the existing `stdDev` function (line 298), insert:

```js
// Recency-weighted variance of observations (same shape as weightedMedian: {value, weight}).
// Returns null with fewer than 2 observations (variance is undefined).
function weightedVariance(observations) {
  if (observations.length < 2) return null;
  const totalWeight = observations.reduce((s, o) => s + o.weight, 0);
  const mean = observations.reduce((s, o) => s + o.value * o.weight, 0) / totalWeight;
  const variance = observations.reduce((s, o) => s + o.weight * (o.value - mean) ** 2, 0) / totalWeight;
  return variance;
}

// Precision-weighted shrinkage: how much to trust `n` personal observations
// with the given variance against a population prior of `priorVariance`.
// A consistent series (low variance) reaches high trust faster than a
// scattered one (high variance), even at the same `n` — unlike a weight
// that depends on `n` alone. Capped at `cap` so the population prior is
// never fully discarded.
function shrinkageWeight(personalVariance, n, priorVariance, cap = 0.9) {
  const safeVariance = Math.max(personalVariance, 1e-6);
  const personalPrecision = n / safeVariance;
  const priorPrecision = 1 / priorVariance;
  return Math.min(cap, personalPrecision / (personalPrecision + priorPrecision));
}
```

Then update the `_testHelpers` export at line 183 from:

```js
export const _testHelpers = { recencyWeight, weightedMedian, weightedPercentile, stdDev };
```

to:

```js
export const _testHelpers = { recencyWeight, weightedMedian, weightedPercentile, stdDev, weightedVariance, shrinkageWeight };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test js/store.test.js`
Expected: PASS (all tests, including the 5 new ones)

- [ ] **Step 5: Commit**

```bash
git add js/store.js js/store.test.js
git commit -m "feat(store): add weightedVariance and shrinkageWeight helpers"
```

---

### Task 2: Wire `weightedVariance` into `personalWakeWindow`

**Files:**
- Modify: `js/store.js:507-533` (`derive.personalWakeWindow`)
- Test: `js/store.test.js:391-415` (existing test — add one assertion)

**Interfaces:**
- Consumes: `weightedVariance(observations)` from Task 1.
- Produces: `derive.personalWakeWindow(position)` now returns `{median, p25, p75, sampleSize, variance, napMedianMin}` — adds `variance: number` (recency-weighted variance of the position's wake-window observations, in minutes²) to the existing shape. `variance` is never `null` here because this function already requires `observations.length >= 7` before returning.

- [ ] **Step 1: Extend the existing test to assert on variance**

In `js/store.test.js`, the test `derive.personalWakeWindow returns ~90-min median from 9 consecutive sleep pairs` currently ends with:

```js
  const result = derive.personalWakeWindow('middle');
  assert.ok(result !== null, 'should return data with 9 middle-position observations');
  assert.ok(result.sampleSize >= 9, `sampleSize ${result.sampleSize} should be ≥ 9`);
  assert.ok(result.median >= 85 && result.median <= 95, `median ${result.median} should be near 90`);
  assert.ok(result.p25 <= result.median, 'p25 ≤ median');
  assert.ok(result.median <= result.p75, 'median ≤ p75');
});
```

Add one line before the closing `});`:

```js
  assert.equal(result.variance, 0, 'variance should be 0 for an exactly-repeating 90-min pattern');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test js/store.test.js`
Expected: FAIL — `result.variance` is `undefined`, not `0`.

- [ ] **Step 3: Implement**

In `js/store.js`, `derive.personalWakeWindow` currently ends with:

```js
    if (observations.length < 7) return null;
    return {
      median: Math.round(weightedMedian(observations)),
      p25:    Math.round(weightedPercentile(observations, 0.25)),
      p75:    Math.round(weightedPercentile(observations, 0.75)),
      sampleSize: observations.length,
      napMedianMin: priorSleeps.length ? Math.round(weightedMedian(priorSleeps)) : 0,
    };
  },
```

Change to:

```js
    if (observations.length < 7) return null;
    return {
      median: Math.round(weightedMedian(observations)),
      p25:    Math.round(weightedPercentile(observations, 0.25)),
      p75:    Math.round(weightedPercentile(observations, 0.75)),
      sampleSize: observations.length,
      variance: weightedVariance(observations),
      napMedianMin: priorSleeps.length ? Math.round(weightedMedian(priorSleeps)) : 0,
    };
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test js/store.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/store.js js/store.test.js
git commit -m "feat(store): expose personal wake-window variance"
```

---

### Task 3: Replace the sample-count ramp in `wakeWindowPrediction`

**Files:**
- Modify: `js/store.js:538-567` (`derive.wakeWindowPrediction`)
- Test: `js/store.test.js:425-443` (update 2 existing tests), plus one new test

**Interfaces:**
- Consumes: `shrinkageWeight(personalVariance, n, priorVariance, cap)` from Task 1; `personal.variance` from Task 2.
- Produces: `derive.wakeWindowPrediction(position, priorSleepMin)` — return shape unchanged (`{low, high, midpoint, source, sampleSize, label}`), but `source` may now become `'personal'` at a lower `n` than before (as low as `n = 7`) when the personal pattern is highly consistent, and may stay `'blend'` at higher `n` than before when the pattern is scattered.

- [ ] **Step 1: Update the existing tests, then write one new failing test**

The zero-variance fixture already in the test file (9 observations, each exactly 90 minutes, added by the `derive.personalWakeWindow` test in the same file) means the new dispersion-aware weight jumps straight to the 0.9 cap — a perfectly consistent pattern earns full trust immediately rather than ramping up over many weeks. Update the two tests that assumed the old ramp:

Replace:

```js
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
```

with:

```js
test('derive.wakeWindowPrediction reaches full personal trust quickly for a perfectly consistent pattern', () => {
  // The personalWakeWindow test added 9 'middle' observations at exactly 90
  // min each (zero variance) — a dispersion-aware weight should cap out at
  // 0.9 immediately, rather than needing ~30 observations like the old
  // sample-count-only ramp required.
  const pred = derive.wakeWindowPrediction('middle');
  assert.equal(pred.source, 'personal');
  const pop = wakeWindowRange('middle');
  // midpoint must stay between pop.low and pop.high (sanity clamp)
  assert.ok(pred.midpoint >= pop.low && pred.midpoint <= pop.high,
    `midpoint ${pred.midpoint} should stay within population range`);
  assert.ok(pred.label.includes("pattern"), 'label should mention her own pattern');
});
```

This test's clamp neighbor (`derive.wakeWindowPrediction clamps personal median to 0.5×–2× population midpoint`) makes no assertion about `source`, so it needs no change — leave it as-is.

Then add a new test directly after it, for the dispersion case the old ramp couldn't express — a scattered pattern that should NOT reach full trust even with a comparable sample size:

```js
test('derive.wakeWindowPrediction stays a blend for a scattered personal pattern', () => {
  const now = Date.now();
  const DAY_MS = 86400000;
  const MIN_MS = 60000;
  // 10 days of 'last'-position wake windows (previous sleep always ends at
  // 5pm, inside the 4pm-8pm bracket), but the gap to the next sleep swings
  // widely day to day — a scattered, inconsistent pattern rather than a
  // tight one. Uses days 11-20 ago so it doesn't overlap the 'middle'
  // fixture's days 2-10 ago.
  const wakeMinutesByDay = [40, 220, 60, 200, 50, 230, 45, 210, 55, 225];
  for (let i = 0; i < wakeMinutesByDay.length; i++) {
    const d = 20 - i;
    const base = new Date(now - d * DAY_MS);
    base.setHours(0, 0, 0, 0);
    const sleepAEnd = new Date(base.getTime() + 17 * 60 * MIN_MS); // 5pm
    const sleepAStart = new Date(sleepAEnd.getTime() - 70 * MIN_MS);
    const sleepBStart = new Date(sleepAEnd.getTime() + wakeMinutesByDay[i] * MIN_MS);
    const sleepBEnd = new Date(sleepBStart.getTime() + 70 * MIN_MS);
    addEntry({ type: 'sleep', start: sleepAStart.toISOString(), end: sleepAEnd.toISOString() });
    addEntry({ type: 'sleep', start: sleepBStart.toISOString(), end: sleepBEnd.toISOString() });
  }
  const personal = derive.personalWakeWindow('last');
  assert.ok(personal !== null, 'should have enough observations');
  assert.ok(personal.sampleSize >= 8, `sampleSize ${personal.sampleSize} should be close to 10`);
  assert.ok(personal.variance > 3000, `variance ${personal.variance} should be large for a scattered pattern`);

  const pred = derive.wakeWindowPrediction('last');
  assert.equal(pred.source, 'blend', 'a scattered pattern should not reach full personal trust at this sample size');
});
```

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

Run: `node --test js/store.test.js`
Expected: FAIL — the renamed test fails because `pred.source` is still `'blend'` under the old ramp (not yet `'personal'`); the new scattered-pattern test fails because `wakeWindowPrediction('last')` still returns `source: 'population'` (personal data not yet blended in under the old code path — the old ramp is unaffected either way, but confirm the fixture actually reaches `derive.personalWakeWindow('last') !== null` first; if it fails at the `personal !== null` assertion, adjust `wakeMinutesByDay`'s day range before proceeding).

- [ ] **Step 3: Implement**

In `js/store.js`, `derive.wakeWindowPrediction` currently has:

```js
    const n = personal.sampleSize;
    const w_p   = Math.min(0.9, Math.max(0, (n - 7) / 23));
    const w_pop = 1 - w_p;
```

Change to:

```js
    const n = personal.sampleSize;
    const priorVariance = ((pop.high - pop.low) / 4) ** 2;
    const w_p   = shrinkageWeight(personal.variance, n, priorVariance);
    const w_pop = 1 - w_p;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test js/store.test.js`
Expected: PASS (all tests). If the scattered-pattern test's `sampleSize`/`variance` thresholds don't match the actual computed values, adjust the assertions' numeric bounds to match reality (the fixture's intent — a scattered pattern with `n` in the 8-10 range — matters more than the exact threshold numbers).

- [ ] **Step 5: Commit**

```bash
git add js/store.js js/store.test.js
git commit -m "fix(store): make wake-window shrinkage dispersion-aware, not just sample-count-based"
```

---

### Task 4: Quickref, changelog, version bump

**Files:**
- Modify: `docs/codebase-quickref.md:52`
- Modify: `js/changelog.js` (today's dated block)
- Run: `scripts/bump-version.sh`

**Interfaces:**
- No code interfaces — documentation and release bookkeeping only.

- [ ] **Step 1: Update the quickref**

In `docs/codebase-quickref.md`, the `store.js` section currently has:

```
- `wakeWindowRange(position)`: age-appropriate awake window `{low, high, midpoint, ...}` in minutes
```

Add a line directly after it:

```
- `wakeWindowRange(position)`: age-appropriate awake window `{low, high, midpoint, ...}` in minutes
- `derive.wakeWindowPrediction(position)`: blends `wakeWindowRange` with `derive.personalWakeWindow` via a precision-weighted shrinkage (`shrinkageWeight` in `_testHelpers`) — a consistent personal pattern earns trust faster than a scattered one at the same sample size
```

- [ ] **Step 2: Add a changelog entry**

Open `js/changelog.js` and add a line to today's dated block (create a new block at the top if today's date isn't already present), under the fixes for that day:

```js
"Sweet Spot now trusts your baby's own pattern faster when it's consistent, and holds back a little longer when naps are more unpredictable."
```

(Match this repo's existing `js/changelog.js` array/object structure exactly — read the file first to see the current day's block format before inserting.)

- [ ] **Step 3: Bump the version**

Run: `scripts/bump-version.sh`
Expected: prints the updated `index.html` meta tag and `sw.js` `VERSION` constant lines — both should show the current UTC timestamp.

- [ ] **Step 4: Run the full unit suite one last time**

Run: `node --test js/store.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/codebase-quickref.md js/changelog.js index.html sw.js
git commit -m "docs: document shrinkage primitive and bump version"
```
