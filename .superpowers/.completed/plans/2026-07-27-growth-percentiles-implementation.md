# Growth Percentiles (#144) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WHO growth-percentile badge to each Growth-tab stat card and a WHO median overlay on the growth chart, for babies 0-24 months old whose sex is known.

**Architecture:** WHO Child Growth Standards LMS reference data ships as a static client-side data module (no network fetch). A small pure computation module turns `(statKey, sex, ageMonths, measurement)` into a percentile via the standard LMS z-score formula, and turns a baby's own measurement dates into an aligned WHO-median overlay curve for the existing chart. A new `sex` field is added to the `babies` table (distinct from the cosmetic `theme` field) end-to-end: migration, server API, onboarding (required picker), profile (editable), and sync.

**Tech Stack:** Vanilla JS (ES modules, `node --test` for unit tests, Playwright for e2e), Go + SQLite (`modernc.org/sqlite`) server, no frameworks.

## Global Constraints

- No framework. Vanilla JS PWA + Go backend + SQLite.
- Round everything you touch: pills for controls, big radii for cards, circles for identity.
- Lucide icons only, Playfair Display for the baby's name/hero timer, Archivo for everything else — this plan adds no new icons or fonts, so this is a "don't break it" constraint, not an action item.
- Follow Conventional Commits for git messages.
- **Bump the version** (`scripts/bump-version.sh`) before every commit that touches a cached asset (`index.html`, `sw.js`, `js/**`, `styles.css`, icons) — every task in this plan touches at least one such file.
- **Keep `js/changelog.js` in sync**: this ships one user-facing feature (growth percentiles) and one required-field change to onboarding. Add one changelog entry once the full feature is merged (Task 8), not per-task.
- `main` is branch-protected — every change needs a branch + PR + `gh-axi pr merge`, never a direct push.
- Run `npm run test:unit` (`node --test js/*.test.js`) and the Playwright suites for touched files locally; lean on CI for the full e2e matrix.
- Never run Playwright suites with concurrency > 1.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `js/growth-percentiles-data.js` | Create | WHO 2006 Child Growth Standards LMS parameters, 0-24 completed months, weight/height/head x boy/girl. Pure data, no logic. |
| `js/growth-percentiles.js` | Create | `percentileFor`, `medianCurveFor`, `ageMonthsAt` — the LMS z-score formula and age/lookup logic. Imports the data module and `parseDateOnlyLocal` from `store.js`. |
| `js/growth-percentiles.test.js` | Create | Unit tests for the above, using WHO's own published percentile columns as verified worked examples. |
| `js/store.js` | Modify | Add `sex: ''` to the default baby shape; export `parseDateOnlyLocal` (was private) so `growth-percentiles.js` can reuse it instead of duplicating date parsing. |
| `js/store.test.js` | Modify | One test asserting the default baby shape includes `sex: ''`. |
| `server/migrations/0013_add_baby_sex.sql` | Create | `ALTER TABLE babies ADD COLUMN sex TEXT NOT NULL DEFAULT ''`. |
| `server/schema.sql` | Modify | Add the `sex` column to the `babies` table definition, matching the migration (required by `TestSchemaSQLMatchesMigrations`). |
| `server/family.go` | Modify | `provisionFamily` gains a `sex` parameter; `createFamilyRequest` gains `Sex string`; `patchBabyRequest` gains `Sex *string` (nil = leave column untouched, protecting against a stale client's full-object PATCH erasing another caregiver's value); `handlePatchBaby`'s `UPDATE` uses `COALESCE`. |
| `server/reconcile.go` | Modify | Update the OAuth-signup `provisionFamily` call site to pass `""` for the new `sex` parameter. |
| `server/sync.go` | Modify | Add `sex` to the baby `SELECT` and the marshaled response in `handleSync`. |
| `server/family_test.go` | Modify | Add one test asserting `sex` persists through `handleCreateFamily`, following the existing `theme` coverage. |
| `server/settings_test.go` | Modify | Extend `TestHandlePatchBabyUpdatesFields` to cover `sex`; add a new test proving an omitted `sex` in a PATCH leaves the existing value untouched. |
| `server/sync_test.go` | Modify | Extend `TestHandleSyncIncludesBabyWhenChanged` to assert `sex` comes back through sync. |
| `js/onboarding.js` | Modify | Add a required girl/boy picker, independent of the theme picker; validate it like the name field; include `sex` in the `/api/family` POST body. |
| `styles.css` | Modify | `.sex-opt` shares `.theme-opt`'s visual treatment (distinct class so it doesn't collide with onboarding's `$$('.theme-opt')` theme-highlight query or the existing `.theme-opt`-scoped e2e test); `.theme-pick.shake` for the required-picker validation shake; `.stat-pctl` for the growth-tab percentile badge text. |
| `tests/helpers.js` | Modify | The shared `onboard()` helper used by ~30 Playwright suites must select a sex before clicking finish, now that it's required. |
| `tests/onboarding-sex.test.js` | Create | e2e coverage for the new required picker: renders, validates, persists. |
| `js/profile.js` | Modify | Add a "Sex" section with an editable girl/boy picker, alongside the existing theme picker. |
| `js/app.js` | Modify | Register `'onboard:sex'` and `'sex:pick'` dispatch-table actions. |
| `js/growth.js` | Modify | Percentile badge on each stat card; WHO median overlay polyline on `lineChart()`, with the y-domain expanded to include it. |
| `js/growth.test.js` | Modify | Badge rendering, overlay rendering, missing-sex and over-24-months graceful-omission paths. |
| `sw.js` | Modify | Add `growth-percentiles-data.js` and `growth-percentiles.js` to `SHELL` so they're cached offline like every other client module. |
| `js/changelog.js` | Modify | One entry once the feature is complete (Task 8). |

---

### Task 1: WHO LMS reference data module

**Files:**
- Create: `js/growth-percentiles-data.js`

**Interfaces:**
- Produces: `GROWTH_LMS` — `{ weightKg: { boy: Row[], girl: Row[] }, heightCm: { boy: Row[], girl: Row[] }, headCm: { boy: Row[], girl: Row[] } }` where `Row = { month: number, L: number, M: number, S: number }`, one row per completed month 0-24.

