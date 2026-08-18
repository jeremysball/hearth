import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, withMockedNow } from './test-helpers.js';

globalThis.localStorage = new MemoryStorage();
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });

const { addEntry, derive, reset, state } = await import('./store.js');
const { sleep, predictionSourceInfo, _testHelpers } = await import('./sleep.js');

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

test('predictionSourceInfo: population source reads as generic estimate', () => {
  reset();
  const info = predictionSourceInfo({ source: 'population', sampleSize: 0 });
  assert.equal(info.cls, 'src-generic');
  assert.equal(info.heading, 'Generic estimate');
  assert.match(info.body, /typical timing for this age/);
});

test('predictionSourceInfo: blend source reads as learning and reports sample size', () => {
  reset();
  state().baby.name = 'Rae';
  const info = predictionSourceInfo({ source: 'blend', sampleSize: 9 });
  assert.equal(info.cls, 'src-learning');
  assert.equal(info.heading, "Learning Rae's pattern");
  assert.match(info.body, /9 naps logged/);
});

test('predictionSourceInfo: blend source uses singular "nap" for sampleSize of 1', () => {
  reset();
  const info = predictionSourceInfo({ source: 'blend', sampleSize: 1 });
  assert.match(info.body, /1 nap logged/);
  assert.doesNotMatch(info.body, /1 naps logged/);
});

test('predictionSourceInfo: personal source reads as personalized and reports sample size', () => {
  reset();
  state().baby.name = 'Rae';
  const info = predictionSourceInfo({ source: 'personal', sampleSize: 32 });
  assert.equal(info.cls, 'src-personal');
  assert.equal(info.heading, "Personalized to Rae");
  assert.match(info.body, /32 naps logged/);
});

test('predictionSourceInfo: missing/unknown source falls back to generic', () => {
  reset();
  const info = predictionSourceInfo({});
  assert.equal(info.cls, 'src-generic');
});

test('sleep view renders a prediction source info button in the SweetSpot schedule header', () => {
  reset();
  const html = withMockedNow('2026-01-01T09:00:00', () => sleep());

  assert.match(html, /data-action="prediction:info"/);
  assert.match(html, /class="src-info-btn src-generic"/);
});

// ── #415: data-id attribute is HTML-escaped so a sync-supplied id with
// quotes/metacharacters can't break out of the attribute and inject markup.
test('sleep view HTML-escapes the entry id in nap-row data-id attributes', () => {
  reset();
  // Live payload the server accepts at server/entries.go:14 (only rejects
  // empty string). " onmouseover="alert(1)" closes data-id="..." and adds
  // an arbitrary event handler — pre-fix, this would have fired on hover.
  const maliciousId = 'x" onmouseover="alert(1)';
  const start = new Date(Date.now() - 60 * 60000).toISOString();
  const end = new Date(Date.now() - 30 * 60000).toISOString();
  addEntry({ id: maliciousId, type: 'sleep', start, end });

  const html = sleep();

  // Quoted payload must be HTML-escaped so the attribute stays intact.
  assert.match(html, /data-id="x&quot; onmouseover=&quot;alert\(1\)"/);
  // And the breakout must not appear unescaped anywhere in the markup.
  assert.doesNotMatch(html, /data-id="x" onmouseover="alert\(1\)"/);
  // The literal <script>/<img> must not have been parsed as live tags by the
  // escape, i.e. the row carries no event handler besides the safe ones.
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onmouseover="alert\(1\)"/);
});

test('sleep view HTML-escapes ampersands in entry ids (no double-escape, no raw &)', () => {
  reset();
  const start = new Date(Date.now() - 60 * 60000).toISOString();
  const end = new Date(Date.now() - 30 * 60000).toISOString();
  addEntry({ id: 'a&b', type: 'sleep', start, end });

  const html = sleep();

  assert.match(html, /data-id="a&amp;b"/);
  assert.doesNotMatch(html, /data-id="a&b"/);
});

