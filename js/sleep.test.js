import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, withMockedNow } from './test-helpers.js';

globalThis.localStorage = new MemoryStorage();
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });

const { addEntry, derive, reset, state } = await import('./store.js');
const { sleep, predictionSourceInfo } = await import('./sleep.js');

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