This data is the WHO 2006 Child Growth Standards LMS parameters, sourced from the CDC's mirror of the official WHO tables (`ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/WHO-{Boys,Girls}-{Weight,Length,Head-Circumference}-for-age-Percentiles.csv`), which replicate WHO's published values verbatim (cross-checked against known reference points: boys birth weight M=3.3464kg, boys birth length M=49.8842cm, boys birth head circumference M=34.4618cm all match WHO's published figures).

- [ ] **Step 1: Create the data file**

```js
// growth-percentiles-data.js: WHO Child Growth Standards 2006, LMS parameters,
// birth to 24 completed months, weight/length/head-circumference-for-age, by sex.
// Source: CDC-mirrored WHO tables (ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/,
// WHO-{Boys,Girls}-{Weight,Length,Head-Circumference}-for-age-Percentiles.csv),
// which replicate the WHO 2006 Child Growth Standards LMS values verbatim.
// L = Box-Cox power, M = median, S = coefficient of variation, per completed month of age.

const WEIGHT_BOY = [
    { month: 0, L: 0.3487, M: 3.3464, S: 0.14602 },
    { month: 1, L: 0.2297, M: 4.4709, S: 0.13395 },
    { month: 2, L: 0.197, M: 5.5675, S: 0.12385 },
    { month: 3, L: 0.1738, M: 6.3762, S: 0.11727 },
    { month: 4, L: 0.1553, M: 7.0023, S: 0.11316 },
    { month: 5, L: 0.1395, M: 7.5105, S: 0.1108 },
    { month: 6, L: 0.1257, M: 7.934, S: 0.10958 },
    { month: 7, L: 0.1134, M: 8.297, S: 0.10902 },
    { month: 8, L: 0.1021, M: 8.6151, S: 0.10882 },
    { month: 9, L: 0.0917, M: 8.9014, S: 0.10881 },
    { month: 10, L: 0.082, M: 9.1649, S: 0.10891 },
    { month: 11, L: 0.073, M: 9.4122, S: 0.10906 },
    { month: 12, L: 0.0644, M: 9.6479, S: 0.10925 },
    { month: 13, L: 0.0563, M: 9.8749, S: 0.10949 },
    { month: 14, L: 0.0487, M: 10.0953, S: 0.10976 },
    { month: 15, L: 0.0413, M: 10.3108, S: 0.11007 },
    { month: 16, L: 0.0343, M: 10.5228, S: 0.11041 },
    { month: 17, L: 0.0275, M: 10.7319, S: 0.11079 },
    { month: 18, L: 0.0211, M: 10.9385, S: 0.11119 },
    { month: 19, L: 0.0148, M: 11.143, S: 0.11164 },
    { month: 20, L: 0.0087, M: 11.3462, S: 0.11211 },
    { month: 21, L: 0.0029, M: 11.5486, S: 0.11261 },
    { month: 22, L: -0.0028, M: 11.7504, S: 0.11314 },
    { month: 23, L: -0.0083, M: 11.9514, S: 0.11369 },
    { month: 24, L: -0.0137, M: 12.1515, S: 0.11426 }
];

const WEIGHT_GIRL = [
    { month: 0, L: 0.3809, M: 3.2322, S: 0.14171 },
    { month: 1, L: 0.1714, M: 4.1873, S: 0.13724 },
    { month: 2, L: 0.0962, M: 5.1282, S: 0.13 },
    { month: 3, L: 0.0402, M: 5.8458, S: 0.12619 },
    { month: 4, L: -0.005, M: 6.4237, S: 0.12402 },
    { month: 5, L: -0.043, M: 6.8985, S: 0.12274 },
    { month: 6, L: -0.0756, M: 7.297, S: 0.12204 },
    { month: 7, L: -0.1039, M: 7.6422, S: 0.12178 },
    { month: 8, L: -0.1288, M: 7.9487, S: 0.12181 },
    { month: 9, L: -0.1507, M: 8.2254, S: 0.12199 },
    { month: 10, L: -0.17, M: 8.48, S: 0.12223 },
    { month: 11, L: -0.1872, M: 8.7192, S: 0.12247 },
    { month: 12, L: -0.2024, M: 8.9481, S: 0.12268 },
    { month: 13, L: -0.2158, M: 9.1699, S: 0.12283 },
    { month: 14, L: -0.2278, M: 9.387, S: 0.12294 },
    { month: 15, L: -0.2384, M: 9.6008, S: 0.12299 },
    { month: 16, L: -0.2478, M: 9.8124, S: 0.12303 },
    { month: 17, L: -0.2562, M: 10.0226, S: 0.12306 },
    { month: 18, L: -0.2637, M: 10.2315, S: 0.12309 },
    { month: 19, L: -0.2703, M: 10.4393, S: 0.12315 },
    { month: 20, L: -0.2762, M: 10.6464, S: 0.12323 },
    { month: 21, L: -0.2815, M: 10.8534, S: 0.12335 },
    { month: 22, L: -0.2862, M: 11.0608, S: 0.1235 },
    { month: 23, L: -0.2903, M: 11.2688, S: 0.12369 },
    { month: 24, L: -0.2941, M: 11.4775, S: 0.1239 }
];

const HEIGHT_BOY = [
    { month: 0, L: 1, M: 49.8842, S: 0.03795 },
    { month: 1, L: 1, M: 54.7244, S: 0.03557 },
    { month: 2, L: 1, M: 58.4249, S: 0.03424 },
    { month: 3, L: 1, M: 61.4292, S: 0.03328 },
    { month: 4, L: 1, M: 63.886, S: 0.03257 },
    { month: 5, L: 1, M: 65.9026, S: 0.03204 },
    { month: 6, L: 1, M: 67.6236, S: 0.03165 },
    { month: 7, L: 1, M: 69.1645, S: 0.03139 },
    { month: 8, L: 1, M: 70.5994, S: 0.03124 },
    { month: 9, L: 1, M: 71.9687, S: 0.03117 },
    { month: 10, L: 1, M: 73.2812, S: 0.03118 },
    { month: 11, L: 1, M: 74.5388, S: 0.03125 },
    { month: 12, L: 1, M: 75.7488, S: 0.03137 },
    { month: 13, L: 1, M: 76.9186, S: 0.03154 },
    { month: 14, L: 1, M: 78.0497, S: 0.03174 },
    { month: 15, L: 1, M: 79.1458, S: 0.03197 },
    { month: 16, L: 1, M: 80.2113, S: 0.03222 },
    { month: 17, L: 1, M: 81.2487, S: 0.0325 },
    { month: 18, L: 1, M: 82.2587, S: 0.03279 },
    { month: 19, L: 1, M: 83.2418, S: 0.0331 },
    { month: 20, L: 1, M: 84.1996, S: 0.03342 },
    { month: 21, L: 1, M: 85.1348, S: 0.03376 },
    { month: 22, L: 1, M: 86.0477, S: 0.0341 },
    { month: 23, L: 1, M: 86.941, S: 0.03445 },
    { month: 24, L: 1, M: 87.8161, S: 0.03479 }
];

const HEIGHT_GIRL = [
    { month: 0, L: 1, M: 49.1477, S: 0.0379 },
    { month: 1, L: 1, M: 53.6872, S: 0.0364 },
    { month: 2, L: 1, M: 57.0673, S: 0.03568 },
    { month: 3, L: 1, M: 59.8029, S: 0.0352 },
    { month: 4, L: 1, M: 62.0899, S: 0.03486 },
    { month: 5, L: 1, M: 64.0301, S: 0.03463 },
    { month: 6, L: 1, M: 65.7311, S: 0.03448 },
    { month: 7, L: 1, M: 67.2873, S: 0.03441 },
    { month: 8, L: 1, M: 68.7498, S: 0.0344 },
    { month: 9, L: 1, M: 70.1435, S: 0.03444 },
    { month: 10, L: 1, M: 71.4818, S: 0.03452 },
    { month: 11, L: 1, M: 72.771, S: 0.03464 },
    { month: 12, L: 1, M: 74.015, S: 0.03479 },
    { month: 13, L: 1, M: 75.2176, S: 0.03496 },
    { month: 14, L: 1, M: 76.3817, S: 0.03514 },
    { month: 15, L: 1, M: 77.5099, S: 0.03534 },
    { month: 16, L: 1, M: 78.6055, S: 0.03555 },
    { month: 17, L: 1, M: 79.671, S: 0.03576 },
    { month: 18, L: 1, M: 80.7079, S: 0.03598 },
    { month: 19, L: 1, M: 81.7182, S: 0.0362 },
    { month: 20, L: 1, M: 82.7036, S: 0.03643 },
    { month: 21, L: 1, M: 83.6654, S: 0.03666 },
    { month: 22, L: 1, M: 84.604, S: 0.03688 },
    { month: 23, L: 1, M: 85.5202, S: 0.03711 },
    { month: 24, L: 1, M: 86.4153, S: 0.03734 }
];

const HEAD_BOY = [
    { month: 0, L: 1, M: 34.4618, S: 0.03686 },
    { month: 1, L: 1, M: 37.2759, S: 0.03133 },
    { month: 2, L: 1, M: 39.1285, S: 0.02997 },
    { month: 3, L: 1, M: 40.5135, S: 0.02918 },
    { month: 4, L: 1, M: 41.6317, S: 0.02868 },
    { month: 5, L: 1, M: 42.5576, S: 0.02837 },
    { month: 6, L: 1, M: 43.3306, S: 0.02817 },
    { month: 7, L: 1, M: 43.9803, S: 0.02804 },
    { month: 8, L: 1, M: 44.53, S: 0.02796 },
    { month: 9, L: 1, M: 44.9998, S: 0.02792 },
    { month: 10, L: 1, M: 45.4051, S: 0.0279 },
    { month: 11, L: 1, M: 45.7573, S: 0.02789 },
    { month: 12, L: 1, M: 46.0661, S: 0.02789 },
    { month: 13, L: 1, M: 46.3395, S: 0.02789 },
    { month: 14, L: 1, M: 46.5844, S: 0.02791 },
    { month: 15, L: 1, M: 46.806, S: 0.02792 },
    { month: 16, L: 1, M: 47.0088, S: 0.02795 },
    { month: 17, L: 1, M: 47.1962, S: 0.02797 },
    { month: 18, L: 1, M: 47.3711, S: 0.028 },
    { month: 19, L: 1, M: 47.5357, S: 0.02803 },
    { month: 20, L: 1, M: 47.6919, S: 0.02806 },
    { month: 21, L: 1, M: 47.8408, S: 0.0281 },
    { month: 22, L: 1, M: 47.9833, S: 0.02813 },
    { month: 23, L: 1, M: 48.1201, S: 0.02817 },
    { month: 24, L: 1, M: 48.2515, S: 0.02821 }
];

const HEAD_GIRL = [
    { month: 0, L: 1, M: 33.8787, S: 0.03496 },
    { month: 1, L: 1, M: 36.5463, S: 0.0321 },
    { month: 2, L: 1, M: 38.2521, S: 0.03168 },
    { month: 3, L: 1, M: 39.5328, S: 0.0314 },
    { month: 4, L: 1, M: 40.5817, S: 0.03119 },
    { month: 5, L: 1, M: 41.459, S: 0.03102 },
    { month: 6, L: 1, M: 42.1995, S: 0.03087 },
    { month: 7, L: 1, M: 42.829, S: 0.03075 },
    { month: 8, L: 1, M: 43.3671, S: 0.03063 },
    { month: 9, L: 1, M: 43.83, S: 0.03053 },
    { month: 10, L: 1, M: 44.2319, S: 0.03044 },
    { month: 11, L: 1, M: 44.5844, S: 0.03035 },
    { month: 12, L: 1, M: 44.8965, S: 0.03027 },
    { month: 13, L: 1, M: 45.1752, S: 0.03019 },
    { month: 14, L: 1, M: 45.4265, S: 0.03012 },
    { month: 15, L: 1, M: 45.6551, S: 0.03006 },
    { month: 16, L: 1, M: 45.865, S: 0.02999 },
    { month: 17, L: 1, M: 46.0598, S: 0.02993 },
    { month: 18, L: 1, M: 46.2424, S: 0.02987 },
    { month: 19, L: 1, M: 46.4152, S: 0.02982 },
    { month: 20, L: 1, M: 46.5801, S: 0.02977 },
    { month: 21, L: 1, M: 46.7384, S: 0.02972 },
    { month: 22, L: 1, M: 46.8913, S: 0.02967 },
    { month: 23, L: 1, M: 47.0391, S: 0.02962 },
    { month: 24, L: 1, M: 47.1822, S: 0.02957 }
];

export const GROWTH_LMS = {
  weightKg: { boy: WEIGHT_BOY, girl: WEIGHT_GIRL },
  heightCm: { boy: HEIGHT_BOY, girl: HEIGHT_GIRL },
  headCm: { boy: HEAD_BOY, girl: HEAD_GIRL },
};
```

- [ ] **Step 2: Commit**

```bash
git add js/growth-percentiles-data.js
git commit -m "feat(growth): add WHO LMS reference data for growth percentiles"
```

---

### Task 2: `store.js` — `sex` field and exported date parser

**Files:**
- Modify: `js/store.js:13` (default baby shape), `js/store.js:230` (`parseDateOnlyLocal`)
- Test: `js/store.test.js`

**Interfaces:**
- Produces: `state().baby.sex` (string, `''` by default); `export function parseDateOnlyLocal(value)` (was private, now exported for `growth-percentiles.js` to reuse instead of duplicating the same UTC-offset-safe date parsing `growth.js`'s `localDate()` already duplicates once — see open issue #178 on this exact class of duplication; don't add a third copy).

- [ ] **Step 1: Write the failing test**

Add to `js/store.test.js`, near the other `reset()`-based tests:

```js
test('reset() default baby state has an empty sex field, ready for the required onboarding picker to set', () => {
  reset();
  assert.equal(state().baby.sex, '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test js/store.test.js`
Expected: FAIL — `state().baby.sex` is `undefined`, not `''`.

- [ ] **Step 3: Add `sex` to the default baby shape**

In `js/store.js`, change line 13:

```js
  baby: { name: '', birthdate: '', theme: 'girl', photo: null, caregiver: '' },
```

to:

```js
  baby: { name: '', birthdate: '', theme: 'girl', sex: '', photo: null, caregiver: '' },
```

- [ ] **Step 4: Export `parseDateOnlyLocal`**

In `js/store.js`, change line 230 from:

```js
function parseDateOnlyLocal(value) {
```

to:

```js
export function parseDateOnlyLocal(value) {
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test js/store.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add js/store.js js/store.test.js
git commit -m "feat(store): add baby.sex field and export parseDateOnlyLocal"
```

---

### Task 3: `growth-percentiles.js` — percentile computation

**Files:**
- Create: `js/growth-percentiles.js`
- Test: `js/growth-percentiles.test.js`

**Interfaces:**
- Consumes: `GROWTH_LMS` from `js/growth-percentiles-data.js` (Task 1); `parseDateOnlyLocal(value)` from `js/store.js` (Task 2).
- Produces:
  - `ageMonthsAt(birthdate, dateStr)` → integer months, floored, matching `store.js`'s private `ageMonths()`'s own floor-to-completed-month convention.
  - `percentileFor(statKey, sex, ageMonths, measurement)` → number 0-100, or `null` if `sex` is falsy, `measurement`/`ageMonths` is `null`/`undefined`, or `ageMonths > 24`.
  - `medianCurveFor(statKey, sex, ages)` → `Array<number|null>` parallel to the input `ages` array (one WHO-median value per age, in the same stat's units, or `null` for an age past 24 months), or `null` outright if `sex` is falsy.

These worked examples are independently derived: each measurement is the WHO/CDC table's own precomputed percentile-column value at that exact `(stat, sex, month)` row, so `percentileFor` recovering that same percentile from the LMS formula alone (not by reading the percentile column) is a real cross-check of the formula, not a tautology.

- [ ] **Step 1: Write the failing tests**

Create `js/growth-percentiles.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { percentileFor, medianCurveFor, ageMonthsAt } from './growth-percentiles.js';

function closeTo(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, want ${expected} +/- ${tol}`);
}

