// growth.js: growth/weight tracker view.
import { state, ageLabel } from './store.js';
import { esc } from './ui.js';
import { percentileFor, medianCurveFor, ageMonthsAt } from './growth-percentiles.js';

const weightImperial = () => state().settings.units.weight === 'lb';
const lengthImperial = () => (state().settings.units.length || 'cm') === 'in';
const dispW = (kg) => kg == null ? '—' : (weightImperial() ? (kg * 2.2046).toFixed(1) + ' lb' : kg.toFixed(1) + ' kg');
const dispL = (cm) => cm == null ? '—' : (lengthImperial() ? (cm / 2.54).toFixed(1) + ' in' : cm.toFixed(0) + ' cm');

// m.date is a plain 'YYYY-MM-DD' string with no time/offset, which `new
// Date()` parses as UTC midnight, so rendering it via toLocaleDateString()
// then shows the wrong (previous) day in any negative-UTC-offset timezone.
// Build the Date from local components instead.
function localDate(ymd) {
  const [y, mo, d] = ymd.split('-').map(Number);
  return new Date(y, mo - 1, d);
}

function delta(cur, prev, fmt) {
  if (cur == null || prev == null) return '';
  const d = cur - prev;
  const s = d >= 0 ? '+' : '−';
  return `<span class="delta ${d >= 0 ? 'up' : 'down'}">${s}${fmt(Math.abs(d))}</span>`;
}

// Not every measurement logs every field (head circumference especially is
// often skipped), so "since last measurement" has to skip back past rows
// that didn't record this particular field rather than just using the
// immediately preceding row.
function prevWithField(chronological, field) {
  for (let i = chronological.length - 2; i >= 0; i--) {
    if (chronological[i][field] != null) return chronological[i];
  }
  return null;
}

// Which stat's graph is currently shown on the growth tab. Module-level view
// state (not persisted), same pattern as home.js's cardEditMode -- resets to
// the default whenever the growth view is left and re-entered fresh.
const STATS = {
  weightKg: { label: 'Weight', field: 'weightKg', disp: dispW },
  heightCm: { label: 'Height', field: 'heightCm', disp: dispL },
  headCm: { label: 'Head', field: 'headCm', disp: dispL },
};
let shownStat = 'weightKg';
export function showGrowthStat(key) { if (STATS[key]) shownStat = key; }

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Evaluated against the age of the most recent applicable measurement, not
// wall-clock "today" -- deterministic regardless of when this code runs, and
// every earlier point is necessarily younger anyway, so gating on the latest
// point already covers the whole series.
function percentileSupported(baby, latest) {
  if (!baby.sex || !baby.birthdate || !latest) return false;
  return ageMonthsAt(baby.birthdate, latest.date) <= 24;
}

function percentileBadge(statKey, latest, baby) {
  if (!latest || !percentileSupported(baby, latest)) return '';
  const stat = STATS[statKey];
  const val = latest[stat.field];
  if (val == null) return '';
  const months = ageMonthsAt(baby.birthdate, latest.date);
  const p = percentileFor(statKey, baby.sex, months, val);
  if (p == null) return '';
  return `<div class="stat-pctl">${ordinal(Math.round(p))} percentile</div>`;
}

