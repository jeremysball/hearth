import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM + storage shims so sky.js (and its store.js import) load under Node.
class MemoryStorage { constructor(){this.s={};} getItem(k){return Object.prototype.hasOwnProperty.call(this.s,k)?this.s[k]:null;} setItem(k,v){this.s[k]=String(v);} removeItem(k){delete this.s[k];} }
globalThis.localStorage = new MemoryStorage();
globalThis.window = globalThis;
globalThis.document = {
  querySelector: () => null, querySelectorAll: () => [],
  hidden: true, addEventListener: () => {},
  documentElement: { classList: { toggle: () => {} } },
};
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });

const { moonPhase, sunPosition, skyPalette, oklch, ridgeColor } = await import('./sky.js');

const EPOCH = Date.UTC(2000, 0, 6, 18, 14); // known new moon
const DAY = 86400000;

test('moonPhase: new moon at the epoch', () => {
  const m = moonPhase(new Date(EPOCH));
  assert.ok(m.illum < 0.001);
  assert.ok(m.frac < 0.001);
});

test('moonPhase: full moon half a synodic cycle later', () => {
  const m = moonPhase(new Date(EPOCH + 14.7652944 * DAY));
  assert.ok(m.illum > 0.999);
  assert.ok(Math.abs(m.frac - 0.5) < 0.001);
});

test('moonPhase: waxing in the first half, waning in the second', () => {
  assert.equal(moonPhase(new Date(EPOCH + 7 * DAY)).waxing, true);
  assert.equal(moonPhase(new Date(EPOCH + 22 * DAY)).waxing, false);
});

test('moonPhase: dates before the epoch normalize into 0..1', () => {
  const m = moonPhase(new Date(EPOCH - 5 * DAY));
  assert.ok(m.frac > 0 && m.frac < 1);
});

test('sunPosition: rises east (right) at wake', () => {
  const s = sunPosition(0, 120);
  assert.ok(Math.abs(s.elevation) < 1e-9);
  assert.ok(s.x > 0.9);
});

test('sunPosition: zenith at half the window', () => {
  const s = sunPosition(60, 120);
  assert.equal(s.elevation, 1);
  assert.ok(Math.abs(s.x - 0.5) < 0.001);
});

test('sunPosition: sets west (left) at the window high', () => {
  const s = sunPosition(120, 120);
  assert.ok(Math.abs(s.elevation) < 1e-9);
  assert.ok(s.x < 0.1);
});

test('sunPosition: below the horizon past the window', () => {
  assert.ok(sunPosition(150, 120).elevation < 0);
});

test('sunPosition: clamps 20% past the window (sun stays just set)', () => {
  assert.equal(sunPosition(300, 120).elevation, sunPosition(144, 120).elevation);
});

test('skyPalette: clamps at both extremes', () => {
  assert.deepEqual(skyPalette(1), skyPalette(2));
  assert.deepEqual(skyPalette(-0.6), skyPalette(-2));
});

test('skyPalette: zenith brightens with elevation', () => {
  let prev = -Infinity;
  for (const e of [-0.6, -0.12, 0, 0.35, 1]) {
    const L = skyPalette(e).zenith[0];
    assert.ok(L > prev, `zenith L not increasing at e=${e}`);
    prev = L;
  }
});

test('skyPalette: horizon hue lerps the short way around 0deg', () => {
  const h = skyPalette(-0.06).horizon[2]; // between dusk (350) and golden (55)
  assert.ok(h >= 350 || h <= 55, 'hue took the long path: ' + h);
});

test('oklch: formats with and without alpha', () => {
  assert.equal(oklch([0.5, 0.1, 300]), 'oklch(0.500 0.100 300.0)');
  assert.equal(oklch([0.5, 0.1, 300], 0.5), 'oklch(0.500 0.100 300.0 / 0.5)');
});

test('ridgeColor: near ridge darker than far (atmospheric perspective)', () => {
  const hz = [0.8, 0.1, 60];
  assert.ok(ridgeColor(hz, 1)[0] < ridgeColor(hz, 0)[0]);
});
