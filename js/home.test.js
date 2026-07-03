import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM + storage so home.js's imports resolve under Node.
class MemoryStorage { constructor(){this.s={};} getItem(k){return Object.prototype.hasOwnProperty.call(this.s,k)?this.s[k]:null;} setItem(k,v){this.s[k]=String(v);} removeItem(k){delete this.s[k];} }
globalThis.localStorage = new MemoryStorage();
globalThis.window = globalThis;
globalThis.document = {
  querySelector: () => null, querySelectorAll: () => [],
  hidden: true, addEventListener: () => {},
  documentElement: { classList: { toggle: () => {} } },
};
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });

const { bathDaysSinceLabel, home } = await import('./home.js');
const { reset } = await import('./store.js');

const atDaysAgo = (n) => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate() - n); return d.toISOString(); };

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

test('bathDaysSinceLabel returns Never for no entry', () => {
  assert.equal(bathDaysSinceLabel(null), 'Never');
});
test('bathDaysSinceLabel returns Today for an entry earlier today', () => {
  assert.equal(bathDaysSinceLabel(atDaysAgo(0)), 'Today');
});
test('bathDaysSinceLabel returns Yesterday for one calendar day ago', () => {
  assert.equal(bathDaysSinceLabel(atDaysAgo(1)), 'Yesterday');
});
test('bathDaysSinceLabel returns N days ago for older entries', () => {
  assert.equal(bathDaysSinceLabel(atDaysAgo(3)), '3 days ago');
});

test('home hero rail renders a prediction source info button while awake', () => {
  reset();
  const html = withMockedNow('2026-01-01T09:00:00', () => home());

  assert.match(html, /data-action="prediction:info"/);
  assert.match(html, /class="src-info-btn src-generic"/);
});

test('home hero renders the sky scene wrapping the timer content', () => {
  reset();
  const html = withMockedNow('2026-01-01T09:00:00', () => home());
  assert.match(html, /class="card hero hero-sky"/);
  assert.match(html, /data-sky-mode="/);
  assert.match(html, /class="sky" data-sky="/);
  assert.match(html, /--light-x:/);
  assert.match(html, /hero-fg/);
  assert.doesNotMatch(html, /hero-moon/);
});
