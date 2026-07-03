// sky.js: hero sky scene — the wake-window prediction rendered as a living
// landscape. Pure math + scene HTML builder + sparse canvas particle engine.

const DAY = 86400000;

// ---------- celestial math ----------
const SYNODIC = 29.530588853; // mean synodic month, days
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14); // known new moon

export function moonPhase(date = new Date()) {
  const days = (date.getTime() - NEW_MOON_EPOCH) / DAY;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const frac = age / SYNODIC;
  return { frac, illum: (1 - Math.cos(frac * 2 * Math.PI)) / 2, waxing: frac < 0.5 };
}

// Sun arc position: elapsed awake time / prediction.high, mapped east (right)
// to west (left) across a shallow arc. Past the window the sun dips below the
// horizon; past 120% it stays just set so the twilight palette stabilizes.
export function sunPosition(elapsedMin, highMin) {
  const frac = highMin > 0 ? Math.max(0, elapsedMin / highMin) : 0;
  const arc = Math.min(frac, 1.2);
  return {
    frac,
    x: 0.92 - 0.84 * Math.min(arc, 1),
    elevation: Math.sin(arc * Math.PI),
  };
}

// ---------- palette ----------
// [elevation, zenith, horizon, glow] — colors are [L, C, H] in oklch.
// Painterly, desaturated, warm-graded. Night zenith sits at plum-violet
// (hue 300) to harmonize with dark mode's maroon firelight.
const SKY_STOPS = [
  [-0.60, [0.24, 0.050, 300], [0.30, 0.050, 320], [0.36, 0.060, 330]], // deep night
  [-0.12, [0.38, 0.070, 300], [0.48, 0.090, 350], [0.55, 0.110, 30]],  // dusk ember afterglow
  [ 0.00, [0.62, 0.070, 285], [0.74, 0.110, 55],  [0.84, 0.130, 70]],  // golden hour horizon
  [ 0.35, [0.80, 0.060, 250], [0.88, 0.060, 75],  [0.94, 0.050, 85]],  // long morning light
  [ 1.00, [0.87, 0.050, 235], [0.92, 0.040, 85],  [0.97, 0.020, 90]],  // midday cerulean-cream
];

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpHue(a, b, t) {
  const d = ((b - a + 540) % 360) - 180; // shortest path around the wheel
  return (a + d * t + 360) % 360;
}
function lerpColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerpHue(a[2], b[2], t)];
}

export function skyPalette(elevation) {
  const e = Math.min(SKY_STOPS.at(-1)[0], Math.max(SKY_STOPS[0][0], elevation));
  let i = 0;
  while (i < SKY_STOPS.length - 2 && e > SKY_STOPS[i + 1][0]) i++;
  const [e0, z0, h0, g0] = SKY_STOPS[i];
  const [e1, z1, h1, g1] = SKY_STOPS[i + 1];
  const t = (e - e0) / (e1 - e0);
  return { zenith: lerpColor(z0, z1, t), horizon: lerpColor(h0, h1, t), glow: lerpColor(g0, g1, t) };
}

export function oklch([l, c, h], alpha = 1) {
  const base = `${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)}`;
  return alpha >= 1 ? `oklch(${base})` : `oklch(${base} / ${alpha})`;
}

// Atmospheric perspective: ridges are the horizon color pulled darker and a
// touch more saturated with depth (0 = far/hazy, 1 = near/dark).
export function ridgeColor(horizon, depth) {
  return [
    Math.max(0.14, horizon[0] * (0.66 - 0.32 * depth)),
    horizon[1] * (0.5 + 0.25 * depth),
    horizon[2],
  ];
}

// ---------- scene state ----------
// Maps hero status to a scene descriptor. All inputs are plain values so the
// mapping is unit-testable without the store.
export function sceneSpec({ asleep, night, newborn, elapsedMin, lowMin, highMin, hour, date }) {
  const deep = hour < 6; // circadian deep night: midnight-6am
  if (asleep || night) {
    return {
      mode: deep ? 'deep-night' : 'night',
      sun: null, moon: moonPhase(date),
      elevation: deep ? -0.6 : -0.45,
      stars: true, fireflies: false,
    };
  }
  if (newborn) {
    return {
      mode: 'newborn',
      sun: { frac: 0.35, x: 0.63, elevation: 0.55 }, moon: null,
      elevation: 0.55, stars: false, fireflies: false,
    };
  }
  const sun = sunPosition(elapsedMin, highMin);
  let mode;
  if (elapsedMin > highMin) mode = 'twilight';
  else if (elapsedMin >= lowMin - 15) mode = 'golden';
  else if (elapsedMin < lowMin * 0.5) mode = 'morning';
  else mode = 'day';
  return {
    mode, sun, moon: null, elevation: sun.elevation,
    stars: mode === 'twilight', fireflies: mode === 'golden',
  };
}