// ── #416: pred.label is built from baby.name in store.js:738; with an HTML
// payload in the baby name, the chart-note must render escaped text, not
// live markup (e.g. <img src=x onerror=...>).
test('sleep view HTML-escapes the SweetSpot chart-note label when baby name has HTML', () => {
  reset();
  state().baby.name = '<img src=x onerror=alert(1)>';
  const start = new Date(Date.now() - 60 * 60000).toISOString();
  const end = new Date(Date.now() - 30 * 60000).toISOString();
  addEntry({ type: 'sleep', start, end });

  // Inject a prediction whose label embeds the (malicious) baby name; the
  // population-path label ("typical for X months old") wouldn't actually
  // surface baby.name so it can't reproduce the original XSS vector.
  const origSweetSpot = derive.sweetSpot;
  derive.sweetSpot = () => ({
    away: false, napping: false, from: null, to: null,
    prediction: { label: `based on ${state().baby.name}'s pattern`, source: 'personal', sampleSize: 99 },
  });
  let html;
  try {
    html = withMockedNow(start, () => sleep());
  } finally {
    derive.sweetSpot = origSweetSpot;
  }

  // Escaped form must appear in the chart-note span.
  assert.match(html, /class="chart-note">[^<]*&lt;img src=x onerror=alert\(1\)&gt;/);
  // Raw payload must not appear as an <img> tag — that would parse as a real
  // tag and fire onerror. The literal substring "onerror=alert(1)" is fine
  // to remain inside the escaped body; what matters is that it sits between
  // &lt; and &gt; and the browser never sees it as markup.
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(html, /<img\b[^>]*onerror=alert\(1\)/);
});

// ── #417: invalid `start` (Invalid Date, getTime() === NaN) must not make
// the sort comparator return NaN — Array.prototype.sort treats NaN as 0,
// which leaves the entries in whatever order _state.log happened to hand
// them, flipping the nap list across renders/devices/syncs.
test('compareByStart: invalid `start` dates sort to the end, never NaN, never flip order', () => {
  const { compareByStart } = _testHelpers;

  const t1 = new Date('2026-08-18T08:00:00Z');
  const t2 = new Date('2026-08-18T10:00:00Z');
  const t3 = new Date('2026-08-18T12:00:00Z');
  const bad = new Date('not a date'); // Invalid Date

  // Mix: two invalid plus three valid. Run with several orderings and assert
  // the sorted output is identical across runs and that valid entries land
  // in start-ascending order ahead of invalid ones.
  const orderings = [
    [{ s: t1 }, { s: bad }, { s: t3 }, { s: bad }, { s: t2 }],
    [{ s: bad }, { s: bad }, { s: t3 }, { s: t2 }, { s: t1 }],
    [{ s: t2 }, { s: bad }, { s: t1 }, { s: bad }, { s: t3 }],
    [{ s: bad }, { s: t3 }, { s: t1 }, { s: t2 }, { s: bad }],
  ];

  const expected = [t1.getTime(), t2.getTime(), t3.getTime()].join('|') + '|invalid|invalid';
  for (const arr of orderings) {
    const sorted = [...arr].sort(compareByStart);
    // The comparator itself must never return NaN.
    for (let i = 1; i < arr.length; i++) {
      const c = compareByStart(arr[i - 1], arr[i]);
      assert.ok(!Number.isNaN(c), `comparator returned NaN at index ${i}`);
    }
    // Valid entries first in start-ascending order, invalid entries last.
    const startTimes = sorted.map((e) => e.s.getTime());
    assert.equal(startTimes.slice(0, 3).join(','), [t1.getTime(), t2.getTime(), t3.getTime()].join(','),
      'valid entries must sort in ascending start order ahead of invalid');
    for (let i = 3; i < sorted.length; i++) {
      assert.ok(isNaN(sorted[i].s.getTime()), 'remaining entries must be invalid-start');
    }
    // And the whole sequence is reproducible across input orderings.
    assert.equal(sorted.map((e) => isNaN(e.s.getTime()) ? 'invalid' : e.s.getTime()).join('|'), expected);
  }
});

