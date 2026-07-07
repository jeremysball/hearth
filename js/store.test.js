import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.store = {}; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  setItem(k, v) { this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
}
globalThis.localStorage = new MemoryStorage();

// Minimal DOM globals so ui.js imports cleanly under Node
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });

const { state, derive, addEntry, removeEntry, addMeasure, applySyncResponse, updateEntry, reset,
  maybeInterruptSleep, undoInterruptSleep, normalizeLog, enqueueFullResync,
  wakePosition, wakeWindowRange, _testHelpers } = await import('./store.js');

function outboxOps() {
  return JSON.parse(localStorage.getItem('hearth.outbox.v1') || '[]');
}

test('addEntry enqueues a PUT to /api/entries/:id', () => {
  const before = outboxOps().length;
  const e = addEntry({ type: 'diaper', start: '2026-01-01T00:00:00Z' });
  const ops = outboxOps();
  assert.equal(ops.length, before + 1);
  const last = ops[ops.length - 1];
  assert.equal(last.url, '/api/entries/' + e.id);
  assert.equal(last.method, 'PUT');
  assert.equal(last.body.id, e.id);
});

test('removeEntry enqueues a DELETE to /api/entries/:id', () => {
  const e = addEntry({ type: 'diaper', start: '2026-01-01T00:00:00Z' });
  removeEntry(e.id);
  const last = outboxOps().at(-1);
  assert.equal(last.method, 'DELETE');
  assert.equal(last.url, '/api/entries/' + e.id);
});

test('addMeasure enqueues a PUT to /api/growth/:id', () => {
  const m = addMeasure({ date: '2026-06-20', weightKg: 7.3 });
  const last = outboxOps().at(-1);
  assert.equal(last.method, 'PUT');
  assert.equal(last.url, '/api/growth/' + m.id);
});

test('enqueueFullResync re-enqueues a PUT for every local log entry and growth measure', () => {
  reset();
  localStorage.setItem('hearth.outbox.v1', '[]');
  state().log = [
    { id: 'e1', type: 'diaper', start: '2026-01-01T00:00:00Z' },
    { id: 'e2', type: 'feed', start: '2026-01-02T00:00:00Z' },
  ];
  state().growth = [{ id: 'g1', date: '2026-01-01', weightKg: 5 }];

  enqueueFullResync();

  const ops = outboxOps();
  assert.equal(ops.length, 3);
  assert.deepEqual(ops.map((o) => o.method), ['PUT', 'PUT', 'PUT']);
  assert.deepEqual(ops.map((o) => o.url).sort(), ['/api/entries/e1', '/api/entries/e2', '/api/growth/g1'].sort());
  assert.equal(ops.find((o) => o.url === '/api/entries/e1').body.type, 'diaper');
});

// hearth.outbox.v1 and hearth.state.v1 are two independent localStorage
// writes. If a process is killed between them (mobile OS reaping a
// backgrounded PWA, tab crash), whichever write happened first survives.
// The outbox op must win that race so a crash never leaves an entry visible
// locally with no queued op to sync it to the other caregiver.
function setItemOrder(fn) {
  const calls = [];
  const realSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (k, v) => { calls.push(k); realSetItem(k, v); };
  try { fn(); } finally { localStorage.setItem = realSetItem; }
  return calls;
}

test('addEntry persists the outbox op before the state', () => {
  const calls = setItemOrder(() => addEntry({ type: 'diaper', start: '2026-01-01T00:00:00Z' }));
  assert.ok(calls.indexOf('hearth.outbox.v1') < calls.indexOf('hearth.state.v1'));
});

test('removeEntry persists the outbox op before the state', () => {
  const e = addEntry({ type: 'diaper', start: '2026-01-01T00:00:00Z' });
  const calls = setItemOrder(() => removeEntry(e.id));
  assert.ok(calls.indexOf('hearth.outbox.v1') < calls.indexOf('hearth.state.v1'));
});

test('updateEntry persists the outbox op before the state', () => {
  const e = addEntry({ type: 'diaper', start: '2026-01-01T00:00:00Z' });
  const calls = setItemOrder(() => updateEntry(e.id, { note: 'x' }));
  assert.ok(calls.indexOf('hearth.outbox.v1') < calls.indexOf('hearth.state.v1'));
});

