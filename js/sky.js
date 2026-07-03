// sky.js: hero sky scene — the wake-window prediction rendered as a living
// sky. Pure math + scene HTML builder + sparse canvas particle engine.
import { state } from './store.js';

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

// ---------- scene svg pieces ----------
// A lit sphere, not a flat disc + ring stack: an off-center specular highlight
// (cx/cy offset in sunCore) and a warm rim read as a body catching light, not
// a sticker. .sun-rays (a screen-blended conic gradient, positioned by CSS from
// --sun-x/--sun-y) rides alongside for a hint of dancing light — see the
// keyframes in styles.css. There is exactly one sun on screen at a time, so a
// fixed gradient id (no per-render uniqueness) is safe.
function sunSVG() {
  return `<div class="sun-rays"></div><svg class="sky-sun" viewBox="0 0 24 24" aria-hidden="true">
    <defs>
      <radialGradient id="sunHalo-hero" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="var(--sky-glow)" stop-opacity="0.4"/>
        <stop offset="45%" stop-color="var(--sky-glow)" stop-opacity="0.14"/>
        <stop offset="100%" stop-color="var(--sky-glow)" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="sunCore-hero" cx="40%" cy="35%" r="72%">
        <stop offset="0%" stop-color="oklch(0.99 0.02 95)"/>
        <stop offset="42%" stop-color="oklch(0.95 0.09 80)"/>
        <stop offset="100%" stop-color="oklch(0.78 0.16 55)"/>
      </radialGradient>
    </defs>
    <circle cx="12" cy="12" r="16" fill="url(#sunHalo-hero)"/>
    <circle class="sun-disc" cx="12" cy="12" r="7" fill="url(#sunCore-hero)" stroke="oklch(0.7 0.12 55 / .35)" stroke-width="0.4"/>
  </svg>`;
}

// Real-phase moon: a painterly raster disc (assets/sky/moon.webp) lit like a
// body, not a hand-drawn sticker. The terminator mask carves the lit fraction —
// the half-rect hides the dark side, the soft bow ellipse restores it;
// rx = r|cos(2pi*frac)| gives the correct crescent/gibbous curve. A circle clip
// trims the raster's feathered margin to a crisp limb; the disc image fills 85%
// of its frame, so width 23.56 centered maps the disc to r=10. Bloom (corona +
// wide sky-lifting halo) lives in CSS so it stays cheap and compositor-only.
export function moonSVG(phase) {
  const { frac, illum, waxing } = phase;
  const r = 10, c = 12;
  const rx = (Math.abs(Math.cos(frac * 2 * Math.PI)) * r).toFixed(2);
  const bow = illum >= 0.5 ? '#fff' : '#000';
  const darkX = waxing ? 0 : c; // waxing: lit on the right, dark half on the left
  return `<svg class="sky-moon" viewBox="0 0 24 24" aria-hidden="true">
    <defs>
      <filter id="sky-moon-soft" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="0.55"/>
      </filter>
      <mask id="sky-moon-mask">
        <rect width="24" height="24" fill="#fff"/>
        <rect x="${darkX}" width="12" height="24" fill="#000"/>
        <ellipse cx="${c}" cy="${c}" rx="${rx}" ry="${r}" fill="${bow}" filter="url(#sky-moon-soft)"/>
      </mask>
      <clipPath id="sky-moon-clip"><circle cx="${c}" cy="${c}" r="${r}"/></clipPath>
    </defs>
    <g class="moon-body" mask="url(#sky-moon-mask)">
      <g clip-path="url(#sky-moon-clip)">
        <image href="assets/sky/moon.webp" x="0.22" y="0.22" width="23.56" height="23.56" preserveAspectRatio="xMidYMid meet"/>
      </g>
    </g>
  </svg>`;
}

// Blurred blob clusters drifting at coprime durations (the fire-a/b/c trick).
// The negative delay is phase-locked to wall time so the once-a-minute
// re-render resumes each cloud where it was instead of snapping it back.
function cloudsHTML(mode) {
  if (mode === 'deep-night') return '';
  const t = Date.now() / 1000;
  const cloud = (cls, dur) =>
    `<div class="sky-cloud ${cls}" style="animation-delay:-${(t % dur).toFixed(1)}s">` +
    `<svg viewBox="0 0 60 20" aria-hidden="true"><ellipse cx="18" cy="12" rx="16" ry="6"/>` +
    `<ellipse cx="34" cy="9" rx="14" ry="5"/><ellipse cx="47" cy="13" rx="11" ry="4.5"/></svg></div>`;
  if (mode === 'night') return `<div class="sky-l sky-clouds">${cloud('c2', 251)}</div>`;
  return `<div class="sky-l sky-clouds">${cloud('c1', 173)}${cloud('c2', 251)}${cloud('c3', 293)}</div>`;
}

