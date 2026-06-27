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

const { state, derive, addEntry, removeEntry, addMeasure, applySyncResponse, updateEntry, maybeInterruptSleep, undoInterruptSleep, normalizeLog } = await import('./store.js');

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

test('fmt.clock honors the clock24 setting', async () => {
  const { fmt } = await import('./ui.js');
  const d = new Date('2026-01-01T23:05:00');
  state().settings.clock24 = '12h';
  assert.equal(fmt.clock(d), '11:05 PM');
  state().settings.clock24 = '24h';
  assert.equal(fmt.clock(d), '23:05');
});