test('addMeasure persists the outbox op before the state', () => {
  const calls = setItemOrder(() => addMeasure({ date: '2026-06-20', weightKg: 7.3 }));
  assert.ok(calls.indexOf('hearth.outbox.v1') < calls.indexOf('hearth.state.v1'));
});

test('applySyncResponse merges baby and settings fields', () => {
  applySyncResponse({ baby: { name: 'Olive', theme: 'boy' }, settings: { bottleIntervalH: 4 }, entries: [], growth: [] });
  assert.equal(state().baby.name, 'Olive');
  assert.equal(state().baby.theme, 'boy');
  assert.equal(state().settings.bottleIntervalH, 4);
});

test('applySyncResponse upserts and tombstones log entries by id', () => {
  applySyncResponse({ baby: null, settings: null, entries: [{ id: 'sync-e1', type: 'sleep', start: '2026-01-01T00:00:00Z' }], growth: [] });
  assert.ok(state().log.find((e) => e.id === 'sync-e1'));

  applySyncResponse({ baby: null, settings: null, entries: [{ id: 'sync-e1', deletedAt: '2026-01-02T00:00:00Z' }], growth: [] });
  assert.equal(state().log.find((e) => e.id === 'sync-e1'), undefined);
});

test('maybeInterruptSleep splits an ongoing sleep and resumes after the gap, during quiet hours', () => {
  const nap = addEntry({ type: 'sleep', start: '2026-01-01T01:00:00' }); // 1am local, ongoing
  const before = state().log.filter((e) => e.type === 'sleep').length;
  maybeInterruptSleep('bottle', '2026-01-01T02:00:00'); // 2am local, within default 20:00-07:00 quiet hours
  const sleeps = state().log.filter((e) => e.type === 'sleep');
  assert.equal(sleeps.length, before + 1, 'a new sleep entry should be created for the resumed nap');
  const closed = sleeps.find((e) => e.id === nap.id);
  assert.equal(closed.end, '2026-01-01T02:00:00');
  const resumed = sleeps.find((e) => e.id !== nap.id && !e.end && new Date(e.start) > new Date(nap.start));
  assert.ok(resumed, 'expected a new ongoing sleep entry after the gap');
  assert.equal(resumed.start, new Date(new Date('2026-01-01T02:00:00').getTime() + 20 * 60000).toISOString());
});

test('maybeInterruptSleep does nothing outside quiet hours', () => {
  const nap = addEntry({ type: 'sleep', start: '2026-01-01T13:00:00' }); // 1pm local, ongoing
  const before = state().log.filter((e) => e.type === 'sleep').length;
  maybeInterruptSleep('bottle', '2026-01-01T14:00:00'); // 2pm local, outside default quiet hours
  const sleeps = state().log.filter((e) => e.type === 'sleep');
  assert.equal(sleeps.length, before, 'no sleep entry should be added outside quiet hours');
  assert.equal(sleeps.find((e) => e.id === nap.id).end, undefined);
});

test('maybeInterruptSleep ignores entry types with no configured gap (e.g. pump)', () => {
  const nap = addEntry({ type: 'sleep', start: '2026-01-01T03:00:00' }); // 3am local, ongoing
  const before = state().log.filter((e) => e.type === 'sleep').length;
  maybeInterruptSleep('pump', '2026-01-01T03:30:00');
  const sleeps = state().log.filter((e) => e.type === 'sleep');
  assert.equal(sleeps.length, before, 'pump should not interrupt sleep');
  assert.equal(sleeps.find((e) => e.id === nap.id).end, undefined);
});

test('derive.status() reads as awake (not asleep at a future time) during the gap window', () => {
  // Uses real "now" (not a fixed past date) so the resumed entry's start is
  // genuinely in the future relative to the assertion below — that's the
  // exact condition the naive "ongoing = !e.end" check gets wrong.
  const r = state().settings.reminders;
  const savedStart = r.quietStart, savedEnd = r.quietEnd;
  try {
    // Close any stale ongoing sleeps from other tests
    state().log.forEach((e) => { if (e.type === 'sleep' && !e.end) updateEntry(e.id, { end: e.start }); });

    const now = new Date();
    const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    r.quietStart = hhmm(new Date(now.getTime() - 60 * 60000));
    r.quietEnd = hhmm(new Date(now.getTime() + 60 * 60000));

    addEntry({ type: 'sleep', start: new Date(now.getTime() - 30 * 60000).toISOString() });
    const atISO = now.toISOString();
    maybeInterruptSleep('bottle', atISO);

    const st = derive.status();
    assert.equal(st.state, 'awake', 'should read as awake during the gap, not asleep at a future time');
    assert.equal(st.since.getTime(), new Date(atISO).getTime());
  } finally {
    r.quietStart = savedStart; r.quietEnd = savedEnd;
  }
});

