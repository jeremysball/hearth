// fx.js: celebratory confetti, Web Audio sounds, and haptics.
import { state } from './store.js';

let audioCtx = null;

function getCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Constructing an AudioContext is a genuinely slow, blocking browser call
// (tens to hundreds of ms, worse under CPU throttling like low-power/low-
// battery mode: measured ~28ms even at 6x throttling in a sandboxed test,
// vs <1ms for every call after). Call this once on the very first tap so
// that cost lands before the user does anything, not mid-drag on the
// spinner or mid-save on a log entry (both of which felt "laggy").
export function warmAudio() {
  getCtx();
}

const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Cubically-decaying noise burst: simulates the transient snap of a mallet or pick attack.
function noiseSnap(ctx, dest, t, durSec, peakGain) {
  const len = Math.ceil(ctx.sampleRate * durSec);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = buf;
  g.gain.setValueAtTime(peakGain, t);
  src.connect(g).connect(dest);
  src.start(t);
}

export function chime() {
  const ctx = getCtx(); if (!ctx) return;
  const now = ctx.currentTime;
  [1046.5, 1318.51, 1567.98].forEach((freq, i) => {  // C6 – E6 – G6
    const t = now + i * 0.065;
    noiseSnap(ctx, ctx.destination, t, 0.012, 0.14);
    // Fundamental starts 3% sharp then settles: the pitch "snap" that reads as bounce.
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.03, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.035);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.14, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc.connect(env).connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.56);
    // Inharmonic partial at 2.756×: characteristic marimba overtone, decays 4× faster than fundamental.
    const osc2 = ctx.createOscillator();
    const env2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2.756;
    env2.gain.setValueAtTime(0.0001, t);
    env2.gain.linearRampToValueAtTime(0.055, t + 0.002);
    env2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc2.connect(env2).connect(ctx.destination);
    osc2.start(t); osc2.stop(t + 0.13);
  });
}

export function tick() {
  const ctx = getCtx(); if (!ctx) return;
  const now = ctx.currentTime;
  noiseSnap(ctx, ctx.destination, now, 0.005, 0.10);
  // Triangle sweep 1400→900 Hz: downward glide reads as a light spring-detent "boing".
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1400, now);
  osc.frequency.exponentialRampToValueAtTime(900, now + 0.055);
  env.gain.setValueAtTime(0.10, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  osc.connect(env).connect(ctx.destination);
  osc.start(now); osc.stop(now + 0.08);
}

function hapticAudio(ms) {
  if (state().settings.sound === false) return;
  const ctx = getCtx(); if (!ctx) return;
  const dur = Math.max(0.004, ms / 1000);
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = buf;
  gain.gain.setValueAtTime(0.025, ctx.currentTime);
  src.connect(gain).connect(ctx.destination);
  src.start();
}

export function buzz(ms) {
  if (navigator.vibrate) {
    navigator.vibrate(ms);
  } else {
    hapticAudio(ms);
  }
}

export function confetti() {
  if (reducedMotion) return;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const particles = [];
  const colors = ['#f4a261', '#e76f51', '#e9c46a', '#2a9d8f', '#264653', '#a8dadc'];
  for (let i = 0; i < 40; i++) {
    particles.push({
      x: canvas.width / 2 + (Math.random() - 0.5) * 60,
      y: canvas.height / 2,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 1) * 8 - 6,
      size: 4 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.3
    });
  }
  let start = performance.now();

  function draw() {
    const elapsed = (performance.now() - start) / 1000;
    if (elapsed > 1.5) { canvas.remove(); return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const life = Math.max(0, 1 - elapsed / 1.5);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.2;
      p.rotation += p.rotSpeed;
      ctx.save();
      ctx.globalAlpha = life;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    });
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

export function animateGrow(el, keyframes, delayMs = 0, easing = 'cubic-bezier(0.34, 1.56, 0.64, 1)') {
  if (reducedMotion) return;
  el.animate(keyframes, { duration: 250, delay: delayMs, easing, fill: 'backwards' });
}