// ---------- scene builder ----------
export function skyScene(spec, { birthdate = '', name = '' } = {}) {
  const pal = skyPalette(spec.elevation);
  const vars = [
    `--sky-zenith:${oklch(pal.zenith)}`,
    `--sky-horizon:${oklch(pal.horizon)}`,
    `--sky-glow:${oklch(pal.glow)}`,
  ];
  let bodies = '';
  if (spec.sun && spec.sun.elevation > -0.05) {
    vars.push(
      `--sun-x:${(spec.sun.x * 100).toFixed(1)}%`,
      `--sun-y:${(62 - spec.sun.elevation * 46).toFixed(1)}%`,
      `--sun-warm:${Math.min(1, Math.max(0, 1 - spec.sun.elevation)).toFixed(2)}`
    );
    bodies += sunSVG();
  }
  if (spec.moon) {
    vars.push(`--moon-x:${spec.mode === 'deep-night' ? '58%' : '72%'}`, '--moon-y:22%');
    bodies += moonSVG(spec.moon);
  }
  const stars = spec.stars
    ? `<div class="sky-l sky-stars"><i class="sky-starfield" style="box-shadow:${starField(birthdate || name || 'hearth')}"></i>${brightStars()}${spec.moon ? constellationSVG(birthdate) : ''}</div>`
    : '';
  return `<div class="sky" data-sky="${spec.mode}" aria-hidden="true" style="${vars.join(';')}">
    <div class="sky-l sky-grad"></div>
    ${stars}
    ${bodies}
    ${cloudsHTML(spec.mode)}
    <canvas class="sky-canvas"></canvas>
    <div class="sky-l sky-grain"></div>
    <div class="sky-l sky-grade"></div>
    <svg width="0" height="0" style="position:absolute"><filter id="sky-grain-f"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7"/><feColorMatrix type="saturate" values="0"/></filter></svg>
  </div>`;
}

// ---------- hero integration ----------
// Builds the scene from the hero's already-derived status. The light position
// feeds --light-x/--light-y so card material highlights follow the sun/moon.
export function heroSky(st, sp, now = new Date()) {
  const elapsedMin = (now.getTime() - new Date(st.since).getTime()) / 60000;
  const spec = sceneSpec({
    asleep: st.state === 'asleep',
    night: Boolean(sp.night),
    newborn: Boolean(sp.newborn),
    elapsedMin,
    lowMin: sp.prediction ? sp.prediction.low : 0,
    highMin: sp.prediction ? sp.prediction.high : 0,
    hour: now.getHours(),
    date: now,
  });
  const b = state().baby;
  const sunUp = spec.sun && spec.sun.elevation > 0.02;
  const lx = sunUp ? spec.sun.x * 100 : 72;
  const ly = sunUp ? 62 - spec.sun.elevation * 46 : 22;
  return {
    mode: spec.mode,
    html: skyScene(spec, { birthdate: b.birthdate, name: b.name }),
    cardStyle: `--light-x:${lx.toFixed(1)}%;--light-y:${ly.toFixed(1)}%`,
  };
}

// ---------- particle layer ----------
// One small canvas, sparse particles only (tens). The rAF loop runs ONLY
// while a particle event is live; otherwise the canvas is idle.
let particles = [];
let rafId = 0;
let timers = [];
let ctx = null;
let dpr = 1;
let sceneMode = '';
let lowPower = false;

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function teardownSky() {
  timers.forEach(clearTimeout);
  timers = [];
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  particles = [];
  ctx = null;
}

export function initSky() {
  teardownSky();
  const sky = document.querySelector('.card.hero .sky');
  const canvas = sky && sky.querySelector('.sky-canvas');
  if (!canvas || document.hidden || reducedMotion() || lowPower) return;
  sceneMode = sky.dataset.sky;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  ctx = canvas.getContext('2d');
  bindParallax();
  scheduleEvents();
}

function later(minS, maxS, fn) {
  timers.push(setTimeout(fn, (minS + Math.random() * (maxS - minS)) * 1000));
}

function scheduleEvents() {
  if (sceneMode === 'golden') later(2, 6, spawnFireflies);
  if (sceneMode === 'night' || sceneMode === 'deep-night') later(20, 90, spawnShootingStar);
  if (sceneMode === 'morning' || sceneMode === 'day') later(30, 240, spawnBirds);
}

function ensureLoop() {
  if (rafId || !ctx) return;
  let last = performance.now();
  const step = (now) => {
    if (!ctx) { rafId = 0; return; }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const { width: w, height: h } = ctx.canvas;
    ctx.clearRect(0, 0, w, h);
    particles = particles.filter((p) => { p.t += dt; p.draw(ctx, w, h); return p.t < p.life; });
    rafId = particles.length ? requestAnimationFrame(step) : 0; // idle until the next event
  };
  rafId = requestAnimationFrame(step);
}

