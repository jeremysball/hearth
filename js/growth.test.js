import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.store = {}; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  setItem(k, v) { this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = {}; // ui.js checks window.matchMedia at module load

const { state, addMeasure } = await import('./store.js');
const { growth, showGrowthStat } = await import('./growth.js');

test('growth() shows no delta when the latest measurement has no weight recorded', () => {
  state().growth = [];
  addMeasure({ date: '2026-05-01', weightKg: 6.0, heightCm: 58 });
  addMeasure({ date: '2026-06-01', weightKg: null, heightCm: 62 }); // height-only follow-up
  const html = growth();
  assert.match(html, /<div class="stat-v">—<\/div>/);
  assert.doesNotMatch(html, /class="delta down"/);
});

test('growth() weight chart skips a height-only point instead of corrupting the scale', () => {
  showGrowthStat('weightKg');
  state().growth = [];
  addMeasure({ date: '2026-04-01', weightKg: 5.0 });
  addMeasure({ date: '2026-05-01', weightKg: null, heightCm: 60 });
  addMeasure({ date: '2026-06-01', weightKg: 6.0 });
  const html = growth();
  const circles = html.match(/<circle cx="[\d.]+" cy="[\d.]+" r="(?:5|3\.5)"/g) || [];
  assert.equal(circles.length, 2);
});

test('growth() renders a measurement date without an off-by-one-day shift', () => {
  state().growth = [];
  addMeasure({ date: '2026-06-15', weightKg: 6.1, heightCm: 63 });
  addMeasure({ date: '2026-05-01', weightKg: 5.8, heightCm: 60 });
  const html = growth();
  assert.match(html, /Jun 15, 2026/);
});

test('growth() shows a change indicator for head circumference, same as weight and height', () => {
  state().growth = [];
  addMeasure({ date: '2026-05-01', weightKg: 6.0, heightCm: 58, headCm: 40 });
  addMeasure({ date: '2026-06-01', weightKg: 6.5, heightCm: 62, headCm: 42 });
  const html = growth();
  const headCard = html.match(/<div class="card stat[^"]*"[^>]*data-stat="headCm"[^>]*><div class="stat-k">Head<\/div>.*?<\/div>(?:<span class="delta[^>]*>.*?<\/span>)?<\/div>/s)[0];
  assert.match(headCard, /class="delta up"/);
});

test('growth() head-circumference delta skips back past a measurement that omitted it', () => {
  state().growth = [];
  addMeasure({ date: '2026-04-01', weightKg: 5.0, heightCm: 55, headCm: 38 });
  addMeasure({ date: '2026-05-01', weightKg: 5.5, heightCm: 58 }); // head skipped this visit
  addMeasure({ date: '2026-06-01', weightKg: 6.0, heightCm: 61, headCm: 40 });
  const html = growth();
  const headCard = html.match(/<div class="card stat[^"]*"[^>]*data-stat="headCm"[^>]*><div class="stat-k">Head<\/div>.*?<\/div>(?:<span class="delta[^>]*>.*?<\/span>)?<\/div>/s)[0];
  assert.match(headCard, /class="delta up"/);
});

test('growth() defaults to showing the weight graph', () => {
  showGrowthStat('weightKg');
  state().growth = [];
  addMeasure({ date: '2026-05-01', weightKg: 6.0, heightCm: 58 });
  addMeasure({ date: '2026-06-01', weightKg: 6.5, heightCm: 62 });
  const html = growth();
  assert.match(html, /<h2>Weight<\/h2>/);
  assert.match(html, /class="card stat stat-active" data-action="growth:showstat" data-stat="weightKg"/);
});