function lineChart(points, statKey, baby) {
  const stat = STATS[statKey] || STATS.weightKg;
  const pts0 = points.filter((p) => p[stat.field] != null);
  if (pts0.length < 2) return `<div class="empty-log">Add at least two measurements to see a ${stat.label.toLowerCase()} curve.</div>`;
  const overlay = percentileSupported(baby, pts0[pts0.length - 1])
    ? medianCurveFor(statKey, baby.sex, pts0.map((p) => ageMonthsAt(baby.birthdate, p.date)))
    : null;
  const overlayVals = overlay ? overlay.filter((v) => v != null) : [];
  const W = 320, Hh = 150, pad = 24, padB = 26;
  const ws = pts0.map((p) => p[stat.field]);
  const min = Math.min(...ws, ...overlayVals), max = Math.max(...ws, ...overlayVals);
  const range = (max - min) || 1;
  const x = (i) => pad + (i / (pts0.length - 1)) * (W - pad * 2);
  const y = (w) => pad + (1 - (w - min) / range) * (Hh - pad - padB);
  const pts = pts0.map((p, i) => `${x(i).toFixed(1)},${y(p[stat.field]).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${(Hh - padB).toFixed(1)} ${pts} ${x(pts0.length - 1).toFixed(1)},${(Hh - padB).toFixed(1)}`;
  const overlayPts = overlay && overlay.every((v) => v != null)
    ? pts0.map((p, i) => `${x(i).toFixed(1)},${y(overlay[i]).toFixed(1)}`).join(' ')
    : null;
  return `<svg class="growth-svg" viewBox="0 0 ${W} ${Hh}">
    <polygon points="${area}" fill="var(--accent-soft)" opacity="0.5" />
    ${overlayPts ? `<polyline class="who-median" points="${overlayPts}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="4 3" stroke-linejoin="round" stroke-linecap="round" />` : ''}
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
    ${pts0.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p[stat.field]).toFixed(1)}" r="${i === pts0.length - 1 ? 5 : 3.5}" fill="${i === pts0.length - 1 ? 'var(--accent)' : 'var(--surface)'}" stroke="var(--accent)" stroke-width="2" />`).join('')}
    ${pts0.map((p, i) => `<text x="${x(i).toFixed(1)}" y="${Hh - 8}" text-anchor="middle" class="growth-x">${localDate(p.date).toLocaleDateString(undefined, { month: 'short' })}</text>`).join('')}
  </svg>`;
}

function measureRow(m, prev) {
  return `<div class="row" data-action="measure:open" data-id="${m.id}">
    <span class="row-ic tone-med"><svg class="icon"><use href="#ruler"></use></svg></span>
    <span class="row-txt"><span class="what">${dispW(m.weightKg)}</span>
    <span class="when">${localDate(m.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${dispL(m.heightCm)}</span></span>
    ${prev ? `<span class="meta">${delta(m.weightKg, prev.weightKg, (v) => dispW(v).replace(/ (kg|lb)/, ''))}</span>` : ''}
  </div>`;
}

export function growth() {
  const g = state().growth.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const baby = state().baby;
  const latest = g[g.length - 1];
  const prevWeight = prevWithField(g, 'weightKg');
  const prevHeight = prevWithField(g, 'heightCm');
  const prevHead = prevWithField(g, 'headCm');
  return `
    <div class="page-hd">
      <h1 class="page-title">Growth</h1>
      <div class="page-sub">${esc(state().baby.name || 'Baby')} · ${ageLabel()}</div>
    </div>

    <div class="stat-grid growth-stats">
      <div class="card stat ${shownStat === 'weightKg' ? 'stat-active' : ''}" data-action="growth:showstat" data-stat="weightKg"><div class="stat-k">Weight</div><div class="stat-v">${latest ? dispW(latest.weightKg) : '—'}</div>${percentileBadge('weightKg', latest, baby)}${delta(latest && latest.weightKg, prevWeight && prevWeight.weightKg, (v) => dispW(v).replace(/ (kg|lb)/, ' '))}</div>
      <div class="card stat ${shownStat === 'heightCm' ? 'stat-active' : ''}" data-action="growth:showstat" data-stat="heightCm"><div class="stat-k">Height</div><div class="stat-v">${latest ? dispL(latest.heightCm) : '—'}</div>${percentileBadge('heightCm', latest, baby)}${delta(latest && latest.heightCm, prevHeight && prevHeight.heightCm, (v) => dispL(v).replace(/ (cm|in)/, ' '))}</div>
      <div class="card stat ${shownStat === 'headCm' ? 'stat-active' : ''}" data-action="growth:showstat" data-stat="headCm"><div class="stat-k">Head</div><div class="stat-v">${latest && latest.headCm ? dispL(latest.headCm) : '—'}</div>${percentileBadge('headCm', latest, baby)}${delta(latest && latest.headCm, prevHead && prevHead.headCm, (v) => dispL(v).replace(/ (cm|in)/, ' '))}</div>
      <div class="card stat"><div class="stat-k">Measurements</div><div class="stat-v">${g.length}</div></div>
    </div>

    <div class="card chart-card">
      <div class="chart-hd"><h2>${STATS[shownStat].label}</h2><span class="chart-note">over time</span></div>
      ${lineChart(g, shownStat, baby)}
    </div>

    <div class="today-block">
      <div class="today-hd"><h2>History</h2><button class="today-add" data-action="measure:open" data-id="" aria-label="Add measurement"><svg class="icon"><use href="#plus"></use></svg></button></div>
      <div class="card log">${g.length ? g.slice().reverse().map((m, i, arr) => measureRow(m, arr[i + 1])).join('') : `<div class="empty-log">No measurements yet. Tap the + button to add one.</div>`}</div>
    </div>`;
}