// Fireflies over the horizon — sweetspot (golden) only.
function spawnFireflies() {
  for (let i = 0; i < 7; i++) {
    const bx = 0.1 + Math.random() * 0.8, by = 0.62 + Math.random() * 0.2;
    const ph = Math.random() * 6;
    particles.push({
      t: 0, life: 10 + Math.random() * 6,
      draw(c, w, h) {
        const x = (bx + Math.sin(this.t * 0.5 + ph) * 0.03) * w;
        const y = (by + Math.cos(this.t * 0.7 + ph) * 0.02) * h;
        const tw = Math.max(0, Math.sin(this.t * 2.1 + ph));
        const fade = Math.min(1, this.t, this.life - this.t);
        c.globalAlpha = 0.75 * tw * fade;
        c.fillStyle = 'oklch(0.88 0.16 105)';
        c.beginPath(); c.arc(x, y, 1.1 * dpr, 0, 7); c.fill();
        c.globalAlpha = 1;
      },
    });
  }
  ensureLoop();
  later(14, 26, spawnFireflies);
}

// Shooting stars with fading trails — night, rare. Fade before the horizon.
function spawnShootingStar() {
  const x0 = 0.15 + Math.random() * 0.6, y0 = 0.05 + Math.random() * 0.15;
  const vx = 0.25 + Math.random() * 0.15, vy = 0.12;
  particles.push({
    t: 0, life: 1.1,
    draw(c, w, h) {
      const k = this.t / this.life;
      const x = (x0 + vx * this.t) * w, y = (y0 + vy * this.t) * h;
      if (y > h * 0.5) return; // gone well above the horizon
      const g = c.createLinearGradient(x - 30 * dpr, y - 14 * dpr, x, y);
      g.addColorStop(0, 'oklch(0.95 0.02 90 / 0)');
      g.addColorStop(1, `oklch(0.95 0.02 90 / ${(0.8 * (1 - k)).toFixed(3)})`);
      c.strokeStyle = g; c.lineWidth = 1 * dpr;
      c.beginPath(); c.moveTo(x - 30 * dpr, y - 14 * dpr); c.lineTo(x, y); c.stroke();
    },
  });
  ensureLoop();
  later(40, 160, spawnShootingStar);
}

// Birds crossing on a curved path — daytime, a few times an hour.
function spawnBirds() {
  const dir = Math.random() < 0.5 ? 1 : -1;
  const y0 = 0.18 + Math.random() * 0.2;
  for (let i = 0; i < 3; i++) {
    particles.push({
      t: -i * 0.5, life: 12,
      draw(c, w, h) {
        if (this.t < 0) return;
        const k = this.t / this.life;
        const x = (dir > 0 ? k : 1 - k) * 1.1 * w - 0.05 * w;
        const y = (y0 - Math.sin(k * Math.PI) * 0.06 + i * 0.015) * h;
        const flap = Math.sin(this.t * 9 + i) * 2.2 * dpr;
        c.strokeStyle = 'oklch(0.35 0.03 40 / 0.65)';
        c.lineWidth = 1 * dpr;
        c.beginPath();
        c.moveTo(x - 3.4 * dpr, y + flap);
        c.quadraticCurveTo(x, y - 1.6 * dpr, x + 3.4 * dpr, y + flap);
        c.stroke();
      },
    });
  }
  ensureLoop();
  later(420, 1500, spawnBirds);
}

// Page Visibility: the canvas ticks only while the app is visible.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) teardownSky();
  else initSky();
});

// Low battery: particles off, cloud drift slowed (CSS reads .sky-low-power).
if (typeof navigator !== 'undefined' && navigator.getBattery) {
  navigator.getBattery().then((b) => {
    const update = () => {
      lowPower = b.level < 0.2 && !b.charging;
      document.documentElement.classList.toggle('sky-low-power', lowPower);
      initSky();
    };
    b.addEventListener('levelchange', update);
    b.addEventListener('chargingchange', update);
    update();
  }).catch(() => {});
}

// ---------- parallax ----------
// Depth-scaled transform from device tilt. iOS requires a user-gesture
// permission request; if it never arrives, the autonomous drift below is the
// graceful fallback.
let parallaxBound = false;

function bindParallax() {
  if (parallaxBound || reducedMotion() || lowPower) return;
  if (typeof DeviceOrientationEvent === 'undefined') return;
  parallaxBound = true;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    const ask = () => {
      DeviceOrientationEvent.requestPermission()
        .then((r) => { if (r === 'granted') attachTilt(); })
        .catch(() => {});
    };
    document.addEventListener('touchend', ask, { once: true });
  } else {
    attachTilt();
  }
}

function attachTilt() {
  let raf = 0;
  window.addEventListener('deviceorientation', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const el = document.querySelector('.card.hero .sky');
      if (!el) return;
      const x = Math.max(-1, Math.min(1, (e.gamma || 0) / 30));
      const y = Math.max(-1, Math.min(1, ((e.beta || 0) - 40) / 30));
      el.style.setProperty('--par-x', x.toFixed(3));
      el.style.setProperty('--par-y', y.toFixed(3));
    });
  });
}
