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

const { state, derive, addEntry, updateEntry, removeEntry, autoCloseOngoingSleep } = await import('./store.js');

// Remove all sleep entries so tests don't bleed into each other
function closeAllSleeps() {
  state().log.filter((e) => e.type === 'sleep').forEach((e) => removeEntry(e.id));
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
  removeEntry(first.id);
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
  removeEntry(first.id);
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
  removeEntry(e.id);
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
  removeEntry(a.id);
  removeEntry(b.id);
});

// ── Test 5 ── derive.status returns awake for a sleep with a future start
test('derive.status is awake when only sleep entry has a future start', () => {
  closeAllSleeps();
  const futureStart = new Date(Date.now() + 30 * 60000).toISOString();
  const e = addEntry({ type: 'sleep', start: futureStart });
  const st = derive.status();
  assert.equal(st.state, 'awake', 'future-start sleep should not count as asleep');
  // cleanup
  removeEntry(e.id);
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
  removeEntry(e.id);
});

// ── Test 7 ── after maybeInterruptSleep, only one open sleep exists
test('after interrupt-sleep split, only one sleep is open (the resumed one)', async () => {
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