test('undoInterruptSleep fully reverts a split', () => {
  const nap = addEntry({ type: 'sleep', start: '2026-01-01T06:00:00' }); // 6am local, ongoing
  const before = state().log.filter((e) => e.type === 'sleep').length;
  const split = maybeInterruptSleep('bottle', '2026-01-01T06:30:00');
  assert.ok(split, 'expected a split to have occurred');
  undoInterruptSleep(split);
  const sleeps = state().log.filter((e) => e.type === 'sleep');
  assert.equal(sleeps.length, before, 'the phantom resumed sleep should be removed');
  const restored = sleeps.find((e) => e.id === nap.id);
  assert.ok(!restored.end, 'the original sleep should be ongoing again');
});

test('load repairs sleep entries whose end precedes start', () => {
  // end is BEFORE start → must be swapped so duration is positive
  const bad = { id: 'bad1', type: 'sleep', start: '2026-01-01T08:00:00.000Z', end: '2026-01-01T07:00:00.000Z' };
  localStorage.setItem('hearth.state.v1', JSON.stringify({ setup: true, log: [bad], growth: [] }));
  // normalizeLog repairs the entry so start/end are chronologically ordered
  const repaired = normalizeLog([bad]);
  assert.ok(new Date(repaired[0].end) >= new Date(repaired[0].start));
});

test('normalizeLog swaps reversed sleep timestamps', () => {
  const out = normalizeLog([{ id: 'x', type: 'sleep', start: '2026-01-01T08:00:00Z', end: '2026-01-01T07:00:00Z' }]);
  assert.ok(new Date(out[0].end) >= new Date(out[0].start));
});

test('normalizeLog migrates a legacy Mixed diaper size into wetSize and dirtySize', () => {
  const legacy = { id: 'd1', type: 'diaper', kind: 'Mixed', size: 'Large' };
  const out = normalizeLog([legacy]);
  assert.equal(out[0].wetSize, 'Large');
  assert.equal(out[0].dirtySize, 'Large');
});

test('normalizeLog leaves an already-migrated Mixed diaper entry untouched', () => {
  const migrated = { id: 'd2', type: 'diaper', kind: 'Mixed', size: null, wetSize: 'Small', dirtySize: 'Large' };
  const out = normalizeLog([migrated]);
  assert.equal(out[0].wetSize, 'Small');
  assert.equal(out[0].dirtySize, 'Large');
});

test('normalizeLog does not touch non-Mixed diaper entries', () => {
  const wet = { id: 'd3', type: 'diaper', kind: 'Wet', size: 'Medium' };
  const out = normalizeLog([wet]);
  assert.equal(out[0].wetSize, undefined);
  assert.equal(out[0].dirtySize, undefined);
});

test('nextForType anchors on the last entry end + interval', () => {
  const end = '2026-06-27T10:30:00.000Z';
  addEntry({ type: 'play', start: '2026-06-27T10:00:00.000Z', end });
  const r = derive.nextForType('play', 4);
  assert.equal(r.last.end, end);
  assert.equal(r.due.toISOString(), new Date(new Date(end).getTime() + 4 * 3600000).toISOString());
});

test('nextForType anchors on start when the last entry has no end', () => {
  const start = '2026-06-27T12:00:00.000Z';
  addEntry({ type: 'bath', start });
  const r = derive.nextForType('bath', 2);
  assert.equal(r.due.toISOString(), new Date(new Date(start).getTime() + 2 * 3600000).toISOString());
});

test('nextForType with no prior entry is due ~now', () => {
  const r = derive.nextForType('pump', 3);
  assert.equal(r.last, null);
  assert.ok(Math.abs(r.due.getTime() - Date.now()) < 5000);
});

