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

const { addEntry, derive, reset } = await import('./store.js');
const { sleep } = await import('./sleep.js');

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

test('sleep schedule omits projected SweetSpot windows after today', () => {
  reset();
  withMockedNow('2026-01-01T22:30:00', () => {
    addEntry({ type: 'sleep', start: '2026-01-01T22:00:00' });

    const html = sleep();

    assert.equal(html.includes('1:10'), false, 'overnight projection should not render as a nap window');
    assert.match(html, /Past today's nap windows\./);
  });
});

test('sleep schedule renders during night mode without a SweetSpot prediction', () => {
  reset();
  const html = withMockedNow('2026-01-01T03:00:00', () => sleep());

  assert.match(html, /Past today's nap windows\./);
});

test('sleep schedule fails closed when sweetSpotSchedule is unavailable', () => {
  reset();
  const original = derive.sweetSpotSchedule;
  delete derive.sweetSpotSchedule;
  try {
    const html = sleep();

    assert.match(html, /Past today's nap windows\./);
  } finally {
    derive.sweetSpotSchedule = original;
  }
});