test('percentileFor recovers the 50th percentile when the measurement equals the WHO median (L != 0 branch)', () => {
  // boys weight-for-age, month 0: L=0.3487, M=3.3464
  closeTo(percentileFor('weightKg', 'boy', 0, 3.3464), 50.0, 0.05, 'boys weight month 0 at M');
});

test('percentileFor recovers the 50th percentile when the measurement equals the WHO median (L == 1 branch)', () => {
  // girls height-for-age, month 12: L=1, M=74.015
  closeTo(percentileFor('heightCm', 'girl', 12, 74.015), 50.0, 0.05, 'girls height month 12 at M');
});

test('percentileFor matches WHO\'s own published 97.7th-percentile column value', () => {
  // boys weight-for-age, month 0: WHO's "98th (97.7th)" column = 4.419354
  closeTo(percentileFor('weightKg', 'boy', 0, 4.419354), 97.7, 0.1, 'boys weight month 0 at WHO 97.7th col');
});

test('percentileFor matches WHO\'s own published 25th-percentile column value', () => {
  // girls weight-for-age, month 3: WHO's "25th" column = 5.368044
  closeTo(percentileFor('weightKg', 'girl', 3, 5.368044), 25.0, 0.1, 'girls weight month 3 at WHO 25th col');
});

test('percentileFor matches WHO\'s own published 75th-percentile column value', () => {
  // boys height-for-age, month 9: WHO's "75th" column = 73.48176
  closeTo(percentileFor('heightCm', 'boy', 9, 73.48176), 75.0, 0.1, 'boys height month 9 at WHO 75th col');
});

test('percentileFor matches WHO\'s own published 10th-percentile column value', () => {
  // girls head-circumference-for-age, month 18: WHO's "10th" column = 44.47224
  closeTo(percentileFor('headCm', 'girl', 18, 44.47224), 10.0, 0.1, 'girls head month 18 at WHO 10th col');
});

test('percentileFor returns null when sex is unset', () => {
  assert.equal(percentileFor('weightKg', '', 6, 8), null);
});

test('percentileFor returns null when age is past 24 months', () => {
  assert.equal(percentileFor('weightKg', 'boy', 25, 12), null);
});

test('percentileFor floors a fractional age to the completed month, not rounds', () => {
  // month 6 row for boys weight has M=7.934 (50th percentile). 6.9 months must
  // floor to month 6, not round to month 7 (M=8.297) -- floor-to-completed-month
  // is the documented rule (see the design spec), and monthly LMS rows mean
  // rounding up would silently apply next month's curve a few weeks early.
  closeTo(percentileFor('weightKg', 'boy', 6.9, 7.934), 50.0, 0.05, 'age 6.9 floors to month 6');
});

test('ageMonthsAt floors to completed months between two YYYY-MM-DD dates', () => {
  assert.equal(ageMonthsAt('2026-01-15', '2026-07-14'), 5); // one day short of 6 completed months
  assert.equal(ageMonthsAt('2026-01-15', '2026-07-15'), 6);
});