test('growth() switches the displayed graph and active-card highlight after showGrowthStat', () => {
  state().growth = [];
  addMeasure({ date: '2026-05-01', weightKg: 6.0, heightCm: 58 });
  addMeasure({ date: '2026-06-01', weightKg: 6.5, heightCm: 62 });
  showGrowthStat('heightCm');
  const html = growth();
  assert.match(html, /<h2>Height<\/h2>/);
  assert.match(html, /class="card stat stat-active" data-action="growth:showstat" data-stat="heightCm"/);
  assert.doesNotMatch(html, /class="card stat stat-active" data-action="growth:showstat" data-stat="weightKg"/);
  showGrowthStat('weightKg'); // reset module-level state for later tests
});

test('growth() ignores an unknown stat key passed to showGrowthStat', () => {
  showGrowthStat('weightKg');
  showGrowthStat('bogus');
  state().growth = [];
  addMeasure({ date: '2026-05-01', weightKg: 6.0, heightCm: 58 });
  addMeasure({ date: '2026-06-01', weightKg: 6.5, heightCm: 62 });
  const html = growth();
  assert.match(html, /<h2>Weight<\/h2>/, 'an invalid key should leave the previously shown stat in place');
});

test('growth() weight delta skips back past a measurement that omitted weight, instead of hiding it', () => {
  showGrowthStat('weightKg');
  state().growth = [];
  addMeasure({ date: '2026-04-01', weightKg: 5.0, heightCm: 55 });
  addMeasure({ date: '2026-05-01', weightKg: null, heightCm: 58 }); // weight skipped this visit
  addMeasure({ date: '2026-06-01', weightKg: 6.0, heightCm: 61 });
  const html = growth();
  const weightCard = html.match(/<div class="card stat[^"]*"[^>]*data-stat="weightKg"[^>]*><div class="stat-k">Weight<\/div>.*?<\/div>(?:<span class="delta[^>]*>.*?<\/span>)?<\/div>/s)[0];
  assert.match(weightCard, /class="delta up"/);
});

test('growth() shows a percentile badge on a stat card when sex and birthdate are set', () => {
  state().baby.sex = 'boy';
  state().baby.birthdate = '2026-01-01';
  state().growth = [];
  addMeasure({ date: '2026-07-01', weightKg: 7.934 }); // month 6 WHO median for boys -> 50th percentile
  const html = growth();
  assert.match(html, /<div class="stat-pctl">50th percentile<\/div>/);
});

test('growth() omits the percentile badge when sex is unset', () => {
  state().baby.sex = '';
  state().baby.birthdate = '2026-01-01';
  state().growth = [];
  addMeasure({ date: '2026-07-01', weightKg: 7.934 });
  const html = growth();
  assert.doesNotMatch(html, /stat-pctl/);
});

test('growth() omits the percentile badge and chart overlay when birthdate is unset', () => {
  state().baby.sex = 'boy';
  state().baby.birthdate = '';
  state().growth = [];
  addMeasure({ date: '2026-07-01', weightKg: 7.934 });
  const html = growth();
  assert.doesNotMatch(html, /stat-pctl/);
  assert.doesNotMatch(html, /class="who-median"/);
});

test('growth() omits the percentile badge and chart overlay when the baby is older than 24 months', () => {
  state().baby.sex = 'boy';
  state().baby.birthdate = '2020-01-01'; // well past 24 months old
  state().growth = [];
  addMeasure({ date: '2026-06-01', weightKg: 15 });
  addMeasure({ date: '2026-07-01', weightKg: 15.2 });
  const html = growth();
  assert.doesNotMatch(html, /stat-pctl/);
  assert.doesNotMatch(html, /class="who-median"/);
});

test('growth() draws a WHO median overlay polyline on the chart when sex and birthdate are set', () => {
  showGrowthStat('weightKg');
  state().baby.sex = 'girl';
  state().baby.birthdate = '2026-01-01';
  state().growth = [];
  addMeasure({ date: '2026-04-01', weightKg: 5.8 }); // ~month 3
  addMeasure({ date: '2026-07-01', weightKg: 7.2 }); // ~month 6
  const html = growth();
  assert.match(html, /class="who-median"/);
  state().baby.sex = ''; // reset module-external state for later tests
});
