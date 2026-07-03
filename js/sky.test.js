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

const { moonPhase, sunPosition, skyPalette, oklch, ridgeColor, sceneSpec, starField, zodiacSign, constellationSVG, brightStars } = await import('./sky.js');

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

const specBase = {
  asleep: false, night: false, newborn: false,
  elapsedMin: 0, lowMin: 140, highMin: 170,
  hour: 13, date: new Date('2026-07-03T13:00:00'),
};

test('sceneSpec: early window is morning', () => {
  const s = sceneSpec({ ...specBase, elapsedMin: 20 }); // < low * 0.5
  assert.equal(s.mode, 'morning');
  assert.ok(s.sun && s.sun.elevation > 0);
  assert.equal(s.moon, null);
});

test('sceneSpec: mid window is day', () => {
  assert.equal(sceneSpec({ ...specBase, elapsedMin: 100 }).mode, 'day');
});

test('sceneSpec: within 15m of the low edge is golden (sweetspot)', () => {
  const s = sceneSpec({ ...specBase, elapsedMin: 130 });
  assert.equal(s.mode, 'golden');
  assert.equal(s.fireflies, true);
});

test('sceneSpec: past the window high is twilight with first stars', () => {
  const s = sceneSpec({ ...specBase, elapsedMin: 180 });
  assert.equal(s.mode, 'twilight');
  assert.ok(s.sun.elevation < 0);
  assert.equal(s.stars, true);
});

test('sceneSpec: asleep at any daytime hour is night with a real moon', () => {
  const s = sceneSpec({ ...specBase, asleep: true, elapsedMin: 30 });
  assert.equal(s.mode, 'night');
  assert.equal(s.sun, null);
  assert.ok(s.moon && typeof s.moon.frac === 'number');
  assert.equal(s.stars, true);
});

test('sceneSpec: circadian night (12-6am) is deep-night', () => {
  assert.equal(sceneSpec({ ...specBase, asleep: true, hour: 3 }).mode, 'deep-night');
  assert.equal(sceneSpec({ ...specBase, night: true, hour: 3 }).mode, 'deep-night');
});

test('sceneSpec: awake at night (pre-midnight) is night', () => {
  assert.equal(sceneSpec({ ...specBase, night: true, hour: 22 }).mode, 'night');
});

test('sceneSpec: newborn gets a fixed gentle mid-morning sky', () => {
  const s = sceneSpec({ ...specBase, newborn: true });
  assert.equal(s.mode, 'newborn');
  assert.equal(s.sun.elevation, 0.55);
  assert.equal(s.stars, false);
});

test('starField: deterministic for a given seed', () => {
  assert.equal(starField('2026-01-01'), starField('2026-01-01'));
  assert.notEqual(starField('2026-01-01'), starField('2025-06-15'));
});

test('starField: exactly 90 stars', () => {
  // oklch colors are space-separated, so commas only delimit shadows.
  assert.equal(starField('x').split(',').length, 90);
});

test('zodiacSign: known boundaries', () => {
  assert.equal(zodiacSign('2026-01-01'), 'capricorn');
  assert.equal(zodiacSign('2025-12-25'), 'capricorn');
  assert.equal(zodiacSign('2025-08-01'), 'leo');
  assert.equal(zodiacSign('2025-03-21'), 'aries');
  assert.equal(zodiacSign('2025-03-20'), 'pisces');
  assert.equal(zodiacSign(''), null);
});

test('constellationSVG: renders hairline lines and points', () => {
  const svg = constellationSVG('2026-01-01');
  assert.match(svg, /class="sky-constellation"/);
  assert.ok(svg.includes('<line'));
  assert.ok(svg.includes('<circle'));
  assert.equal(constellationSVG(''), '');
});

test('brightStars: five staggered twinkle stars', () => {
  const html = brightStars();
  assert.equal((html.match(/star-b/g) || []).length, 5);
  assert.match(html, /animation-delay/);
});
