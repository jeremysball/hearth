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

// ---------- stars ----------
// Deterministic PRNG (mulberry32) so the star field is stable across the
// once-a-minute re-renders — stars must not jump.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One box-shadow star field on a single element. cq units size it to the
// .sky container (container-type: size).
export function starField(seedStr) {
  let seed = 0;
  for (const ch of String(seedStr)) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  const rnd = mulberry32(seed || 42);
  const shadows = [];
  for (let i = 0; i < 90; i++) {
    const x = (rnd() * 100).toFixed(1);
    const y = (rnd() * 70).toFixed(1);
    const a = (0.25 + rnd() * 0.55).toFixed(2);
    shadows.push(`${x}cqw ${y}cqh 0 0 oklch(0.95 0.02 90 / ${a})`);
  }
  return shadows.join(',');
}

export function brightStars() {
  const POS = [[12, 12], [30, 26], [55, 9], [72, 31], [88, 15]];
  return POS.map(([x, y], i) =>
    `<i class="star-b" style="left:${x}%;top:${y}%;animation-delay:-${(i * 1.1).toFixed(1)}s"></i>`
  ).join('');
}

// ---------- birth constellation ----------
// Zodiac cutoffs: [month, last day of the sign, sign].
const ZODIAC_DATES = [
  [1, 19, 'capricorn'], [2, 18, 'aquarius'], [3, 20, 'pisces'], [4, 19, 'aries'],
  [5, 20, 'taurus'], [6, 20, 'gemini'], [7, 22, 'cancer'], [8, 22, 'leo'],
  [9, 22, 'virgo'], [10, 22, 'libra'], [11, 21, 'scorpio'], [12, 21, 'sagittarius'],
  [12, 31, 'capricorn'],
];

export function zodiacSign(birthdate) {
  if (!birthdate) return null;
  const [, m, d] = String(birthdate).split('-').map(Number);
  if (!m || !d) return null;
  for (const [mm, dd, sign] of ZODIAC_DATES) {
    if (m < mm || (m === mm && d <= dd)) return sign;
  }
  return 'capricorn';
}

// Stylized star patterns, points in a 24x14 box, lines as point-index pairs.
const CONSTELLATIONS = {
  capricorn:   { pts: [[2,4],[7,3],[12,5],[17,4],[21,7],[16,10],[10,9]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,0]] },
  aquarius:    { pts: [[2,8],[6,5],[10,8],[14,5],[18,8],[22,5]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5]] },
  pisces:      { pts: [[2,3],[6,5],[10,7],[14,9],[19,11],[21,7],[17,4]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]] },
  aries:       { pts: [[3,9],[9,6],[15,4],[20,4],[22,6]], lines: [[0,1],[1,2],[2,3],[3,4]] },
  taurus:      { pts: [[3,2],[8,5],[12,7],[16,5],[21,2],[12,11]], lines: [[0,1],[1,2],[2,3],[3,4],[2,5]] },
  gemini:      { pts: [[5,2],[5,7],[5,12],[17,2],[17,7],[17,12],[11,4]], lines: [[0,1],[1,2],[3,4],[4,5],[0,6],[6,3]] },
  cancer:      { pts: [[12,3],[10,6],[8,10],[15,8],[19,11]], lines: [[0,1],[1,2],[1,3],[3,4]] },
  leo:         { pts: [[4,10],[9,9],[14,10],[19,8],[21,4],[17,2],[13,4]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,3]] },
  virgo:       { pts: [[3,3],[7,5],[11,7],[15,6],[19,9],[13,11],[9,10]], lines: [[0,1],[1,2],[2,3],[3,4],[2,5],[5,6]] },
  libra:       { pts: [[5,10],[8,4],[16,4],[19,10],[12,2]], lines: [[0,1],[1,4],[4,2],[2,3],[1,2]] },
  scorpio:     { pts: [[2,3],[6,4],[10,6],[13,9],[15,12],[19,12],[22,9]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]] },
  sagittarius: { pts: [[3,11],[8,8],[13,5],[18,3],[15,9],[10,12]], lines: [[0,1],[1,2],[2,3],[1,4],[4,5]] },
};

// Never announced; discovered. Hairline lines at ~8% opacity via CSS.
export function constellationSVG(birthdate) {
  const sign = zodiacSign(birthdate);
  if (!sign) return '';
  const c = CONSTELLATIONS[sign];
  const lines = c.lines.map(([a, b]) =>
    `<line x1="${c.pts[a][0]}" y1="${c.pts[a][1]}" x2="${c.pts[b][0]}" y2="${c.pts[b][1]}"/>`).join('');
  const pts = c.pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.4"/>`).join('');
  return `<svg class="sky-constellation" viewBox="0 0 24 14" aria-hidden="true">${lines}${pts}</svg>`;
}