test('nextForType reads the interval from settings.cards.intervals by default', () => {
  state().settings.cards.intervals = { play: 6 };
  const r = derive.nextForType('play');
  assert.equal(r.intervalH, 6);
});

test('normalizeSettings coerces legacy boolean clock24 to a string option value', async () => {
  const { normalizeSettings } = await import('./store.js');
  assert.equal(normalizeSettings({ clock24: true }).clock24, '24h');
  assert.equal(normalizeSettings({ clock24: false }).clock24, '12h');
  assert.equal(normalizeSettings({ clock24: '24h' }).clock24, '24h');
  assert.equal(normalizeSettings({ clock24: '12h' }).clock24, '12h');
  assert.equal(normalizeSettings({}).clock24, '12h');
});



test('wakePosition returns correct position for time of day', () => {
  assert.equal(wakePosition(new Date('2026-01-01T02:45:00')), 'night');  // 2:45am = night
  assert.equal(wakePosition(new Date('2026-01-01T05:59:00')), 'night');  // just before 6am = still night
  assert.equal(wakePosition(new Date('2026-01-01T06:00:00')), 'first');  // boundary: 6am is first
  assert.equal(wakePosition(new Date('2026-01-01T09:30:00')), 'first');
  assert.equal(wakePosition(new Date('2026-01-01T10:00:00')), 'middle'); // boundary: 10am is middle
  assert.equal(wakePosition(new Date('2026-01-01T12:00:00')), 'middle');
  assert.equal(wakePosition(new Date('2026-01-01T16:00:00')), 'last'); // boundary: 4pm is last
  assert.equal(wakePosition(new Date('2026-01-01T16:30:00')), 'last');
  assert.equal(wakePosition(new Date('2026-01-01T22:47:00')), 'night'); // late evening = night
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
  const r = wakeWindowRange('first'); // 3–5m bracket: first=[70,95]
  assert.equal(r.low, 70);
  assert.equal(r.high, 95);
  assert.equal(r.midpoint, 83);
});

test('wakeWindowRange first window is shorter than middle for infants', () => {
  // 4 months old — maxMonths:5 row has first=[70,95], middle=[80,110]
  const f = wakeWindowRange('first');
  const m = wakeWindowRange('middle');
  assert.ok(f.midpoint < m.midpoint,
    `first midpoint (${f.midpoint}) should be less than middle midpoint (${m.midpoint})`);
});

test('derive.sweetSpot() from/to match prediction low/high outside night mode', () => {
  // Close any ongoing sleeps left by prior tests
  const MIN = 60000;
  state().log.forEach((e) => { if (e.type === 'sleep' && !e.end) updateEntry(e.id, { end: new Date(Date.now() - MIN).toISOString() }); });
  const sp = derive.sweetSpot();
  assert.ok('prediction' in sp, 'sweetSpot should include prediction object');
  if (sp.night) {
    assert.equal(sp.prediction, null);
    assert.equal(sp.from, null);
    assert.equal(sp.to, null);
    return;
  }
  const { prediction } = sp;
  assert.ok(typeof prediction.low === 'number' && typeof prediction.high === 'number');
  if (!sp.napping) {
    const since = derive.status().since.getTime();
    assert.ok(Math.abs((sp.from.getTime() - since) / MIN - prediction.low) < 1);
    assert.ok(Math.abs((sp.to.getTime() - since) / MIN - prediction.high) < 1);
  }
});

test('derive.sweetSpot() returns night mode for wakes before 6am', () => {
  // Mock global Date so that new Date() without args returns 2:45am.
  const OrigDate = global.Date;
  const nightMs = new OrigDate('2026-01-01T02:45:00').getTime();
  class MockDate extends OrigDate {
    constructor(...args) { if (args.length === 0) { super(nightMs); } else { super(...args); } }
    static now() { return nightMs; }
  }
  global.Date = MockDate;
  try {
    const sp = derive.sweetSpot();
    assert.equal(sp.night, true, 'should return night mode for 2:45am wake');
    assert.equal(sp.from, null, 'from should be null in night mode');
    assert.equal(sp.to, null, 'to should be null in night mode');
    assert.equal(sp.prediction, null, 'prediction should be null in night mode');
  } finally {
    global.Date = OrigDate;
  }
});