test('compareByStart: all-invalid input is a no-op (returns 0 for every pair, stable)', () => {
  const { compareByStart } = _testHelpers;
  const bad1 = new Date('garbage'), bad2 = new Date('also garbage'), bad3 = new Date('nope');
  const arr = [{ s: bad1 }, { s: bad2 }, { s: bad3 }];
  const sorted = [...arr].sort(compareByStart);
  // Stable sort preserves input order when comparator always returns 0.
  assert.deepEqual(sorted.map((e) => e.s), [bad1, bad2, bad3]);
  // Every pairwise comparison returns 0 — never NaN.
  for (let i = 1; i < arr.length; i++) {
    const c = compareByStart(arr[i - 1], arr[i]);
    assert.equal(Number.isNaN(c), false, 'comparator must never return NaN even when both sides are invalid');
  }
});

test('sleep view renders valid naps in ascending start order across rearranged log orderings', () => {
  // End-to-end check: even if state().log is reordered between renders
  // (simulating a sync merge landing entries in different positions on
  // different devices), the rendered nap-row order must not depend on log
  // order — that's the user-visible symptom #417 describes.
  reset();
  const now = new Date();
  const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const a = { type: 'sleep', start: new Date(noon.getTime() - 5 * 3600000).toISOString(), end: new Date(noon.getTime() - 4 * 3600000).toISOString() };
  const b = { type: 'sleep', start: new Date(noon.getTime() - 3 * 3600000).toISOString(), end: new Date(noon.getTime() - 2 * 3600000).toISOString() };
  const c = { type: 'sleep', start: new Date(noon.getTime() - 1 * 3600000).toISOString(), end: new Date(noon.getTime() - 0 * 3600000).toISOString() };
  addEntry(a); addEntry(b); addEntry(c);

  // addEntry sorts _state.log newest-first by start, so the log ends up
  // [c, b, a]; idsBelow are in start-ascending order — what the nap list
  // should render, irrespective of how the log is shaped.
  const idA = state().log.find((e) => e.start === a.start).id;
  const idB = state().log.find((e) => e.start === b.start).id;
  const idC = state().log.find((e) => e.start === c.start).id;
  const idsStartAsc = [idA, idB, idC];

  const idsLog = state().log.map((e) => e.id); // newest-first per addEntry's sort
  // A rotation that is neither newest-first nor start-ascending, so we can
  // prove the rendered row order comes from the comparator, not the log.
  const idsRotated = [idsLog[1], idsLog[2], idsLog[0]];
  assert.notDeepEqual(idsRotated, idsStartAsc, 'precondition: rotated order must differ from start-ascending');
  assert.notDeepEqual(idsRotated, idsLog, 'precondition: rotated order must differ from log order');

  const renderOrder = (ids) => {
    state().log = ids.map((id) => {
      const orig = state().log.find((e) => e.id === id);
      return orig || { id, type: 'sleep', start: '', end: '' };
    });
    return sleep();
  };

  const htmlA = renderOrder(idsLog);
  const htmlB = renderOrder(idsRotated);

  // The row order in the rendered log card must match start-ascending order
  // in both renderings, regardless of how state().log is ordered.
  const rowOrder = (html) => {
    // nap rows are the ones with data-action="entry:open"
    const m = html.match(/data-action="entry:open" data-id="([^"]+)"/g) || [];
    return m.map((s) => s.match(/data-id="([^"]+)"/)[1]);
  };
  assert.deepEqual(rowOrder(htmlA), idsStartAsc, 'first render must produce start-ascending rows');
  assert.deepEqual(rowOrder(htmlB), idsStartAsc, 'render after re-shuffling state().log must produce the same row order');
});
