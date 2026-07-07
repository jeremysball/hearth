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
  [-0.60, [0.14, 0.040, 300], [0.19, 0.045, 320], [0.24, 0.055, 330]], // deep night
  [-0.12, [0.26, 0.065, 300], [0.36, 0.085, 350], [0.44, 0.105, 30]],  // dusk ember afterglow
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

// ---------- ember glow (hero card ambient field, replaces the 16-coal bed) ----------
// heat 0-1 drives color/opacity/size on one continuous curve, tuned so a
// banked ember (heat ~0.1-0.2) still reads as a quiet warm coal — never fully
// cold — and an overtired overshoot (heat ~0.95) reads as an anxious hot
// flare. Values match the ones validated in the Ember Horizon mockup.
export function emberGlow(heat) {
  const h = Math.max(0, Math.min(1, heat));
  return {
    // Core lightness is capped at 0.78 (not 0.88): the hero labels sitting on
    // top of the glow use a near-white cream ink (~0.90 L), and an ember that
    // bright washed the text illegible at high heat. Chroma still climbs with
    // heat so a hot overshoot reads as saturated orange, not just paler.
    core: oklch([0.62 + h * 0.16, 0.14 + h * 0.10, 48 - h * 8]),
    mid: oklch([0.42 + h * 0.16, 0.10 + h * 0.09, 38]),
    groundOp: +(0.30 + h * 0.45).toFixed(2),
    fieldOp: +(0.35 + h * 0.55).toFixed(2),
    size: +(120 + h * 80).toFixed(0),
  };
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

// A richer star field: varied radius (a few "near" bright stars among many
// distant pinpricks) and a touch of warm/cool color variance, instead of one
// flat box-shadow field of uniform 2px dots. Same deterministic mulberry32
// seed as before, so the field is stable across the once-a-minute re-render.
export function starsSVG(seedStr) {
  let seed = 0;
  for (const ch of String(seedStr)) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  const rnd = mulberry32(seed || 42);
  let circles = '';
  for (let i = 0; i < 150; i++) {
    const x = (rnd() * 100).toFixed(1), y = (rnd() * 68).toFixed(1);
    const big = rnd() < 0.07;
    // Big-star radius was 0.85-1.4, which combined with the drop-shadow below
    // to read as soft glowing orbs (bokeh) rather than crisp bright pinpricks.
    const r = big ? (0.5 + rnd() * 0.3).toFixed(2) : (0.22 + rnd() * 0.3).toFixed(2);
    const warm = rnd() < 0.1;
    // Raised the opacity floor so stars read as sharp bright points against
    // the sky rather than translucent flecks that blend into the gradient.
    const a = (big ? 0.78 : 0.5) + rnd() * 0.22;
    const fill = warm
      ? `oklch(0.90 0.045 70 / ${a.toFixed(2)})`
      : `oklch(0.97 0.015 250 / ${a.toFixed(2)})`;
    // Twinkle a minority of stars (every big one, plus a scatter of small
    // ones) rather than the whole field — real skies read as mostly steady
    // points with only some visibly flickering. Duration/delay are randomized
    // per star so 150 points never beat in sync (same idea as the fire
    // system's coprime periods, just continuous instead of three fixed ones).
    const twinkle = big || rnd() < 0.18;
    const cls = [big && 'star-big', twinkle && 'star-twinkle'].filter(Boolean).join(' ');
    const style = twinkle ? ` style="--tw-d:${(1.6 + rnd() * 2.4).toFixed(2)}s;--tw-o:-${(rnd() * 3).toFixed(2)}s"` : '';
    circles += `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"${cls ? ` class="${cls}"` : ''}${style}/>`;
  }
  return `<svg class="sky-stars-rich" viewBox="0 0 100 68" preserveAspectRatio="none" aria-hidden="true">${circles}</svg>`;
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

// Real star patterns, projected from actual RA/Dec (IAU classical Western
// constellation lines, via d3-celestial) into a 24x14 box, one constellation
// per zodiac sign. Points in the box, lines as point-index pairs.
const CONSTELLATIONS = {
  capricorn:   { pts: [[3.47,1.5],[4.11,3.24],[5.61,5.55],[8.9,11.24],[9.99,12.5],[16.64,9.06],[20.53,4.26],[19.2,4.67],[15.8,4.8],[12.69,5.11]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,0]] },
  aquarius:    { pts: [[1.5,6.81],[2.1,6.56],[6.79,4.91],[10.92,2.38],[12.84,2.89],[13.7,2.23],[14.49,2.28],[16.57,5.88],[19.62,6.66],[18.6,12.44],[11,8.92],[12.26,5.98],[13.27,1.56],[20.23,11.92],[22.5,10.82]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[2,10],[3,11],[5,12],[13,8],[8,14]] },
  pisces:      { pts: [[15.89,3.6],[15.69,1.5],[16.44,2.58],[15.67,4.95],[17.58,7.12],[20.5,11.92],[18.53,10.89],[15.89,10.09],[13.5,10.09],[6.94,10.83],[5.8,10.55],[4.77,11.73],[7.14,12.3]], lines: [[0,1],[1,2],[2,0],[0,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,12],[12,9]] },
  aries:       { pts: [[21.74,1.5],[6.97,6.74],[2.64,10.41],[2.26,12.5]], lines: [[0,1],[1,2],[2,3]] },
  taurus:      { pts: [[18.48,4.41],[12.46,6.22],[11.75,6.47],[10.89,6.56],[11.19,5.82],[11.75,5.18],[17.37,1.5],[9.02,7.79],[5.75,8.86],[9.26,10.32],[5.52,9.14],[6.7,12.5]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[3,7],[7,8],[8,9],[8,10],[10,11]] },
  gemini:      { pts: [[5.45,6.93],[6.62,6.93],[9.66,5.41],[13.6,2.45],[17,1.5],[18.55,3.74],[17.19,4.39],[14.9,7.24],[12.58,8.06],[8.76,10.47],[9.86,12.5],[14.61,10.39]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[7,11]] },
  cancer:      { pts: [[14.95,11],[13.01,7.46],[12.81,5.6],[13.29,1.5],[9.05,12.5]], lines: [[0,1],[1,2],[2,3],[1,4]] },
  leo:         { pts: [[5.34,11.79],[5.16,8.52],[7.32,6.42],[16.54,5.95],[22.5,10.01],[16.57,9.43],[6.76,3.98],[2.68,2.21],[1.5,3.74]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[2,6],[6,7],[7,8]] },
  virgo:       { pts: [[1.5,3.91],[2.06,6.13],[5.46,7.26],[8,7.63],[11.29,9.53],[13.06,12.15],[18.98,9.75],[22.13,9.59],[10.38,1.85],[9.62,5.37],[14.17,7.23],[17.31,6.23],[22.5,6.07]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[8,9],[9,3],[4,10],[10,11],[11,12]] },
  libra:       { pts: [[10.56,10.08],[8.78,5.09],[12.3,1.5],[14.8,4.42],[15,11.61],[15.22,12.5]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[1,3]] },
  scorpio:     { pts: [[5.62,4.46],[5.79,2.82],[6.39,1.5],[8.24,4.22],[9.21,4.61],[9.97,5.45],[11.64,8.3],[11.84,10.06],[12.16,12.09],[14.22,12.5],[17.18,12.39],[18.38,11.04],[17.78,10.52],[16.74,9.62]], lines: [[0,1],[1,2],[1,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,12],[12,13]] },
  sagittarius: { pts: [[7.64,9.53],[8.28,8.61],[7.97,6.85],[8.64,5.15],[7.27,3.47],[13.92,12.5],[14.04,11.02],[11.98,6.87],[10.35,5.76],[17.06,11.5],[17.5,8.96],[17.12,5.49],[15.27,4.95],[14.17,4.8],[13.23,5.09],[11.28,5.49],[6.5,7.08],[12.4,6.02],[12.18,3.73],[12.67,3.46],[13.43,2.66],[13.82,2.23],[13.83,1.5],[11.51,3.49],[11.17,4.12]], lines: [[0,1],[1,2],[2,3],[3,4],[5,6],[6,7],[7,8],[8,3],[9,10],[10,11],[11,12],[12,13],[13,14],[14,15],[15,8],[8,2],[2,16],[16,1],[1,7],[7,17],[17,15],[15,18],[18,19],[19,20],[20,21],[21,22],[18,23],[23,24],[24,15]] },
};

// Never announced; discovered — but visible enough to actually notice at a
// glance, unlike the original near-invisible 8%-opacity version. Opacity and
// position are CSS-only (see styles.css); this just emits the geometry.
// Deterministic per-point "magnitude": real constellations read as a mix of a
// few bright anchor stars among smaller ones, not a uniform dot pattern. Hashed
// from the point's own coordinates so it's stable across re-renders without
// needing a seed or real magnitude data.
function starMagnitude(x, y) {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

export function constellationSVG(birthdate) {
  const sign = zodiacSign(birthdate);
  if (!sign) return '';
  const c = CONSTELLATIONS[sign];
  const lines = c.lines.map(([a, b]) =>
    `<line x1="${c.pts[a][0]}" y1="${c.pts[a][1]}" x2="${c.pts[b][0]}" y2="${c.pts[b][1]}"/>`).join('');
  const pts = c.pts.map(([x, y]) => {
    const t = starMagnitude(x, y);
    const r = t < 0.25 ? (0.75 + t * 1.4).toFixed(2) : (0.32 + t * 0.5).toFixed(2);
    return `<circle cx="${x}" cy="${y}" r="${r}"/>`;
  }).join('');
  return `<svg class="sky-constellation" viewBox="0 0 24 14" aria-hidden="true">${lines}${pts}</svg>`;
}

// ---------- scene svg pieces ----------
// A lit sphere, not a flat disc + ring stack: an off-center specular highlight
// (cx/cy offset in sunCore) and a warm rim read as a body catching light, not
// a sticker. .sun-rays (a FLUX starburst used as an SVG luminance mask over a
// warm screen-blended fill, positioned by CSS from --sun-x/--sun-y) rides
// alongside for a hint of dancing light — see the keyframes in styles.css.
// There is exactly one sun on screen at a time, so fixed mask/gradient ids
// (no per-render uniqueness) are safe.
function sunSVG() {
  return `<svg class="sun-rays" viewBox="0 0 100 100" aria-hidden="true">
    <defs><mask id="sun-rays-mask"><image href="assets/sky/sun-starburst.webp" x="0" y="0" width="100" height="100"/></mask></defs>
    <rect class="sun-rays-fill" width="100" height="100" mask="url(#sun-rays-mask)"/>
  </svg><svg class="sky-sun" viewBox="0 0 24 24" aria-hidden="true">
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
// re-render resumes each cloud where it was instead of snapping it back. Each
// puff is a FLUX-painted raster (assets/sky/*.webp) used as an SVG luminance
// mask, not a final-color image: the same file does triple duty as (1) the
// silhouette cut over the existing palette gradient — this is exactly why
// color stays 100% palette-driven — (2) a self-masked soft-light shading
// overlay that reintroduces FLUX's own painted lobes/crevices as real tonal
// shading, and (3) the clip region for a warm screen-blended hotspot. The
// hotspot's cx is computed here (not via CSS var) because a live-browser
// check this session showed CSS custom properties do not actually reposition
// a <radialGradient>'s cx at paint time in this engine, despite
// getComputedStyle reporting the resolved value — see the plan's Global
// Constraints for the verification. One gradient/mask id set per layer
// (c1/c2/c3) is enough uniqueness: only one cloud layer of each class ever
// renders in a given card at once.
const CLOUD_SHAPE = { c1: 'cloud-tower', c2: 'cloud-classic', c3: 'cloud-hazybank' };
const CLOUD_VIEW_H = 33.49; // 60 * 1536/2752, the source PNGs' true aspect ratio
// Must match `.sky-low-power .sky-cloud { animation-duration: 700s !important }`
// in styles.css — the delay below is computed as a fraction of *this* duration,
// so it has to agree with whichever duration the CSS actually applies.
const LOW_POWER_CLOUD_DUR = 700;

function cloudsHTML(mode, sunFrac) {
  if (mode === 'deep-night') return '';
  const t = Date.now() / 1000;
  const hotspotCx = sunFrac == null ? '50%' : `${(sunFrac * 100).toFixed(1)}%`;
  const cloud = (cls, dur) => {
    const gid = `cloud-${cls}`;
    const href = `assets/sky/${CLOUD_SHAPE[cls]}.webp`;
    const h = CLOUD_VIEW_H;
    // Low power overrides every cloud's animation-duration in CSS; compute the
    // delay against that same effective duration so a cloud's phase (delay /
    // duration) doesn't jump when low-power toggles between renders.
    const effDur = lowPower ? LOW_POWER_CLOUD_DUR : dur;
    return `<div class="sky-cloud ${cls}" style="animation-delay:-${(t % effDur).toFixed(1)}s">` +
      `<svg viewBox="0 0 60 ${h}" aria-hidden="true"><defs>` +
      `<linearGradient id="${gid}" x1="6" y1="${(h * 0.2).toFixed(1)}" x2="44" y2="${(h * 0.85).toFixed(1)}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0%" stop-color="var(--cloud-hi)"/><stop offset="60%" stop-color="var(--cloud-mid)"/><stop offset="100%" stop-color="var(--cloud-sh)"/>` +
      `</linearGradient>` +
      `<radialGradient id="${gid}-hotspot" cx="${hotspotCx}" cy="30%" r="70%">` +
      `<stop offset="0%" stop-color="oklch(0.92 0.09 75 / 0.85)"/><stop offset="100%" stop-color="oklch(0.92 0.09 75 / 0)"/>` +
      `</radialGradient>` +
      `<mask id="${gid}-mask"><image href="${href}" x="0" y="0" width="60" height="${h}" preserveAspectRatio="xMidYMid meet"/></mask>` +
      `</defs>` +
      `<rect width="60" height="${h}" fill="url(#${gid})" mask="url(#${gid}-mask)"/>` +
      `<image href="${href}" x="0" y="0" width="60" height="${h}" preserveAspectRatio="xMidYMid meet" mask="url(#${gid}-mask)" class="cloud-shade"/>` +
      `<rect width="60" height="${h}" fill="url(#${gid}-hotspot)" mask="url(#${gid}-mask)" class="cloud-hotspot"/>` +
      `</svg></div>`;
  };
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
    ? `<div class="sky-l sky-stars">${starsSVG(birthdate || name || 'hearth')}<div class="night-wash"></div>${spec.moon ? constellationSVG(birthdate) : ''}</div>`
    : '';
  return `<div class="sky" data-sky="${spec.mode}" aria-hidden="true" style="${vars.join(';')}">
    <div class="sky-l sky-grad"></div>
    ${stars}
    ${bodies}
    ${cloudsHTML(spec.mode, spec.sun ? spec.sun.x : null)}
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
    particles = particles.filter((p) => { p.t += dt; p.draw(ctx, w, h); return p.t < p.life && !p.dead; });
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
      if (y > h * 0.5) { this.dead = true; return; } // past the horizon: prune now, don't idle out the rest of life
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