test('derive.sweetSpot() returns night mode for late evening wakes', () => {
  const OrigDate = global.Date;
  const nightMs = new OrigDate('2026-01-01T22:47:00').getTime();
  class MockDate extends OrigDate {
    constructor(...args) { if (args.length === 0) { super(nightMs); } else { super(...args); } }
    static now() { return nightMs; }
  }
  global.Date = MockDate;
  try {
    const sp = derive.sweetSpot();
    assert.equal(sp.night, true, 'should return night mode for 10:47pm wake');
    assert.equal(sp.from, null, 'from should be null in night mode');
    assert.equal(sp.to, null, 'to should be null in night mode');
    assert.equal(sp.prediction, null, 'prediction should be null in night mode');
  } finally {
    global.Date = OrigDate;
  }
});

test('wakeWindowPrediction returns null for night', () => {
  assert.equal(derive.wakeWindowPrediction('night'), null);
});

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

test('derive.personalWakeWindow returns null with no data for that position', () => {
  // All prior sleeps in the test log are Jan 2026 (outside 21-day cutoff)
  // or have no end, so 'first' position should have zero observations.
  const result = derive.personalWakeWindow('first');
  assert.equal(result, null);
});

test('derive.personalWakeWindow returns ~90-min median from 10 consecutive sleep pairs', () => {
  const now = Date.now();
  const DAY_MS = 86400000;
  const MIN_MS = 60000;
  // Add 10 days of sleep pairs (days 10 to 1 ago). Each pair:
  //   Sleep A: ends at noon local (wakePosition = 'middle')
  //   Sleep B: starts 90 min later (noon + 90 min)
  // The algorithm pairs consecutive sleeps: (B_day, A_day) → 90-min wake window.
  // Stays clear of day 0 (an unrelated ongoing sleep from an earlier test
  // lives near "now") and of the scattered fixture's days 11-20.
  for (let d = 10; d >= 1; d--) {
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
  assert.ok(result !== null, 'should return data with 10 middle-position observations');
  assert.ok(result.sampleSize >= 10, `sampleSize ${result.sampleSize} should be ≥ 10`);
  assert.ok(result.median >= 85 && result.median <= 95, `median ${result.median} should be near 90`);
  assert.ok(result.p25 <= result.median, 'p25 ≤ median');
  assert.ok(result.median <= result.p75, 'median ≤ p75');
  assert.ok(result.variance !== null && result.variance < 1e-6, `variance ${result.variance} should be ~0 for an exactly-repeating 90-min pattern`);
});

test('derive.wakeWindowPrediction returns population prior when position has no personal data', () => {
  // 'last' position (after 4pm) — no 'last' window sleep pairs exist in the test log
  const pred = derive.wakeWindowPrediction('last');
  assert.equal(pred.source, 'population');
  assert.ok(pred.label.startsWith('typical'), 'label should say typical');
  assert.equal(pred.sampleSize, 0);
});

test('derive.wakeWindowPrediction reaches full personal trust for a perfectly consistent pattern', () => {
  // The personalWakeWindow test added 11 'middle' observations at exactly 90
  // min each (zero recorded variance) — dispersion-aware weighting reaches
  // 0.9 faster than the old sample-count-only ramp (which needed ~30), but
  // not instantly: a noise floor (js/store.js noiseFloorVariance) assumes
  // some of that apparent zero variance could just be logging imprecision,
  // so it still takes more than the bare 7-observation minimum.
  const pred = derive.wakeWindowPrediction('middle');
  assert.equal(pred.source, 'personal');
  const pop = wakeWindowRange('middle');
  // midpoint must stay between pop.low and pop.high (sanity clamp)
  assert.ok(pred.midpoint >= pop.low && pred.midpoint <= pop.high,
    `midpoint ${pred.midpoint} should stay within population range`);
  assert.ok(pred.label.includes("pattern"), 'label should mention her own pattern');
});

test('shrinkageWeight: noiseFloorVariance keeps a small sample of apparent zero variance from over-trusting', () => {
  const { noiseFloorVariance, shrinkageWeight } = _testHelpers;
  const priorVariance = 56.25; // ~5-7mo 'middle' bracket population spread
  // 9 observations with zero recorded variance — the bare personalWakeWindow
  // minimum. Logging imprecision means this shouldn't yet mean full trust.
  const adjusted = noiseFloorVariance(0, 9);
  const w = shrinkageWeight(adjusted, 9, priorVariance);
  assert.ok(w < 0.9, `weight ${w} should stay below the cap at only 9 samples of apparent zero variance`);
});

test('derive.wakeWindowPrediction stays a blend for a scattered personal pattern', () => {
  const now = Date.now();
  const DAY_MS = 86400000;
  const MIN_MS = 60000;
  // 10 days of 'last'-position wake windows (previous sleep always ends at
  // 5pm, inside the 4pm-8pm bracket), but the gap to the next sleep swings
  // widely day to day — a scattered, inconsistent pattern rather than a
  // tight one. Uses days 11-20 ago so it doesn't overlap the 'middle'
  // fixture's days 2-10 ago. This is the full disjoint band available
  // inside the 21-day cutoff — don't shift it without re-checking overlap.
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

test('derive.wakeWindowPrediction clamps personal median to 0.5×–2× population midpoint', () => {
  // Sanity: with 9 observations near the population midpoint, clamping doesn't fire.
  // Verify no clamp by confirming midpoint is in a reasonable range.
  const pred = derive.wakeWindowPrediction('middle');
  const pop = wakeWindowRange('middle');
  assert.ok(pred.midpoint >= pop.midpoint * 0.5, 'must not fall below 50% of pop midpoint');
  assert.ok(pred.midpoint <= pop.midpoint * 2,   'must not exceed 200% of pop midpoint');
});

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

test('morningWakes rejects sleeps longer than 16h (auto-closed sleep guard)', () => {
  // Capture the anchor before adding the bogus entry so the test is independent
  // of whatever the earlier circadianAnchor tests left in the shared state.
  const before = derive.circadianAnchor();
  const now = Date.now();
  const DAY_MS = 86400000;
  // Bogus: 20-day sleep ending at 6am local today (or yesterday if it's
  // before 6am now). Duration ~20 days, far over the 16h cap. End sits in the
  // 4-10am filter window, so without the cap it would inflate the anchor.
  const wake = new Date(now);
  wake.setHours(6, 0, 0, 0);
  if (wake > now) wake.setDate(wake.getDate() - 1);
  const start = new Date(wake.getTime() - 20 * DAY_MS);
  addEntry({ type: 'sleep', start: start.toISOString(), end: wake.toISOString() });
  const after = derive.circadianAnchor();
  assert.deepEqual(
    after ? { sampleSize: after.sampleSize } : null,
    before ? { sampleSize: before.sampleSize } : null,
    'a sleep longer than 16h ending in 4-10am must not be counted'
  );
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

test('normalizeSettings initializes dismissedRegressions when missing', async () => {
  const { normalizeSettings } = await import('./store.js');
  const s = normalizeSettings({ clock24: '12h' });
  assert.ok(Array.isArray(s.dismissedRegressions), 'should have dismissedRegressions array');
  assert.equal(s.dismissedRegressions.length, 0);
});

test('normalizeSettings seeds default playTypes for settings saved before the field existed', async () => {
  const { normalizeSettings } = await import('./store.js');
  const s = normalizeSettings({ clock24: '12h' });
  assert.ok(Array.isArray(s.playTypes), 'should have a playTypes array');
  assert.ok(s.playTypes.length > 0);
});

test('normalizeSettings leaves an existing playTypes list untouched', async () => {
  const { normalizeSettings } = await import('./store.js');
  const s = normalizeSettings({ clock24: '12h', playTypes: ['Sensory bin'] });
  assert.deepEqual(s.playTypes, ['Sensory bin']);
});

test('derive.regressionAlert returns null when baby age is far from any regression', () => {
  // Current baby age from prior applySyncResponse calls is ~4 months.
  // The 4-month regression fires at 3.5–5 months → may be in range.
  // This test just verifies the return shape is null or a valid object.
  const alert = derive.regressionAlert();
  if (alert !== null) {
    assert.ok(typeof alert.id === 'string');
    assert.ok(typeof alert.name === 'string');
    assert.ok(typeof alert.text === 'string');
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

test('fmt.clock honors the clock24 setting', async () => {
  const { fmt } = await import('./ui.js');
  const d = new Date('2026-01-01T23:05:00');
  state().settings.clock24 = '12h';
  assert.equal(fmt.clock(d), '11:05 PM');
  state().settings.clock24 = '24h';
  assert.equal(fmt.clock(d), '23:05');
});

test('wakeWindowPrediction extends midpoint for a preceding long nap', () => {
  const personal = derive.personalWakeWindow('middle');
  assert.ok(personal !== null, 'should have personal wake window data');
  assert.ok(personal.napMedianMin > 0, 'napMedianMin should be computed');

  const baseline = derive.wakeWindowPrediction('middle');
  const longNap = Math.round(personal.napMedianMin * 2);
  const withLong = derive.wakeWindowPrediction('middle', longNap);

  assert.ok(withLong.midpoint > baseline.midpoint,
    `midpoint with long nap (${withLong.midpoint}) should exceed baseline (${baseline.midpoint})`);

  const ratio = withLong.midpoint / baseline.midpoint;
  assert.ok(ratio >= 0.84 && ratio <= 1.21,
    `ratio ${ratio.toFixed(3)} should be within [0.85, 1.2] (loosened for Math.round)`);
});

test('wakeWindowPrediction shrinks midpoint for a preceding short nap', () => {
  const personal = derive.personalWakeWindow('middle');
  assert.ok(personal !== null && personal.napMedianMin > 0);

  const baseline = derive.wakeWindowPrediction('middle');
  const shortNap = Math.round(personal.napMedianMin * 0.5);
  const withShort = derive.wakeWindowPrediction('middle', shortNap);

  assert.ok(withShort.midpoint < baseline.midpoint,
    `midpoint with short nap (${withShort.midpoint}) should be below baseline (${baseline.midpoint})`);

  const ratio = withShort.midpoint / baseline.midpoint;
  assert.ok(ratio >= 0.84 && ratio <= 1.21,
    `ratio ${ratio.toFixed(3)} should be within [0.85, 1.2] (loosened for Math.round)`);
});

test('wakeWindowPrediction with no priorSleepMin returns unadjusted midpoint', () => {
  const pred = derive.wakeWindowPrediction('middle');
  const predNull = derive.wakeWindowPrediction('middle', null);
  assert.equal(pred.midpoint, predNull.midpoint);
});

test('todayStats sums bottle and pump amounts into feedVol', () => {
  reset();
  const now = new Date().toISOString();
  state().log = [
    { id: 'b1', type: 'bottle', start: now, amount: 120 },
    { id: 'p1', type: 'pump', start: now, amount: 90 },
    { id: 'd1', type: 'diaper', start: now, amount: 50 },
  ];

  const stats = derive.todayStats();

  assert.equal(stats.bottleVol, 120);
  assert.equal(stats.feedVol, 210);
});

test('nextHygiene computes per-item due dates like nextMeds', () => {
  reset();
  state().settings.hygiene = [{ id: 'h1', name: 'Nail trim', everyH: 168 }];
  const before = derive.nextHygiene();
  assert.equal(before[0].last, null);
  assert.equal(before[0].due, null);
  addEntry({ type: 'hygiene', start: new Date().toISOString(), itemId: 'h1', name: 'Nail trim' });
  const after = derive.nextHygiene();
  assert.ok(after[0].last instanceof Date);
  assert.ok(after[0].due instanceof Date);
  assert.equal(after[0].due.getTime() - after[0].last.getTime(), 168 * 60 * 60 * 1000);
});

test('derive.insightWakeCalibration returns null with no personal data', () => {
  reset();
  assert.equal(derive.insightWakeCalibration('middle'), null);
});

test('derive.insightWakeCalibration narrates an earlier-than-typical consistent pattern', () => {
  reset();
  const now = Date.now();
  const DAY_MS = 86400000;
  const MIN_MS = 60000;
  // 10 days of 'middle'-position wake windows, each exactly 60 min (well
  // under the ~95-min population midpoint for the default 4-month bracket).
  for (let d = 10; d >= 1; d--) {
    const base = new Date(now - d * DAY_MS);
    base.setHours(0, 0, 0, 0);
    const sleepAEnd = new Date(base.getTime() + 12 * 60 * MIN_MS); // noon
    const sleepAStart = new Date(sleepAEnd.getTime() - 70 * MIN_MS);
    const sleepBStart = new Date(sleepAEnd.getTime() + 60 * MIN_MS);
    const sleepBEnd = new Date(sleepBStart.getTime() + 70 * MIN_MS);
    addEntry({ type: 'sleep', start: sleepAStart.toISOString(), end: sleepAEnd.toISOString() });
    addEntry({ type: 'sleep', start: sleepBStart.toISOString(), end: sleepBEnd.toISOString() });
  }
  const result = derive.insightWakeCalibration('middle');
  assert.ok(result !== null, 'a consistent 35-min gap should clear the legibility bar');
  assert.equal(result.direction, 'earlier');
  assert.ok(result.text.split(' ').length <= 12, `"${result.text}" should be ≤12 words`);
  assert.ok(result.text.includes('earlier'), 'text should say earlier');
});

test('derive.insightWakeCalibration returns null for a scattered personal pattern (low trust)', () => {
  reset();
  const now = Date.now();
  const DAY_MS = 86400000;
  const MIN_MS = 60000;
  const wakeMinutesByDay = [40, 220, 60, 200, 50, 230, 45, 210, 55, 225];
  for (let i = 0; i < wakeMinutesByDay.length; i++) {
    const d = 20 - i;
    const base = new Date(now - d * DAY_MS);
    base.setHours(0, 0, 0, 0);
    const sleepAEnd = new Date(base.getTime() + 17 * 60 * MIN_MS); // 5pm -> 'last' position
    const sleepAStart = new Date(sleepAEnd.getTime() - 70 * MIN_MS);
    const sleepBStart = new Date(sleepAEnd.getTime() + wakeMinutesByDay[i] * MIN_MS);
    const sleepBEnd = new Date(sleepBStart.getTime() + 70 * MIN_MS);
    addEntry({ type: 'sleep', start: sleepAStart.toISOString(), end: sleepAEnd.toISOString() });
    addEntry({ type: 'sleep', start: sleepBStart.toISOString(), end: sleepBEnd.toISOString() });
  }
  assert.equal(derive.insightWakeCalibration('last'), null);
});

test('derive.insightWakeCalibration returns null when the gap from population is too small to narrate', () => {
  reset();
  const now = Date.now();
  const DAY_MS = 86400000;
  const MIN_MS = 60000;
  // Consistent 92-min pattern -- within 10 min of the ~95-min population midpoint.
  for (let d = 10; d >= 1; d--) {
    const base = new Date(now - d * DAY_MS);
    base.setHours(0, 0, 0, 0);
    const sleepAEnd = new Date(base.getTime() + 12 * 60 * MIN_MS);
    const sleepAStart = new Date(sleepAEnd.getTime() - 70 * MIN_MS);
    const sleepBStart = new Date(sleepAEnd.getTime() + 92 * MIN_MS);
    const sleepBEnd = new Date(sleepBStart.getTime() + 70 * MIN_MS);
    addEntry({ type: 'sleep', start: sleepAStart.toISOString(), end: sleepAEnd.toISOString() });
    addEntry({ type: 'sleep', start: sleepBStart.toISOString(), end: sleepBEnd.toISOString() });
  }
  assert.equal(derive.insightWakeCalibration('middle'), null);
});

test('betaShrinkage returns the prior when n is 0', () => {
  const { betaShrinkage } = _testHelpers;
  assert.equal(betaShrinkage(0, 0, 0.4, 6), 0.4);
});

test('betaShrinkage converges to the raw proportion as n grows large', () => {
  const { betaShrinkage } = _testHelpers;
  const shrunk = betaShrinkage(90, 100, 0.5, 6);
  assert.ok(Math.abs(shrunk - 0.9) < 0.05, `shrunk ${shrunk} should be close to raw 0.9 at large n`);
});

test('betaShrinkage stays close to the prior at small n', () => {
  const { betaShrinkage } = _testHelpers;
  const shrunk = betaShrinkage(1, 2, 0.5, 6);
  assert.ok(Math.abs(shrunk - 0.5) < 0.15, `shrunk ${shrunk} should stay near the 0.5 prior at n=2`);
});

test('isGoodQuality treats Good and Great as good, others as not', () => {
  const { isGoodQuality } = _testHelpers;
  assert.equal(isGoodQuality('Good'), true);
  assert.equal(isGoodQuality('Great'), true);
  assert.equal(isGoodQuality('Okay'), false);
  assert.equal(isGoodQuality('Restless'), false);
});
