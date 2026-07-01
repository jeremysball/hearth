# Sleep Edge Cases Implementation Plan

> **Status:** COMPLETE — merged to `main` (the three fix commits `6e9cb90`, `1e7a85b`, `5b7ef61` are on `main`); this plan doc was rescued from a since-pruned worktree on 2026-07-01.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four sleep-tracking bugs (dangling open sleeps, overnight sleep not counted in today's stats, overlapping sleep double-counting, future-start sleep shown as asleep) and document them with a new test file.

**Architecture:** Add one new store function (`autoCloseOngoingSleep`), call it from `saveLog` in sheets.js for type `sleep`, and replace the `sleepMin` accumulator in `todayStats` with an interval-merge approach that handles overnight and overlapping entries.

**Tech Stack:** Vanilla JS (ESM), Node built-in test runner (`node --test`), localStorage-based state.

## Global Constraints

- Worktree root: `/workspace/hearth/.claude/worktrees/cozy-crunching-mccarthy`
- All commands run from that directory
- No framework — vanilla JS only
- Run tests with: `node --test js/sleep-edge-cases.test.js`
- Run full suite with: `node --test js/*.test.js`
- Commit format: Conventional Commits (`fix(sleep): …`)
- Version bump (both `index.html` `<meta name="version">` and `sw.js` `VERSION`) required before every commit that touches user-facing JS — do it last, once, before the final commit using `date -u +%Y-%m-%dT%H:%MZ`

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `js/sleep-edge-cases.test.js` | Create | 7 edge-case tests, all expected to fail before fixes |
| `js/store.js` | Modify | Add `autoCloseOngoingSleep`; replace `sleepMin` loop in `todayStats` |
| `js/sheets.js` | Modify | Call `autoCloseOngoingSleep` in `saveLog` for type `sleep` |

---

### Task 1: Write the edge-case test file (failing)

**Files:**
- Create: `js/sleep-edge-cases.test.js`

**Interfaces:**
- Consumes: `state`, `derive`, `addEntry`, `updateEntry`, `autoCloseOngoingSleep` from `./store.js`
- `autoCloseOngoingSleep` does not exist yet — tests that use it will throw on import; that is the expected failure mode for Task 1

- [ ] **Step 1: Create `js/sleep-edge-cases.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.store = {}; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  setItem(k, v) { this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });

const { state, derive, addEntry, updateEntry, autoCloseOngoingSleep } = await import('./store.js');

// Seal all open sleeps so tests don't bleed into each other
function closeAllSleeps() {
  state().log.forEach((e) => { if (e.type === 'sleep' && !e.end) updateEntry(e.id, { end: e.start }); });
}

// ── Test 1 ── autoCloseOngoingSleep closes an open sleep at the new start time
test('autoCloseOngoingSleep closes open sleep when new sleep starts after it', () => {
  closeAllSleeps();
  const t0 = new Date(Date.now() - 60 * 60000).toISOString(); // 1h ago
  const t1 = new Date(Date.now() - 10 * 60000).toISOString(); // 10min ago
  const first = addEntry({ type: 'sleep', start: t0 });
  autoCloseOngoingSleep(t1);
  const updated = state().log.find((e) => e.id === first.id);
  assert.equal(updated.end, t1, 'ongoing sleep should be closed at the new sleep start');
  // cleanup
  updateEntry(first.id, { end: first.start });
});

// ── Test 2 ── autoCloseOngoingSleep is a no-op when new start is before or equal to ongoing start
test('autoCloseOngoingSleep does not close a sleep that started after the new entry', () => {
  closeAllSleeps();
  const t0 = new Date(Date.now() - 5 * 60000).toISOString();  // 5min ago (ongoing)
  const tBack = new Date(Date.now() - 90 * 60000).toISOString(); // 90min ago (backdated new entry)
  const first = addEntry({ type: 'sleep', start: t0 });
  autoCloseOngoingSleep(tBack);
  const updated = state().log.find((e) => e.id === first.id);
  assert.equal(updated.end, undefined, 'sleep that started after the backdated entry should stay open');
  // cleanup
  updateEntry(first.id, { end: first.start });
});

// ── Test 3 ── todayStats counts overnight sleep (started yesterday, ends today)
test('todayStats counts the today-portion of an overnight sleep', () => {
  closeAllSleeps();
  const now = Date.now();
  // Sleep started 3h before midnight, ended 2h after midnight
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const sleepStart = new Date(midnight.getTime() - 3 * 60 * 60000).toISOString();
  const sleepEnd   = new Date(midnight.getTime() + 2 * 60 * 60000).toISOString();
  const e = addEntry({ type: 'sleep', start: sleepStart, end: sleepEnd });
  const stats = derive.todayStats();
  // Only the 2h after midnight should be counted
  assert.ok(stats.sleepMin >= 119 && stats.sleepMin <= 121,
    `expected ~120 min, got ${stats.sleepMin}`);
  // cleanup
  updateEntry(e.id, { end: e.start });
});

// ── Test 4 ── todayStats deduplicates overlapping sleep intervals
test('todayStats counts union not sum of overlapping sleeps', () => {
  closeAllSleeps();
  const now = Date.now();
  // Two sleeps: 08:00-10:00 and 09:00-11:00 → union is 3h not 4h
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const s1 = new Date(today.getTime() + 8 * 60 * 60000).toISOString();
  const e1 = new Date(today.getTime() + 10 * 60 * 60000).toISOString();
  const s2 = new Date(today.getTime() + 9 * 60 * 60000).toISOString();
  const e2 = new Date(today.getTime() + 11 * 60 * 60000).toISOString();
  const a = addEntry({ type: 'sleep', start: s1, end: e1 });
  const b = addEntry({ type: 'sleep', start: s2, end: e2 });
  const stats = derive.todayStats();
  assert.ok(stats.sleepMin >= 179 && stats.sleepMin <= 181,
    `expected ~180 min (union), got ${stats.sleepMin}`);
  // cleanup
  updateEntry(a.id, { end: a.start });
  updateEntry(b.id, { end: b.start });
});

// ── Test 5 ── derive.status returns awake for a sleep with a future start
test('derive.status is awake when only sleep entry has a future start', () => {
  closeAllSleeps();
  const futureStart = new Date(Date.now() + 30 * 60000).toISOString();
  const e = addEntry({ type: 'sleep', start: futureStart });
  const st = derive.status();
  assert.equal(st.state, 'awake', 'future-start sleep should not count as asleep');
  // cleanup
  updateEntry(e.id, { end: e.start });
});

// ── Test 6 ── zero-duration sleep does not crash todayStats
test('todayStats handles zero-duration sleep (start === end)', () => {
  closeAllSleeps();
  const ts = new Date(Date.now() - 5 * 60000).toISOString();
  const e = addEntry({ type: 'sleep', start: ts, end: ts });
  let stats;
  assert.doesNotThrow(() => { stats = derive.todayStats(); });
  assert.ok(stats.sleepMin >= 0, 'sleepMin should be non-negative');
  // cleanup
  updateEntry(e.id, { end: e.start });
});

// ── Test 7 ── after maybeInterruptSleep, only one open sleep exists
test('after interrupt-sleep split, only one sleep is open (the resumed one)', () => {
  closeAllSleeps();
  const r = state().settings.reminders;
  const savedStart = r.quietStart, savedEnd = r.quietEnd;
  try {
    const now = new Date();
    const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    r.quietStart = hhmm(new Date(now.getTime() - 60 * 60000));
    r.quietEnd   = hhmm(new Date(now.getTime() + 60 * 60000));

    const { maybeInterruptSleep } = await import('./store.js');
    addEntry({ type: 'sleep', start: new Date(now.getTime() - 40 * 60000).toISOString() });
    maybeInterruptSleep('bottle', now.toISOString());

    const openSleeps = state().log.filter((e) => e.type === 'sleep' && !e.end && new Date(e.start) <= now);
    assert.equal(openSleeps.length, 0, 'no sleep should be open immediately after the interrupt (gap window)');
  } finally {
    r.quietStart = savedStart; r.quietEnd = savedEnd;
    closeAllSleeps();
  }
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
node --test js/sleep-edge-cases.test.js 2>&1
```

Expected: most tests fail. `autoCloseOngoingSleep` will be undefined (import fails or throws). Tests 3 and 4 will fail due to overnight/overlap bugs. Test 5 may pass (already guarded by `<= new Date()`). Record which pass/fail.

---

### Task 2: Add `autoCloseOngoingSleep` to `store.js`

**Files:**
- Modify: `js/store.js` — add after `undoInterruptSleep` (~line 131)

**Interfaces:**
- Produces: `export function autoCloseOngoingSleep(newStartISO)` — closes the single ongoing sleep whose `start` is before `newStartISO`; no-op if none or if ongoing sleep starts after `newStartISO`; returns the closed entry or `null`

- [ ] **Step 1: Add the function to `store.js` after `undoInterruptSleep`**

Find the block ending with:
```js
export function undoInterruptSleep(split) {
  if (!split) return;
  removeEntry(split.resumedId);
  updateEntry(split.sleepId, { end: null });
}
```

Add immediately after it:
```js
export function autoCloseOngoingSleep(newStartISO) {
  const ongoing = _state.log.find((e) => e.type === 'sleep' && !e.end && new Date(e.start) <= new Date());
  if (!ongoing || new Date(ongoing.start) >= new Date(newStartISO)) return null;
  updateEntry(ongoing.id, { end: newStartISO });
  log.event('store', 'autoCloseOngoingSleep', ongoing.id, { closedAt: newStartISO });
  return ongoing;
}
```

- [ ] **Step 2: Run test 1 and test 2 to verify they pass**

```bash
node --test --test-name-pattern "autoCloseOngoingSleep" js/sleep-edge-cases.test.js 2>&1
```

Expected: both pass.

---

### Task 3: Fix `todayStats` for overnight and overlapping sleeps

**Files:**
- Modify: `js/store.js` — replace lines 227–232 (the `sleepMin` accumulator inside `todayStats`)

**Interfaces:**
- Consumes: nothing new — internal change only
- Produces: `derive.todayStats()` returns correct `sleepMin` for overnight and overlapping cases

- [ ] **Step 1: Replace the `sleepMin` accumulator in `todayStats`**

Find and replace this exact block inside `todayStats`:
```js
    let sleepMin = 0;
    inDay.filter((e) => e.type === 'sleep').forEach((e) => {
      const s = new Date(e.start).getTime();
      const en = e.end ? new Date(e.end).getTime() : Math.min(Date.now(), end);
      sleepMin += Math.max(0, (en - s) / MIN);
    });
```

Replace with:
```js
    // Collect all sleep intervals that overlap today, clamped to day bounds, then
    // merge overlapping ranges so double-counted minutes and overnight sleeps are
    // handled correctly.
    const sleepIntervals = [];
    _state.log.filter((e) => e.type === 'sleep').forEach((e) => {
      const rawS = new Date(e.start).getTime();
      const rawEn = e.end ? new Date(e.end).getTime() : Math.min(Date.now(), end);
      if (rawEn <= start || rawS >= end) return;
      sleepIntervals.push([Math.max(rawS, start), Math.min(rawEn, end)]);
    });
    sleepIntervals.sort((a, b) => a[0] - b[0]);
    let sleepMin = 0;
    let cur = null;
    for (const [s, en] of sleepIntervals) {
      if (!cur) { cur = [s, en]; }
      else if (s <= cur[1]) { cur[1] = Math.max(cur[1], en); }
      else { sleepMin += (cur[1] - cur[0]) / MIN; cur = [s, en]; }
    }
    if (cur) sleepMin += (cur[1] - cur[0]) / MIN;
```

- [ ] **Step 2: Run tests 3 and 4**

```bash
node --test --test-name-pattern "overnight|overlapping" js/sleep-edge-cases.test.js 2>&1
```

Expected: both pass.

---

### Task 4: Wire `autoCloseOngoingSleep` into `saveLog` in `sheets.js`

**Files:**
- Modify: `js/sheets.js` — update import + add one call inside `saveLog`

**Interfaces:**
- Consumes: `autoCloseOngoingSleep` from `./store.js`

- [ ] **Step 1: Add `autoCloseOngoingSleep` to the store import in `sheets.js`**

Find:
```js
import { state, save, addEntry, removeEntry, updateEntry, addMeasure, enqueueSettingsSync, maybeInterruptSleep, undoInterruptSleep } from './store.js';
```

Replace with:
```js
import { state, save, addEntry, removeEntry, updateEntry, addMeasure, enqueueSettingsSync, maybeInterruptSleep, undoInterruptSleep, autoCloseOngoingSleep } from './store.js';
```

- [ ] **Step 2: Call `autoCloseOngoingSleep` in `saveLog` before adding a new sleep**

Find this block in `saveLog`:
```js
  const split = maybeInterruptSleep(type, e.start);
  const added = addEntry(e);
```

Replace with:
```js
  if (type === 'sleep') autoCloseOngoingSleep(e.start);
  const split = maybeInterruptSleep(type, e.start);
  const added = addEntry(e);
```

- [ ] **Step 3: No direct unit test for sheets.js (requires DOM). Verify indirectly by running all edge-case tests**

```bash
node --test js/sleep-edge-cases.test.js 2>&1
```

Expected: all 7 tests pass.

---

### Task 5: Full regression check, version bump, and commit

**Files:**
- Modify: `index.html` — update `<meta name="version">` value
- Modify: `sw.js` — update `VERSION` constant

- [ ] **Step 1: Run the full test suite**

```bash
node --test js/*.test.js 2>&1
```

Expected: all tests pass, no regressions.

- [ ] **Step 2: Get the version timestamp**

```bash
date -u +%Y-%m-%dT%H:%MZ
```

Copy the output (e.g. `2026-06-28T14:30Z`).

- [ ] **Step 3: Update `index.html` version meta**

In `index.html`, find:
```html
<meta name="version" content="
```
and update the content value to the timestamp from Step 2.

- [ ] **Step 4: Update `sw.js` VERSION constant**

In `sw.js`, find:
```js
const VERSION = 'hearth-
```
and update the value to `hearth-<timestamp>` where `<timestamp>` matches Step 2.

- [ ] **Step 5: Commit everything**

```bash
git add js/sleep-edge-cases.test.js js/store.js js/sheets.js index.html sw.js
git commit -m "fix(sleep): auto-close dangling open sleep, count overnight and dedup overlapping minutes"
```
