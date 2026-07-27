import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, withMockedNow } from './test-helpers.js';

// Minimal DOM + storage so home.js's imports resolve under Node.
globalThis.localStorage = new MemoryStorage();
globalThis.window = globalThis;
globalThis.document = {
  querySelector: () => null, querySelectorAll: () => [],
  hidden: true, addEventListener: () => {},
  documentElement: { classList: { toggle: () => {} } },
};
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });

const { bathDaysSinceLabel, home, summary } = await import('./home.js');
const { reset, addEntry } = await import('./store.js');

const atDaysAgo = (n) => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate() - n); return d.toISOString(); };

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

test('summary() shows a play entry\'s duration in the meta badge', () => {
  const s = summary({ type: 'play', start: new Date().toISOString(), playType: 'Reading', duration: 25 });
  assert.equal(s.meta, '25m');
});
test('summary() combines play duration and note without dropping either', () => {
  const s = summary({ type: 'play', start: new Date().toISOString(), playType: 'Reading', duration: 90, note: 'with grandma' });
  assert.equal(s.meta, '1h 30m · with grandma');
});
test('summary() falls back to the note alone for a play entry with no duration (legacy entries)', () => {
  const s = summary({ type: 'play', start: new Date().toISOString(), playType: 'Reading', note: 'quiet time' });
  assert.equal(s.meta, 'quiet time');
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

test('home hero replaces the coal bed with an ember-glow field', () => {
  reset();
  const html = withMockedNow('2026-01-01T09:00:00', () => home()); // awake state
  assert.match(html, /class="ember-glow"/);
  assert.match(html, /class="ember-ground"/);
  assert.match(html, /class="ember-field"/);
  assert.doesNotMatch(html, /class="sh-bed/);
  assert.doesNotMatch(html, /class="coal/);
});

test('home away hero at a daytime hour does not render a twilight/night sky mode', () => {
  // End-to-end regression for the away-hero sky mode bug: with the wake-window
  // prediction absent on the away gate (sp.prediction=null), the wake-window
  // arc fell into the 'elapsedMin > highMin' branch almost immediately, so a
  // 2pm away block rendered the 'twilight' scene regardless of clock time.
  // The away path in sceneSpec now picks a scene from the clock hour, so
  // 2pm must land in a daytime mode.
  reset();
  // Ongoing away block: a 2pm start, no end yet.
  const start = new Date('2026-07-03T14:00:00').toISOString();
  addEntry({ type: 'away', start, end: null });
  const html = withMockedNow('2026-07-03T14:30:00', () => home());
  const modeMatch = html.match(/data-sky-mode="([^"]+)"/);
  assert.ok(modeMatch, 'hero should expose its sky mode via data-sky-mode');
  const mode = modeMatch[1];
  assert.notEqual(mode, 'twilight', `2pm away hero should not be twilight, got ${mode}`);
  assert.notEqual(mode, 'night', `2pm away hero should not be night, got ${mode}`);
  assert.notEqual(mode, 'deep-night', `2pm away hero should not be deep-night, got ${mode}`);
  assert.match(html, /data-state="away"/);
  assert.match(html, /Away since/);
});