test('medianCurveFor returns the WHO median for each in-range age and null past 24 months', () => {
  const curve = medianCurveFor('weightKg', 'boy', [0, 6, 12, 25]);
  closeTo(curve[0], 3.3464, 0.0001, 'month 0');
  closeTo(curve[1], 7.934, 0.0001, 'month 6');
  closeTo(curve[2], 9.6479, 0.0001, 'month 12');
  assert.equal(curve[3], null, 'month 25 is out of range');
});

test('medianCurveFor returns null outright when sex is unset', () => {
  assert.equal(medianCurveFor('weightKg', '', [0, 6]), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test js/growth-percentiles.test.js`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `js/growth-percentiles.js`:

```js
// growth-percentiles.js: WHO LMS growth-percentile lookup and the WHO-median
// overlay curve for the growth chart. Pure functions, no DOM/state access.
import { GROWTH_LMS } from './growth-percentiles-data.js';
import { parseDateOnlyLocal } from './store.js';

// Abramowitz & Stegun 7.1.26 approximation of erf(); max absolute error
// 1.5e-7, far more precise than the integer-rounded percentile this feeds.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function normalCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

// Age is floored to the completed month per the design spec (WHO's own LMS
// rows are monthly resolution, so interpolating between rows would overstate
// precision the reference data doesn't have).
function rowForMonth(table, months) {
  const clamped = Math.max(0, Math.min(24, Math.floor(months)));
  return table.find((r) => r.month === clamped) || null;
}

export function ageMonthsAt(birthdate, dateStr) {
  const b = parseDateOnlyLocal(birthdate), d = parseDateOnlyLocal(dateStr);
  return Math.max(0, (d.getFullYear() - b.getFullYear()) * 12 + (d.getMonth() - b.getMonth()));
}

export function percentileFor(statKey, sex, ageMonths, measurement) {
  if (!sex || measurement == null || ageMonths == null || ageMonths > 24) return null;
  const table = GROWTH_LMS[statKey] && GROWTH_LMS[statKey][sex];
  if (!table) return null;
  const row = rowForMonth(table, ageMonths);
  if (!row) return null;
  const { L, M, S } = row;
  const z = L !== 0 ? (Math.pow(measurement / M, L) - 1) / (L * S) : Math.log(measurement / M) / S;
  return normalCdf(z) * 100;
}

export function medianCurveFor(statKey, sex, ages) {
  const table = sex && GROWTH_LMS[statKey] && GROWTH_LMS[statKey][sex];
  if (!table) return null;
  return ages.map((months) => {
    const row = months > 24 ? null : rowForMonth(table, months);
    return row ? row.M : null;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test js/growth-percentiles.test.js`
Expected: PASS (all 12 tests)

- [ ] **Step 5: Commit**

```bash
git add js/growth-percentiles.js js/growth-percentiles.test.js
git commit -m "feat(growth): add WHO LMS percentile computation, verified against WHO's own worked examples"
```

---

### Task 4: Server — `sex` field end-to-end

**Files:**
- Create: `server/migrations/0013_add_baby_sex.sql`
- Modify: `server/schema.sql`, `server/family.go`, `server/reconcile.go`, `server/sync.go`
- Test: `server/family_test.go`, `server/settings_test.go`, `server/sync_test.go`

**Interfaces:**
- Produces: `babies.sex` column (`TEXT NOT NULL DEFAULT ''`); `provisionFamily(tx, familyID, babyID, caregiverID, babyName, birthdate, theme, sex, caregiverName, now)` (new `sex` param, after `theme`); `createFamilyRequest.Sex string`; `patchBabyRequest.Sex *string` (nil = don't touch the column); `sex` field in `handleSync`'s baby JSON.

- [ ] **Step 1: Write the migration**

Create `server/migrations/0013_add_baby_sex.sql`:

```sql
ALTER TABLE babies ADD COLUMN sex TEXT NOT NULL DEFAULT '';
```

- [ ] **Step 2: Update `schema.sql` to match**

In `server/schema.sql`, change:

```sql
CREATE TABLE IF NOT EXISTS babies (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL DEFAULT '',
  birthdate TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'girl',
  photo TEXT,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0
);
```

to:

```sql
CREATE TABLE IF NOT EXISTS babies (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL DEFAULT '',
  birthdate TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'girl',
  sex TEXT NOT NULL DEFAULT '',
  photo TEXT,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 3: Run the migration-consistency test to verify it passes**

Run: `cd server && go test -run TestSchemaSQLMatchesMigrations ./...`
Expected: PASS (this is the test that would have failed without Step 2 — see the design spec's finding #1).

- [ ] **Step 4: Write the failing server tests**

In `server/family_test.go`, add:

```go
func TestHandleCreateFamilyStoresSex(t *testing.T) {
	db := newParallelTestDB(t)
	body := bytes.NewBufferString(`{"babyName":"Mira","birthdate":"2026-01-01","theme":"girl","sex":"girl","caregiverName":"Maya"}`)
	req := httptest.NewRequest("POST", "/api/family", body)
	rec := httptest.NewRecorder()

	handleCreateFamily(db)(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var sex string
	if err := db.QueryRow(`SELECT sex FROM babies`).Scan(&sex); err != nil {
		t.Fatalf("querying baby: %v", err)
	}
	if sex != "girl" {
		t.Errorf("sex = %q, want girl", sex)
	}
}
```

In `server/settings_test.go`, change `TestHandlePatchBabyUpdatesFields`'s body and assertions from:

```go
	req := httptest.NewRequest("PATCH", "/api/baby", bytes.NewBufferString(`{"name":"Olive","birthdate":"2026-01-15","theme":"boy","photo":""}`))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handlePatchBaby(db, hub)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var name, theme string
	db.QueryRow(`SELECT name, theme FROM babies WHERE family_id = 'fam1'`).Scan(&name, &theme)
	if name != "Olive" || theme != "boy" {
		t.Errorf("name=%q theme=%q, want Olive/boy", name, theme)
	}
```

to:

```go
	req := httptest.NewRequest("PATCH", "/api/baby", bytes.NewBufferString(`{"name":"Olive","birthdate":"2026-01-15","theme":"boy","photo":"","sex":"girl"}`))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handlePatchBaby(db, hub)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var name, theme, sex string
	db.QueryRow(`SELECT name, theme, sex FROM babies WHERE family_id = 'fam1'`).Scan(&name, &theme, &sex)
	if name != "Olive" || theme != "boy" || sex != "girl" {
		t.Errorf("name=%q theme=%q sex=%q, want Olive/boy/girl", name, theme, sex)
	}
```

Then add a new test proving the stale-client protection (the design spec's finding #2 — this is the load-bearing test for that fix):

```go
// A caregiver on a stale service-worker shell PATCHes the whole baby object
// without a "sex" key at all (its local copy predates the field). That must
// not erase a sex value a different, up-to-date caregiver already set.
func TestHandlePatchBabyLeavesSexUnchangedWhenOmitted(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()

	setReq := httptest.NewRequest("PATCH", "/api/baby", bytes.NewBufferString(`{"name":"Olive","sex":"girl"}`))
	setReq = withSession(setReq, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handlePatchBaby(db, hub)(httptest.NewRecorder(), setReq)

	staleReq := httptest.NewRequest("PATCH", "/api/baby", bytes.NewBufferString(`{"name":"Olive","birthdate":"2026-02-01"}`))
	staleReq = withSession(staleReq, SessionInfo{CaregiverID: "cg2", FamilyID: "fam1"})
	rec := httptest.NewRecorder()
	handlePatchBaby(db, hub)(rec, staleReq)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var sex string
	db.QueryRow(`SELECT sex FROM babies WHERE family_id = 'fam1'`).Scan(&sex)
	if sex != "girl" {
		t.Errorf("sex = %q, want girl (a stale PATCH without a sex key must not erase it)", sex)
	}
}
```

In `server/sync_test.go`, change `TestHandleSyncIncludesBabyWhenChanged` from:

```go
	reqPatch := httptest.NewRequest("PATCH", "/api/baby", bytes.NewBufferString(`{"name":"Olive","theme":"boy"}`))
	reqPatch = withSession(reqPatch, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handlePatchBaby(db, hub)(httptest.NewRecorder(), reqPatch)

	req := httptest.NewRequest("GET", "/api/sync?since=", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleSync(db)(rec, req)

	var resp syncResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Baby == nil {
		t.Fatal("expected baby to be included")
	}
	var baby struct {
		Name string `json:"name"`
	}
	json.Unmarshal(resp.Baby, &baby)
	if baby.Name != "Olive" {
		t.Errorf("baby.name = %q, want Olive", baby.Name)
	}
```

to:

```go
	reqPatch := httptest.NewRequest("PATCH", "/api/baby", bytes.NewBufferString(`{"name":"Olive","theme":"boy","sex":"boy"}`))
	reqPatch = withSession(reqPatch, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handlePatchBaby(db, hub)(httptest.NewRecorder(), reqPatch)

	req := httptest.NewRequest("GET", "/api/sync?since=", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleSync(db)(rec, req)

	var resp syncResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Baby == nil {
		t.Fatal("expected baby to be included")
	}
	var baby struct {
		Name string `json:"name"`
		Sex  string `json:"sex"`
	}
	json.Unmarshal(resp.Baby, &baby)
	if baby.Name != "Olive" || baby.Sex != "boy" {
		t.Errorf("baby.name=%q baby.sex=%q, want Olive/boy", baby.Name, baby.Sex)
	}
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd server && go test ./...`
Expected: FAIL (compile error — `sex` isn't a field yet on any of these structs).

- [ ] **Step 6: Implement the server changes**

In `server/family.go`, change `createFamilyRequest`:

```go
type createFamilyRequest struct {
	BabyName      string `json:"babyName"`
	Birthdate     string `json:"birthdate"`
	Theme         string `json:"theme"`
	Sex           string `json:"sex"`
	CaregiverName string `json:"caregiverName"`
}
```

Change `provisionFamily`'s signature and body:

```go
// provisionFamily inserts a family, its baby, its first caregiver (always
// role 'Parent'), and default settings within tx. Shared by the manual
// onboarding form (handleCreateFamily) and the OAuth first-sign-in path
// (reconcile.go), which differ only in the values supplied.
func provisionFamily(tx *sql.Tx, familyID, babyID, caregiverID, babyName, birthdate, theme, sex, caregiverName, now string) error {
	if _, err := tx.Exec(`INSERT INTO families (id, created_at) VALUES (?, ?)`, familyID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO babies (id, family_id, name, birthdate, theme, sex, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		babyID, familyID, babyName, birthdate, theme, sex, now); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES (?, ?, ?, 'Parent', ?, ?)`,
		caregiverID, familyID, caregiverName, now, now); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO settings (family_id, units_json, reminders_json, cards_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
		familyID, defaultUnitsJSON, defaultRemindersJSON, defaultCardsJSON, now); err != nil {
		return err
	}
	return nil
}
```

Change the call site inside `handleCreateFamily` — unlike `theme`, `sex` gets no forced default (an empty `sex` is the valid "not yet set" state the graceful-omission UI relies on):

```go
		if err := provisionFamily(tx, familyID, babyID, caregiverID, req.BabyName, req.Birthdate, theme, req.Sex, caregiverName, now); err != nil {
```

Change `patchBabyRequest`:

```go
type patchBabyRequest struct {
	Name      string  `json:"name"`
	Birthdate string  `json:"birthdate"`
	Theme     string  `json:"theme"`
	Photo     string  `json:"photo"`
	Sex       *string `json:"sex"`
}
```

Change `handlePatchBaby`'s `UPDATE`:

```go
		res, err := tx.Exec(`UPDATE babies SET name = ?, birthdate = ?, theme = ?, photo = ?, sex = COALESCE(?, sex), updated_at = ?, rev = ? WHERE family_id = ?`,
			req.Name, req.Birthdate, req.Theme, req.Photo, req.Sex, now, rev, session.FamilyID)
```

In `server/reconcile.go`, change the `provisionFamily` call site (OAuth first-sign-in):

```go
			if e = provisionFamily(tx, newFamily, newBaby, newCare, "", "", "girl", "", "Parent", now); e != nil {
```

In `server/sync.go`, change the baby query and marshal in `handleSync`:

```go
		var name, birthdate, theme, sex string
		var photo sql.NullString
		var babyRev int64
		err = tx.QueryRow(`SELECT name, birthdate, theme, sex, photo, rev FROM babies WHERE family_id = ?`, session.FamilyID).
			Scan(&name, &birthdate, &theme, &sex, &photo, &babyRev)
		if err == nil && babyRev > since {
			b, _ := json.Marshal(map[string]any{"name": name, "birthdate": birthdate, "theme": theme, "sex": sex, "photo": photo.String})
			resp.Baby = b
		}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd server && go test ./...`
Expected: PASS (all tests, including the 3 new/modified ones above)

- [ ] **Step 8: Commit**

```bash
git add server/migrations/0013_add_baby_sex.sql server/schema.sql server/family.go server/reconcile.go server/sync.go server/family_test.go server/settings_test.go server/sync_test.go
git commit -m "feat(server): add a baby sex field, distinct from the cosmetic theme field"
```

---

### Task 5: Onboarding — required sex picker

**Files:**
- Modify: `js/onboarding.js`, `js/app.js`, `styles.css`, `tests/helpers.js`
- Test: `tests/onboarding-sex.test.js` (new)

**Interfaces:**
- Consumes: `state()`, `save()` from `js/store.js` (already imported in `onboarding.js`); `$`, `$$`, `toast` from `js/ui.js` (already imported).
- Produces: `onboardSex(sex)` export from `onboarding.js`; `'onboard:sex'` dispatch action in `app.js`; `state().baby.sex` set before the `/api/family` POST.

This is a required field (per the design spec), and the shared Playwright `onboard()` helper in `tests/helpers.js` drives onboarding for roughly 30 other test files — it must select a sex or every one of those suites breaks the moment this field becomes required.

- [ ] **Step 1: Add the sex picker markup**

In `js/onboarding.js`, insert a new field block right after the Theme block (after the `</div>` that closes the `theme-pick` div, before the caregiver-name `<label>`):

```html
      <div class="fld"><span class="fld-l">Sex</span>
        <div class="theme-pick" style="padding: 8px 0;">
          <button type="button" class="sex-opt" data-action="onboard:sex" data-sex="girl"><span>Girl</span></button>
          <button type="button" class="sex-opt" data-action="onboard:sex" data-sex="boy"><span>Boy</span></button>
        </div>
      </div>
```

Full context — the block right before it stays unchanged:

```html
      <div class="fld"><span class="fld-l">Theme</span>
        <div class="theme-pick" style="padding: 8px 0;">
          <button type="button" class="theme-opt ${t === 'girl' ? 'on' : ''}" data-action="onboard:theme" data-theme="girl"><span class="theme-swatch girl"></span><span>Girl</span></button>
          <button type="button" class="theme-opt ${t === 'boy' ? 'on' : ''}" data-action="onboard:theme" data-theme="boy"><span class="theme-swatch boy"></span><span>Boy</span></button>
          <button type="button" class="theme-opt ${t === 'dayjob-girl' ? 'on' : ''}" data-action="onboard:theme" data-theme="dayjob-girl"><span class="theme-swatch dayjob-girl"></span><span>Warm</span></button>
          <button type="button" class="theme-opt ${t === 'dayjob-boy' ? 'on' : ''}" data-action="onboard:theme" data-theme="dayjob-boy"><span class="theme-swatch dayjob-boy"></span><span>Cool</span></button>
        </div>
      </div>

      <div class="fld"><span class="fld-l">Sex</span>
        <div class="theme-pick" style="padding: 8px 0;">
          <button type="button" class="sex-opt" data-action="onboard:sex" data-sex="girl"><span>Girl</span></button>
          <button type="button" class="sex-opt" data-action="onboard:sex" data-sex="boy"><span>Boy</span></button>
        </div>
      </div>

      <label class="fld"><span class="fld-l">Your name <span class="opt">(caregiver)</span></span>
        <input id="onb-cg" placeholder="e.g. Maya" autocomplete="off" /></label>
```

Note: `sex-opt` is a distinct class from `theme-opt`, not a reuse of it. `onboardTheme()` (below) does `$$('.theme-opt').forEach(...)` to update the theme highlight; if the sex buttons also carried `theme-opt`, that call would toggle `.on` off them every time a theme swatch is clicked (their `dataset.theme` is always `undefined`, never matching). It would also break `tests/onboarding-theme.test.js`, which asserts `.theme-opt` elements are exactly the 4 theme choices. `styles.css` gives `.sex-opt` the identical pill styling by adding it to `.theme-opt`'s selector list (Step 4), so the two look the same without sharing a class name.

- [ ] **Step 2: Add the `_onbSex` state, `onboardSex()`, and required validation**

In `js/onboarding.js`, change:

```js
let _onbPhoto = null;
```

to:

```js
let _onbPhoto = null;
let _onbSex = '';
```

Add a new exported function, near `onboardTheme`:

```js
export function onboardSex(sex) {
  _onbSex = sex;
  $$('.sex-opt').forEach((b) => b.classList.toggle('on', b.dataset.sex === sex));
}
```

In `onboardFinish()`, change:

```js
export async function onboardFinish() {
  const name = $('#onb-name').value.trim();
  if (!name) { $('#onb-name').focus(); $('#onb-name').classList.add('shake'); setTimeout(() => $('#onb-name').classList.remove('shake'), 500); return; }
  const st = state();
  st.baby.name = name;
  st.baby.birthdate = $('#onb-bd').value || '';
  st.baby.theme = document.body.dataset.theme || 'girl';
  st.baby.caregiver = $('#onb-cg').value.trim();
```

to:

```js
export async function onboardFinish() {
  const name = $('#onb-name').value.trim();
  if (!name) { $('#onb-name').focus(); $('#onb-name').classList.add('shake'); setTimeout(() => $('#onb-name').classList.remove('shake'), 500); return; }
  if (!_onbSex) {
    const grp = $('.sex-opt')?.closest('.theme-pick');
    if (grp) { grp.classList.add('shake'); setTimeout(() => grp.classList.remove('shake'), 500); }
    toast('Please choose a sex to continue');
    return;
  }
  const st = state();
  st.baby.name = name;
  st.baby.birthdate = $('#onb-bd').value || '';
  st.baby.theme = document.body.dataset.theme || 'girl';
  st.baby.sex = _onbSex;
  st.baby.caregiver = $('#onb-cg').value.trim();
```

- [ ] **Step 3: Include `sex` in the `/api/family` POST body**

In `js/onboarding.js`, change:

```js
      body: JSON.stringify({
        babyName: name, birthdate: st.baby.birthdate, theme: st.baby.theme,
        caregiverName: st.baby.caregiver || 'Parent'
      })
```

to:

```js
      body: JSON.stringify({
        babyName: name, birthdate: st.baby.birthdate, theme: st.baby.theme, sex: st.baby.sex,
        caregiverName: st.baby.caregiver || 'Parent'
      })
```

- [ ] **Step 4: Add CSS for `.sex-opt` and the picker-group shake**

In `styles.css`, change:

```css
.theme-opt { all: unset; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 14px; border: 1.5px solid var(--hair); font-weight: 700; font-size: 14px; color: oklch(0.18 0.02 50); background: var(--surface); box-shadow: 0 2px 6px oklch(0 0 0 / .07), 0 1px 2px oklch(0 0 0 / .05), inset 0 1px 0 oklch(1 0 0 / .75); transition: box-shadow .1s; }
.theme-opt.on { border-color: var(--accent); background: var(--accent-tint); color: var(--accent-ink); box-shadow: 0 1px 2px oklch(0 0 0 / .05), inset 0 2px 4px oklch(0 0 0 / .08), inset 0 1px 0 color-mix(in oklch, var(--accent) 30%, white 70%); }
```

to:

```css
.theme-opt, .sex-opt { all: unset; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 14px; border: 1.5px solid var(--hair); font-weight: 700; font-size: 14px; color: oklch(0.18 0.02 50); background: var(--surface); box-shadow: 0 2px 6px oklch(0 0 0 / .07), 0 1px 2px oklch(0 0 0 / .05), inset 0 1px 0 oklch(1 0 0 / .75); transition: box-shadow .1s; }
.theme-opt.on, .sex-opt.on { border-color: var(--accent); background: var(--accent-tint); color: var(--accent-ink); box-shadow: 0 1px 2px oklch(0 0 0 / .05), inset 0 2px 4px oklch(0 0 0 / .08), inset 0 1px 0 color-mix(in oklch, var(--accent) 30%, white 70%); }
```

Change the dark-mode variant:

```css
[data-mode="dark"] .theme-opt { box-shadow: 0 2px 6px oklch(0 0 0 / .2), 0 1px 2px oklch(0 0 0 / .15), inset 0 1px 0 oklch(1 0 0 / .12), inset 0 0 10px oklch(1 0 0 / .04); }
```

to:

```css
[data-mode="dark"] .theme-opt, [data-mode="dark"] .sex-opt { box-shadow: 0 2px 6px oklch(0 0 0 / .2), 0 1px 2px oklch(0 0 0 / .15), inset 0 1px 0 oklch(1 0 0 / .12), inset 0 0 10px oklch(1 0 0 / .04); }
```

Add a shake rule for the sex picker's wrapping `.theme-pick` (the existing `.shake` rule at `input.shake` is scoped to inputs only and adds a border-color change that doesn't apply to a `<div>`):

```css
.theme-pick.shake { animation: shake .4s; }
```

Add this line directly after the existing `@keyframes shake { ... }` rule.

- [ ] **Step 5: Register the `onboard:sex` dispatch action**

In `js/app.js`, add to the click-delegation map, next to the existing `'onboard:theme'` entry:

```js
    'onboard:theme': () => onboardTheme(d.theme),
    'onboard:sex': () => onboardSex(d.sex),
```

Update the import line at the top of `js/app.js`:

```js
import { onboarding, onboardTheme, onboardPhoto, onboardFinish, provisionedView } from './onboarding.js';
```

to:

```js
import { onboarding, onboardTheme, onboardSex, onboardPhoto, onboardFinish, provisionedView } from './onboarding.js';
```

- [ ] **Step 6: Fix the shared Playwright onboarding helper**

In `tests/helpers.js`, change:

```js
  if (await page.$('#onb-name')) {
    await page.fill('#onb-name', 'Test');
    await page.fill('#onb-bd', '2025-01-01');
    await page.fill('#onb-cg', 'Maya');
    await page.click('[data-action="onboard:finish"]');
    await page.waitForTimeout(800);
  }
```

to:

```js
  if (await page.$('#onb-name')) {
    await page.fill('#onb-name', 'Test');
    await page.fill('#onb-bd', '2025-01-01');
    await page.click('[data-action="onboard:sex"][data-sex="girl"]');
    await page.fill('#onb-cg', 'Maya');
    await page.click('[data-action="onboard:finish"]');
    await page.waitForTimeout(800);
  }
```

- [ ] **Step 7: Write the new e2e test**

Create `tests/onboarding-sex.test.js`, mirroring `tests/onboarding-theme.test.js`'s structure:

```js
const { startServer, launchBrowser, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18796);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await page.waitForSelector('.sex-opt');

    const sexes = await page.$$eval('.sex-opt', (els) => els.map((el) => el.dataset.sex));
    check('onboarding shows two sex choices', sexes.join(',') === 'girl,boy', sexes.join(','));

    await page.fill('#onb-name', 'Test Baby');
    await page.click('[data-action="onboard:finish"]');
    await page.waitForTimeout(300);
    const stillOnboarding = await page.$('#onb-name');
    check('finishing without a sex choice does not complete onboarding', !!stillOnboarding);
    const groupShaken = await page.$eval('.sex-opt', (el) => el.closest('.theme-pick').classList.contains('shake'));
    check('the sex picker shakes when required and missing', groupShaken);

    await page.click('.sex-opt[data-sex="boy"]');
    const selected = await page.$eval('.sex-opt[data-sex="boy"]', (el) => el.classList.contains('on'));
    check('selecting boy highlights it', selected);

    await page.click('[data-action="onboard:finish"]');
    await page.waitForTimeout(800);
    const onApp = await page.$('.tabbar');
    check('onboarding completes once a sex is chosen', !!onApp);

    const savedSex = await page.evaluate(() => JSON.parse(localStorage.getItem('hearth.state.v1')).baby.sex);
    check('the chosen sex persists to state', savedSex === 'boy', savedSex);
  } catch (e) {
    check('onboarding sex test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 8: Run the new and existing onboarding e2e tests**

Run: `CHROMIUM=/usr/bin/chromium node tests/onboarding-sex.test.js`
Run: `CHROMIUM=/usr/bin/chromium node tests/onboarding-theme.test.js`
Expected: both PASS (0 fail). If Chromium isn't available locally, note that and rely on CI's `e2e` matrix leg for this file per CLAUDE.md.

- [ ] **Step 9: Spot-check a couple of the ~30 suites that use the shared `onboard()` helper**

Run: `CHROMIUM=/usr/bin/chromium node tests/persistence.test.js`
Run: `CHROMIUM=/usr/bin/chromium node tests/first-account-gating.test.js`
Expected: both PASS — confirms Step 6's helper fix keeps the broader suite working. Full confirmation comes from CI's `e2e` matrix leg (all `tests/*.test.js` files), which is the actual gate for a change this broad per CLAUDE.md.

- [ ] **Step 10: Commit**

```bash
git add js/onboarding.js js/app.js styles.css tests/helpers.js tests/onboarding-sex.test.js
git commit -m "feat(onboarding): add a required sex picker, distinct from the theme picker"
```

---

### Task 6: Profile — editable sex control

**Files:**
- Modify: `js/profile.js`, `js/app.js`

**Interfaces:**
- Produces: `'sex:pick'` dispatch action in `app.js`, following the exact pattern of the existing `'theme:pick'` action.

`js/profile.js` always fully re-renders on every action (`router.refresh()`), unlike `onboarding.js`'s incremental DOM patching — so unlike Task 5, there's no `.on`-class cross-talk risk here, and reusing the literal `theme-opt` class is safe (confirmed no e2e test scopes a `.theme-opt` count assertion to the Profile page).

- [ ] **Step 1: Add the Sex section to `profile()`**

In `js/profile.js`, insert a new section right after the Theme card block:

```html
    <div class="sec-label">Sex</div>
    <div class="card row-card">
      <div class="theme-pick">
        <button type="button" class="theme-opt${b.sex === 'girl' ? ' on' : ''}" data-action="sex:pick" data-sex="girl"><span>Girl</span></button>
        <button type="button" class="theme-opt${b.sex === 'boy' ? ' on' : ''}" data-action="sex:pick" data-sex="boy"><span>Boy</span></button>
      </div>
      <p class="empty-note">Used to calculate growth percentiles on the Growth tab.</p>
    </div>
```

Full context — insert it between the existing Theme block and the Appearance block:

```html
    <div class="sec-label">Theme</div>
    <div class="card row-card">
      <div class="theme-set">
        <div class="theme-section">
          <div class="theme-section-hd">Original</div>
          <div class="theme-pick">${thOpt('girl', 'girl', 'Girl')}${thOpt('boy', 'boy', 'Boy')}</div>
        </div>
        <div class="theme-section">
          <div class="theme-section-hd">Day Job</div>
          <div class="theme-pick">${thOpt('dayjob-girl', 'dayjob-girl', 'Girl')}${thOpt('dayjob-boy', 'dayjob-boy', 'Boy')}</div>
        </div>
      </div>
    </div>

    <div class="sec-label">Sex</div>
    <div class="card row-card">
      <div class="theme-pick">
        <button type="button" class="theme-opt${b.sex === 'girl' ? ' on' : ''}" data-action="sex:pick" data-sex="girl"><span>Girl</span></button>
        <button type="button" class="theme-opt${b.sex === 'boy' ? ' on' : ''}" data-action="sex:pick" data-sex="boy"><span>Boy</span></button>
      </div>
      <p class="empty-note">Used to calculate growth percentiles on the Growth tab.</p>
    </div>

    <div class="sec-label">Appearance</div>
```

- [ ] **Step 2: Register the `sex:pick` dispatch action**

In `js/app.js`, add next to the existing `'theme:pick'` entry:

```js
    'theme:pick': () => {
      state().settings.theme = d.theme;
      state().baby.theme = d.theme;
      save();
      enqueueBabySync();
      applyTheme();
      router.refresh();
    },
    'sex:pick': () => {
      state().baby.sex = d.sex;
      save();
      enqueueBabySync();
      router.refresh();
    },
```

- [ ] **Step 3: Manually verify in the browser**

Use the `run` skill to launch the dev server, navigate to Profile, click each sex option, confirm it highlights and persists across a reload.

- [ ] **Step 4: Commit**

```bash
git add js/profile.js js/app.js
git commit -m "feat(profile): add an editable sex control alongside the theme picker"
```

---

### Task 7: Growth tab — percentile badge and WHO median overlay

**Files:**
- Modify: `js/growth.js`, `styles.css`
- Test: `js/growth.test.js`

**Interfaces:**
- Consumes: `percentileFor`, `medianCurveFor`, `ageMonthsAt` from `js/growth-percentiles.js` (Task 3); `state().baby.sex`, `state().baby.birthdate` (Task 2).
- Produces: a percentile line under each stat card's value; a second (dashed, muted) polyline on `lineChart()`.

Per the design spec, both the badge and the overlay omit cleanly — no placeholder state — when `sex` is unset or the baby is older than 24 months. This is evaluated against the age of the *most recent applicable measurement*, not wall-clock "today": since every logged growth point is necessarily in the past, the latest point being within 0-24 months already guarantees every earlier point is too, so gating on the latest point covers the whole series without needing the real-world current date at all — which also keeps the unit tests below deterministic regardless of when they're actually run, instead of silently drifting once real time passes a fixed test birthdate's 24-month mark.

- [ ] **Step 1: Write the failing tests**

Add to `js/growth.test.js`:

```js
test('growth() shows a percentile badge on a stat card when sex and birthdate are set', () => {
  state().baby.sex = 'boy';
  state().baby.birthdate = '2026-01-01';
  state().growth = [];
  addMeasure({ date: '2026-07-01', weightKg: 7.934 }); // month 6 WHO median for boys -> 50th percentile
  const html = growth();
  assert.match(html, /<div class="stat-pctl">50th percentile<\/div>/);
});

test('growth() omits the percentile badge when sex is unset', () => {
  state().baby.sex = '';
  state().baby.birthdate = '2026-01-01';
  state().growth = [];
  addMeasure({ date: '2026-07-01', weightKg: 7.934 });
  const html = growth();
  assert.doesNotMatch(html, /stat-pctl/);
});

test('growth() omits the percentile badge and chart overlay when the baby is older than 24 months', () => {
  state().baby.sex = 'boy';
  state().baby.birthdate = '2020-01-01'; // well past 24 months old
  state().growth = [];
  addMeasure({ date: '2026-06-01', weightKg: 15 });
  addMeasure({ date: '2026-07-01', weightKg: 15.2 });
  const html = growth();
  assert.doesNotMatch(html, /stat-pctl/);
  assert.doesNotMatch(html, /class="who-median"/);
});

test('growth() draws a WHO median overlay polyline on the chart when sex and birthdate are set', () => {
  showGrowthStat('weightKg');
  state().baby.sex = 'girl';
  state().baby.birthdate = '2026-01-01';
  state().growth = [];
  addMeasure({ date: '2026-04-01', weightKg: 5.8 }); // ~month 3
  addMeasure({ date: '2026-07-01', weightKg: 7.2 }); // ~month 6
  const html = growth();
  assert.match(html, /class="who-median"/);
  state().baby.sex = ''; // reset module-external state for later tests
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test js/growth.test.js`
Expected: FAIL — no `.stat-pctl` or `.who-median` markup exists yet.

- [ ] **Step 3: Implement the badge and overlay**

In `js/growth.js`, change the import line:

```js
import { state, ageLabel } from './store.js';
```

to:

```js
import { state, ageLabel } from './store.js';
import { percentileFor, medianCurveFor, ageMonthsAt } from './growth-percentiles.js';
```

Add helper functions right after `prevWithField` (before the `STATS` block):

```js
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Evaluated against the age of the most recent applicable measurement, not
// wall-clock "today" -- deterministic regardless of when this code runs, and
// every earlier point is necessarily younger anyway, so gating on the latest
// point already covers the whole series.
function percentileSupported(baby, latest) {
  if (!baby.sex || !baby.birthdate || !latest) return false;
  return ageMonthsAt(baby.birthdate, latest.date) <= 24;
}

function percentileBadge(statKey, latest, baby) {
  if (!latest || !percentileSupported(baby, latest)) return '';
  const stat = STATS[statKey];
  const val = latest[stat.field];
  if (val == null) return '';
  const months = ageMonthsAt(baby.birthdate, latest.date);
  const p = percentileFor(statKey, baby.sex, months, val);
  if (p == null) return '';
  return `<div class="stat-pctl">${ordinal(Math.round(p))} percentile</div>`;
}
```

Change `lineChart()` to accept the baby and draw the overlay:

```js
function lineChart(points, statKey, baby) {
  const stat = STATS[statKey] || STATS.weightKg;
  const pts0 = points.filter((p) => p[stat.field] != null);
  if (pts0.length < 2) return `<div class="empty-log">Add at least two measurements to see a ${stat.label.toLowerCase()} curve.</div>`;
  const overlay = percentileSupported(baby, pts0[pts0.length - 1])
    ? medianCurveFor(statKey, baby.sex, pts0.map((p) => ageMonthsAt(baby.birthdate, p.date)))
    : null;
  const overlayVals = overlay ? overlay.filter((v) => v != null) : [];
  const W = 320, Hh = 150, pad = 24, padB = 26;
  const ws = pts0.map((p) => p[stat.field]);
  const min = Math.min(...ws, ...overlayVals), max = Math.max(...ws, ...overlayVals);
  const range = (max - min) || 1;
  const x = (i) => pad + (i / (pts0.length - 1)) * (W - pad * 2);
  const y = (w) => pad + (1 - (w - min) / range) * (Hh - pad - padB);
  const pts = pts0.map((p, i) => `${x(i).toFixed(1)},${y(p[stat.field]).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${(Hh - padB).toFixed(1)} ${pts} ${x(pts0.length - 1).toFixed(1)},${(Hh - padB).toFixed(1)}`;
  const overlayPts = overlay && overlay.every((v) => v != null)
    ? pts0.map((p, i) => `${x(i).toFixed(1)},${y(overlay[i]).toFixed(1)}`).join(' ')
    : null;
  return `<svg class="growth-svg" viewBox="0 0 ${W} ${Hh}">
    <polygon points="${area}" fill="var(--accent-soft)" opacity="0.5" />
    ${overlayPts ? `<polyline class="who-median" points="${overlayPts}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="4 3" stroke-linejoin="round" stroke-linecap="round" />` : ''}
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
    ${pts0.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p[stat.field]).toFixed(1)}" r="${i === pts0.length - 1 ? 5 : 3.5}" fill="${i === pts0.length - 1 ? 'var(--accent)' : 'var(--surface)'}" stroke="var(--accent)" stroke-width="2" />`).join('')}
    ${pts0.map((p, i) => `<text x="${x(i).toFixed(1)}" y="${Hh - 8}" text-anchor="middle" class="growth-x">${localDate(p.date).toLocaleDateString(undefined, { month: 'short' })}</text>`).join('')}
  </svg>`;
}
```

Change `growth()` to pass `baby` through and insert the badges:

```js
export function growth() {
  const g = state().growth.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const baby = state().baby;
  const latest = g[g.length - 1];
  const prevWeight = prevWithField(g, 'weightKg');
  const prevHeight = prevWithField(g, 'heightCm');
  const prevHead = prevWithField(g, 'headCm');
  return `
    <div class="page-hd">
      <h1 class="page-title">Growth</h1>
      <div class="page-sub">${esc(state().baby.name || 'Baby')} · ${ageLabel()}</div>
    </div>

    <div class="stat-grid growth-stats">
      <div class="card stat ${shownStat === 'weightKg' ? 'stat-active' : ''}" data-action="growth:showstat" data-stat="weightKg"><div class="stat-k">Weight</div><div class="stat-v">${latest ? dispW(latest.weightKg) : '—'}</div>${percentileBadge('weightKg', latest, baby)}${delta(latest && latest.weightKg, prevWeight && prevWeight.weightKg, (v) => dispW(v).replace(/ (kg|lb)/, ' '))}</div>
      <div class="card stat ${shownStat === 'heightCm' ? 'stat-active' : ''}" data-action="growth:showstat" data-stat="heightCm"><div class="stat-k">Height</div><div class="stat-v">${latest ? dispL(latest.heightCm) : '—'}</div>${percentileBadge('heightCm', latest, baby)}${delta(latest && latest.heightCm, prevHeight && prevHeight.heightCm, (v) => dispL(v).replace(/ (cm|in)/, ' '))}</div>
      <div class="card stat ${shownStat === 'headCm' ? 'stat-active' : ''}" data-action="growth:showstat" data-stat="headCm"><div class="stat-k">Head</div><div class="stat-v">${latest && latest.headCm ? dispL(latest.headCm) : '—'}</div>${percentileBadge('headCm', latest, baby)}${delta(latest && latest.headCm, prevHead && prevHead.headCm, (v) => dispL(v).replace(/ (cm|in)/, ' '))}</div>
      <div class="card stat"><div class="stat-k">Measurements</div><div class="stat-v">${g.length}</div></div>
    </div>

    <div class="card chart-card">
      <div class="chart-hd"><h2>${STATS[shownStat].label}</h2><span class="chart-note">over time</span></div>
      ${lineChart(g, shownStat, baby)}
    </div>

    <div class="today-block">
      <div class="today-hd"><h2>History</h2><button class="today-add" data-action="measure:open" data-id="" aria-label="Add measurement"><svg class="icon"><use href="#plus"></use></svg></button></div>
      <div class="card log">${g.length ? g.slice().reverse().map((m, i, arr) => measureRow(m, arr[i + 1])).join('') : `<div class="empty-log">No measurements yet. Tap the + button to add one.</div>`}</div>
    </div>`;
}
```

- [ ] **Step 4: Add the badge CSS**

In `styles.css`, change:

```css
.delta { font-size: 11px; font-weight: 800; margin-top: 2px; display: block; }
```

to:

```css
.stat-pctl { font-size: 11px; font-weight: 700; color: var(--muted); margin-top: 2px; }
.delta { font-size: 11px; font-weight: 800; margin-top: 2px; display: block; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test js/growth.test.js`
Expected: PASS (all tests, including the 8 pre-existing ones — confirm none regressed)

- [ ] **Step 6: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS (every `js/*.test.js` file)

- [ ] **Step 7: Manually verify in the browser**

Use the `run` skill: onboard a fresh baby with a birthdate a few months in the past and a sex chosen, log 2+ weight measurements, confirm the percentile badge and the dashed WHO median line both render on the Growth tab. Then set the baby's birthdate to 3 years ago via Profile and confirm both disappear cleanly.

- [ ] **Step 8: Commit**

```bash
git add js/growth.js js/growth.test.js styles.css
git commit -m "feat(growth): add WHO percentile badges and a median overlay to the growth chart"
```

---

### Task 8: Service worker cache registration and changelog

**Files:**
- Modify: `sw.js`, `js/changelog.js`

**Interfaces:** none (final integration task).

- [ ] **Step 1: Add the two new modules to `SHELL`**

In `sw.js`, change:

```js
  './js/growth.js',
  './js/profile.js',
```

to:

```js
  './js/growth.js',
  './js/growth-percentiles.js',
  './js/growth-percentiles-data.js',
  './js/profile.js',
```

- [ ] **Step 2: Bump the version**

Run: `scripts/bump-version.sh`
Verify both printed lines (`index.html`'s `<meta name="version">` and `sw.js`'s `VERSION` constant) show the same new UTC timestamp.

- [ ] **Step 3: Add the changelog entry**

In `js/changelog.js`, add one entry to today's dated block (create a new block at the top if the calendar day has rolled over since the last entry), in plain parent-facing language, features before fixes:

```
Growth percentiles: see how your baby's weight, height, and head size compare to WHO growth charts, right on the Growth tab.
```

Also note the required-sex-picker change in onboarding is not separately called out — it's part of the same user-facing feature (percentiles need a sex to compute), so one entry covers both.

- [ ] **Step 4: Run the full local check**

Run: `node --test js/*.test.js`
Run: `cd server && go test ./...`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add sw.js index.html js/changelog.js
git commit -m "chore(growth): cache the new percentile modules offline and add a changelog entry"
```

---

## Final Verification

Before opening the PR:

- [ ] `node --test js/*.test.js` — all pass
- [ ] `cd server && go test ./...` — all pass
- [ ] `CHROMIUM=/usr/bin/chromium node tests/onboarding-sex.test.js` and `tests/onboarding-theme.test.js` — both pass locally (or note Chromium unavailable and defer to CI)
- [ ] Manually verified in-browser: onboarding requires a sex choice; Growth tab shows a badge and overlay for a 0-24-month baby with sex set; both disappear cleanly for an older baby or unset sex; Profile's sex control edits and persists
- [ ] `scripts/bump-version.sh` was run before the final commit
- [ ] `js/changelog.js` has one entry for this feature
- [ ] Open the PR, let CI's full `e2e` matrix leg confirm no other Playwright suite regressed from the required-sex-picker change
