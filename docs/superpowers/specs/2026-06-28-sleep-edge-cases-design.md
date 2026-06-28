# Sleep Edge Cases — Design Spec

**Date:** 2026-06-28  
**Branch:** sleep-edge-cases  
**Status:** Approved

## Problem

Several edge cases in sleep tracking produce silent data corruption or incorrect derived values. The user-visible symptom is that logging a new sleep while one is already ongoing leaves the old entry perpetually open. Other cases (overnight sleep, overlapping intervals, future-start entries) produce wrong stats or wrong status.

## Scope

- `js/store.js` — `saveLog` auto-close, `todayStats` overnight + overlap dedup, `derive.status` future-start guard
- `js/sheets.js` — `saveLog` must close an ongoing sleep before adding a new one
- New test file: `js/sleep-edge-cases.test.js`

Out of scope: UI display of overlapping ring segments, backend sync consistency.

## Test Inventory

| # | Scenario | File | Expected behaviour |
|---|----------|------|--------------------|
| 1 | New sleep logged while previous ongoing | sheets.js → store.js | Previous entry gets `end` set to new sleep's `start`; only one open sleep after |
| 2 | Two ongoing sleeps exist | store.js | `derive.status()` returns `asleep` with newest start; stale entry treated as closed at its own start |
| 3 | Overnight sleep (started yesterday, ends today) | store.js | `todayStats()` credits only the today-portion of the sleep |
| 4 | Overlapping sleeps | store.js | `todayStats.sleepMin` equals union of ranges, not sum of raw durations |
| 5 | Future-start sleep (no end) | store.js | `derive.status()` returns `awake` |
| 6 | Zero-duration sleep (`start === end`) | store.js | `todayStats.sleepMin` is 0, no crash |
| 7 | New sleep logged while interrupted-sleep gap active | store.js | Only the one open entry (the resumed gap sleep) exists; no third stray entry |

## Fix Plan

### Fix 1 — Auto-close ongoing sleep on new sleep log (`sheets.js`)
In `saveLog`, before `addEntry` for type `sleep`, find any ongoing sleep entry and set its `end` to the new sleep's `start` (only if new sleep starts after the ongoing one's start).

### Fix 2 — Overnight sleep in `todayStats` (`store.js`)
In `derive.todayStats()`, clamp sleep interval to `[dayStart, dayEnd]` when computing `sleepMin`. Currently only the `start` is checked against the day window; sleeps that started before `dayStart` but end within today are entirely excluded.

### Fix 3 — Overlapping sleep dedup in `todayStats` (`store.js`)
After collecting today's sleep intervals (clamped), merge overlapping ranges before summing. Sum the merged union, not raw per-entry durations.

### Fix 4 — `derive.status` with multiple ongoing entries (`store.js`)
Already partially handled (`.find()` picks newest-first). Confirm the future-start guard (`new Date(e.start) <= new Date()`) also prevents stale future-start entries from showing as asleep.

## Execution Plan

1. Write `js/sleep-edge-cases.test.js` with all 7 tests (expected to fail before fixes).
2. Run `node --test js/sleep-edge-cases.test.js` — record which fail.
3. Apply fixes (Fix 1–4) to `store.js` and `sheets.js`.
4. Re-run tests until all pass.
5. Run full test suite (`node --test js/*.test.js`) — no regressions.
6. Bump version, commit, open PR.
