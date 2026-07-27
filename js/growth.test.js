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
const { growth } = await import('./growth.js');

test('growth() shows no delta when the latest measurement has no weight recorded', () => {
  state().growth = [];
  addMeasure({ date: '2026-05-01', weightKg: 6.0, heightCm: 58 });
  addMeasure({ date: '2026-06-01', weightKg: null, heightCm: 62 }); // height-only follow-up
  const html = growth();
  assert.match(html, /<div class="stat-v">—<\/div>/);
  assert.doesNotMatch(html, /class="delta down"/);
});

test('growth() weight chart skips a height-only point instead of corrupting the scale', () => {
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
  const headCard = html.match(/<div class="card stat"><div class="stat-k">Head<\/div>.*?<\/div>(?:<span class="delta[^>]*>.*?<\/span>)?<\/div>/s)[0];
  assert.match(headCard, /class="delta up"/);
});

test('growth() head-circumference delta skips back past a measurement that omitted it', () => {
  state().growth = [];
  addMeasure({ date: '2026-04-01', weightKg: 5.0, heightCm: 55, headCm: 38 });
  addMeasure({ date: '2026-05-01', weightKg: 5.5, heightCm: 58 }); // head skipped this visit
  addMeasure({ date: '2026-06-01', weightKg: 6.0, heightCm: 61, headCm: 40 });
  const html = growth();
  const headCard = html.match(/<div class="card stat"><div class="stat-k">Head<\/div>.*?<\/div>(?:<span class="delta[^>]*>.*?<\/span>)?<\/div>/s)[0];
  assert.match(headCard, /class="delta up"/);
});

test('growth() weight delta skips back past a measurement that omitted weight, instead of hiding it', () => {
  state().growth = [];
  addMeasure({ date: '2026-04-01', weightKg: 5.0, heightCm: 55 });
  addMeasure({ date: '2026-05-01', weightKg: null, heightCm: 58 }); // weight skipped this visit
  addMeasure({ date: '2026-06-01', weightKg: 6.0, heightCm: 61 });
  const html = growth();
  const weightCard = html.match(/<div class="card stat"><div class="stat-k">Weight<\/div>.*?<\/div>(?:<span class="delta[^>]*>.*?<\/span>)?<\/div>/s)[0];
  assert.match(weightCard, /class="delta up"/);
});
