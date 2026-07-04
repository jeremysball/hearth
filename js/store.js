// store.js: Hearth state, persistence, derived data, seeding.
import { enqueue, mergeById } from './sync.js';
import { log } from './log.js';

let _syncTrigger = null;
export function setSyncTrigger(fn) { _syncTrigger = fn; }

const KEY = 'hearth.state.v1';

const DEFAULT = () => ({
  setup: false,
  synced: false,
  baby: { name: '', birthdate: '', theme: 'girl', photo: null, caregiver: '' },
  settings: {
    theme: '',
    bottleIntervalH: 3,
    meds: [
      { id: 'm1', name: 'Vitamin D', dose: '1', unit: 'drop', everyH: 24 }
    ],
    playTypes: ['Tummy time', 'Reading', 'Outdoor'],
    units: { volume: 'ml', temp: 'C', weight: 'kg', length: 'cm' },
    reminders: { naps: true, bottle: true, meds: true, lead: 0, quietStart: '20:00', quietEnd: '07:00' },
    cards: { bottle: true, medicine: true, order: ['bottle', 'medicine'], intervals: {} },
    sound: true,
    clock24: '12h',
    darkMode: 'auto',
    seenChangelog: ''
  },
  log: [],
  growth: [],
  caregivers: [],
  currentCaregiverId: ''
});

let _state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = Object.assign(DEFAULT(), JSON.parse(raw));
      s.log = normalizeLog(s.log);
      // Migrate legacy state: the standalone SweetSpot card was folded into the
      // hero card, so drop its now-meaningless visibility key and order entry.
      if (s.cards) {
        delete s.cards.sweetspot;
        if (Array.isArray(s.cards.order)) s.cards.order = s.cards.order.filter((k) => k !== 'sweetspot');
      }
      normalizeSettings(s.settings);
      return s;
    }
  } catch (e) {}
  return DEFAULT();
}

export function normalizeSettings(s) {
  if (!s) return s;
  if (s.clock24 === true) s.clock24 = '24h';
  else if (s.clock24 === false) s.clock24 = '12h';
  else if (s.clock24 !== '24h' && s.clock24 !== '12h') s.clock24 = '12h';
  if (typeof s.tipMorningLightDismissed !== 'boolean') s.tipMorningLightDismissed = false;
  if (!Array.isArray(s.dismissedRegressions)) s.dismissedRegressions = [];
  if (!Array.isArray(s.dismissedTips)) s.dismissedTips = [];
  if (typeof s.seenChangelog !== 'string') s.seenChangelog = '';
  if (!Array.isArray(s.playTypes)) s.playTypes = ['Tummy time', 'Reading', 'Outdoor'];
  return s;
}

export function normalizeLog(log) {
  if (!Array.isArray(log)) return [];
  return log.map((e) => {
    if (e && e.type === 'sleep' && e.end && new Date(e.end) < new Date(e.start)) {
      return { ...e, start: e.end, end: e.start };
    }
    // Mixed diapers logged before the wet/dirty size split only have `size`.
    // Carry it into both fields rather than losing it, since we can't know
    // the original split.
    if (e && e.type === 'diaper' && e.kind === 'Mixed' && e.size && e.wetSize == null && e.dirtySize == null) {
      return { ...e, wetSize: e.size, dirtySize: e.size };
    }
    return e;
  });
}
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(_state)); } catch (e) {}
}
export function markSynced() { _state.synced = true; save(); }
export function reset() { _state = DEFAULT(); save(); }

export function state() { return _state; }

// ---------- log helpers ----------
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function currentCaregiverId() {
  return _state.currentCaregiverId || '';
}
export function addEntry(e) {
  e.id = e.id || uid();
  if (!e.caregiverId) e.caregiverId = currentCaregiverId();
  _state.log.push(e);
  _state.log.sort((a, b) => b.start < a.start ? -1 : b.start > a.start ? 1 : 0);
  // Enqueue before save: they're two separate localStorage writes, and a
  // process kill between them (backgrounded PWA reaped, tab crash) must not
  // leave an entry in local state with no queued op to sync it.
  enqueue({ url: '/api/entries/' + e.id, method: 'PUT', body: e });
  save();
  if (_syncTrigger) _syncTrigger();
  log.event('store', 'addEntry', e.type, e.id);
  return e;
}
export function removeEntry(id) {
  _state.log = _state.log.filter((e) => e.id !== id);
  enqueue({ url: '/api/entries/' + id, method: 'DELETE' });
  save();
  if (_syncTrigger) _syncTrigger();
  log.event('store', 'removeEntry', id);
}
export function updateEntry(id, patch) {
  const e = _state.log.find((x) => x.id === id);
  if (e) {
    if (!patch.caregiverId && !e.caregiverId) patch.caregiverId = currentCaregiverId();
    Object.assign(e, patch);
    _state.log.sort((a, b) => b.start < a.start ? -1 : b.start > a.start ? 1 : 0);
    enqueue({ url: '/api/entries/' + id, method: 'PUT', body: e });
    save();
  }
  if (_syncTrigger) _syncTrigger();
  log.event('store', 'updateEntry', id, patch);
  return e;
}

const INTERRUPT_GAP_MIN = { feed: 20, bottle: 20, diaper: 10 };
function inQuietHours(d) {
  const r = _state.settings.reminders;
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const s = toMin(r.quietStart || '20:00'), e = toMin(r.quietEnd || '07:00');
  const cur = d.getHours() * 60 + d.getMinutes();
  return s > e ? (cur >= s || cur < e) : (cur >= s && cur < e);
}
// A feed/bottle/diaper logged while a sleep is ongoing, during quiet hours,
// implies the baby briefly woke up: close the sleep at that moment and
// auto-resume it after a short type-specific gap. Returns a descriptor for
// undoInterruptSleep, or null if nothing was split.
export function maybeInterruptSleep(type, atISO) {
  const gap = INTERRUPT_GAP_MIN[type];
  if (!gap) return null;
  const at = new Date(atISO);
  if (!inQuietHours(at)) return null;
  const ongoing = _state.log.find((e) => e.type === 'sleep' && !e.end && new Date(e.start) <= at);
  if (!ongoing) return null;
  updateEntry(ongoing.id, { end: atISO });
  const resumed = addEntry({ type: 'sleep', start: new Date(at.getTime() + gap * 60000).toISOString() });
  log.event('store', 'interruptSleep', type, { sleepId: ongoing.id, resumedId: resumed.id });
  return { sleepId: ongoing.id, resumedId: resumed.id };
}
export function undoInterruptSleep(split) {
  if (!split) return;
  removeEntry(split.resumedId);
  updateEntry(split.sleepId, { end: null });
}
export function autoCloseOngoingSleep(newStartISO) {
  // Clamp to now so a future-dated new sleep doesn't push the existing sleep's end into the future.
  const closeAt = new Date(Math.min(new Date(newStartISO).getTime(), Date.now())).toISOString();
  const closeDate = new Date(closeAt);
  const closed = _state.log.filter((e) => e.type === 'sleep' && !e.end && new Date(e.start) < closeDate);
  if (!closed.length) return [];
  closed.forEach((e) => {
    updateEntry(e.id, { end: closeAt });
    log.event('store', 'autoCloseOngoingSleep', e.id, { closedAt: closeAt });
  });
  return closed;
}
export function undoAutoCloseSleep(closed) {
  if (!closed?.length) return;
  closed.forEach((c) => updateEntry(c.id, { end: null }));
}

// Exported for unit tests only: do not use in application code.
export const _testHelpers = { recencyWeight, weightedMedian, weightedPercentile, stdDev };

// ---------- growth helpers ----------
export function addMeasure(m) {
  m.id = m.id || uid();
  const existing = _state.growth.find((x) => x.id === m.id);
  if (existing) Object.assign(existing, m); else _state.growth.push(m);
  _state.growth.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  enqueue({ url: '/api/growth/' + m.id, method: 'PUT', body: m });
  save();
  return m;
}
export function removeMeasure(id) {
  _state.growth = _state.growth.filter((m) => m.id !== id);
  enqueue({ url: '/api/growth/' + id, method: 'DELETE' });
  save();
}

// ---------- time utils ----------
const MIN = 60000, HR = 3600000, DAY = 86400000;
export function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function ageMonths() {
  if (!_state.baby.birthdate) return 4;
  const b = parseDateOnlyLocal(_state.baby.birthdate), now = new Date();
  return Math.max(0, (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth()));
}

function parseDateOnlyLocal(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date(value);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
export function ageWeeks() {
  if (!_state.baby.birthdate) return null;
  return Math.floor((Date.now() - parseDateOnlyLocal(_state.baby.birthdate).getTime()) / (7 * DAY));
}
export function ageLabel() {
  const m = ageMonths();
  if (m < 1) {
    if (!_state.baby.birthdate) return 'newborn';
    const wks = Math.floor((Date.now() - parseDateOnlyLocal(_state.baby.birthdate)) / (7 * DAY));
    return wks + (wks === 1 ? ' week old' : ' weeks old');
  }
  if (m < 24) return m + (m === 1 ? ' month old' : ' months old');
  const y = Math.floor(m / 12), rem = m % 12;
  return y + 'y' + (rem ? ' ' + rem + 'm' : '') + ' old';
}
// Population wake window ranges from Dubief, per day position and age bracket.
// Each row covers ages < maxMonths; [low, high] in minutes.
const WAKE_WINDOW_TABLE = [
  { maxMonths:  1, first: [35, 50],   middle: [40, 60],   last: [50, 75]   },
  { maxMonths:  3, first: [50, 70],   middle: [60, 80],   last: [75, 100]  },
  { maxMonths:  5, first: [70, 95],   middle: [80, 110],  last: [105, 140] },
  { maxMonths:  7, first: [95, 120],  middle: [110, 140], last: [140, 180] },
  { maxMonths: 10, first: [120, 145], middle: [140, 170], last: [180, 215] },
  { maxMonths: 13, first: [145, 170], middle: [170, 200], last: [215, 250] },
  { maxMonths: Infinity, first: [190, 240], middle: [190, 240], last: [190, 240] },
];

// Infers the position of an awake period in the day from the clock.
// 'night'  = 8pm–6am (circadian drive takes over; not a true nap window)
// 'first'  = 6am–10am (before day's first nap)
// 'last'   = 4pm–8pm (pre-bedtime, longest wake window)
// 'middle' = 10am–4pm
// Thresholds are fixed population defaults; Phase 3 will anchor them to the
// baby's actual morning wake time.
export function wakePosition(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h < 6 || h >= 20) return 'night';
  if (h < 10) return 'first';
  if (h >= 16) return 'last';
  return 'middle';
}

// Age-appropriate wake window range for a given day position.
// Returns a population-sourced range; Phase 2 will blend in personal data.
export function wakeWindowRange(position = 'middle') {
  const m = ageMonths();
  const row = WAKE_WINDOW_TABLE.find((r) => m < r.maxMonths) ?? WAKE_WINDOW_TABLE.at(-1);
  const [low, high] = row[position] ?? row.middle;
  return { low, high, midpoint: Math.round((low + high) / 2), source: 'population', sampleSize: 0, label: 'typical for ' + ageLabel() };
}

// Recency decay: observation from `date` gets weight 0.93^(ageDays).
function recencyWeight(date, now = Date.now(), lambda = 0.93) {
  const ageDays = (now - (date instanceof Date ? date.getTime() : date)) / DAY;
  return Math.pow(lambda, ageDays);
}

// Value at the midpoint of cumulative weight (sorted ascending).
function weightedMedian(observations) {
  if (!observations.length) return 0;
  const sorted = [...observations].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, o) => s + o.weight, 0);
  let cum = 0;
  for (const o of sorted) { cum += o.weight; if (cum >= total / 2) return o.value; }
  return sorted.at(-1).value;
}

// Value at the p-fraction of cumulative weight (p: 0–1, sorted ascending).
function weightedPercentile(observations, p) {
  if (!observations.length) return 0;
  const sorted = [...observations].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, o) => s + o.weight, 0);
  let cum = 0;
  for (const o of sorted) { cum += o.weight; if (cum >= total * p) return o.value; }
  return sorted.at(-1).value;
}

// Unweighted standard deviation of an array of numbers.
function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Age ranges for known developmental sleep regressions. onsetRange is [minMonths, maxMonths].
// The banner fires when the baby is within onsetWeeksBefore weeks of minMonths.
const REGRESSION_TABLE = [
  { id: '4m',  name: '4-month sleep change', onsetRange: [3.5, 5],   onsetWeeksBefore: 4,
    text: 'Sleep is shifting into adult-style NREM/REM cycles, so light-sleep transitions wake babies more often. Keep the bedtime routine steady, and expect to help more between cycles for a while.',
    sources: 'CHOP; Ednick 2009' },
  { id: '6m',  name: '6-month sleep change', onsetRange: [5.5, 7],   onsetWeeksBefore: 3,
    text: 'New motor skills, growth, and separation awareness can make settling less predictable. Respond the same calm way each time so the night stays boring.',
    sources: 'Sleep Foundation; Huckleberry' },
  { id: '810m', name: '8-10-month sleep change', onsetRange: [7.5, 10.5], onsetWeeksBefore: 3,
    text: 'Crawling, pulling up, object permanence, and separation awareness often overlap with the 3-to-2 nap transition. Practice new skills by day and keep sleep responses simple at night.',
    sources: 'Sleep Foundation; Huckleberry' },
  { id: '12m', name: '12-month sleep change', onsetRange: [11, 13],  onsetWeeksBefore: 3,
    text: 'Walking practice, separation anxiety, teething, and nap instability can all crowd sleep at this age. Protect naps when you can, and move bedtime earlier after rough nap days.',
    sources: 'Sleep Foundation; Huckleberry' },
  { id: '18m', name: '18-month sleep change', onsetRange: [17, 19],  onsetWeeksBefore: 3,
    text: 'Language growth, molars, and a new streak of independence can make bedtime louder for a stretch. Hold the boundary, keep the routine short, and expect bigger feelings.',
    sources: 'Sleep Foundation; Taking Cara Babies' },
];

// Age-staged educational tips. minW/maxW are weeks (inclusive/exclusive).
// body() receives the already-escaped baby name and returns plain text.
const STAGE_TIPS = [
  { id: 'newborn-cues', minW: 0, maxW: 6, icon: 'baby', title: 'Cues beat schedules',
    body: (n) => `${n} doesn't have a reliable sleep clock yet — sleep is driven mostly by hunger and short newborn cycles. Use yawning, eye-rubs, and looking away as your best signal to settle.`,
    sources: 'CHOP; Ednick 2009' },
  { id: 'day-night-contrast', minW: 0, maxW: 10, icon: 'moon-star', title: 'Make days and nights feel different',
    body: (n) => `Keep days bright and social, then make night feeds dim, quiet, and boring. That light-dark contrast is one of the earliest cues ${n}'s sleep clock learns to read.`,
    sources: 'Yates 2018; Kok 2024' },
  { id: 'morning-light-early', minW: 6, maxW: 20, icon: 'sunrise', title: 'Morning light helps set the day',
    body: (n) => `Get bright light soon after ${n}'s first wake when you can — open curtains, step outside, or sit near a window. It's one of the strongest signals for setting a developing sleep clock.`,
    sources: 'Yates 2018; Kok 2024' },
  { id: 'night-stretch-protect', minW: 6, maxW: 20, icon: 'moon', title: 'Keep night wakes boring',
    body: (n) => `${n}'s longest sleep stretch is starting to move into the night. Keep those wakes dim and quiet — that shift firms up faster when nothing exciting happens.`,
    sources: 'Sleep Foundation' },
  { id: 'window-position', minW: 10, maxW: 30, icon: 'layers', title: 'The last window runs longer',
    body: () => 'A longer awake stretch before bed is normal. Morning windows tend to be shortest, and the last window of the day usually carries the most sleep pressure.',
    sources: 'Huckleberry; Dubief' },
  { id: 'early-bedtime', minW: 20, maxW: 48, icon: 'moon', title: 'Rough nap day? Move bedtime up',
    body: () => 'When naps run short, an earlier bedtime protects the night — overtired babies typically take longer to settle, not less.',
    sources: 'AASM 2016; Dubief; Weissbluth' },
  { id: 'last-nap-budget', minW: 20, maxW: 48, icon: 'chart-bar', title: 'Late naps spend bedtime budget',
    body: () => 'A late final nap can push bedtime later. If bedtime keeps sliding, try shortening the last nap or ending it earlier in the afternoon.',
    sources: 'Huckleberry' },
  { id: 'three-to-two', minW: 28, maxW: 48, icon: 'layers', title: 'Watch for the 3-to-2 shift',
    body: (n) => `If ${n} keeps fighting the third nap or bedtime keeps drifting late, the two-nap rhythm may be close. Most babies make the shift around 8 to 9 months, with a few unsettled weeks along the way.`,
    sources: 'Staton 2020; Baby Sleep Science' },
  { id: 'two-to-one', minW: 52, maxW: 80, icon: 'layers', title: 'One nap takes time',
    body: () => 'Resisting one nap often means the one-nap transition is starting. Move gradually, and use an early bedtime on days the single nap runs short.',
    sources: 'Staton 2020; Baby Sleep Science' },
];

// ---------- derived ----------
const sleeps = () => _state.log.filter((e) => e.type === 'sleep');

// Extracts morning wake times: end timestamps on overnight sleeps
// (duration > 3h, ending between 4am–10am local, within 21 days).
function morningWakes() {
  const now = Date.now();
  const cutoff = now - 21 * DAY;
  return sleeps().filter((e) => {
    if (!e.end) return false;
    const s = new Date(e.start), en = new Date(e.end);
    if (en.getTime() < cutoff) return false;
    const durMin = (en - s) / MIN;
    if (durMin < 180) return false;
    // Cap at 16h: a sleep longer than that is almost always a data error or
    // an auto-closed ongoing sleep (the previous sleep gets end=now when a new
    // one starts). Neither is a legitimate morning wake.
    if (durMin > 16 * 60) return false;
    const h = en.getHours() + en.getMinutes() / 60;
    return h >= 4 && h < 10;
  }).map((e) => {
    const en = new Date(e.end);
    return { wakeMinutes: en.getHours() * 60 + en.getMinutes(), date: en, weight: recencyWeight(en) };
  });
}
export const derive = {
  status() {
    const ss = sleeps();
    const ongoing = ss.find((e) => !e.end && new Date(e.start) <= new Date());
    if (ongoing) return { state: 'asleep', since: new Date(ongoing.start) };
    let lastWake = null;
    ss.forEach((e) => { if (e.end) { const d = new Date(e.end); if (!lastWake || d > lastWake) lastWake = d; } });
    return { state: 'awake', since: lastWake || new Date(Date.now() - 80 * MIN) };
  },
  sweetSpot() {
    const st = derive.status();
    const pos = wakePosition();
    // Nighttime arousals are circadian, not homeostatic: adenosine hasn't
    // built up enough to govern a true nap window. Return night mode so the
    // UI can show "go back down" instead of a misleading sweet spot rail.
    if (pos === 'night') return { night: true, napping: false, from: null, to: null, prediction: null };
    // Under 6 weeks: no circadian rhythm and no reliable wake windows.
    // Show cue-following guidance instead of a sweet spot rail.
    const w = ageWeeks();
    if (w !== null && w < 6) return { newborn: true, napping: false, from: null, to: null, prediction: null };
    const prediction = derive.wakeWindowPrediction(pos);
    if (!prediction) return { night: true, napping: false, from: null, to: null, prediction: null };
    if (st.state === 'asleep') {
      const wake = new Date(st.since.getTime() + 70 * MIN);
      const from = new Date(wake.getTime() + prediction.low * MIN);
      const to   = new Date(wake.getTime() + prediction.high * MIN);
      return { napping: true, wake, from, to, prediction };
    }
    const from = new Date(st.since.getTime() + prediction.low * MIN);
    const to   = new Date(st.since.getTime() + prediction.high * MIN);
    return { napping: false, from, to, prediction };
  },
  sweetSpotSchedule(limit = 4) {
    const out = [];
    const today = startOfDay(Date.now());
    const dayEnd = today.getTime() + DAY;
    const st = derive.status();
    let priorSleepMin = null;
    if (st.state === 'awake') {
      const lastSleep = _state.log.filter((e) => e.type === 'sleep' && e.end).sort((a, b) => new Date(b.end) - new Date(a.end))[0];
      if (lastSleep) priorSleepMin = (new Date(lastSleep.end) - new Date(lastSleep.start)) / MIN;
    }
    let cursor = st.state === 'asleep' ? new Date(st.since.getTime() + 70 * MIN) : new Date(st.since);
    for (let i = 0; i < limit; i++) {
      const pos = wakePosition(cursor);
      if (pos === 'night') break;
      const pred = derive.wakeWindowPrediction(pos, i === 0 ? priorSleepMin : null);
      if (!pred) break;
      const from = new Date(cursor.getTime() + pred.midpoint * MIN);
      if (from.getTime() >= dayEnd || from.getHours() >= 20 || wakePosition(from) === 'night') break;
      const to = new Date(from.getTime() + 30 * MIN);
      out.push({ from, to, prediction: pred });
      cursor = new Date(from.getTime() + 70 * MIN);
    }
    return out;
  },
  nextBottle() {
    const feeds = _state.log.filter((e) => e.type === 'feed' || e.type === 'bottle');
    const last = feeds.length ? new Date(feeds[0].start) : new Date(Date.now() - 90 * MIN);
    const due = new Date(last.getTime() + _state.settings.bottleIntervalH * HR);
    return { last, due };
  },
  // Generic timer-card prediction for an arbitrary activity type. Predicts the
  // next occurrence from the most recent entry of that type plus an interval:
  // anchored on the entry's end when it has one (e.g. last wake for sleep) and
  // its start otherwise. With no prior entry the card reads "due now".
  nextForType(type, intervalH) {
    const hrs = intervalH != null ? intervalH : ((_state.settings.cards.intervals || {})[type] ?? 3);
    const items = _state.log.filter((e) => e.type === type);
    const last = items.length ? items[0] : null; // log is sorted newest-first by start
    const anchor = last ? new Date(last.end || last.start) : new Date(Date.now() - hrs * HR);
    const due = new Date(anchor.getTime() + hrs * HR);
    return { last, due, intervalH: hrs };
  },
  nextMeds() {
    return _state.settings.meds.map((m) => {
      const given = _state.log.filter((e) => e.type === 'medicine' && e.medId === m.id);
      const last = given.length ? new Date(given[0].start) : null;
      const due = last ? new Date(last.getTime() + m.everyH * HR) : null;
      return { med: m, last, due };
    }).sort((a, b) => (a.due ? a.due : Infinity) - (b.due ? b.due : Infinity));
  },
  todayStats(dayOffset = 0) {
    const start = startOfDay(Date.now() - dayOffset * DAY).getTime();
    const end = start + DAY;
    const inDay = _state.log.filter((e) => { const t = new Date(e.start).getTime(); return t >= start && t < end; });
    // Collect all sleep intervals that overlap today, clamped to day bounds, then
    // merge overlapping ranges so double-counted minutes and overnight sleeps are
    // handled correctly.
    const sleepIntervals = [];
    _state.log.filter((e) => e.type === 'sleep').forEach((e) => {
      const rawS = new Date(e.start).getTime();
      if (!e.end) {
        if (rawS > Date.now()) return;       // future-start: not yet ongoing
        if (dayOffset > 0) return;           // historical day: open sleep has unknown end
        if (rawS < start - DAY) return;      // stale: started >24h before this day's window
      }
      const rawEn = e.end ? new Date(e.end).getTime() : Math.min(Date.now(), end);
      if (rawEn <= start || rawS >= end) return;
      sleepIntervals.push([Math.max(rawS, start), Math.min(rawEn, end)]);
    });
    sleepIntervals.sort((a, b) => a[0] - b[0]);
    let sleepMin = 0;
    let cur = null;
    for (const [s, en] of sleepIntervals) {
      if (!cur) { cur = [s, en]; }
      else if (s <= cur[1]) { cur[1] = Math.max(cur[1], en); }
      else { sleepMin += (cur[1] - cur[0]) / MIN; cur = [s, en]; }
    }
    if (cur) sleepMin += (cur[1] - cur[0]) / MIN;
    const feeds = inDay.filter((e) => e.type === 'feed' || e.type === 'bottle').length;
    const diapers = inDay.filter((e) => e.type === 'diaper').length;
    // Count naps by start date (not overlap) so overnight sleeps aren't double-counted.
    const naps = inDay.filter((e) => e.type === 'sleep').length;
    let bottleVol = 0;
    let feedVol = 0;
    inDay.filter((e) => e.type === 'bottle').forEach((e) => bottleVol += Number(e.amount) || 0);
    inDay.filter((e) => e.type === 'bottle' || e.type === 'pump').forEach((e) => feedVol += Number(e.amount) || 0);
    return { sleepMin, feeds, diapers, naps, bottleVol, feedVol };
  },
  // Rolling personal wake window for a given day position, computed from consecutive
  // completed sleeps in the last 21 days. Returns null if fewer than 7 observations.
  personalWakeWindow(position) {
    const now = Date.now();
    const cutoffMs = now - 21 * DAY;
    // ss is newest-first; wake window i = interval between ss[i+1].end → ss[i].start
    const ss = sleeps().filter((e) => e.end && new Date(e.end).getTime() > cutoffMs);
    const observations = [];
    const priorSleeps = [];
    for (let i = 0; i < ss.length - 1; i++) {
      const wakeStart = new Date(ss[i + 1].end);
      const wakeEnd   = new Date(ss[i].start);
      if (wakeEnd <= wakeStart) continue;
      const wakeMin = (wakeEnd - wakeStart) / MIN;
      if (wakeMin < 10 || wakeMin > 360) continue; // sanity bounds
      if (wakePosition(wakeStart) !== position) continue;
      observations.push({ value: wakeMin, weight: recencyWeight(wakeStart, now) });
      const priorDur = (new Date(ss[i + 1].end) - new Date(ss[i + 1].start)) / MIN;
      priorSleeps.push({ value: priorDur, weight: recencyWeight(wakeStart, now) });
    }
    if (observations.length < 7) return null;
    return {
      median: Math.round(weightedMedian(observations)),
      p25:    Math.round(weightedPercentile(observations, 0.25)),
      p75:    Math.round(weightedPercentile(observations, 0.75)),
      sampleSize: observations.length,
      napMedianMin: priorSleeps.length ? Math.round(weightedMedian(priorSleeps)) : 0,
    };
  },
  // Blended wake window prediction. Uses population data until 7 personal
  // observations accumulate, then smoothly shifts toward personal data.
  // At n=30 the personal signal reaches 90% weight; population acts as a
  // sanity check at all times.
  wakeWindowPrediction(position = 'middle', priorSleepMin = null) {
    if (position === 'night') return null;
    const pop = wakeWindowRange(position);
    const personal = derive.personalWakeWindow(position);
    if (!personal) {
      return { ...pop, source: 'population', sampleSize: 0, label: 'typical for ' + ageLabel() };
    }
    const n = personal.sampleSize;
    const w_p   = Math.min(0.9, Math.max(0, (n - 7) / 23));
    const w_pop = 1 - w_p;
    let midpoint = Math.round(w_p * personal.median + w_pop * pop.midpoint);
    // Clamp: personal signal must stay within 0.5×–2× population midpoint.
    if (midpoint < pop.midpoint * 0.5) midpoint = pop.low;
    if (midpoint > pop.midpoint * 2)   midpoint = pop.high;
    let low  = Math.round(w_p * personal.p25 + w_pop * pop.low);
    let high = Math.round(w_p * personal.p75 + w_pop * pop.high);
    if (priorSleepMin && personal && personal.napMedianMin > 0) {
      const ratio = priorSleepMin / personal.napMedianMin;
      const factor = Math.min(1.2, Math.max(0.85, 1 + 0.25 * (ratio - 1)));
      midpoint = Math.round(midpoint * factor);
      low = Math.round(low * factor);
      high = Math.round(high * factor);
    }
    const source = w_p >= 0.9 ? 'personal' : 'blend';
    const name = state().baby.name || 'your baby';
    const label = w_p >= 0.9
      ? `based on ${name}'s pattern`
      : `based on ${name}'s recent naps`;
    return { low, high, midpoint, source, sampleSize: n, label };
  },
  // Recency-weighted median morning wake time. Confidence is gated by sample
  // size and standard deviation: variable schedules cap at 'low'.
  circadianAnchor() {
    const wakes = morningWakes();
    if (wakes.length < 5) return null;
    const obs = wakes.map((w) => ({ value: w.wakeMinutes, weight: w.weight }));
    const medianMinutes = Math.round(weightedMedian(obs));
    const sd = stdDev(wakes.map((w) => w.wakeMinutes));
    let confidence;
    if (wakes.length >= 28)      confidence = 'high';
    else if (wakes.length >= 14) confidence = 'medium';
    else                          confidence = 'low';
    if (sd > 45) confidence = 'low'; // irregular schedule: cap confidence
    return { morningWakeMinutes: medianMinutes, confidence, sampleSize: wakes.length, sdMinutes: Math.round(sd) };
  },

  // Estimated bedtime window derived from the circadian anchor + typical daily
  // awake time. Returns null when anchor is absent or confidence is low.
  bedtimeWindow() {
    const anchor = derive.circadianAnchor();
    if (!anchor || anchor.confidence === 'low') return null;
    const m = ageMonths();
    const numNaps     = m < 5 ? 3 : m < 14 ? 2 : 1;
    const napDuration = m < 6 ? 60 : 80;
    const fp = derive.wakeWindowPrediction('first');
    const mp = derive.wakeWindowPrediction('middle');
    const lp = derive.wakeWindowPrediction('last');
    let totalMinutes;
    if (numNaps >= 3) {
      totalMinutes = fp.midpoint + napDuration + mp.midpoint + napDuration + mp.midpoint + napDuration + lp.midpoint;
    } else if (numNaps === 2) {
      totalMinutes = fp.midpoint + napDuration + mp.midpoint + napDuration + lp.midpoint;
    } else {
      totalMinutes = fp.midpoint + Math.round(napDuration * 1.5) + lp.midpoint;
    }
    const bedtimeMid = anchor.morningWakeMinutes + totalMinutes;
    const halfRange  = Math.round((lp.high - lp.low) / 2);
    const baseMs = startOfDay(Date.now()).getTime() + bedtimeMid * MIN;
    return {
      from: new Date(baseMs - halfRange * MIN),
      to:   new Date(baseMs + halfRange * MIN),
      confidence: anchor.confidence,
    };
  },
  // Returns the first non-dismissed stage tip appropriate for the baby's age,
  // or null if none applies or the birthdate is unset.
  stageTip() {
    const w = ageWeeks();
    if (w === null) return null;
    const dismissed = state().settings.dismissedTips || [];
    return STAGE_TIPS.find((t) => w >= t.minW && w < t.maxW && !dismissed.includes(t.id)) || null;
  },
  // Returns the approaching or active regression for the current baby age,
  // or null if none applies or the regression has been dismissed.
  regressionAlert() {
    const dismissed = (state().settings.dismissedRegressions) || [];
    const m = ageMonths();
    for (const r of REGRESSION_TABLE) {
      if (dismissed.includes(r.id)) continue;
      const warningStart = r.onsetRange[0] - r.onsetWeeksBefore / 4.33;
      const warningEnd   = r.onsetRange[1];
      if (m >= warningStart && m <= warningEnd) return r;
    }
    return null;
  },
  week() {
    const arr = [];
    for (let i = 6; i >= 0; i--) {
      const s = derive.todayStats(i);
      const d = new Date(Date.now() - i * DAY);
      arr.push({ date: d, label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), ...s });
    }
    return arr;
  },
  today() {
    const start = startOfDay(Date.now()).getTime();
    return _state.log.filter((e) => new Date(e.start).getTime() >= start);
  },
  reminders() {
    const r = _state.settings.reminders, out = [];
    if (r.naps) { const sp = derive.sweetSpot(); if (!sp.napping && !sp.night && sp.from) out.push({ key: 'nap', title: 'Nap time soon', body: 'SweetSpot nap window is approaching.', at: sp.from.getTime() }); }
    if (r.bottle) { const nb = derive.nextBottle(); out.push({ key: 'bottle', title: 'Bottle due', body: 'Time for the next feed.', at: nb.due.getTime() }); }
    if (r.meds) { derive.nextMeds().forEach((m) => { if (m.due) out.push({ key: 'med-' + m.med.id, title: m.med.name + ' due', body: m.med.dose + (m.med.unit || '') + ' scheduled now.', at: m.due.getTime() }); }); }
    return out.sort((a, b) => a.at - b.at);
  }
};

// ---------- seed sample history on first setup ----------
export function seed() {
  const log = [];
  const now = new Date();
  const add = (type, startOffsetMin, extra) => {
    const start = new Date(now.getTime() - startOffsetMin * MIN);
    log.push(Object.assign({ id: uid(), type, start: start.toISOString() }, extra));
  };
  // build 6 days of plausible rhythm
  for (let day = 0; day < 6; day++) {
    const base = day * 24 * 60; // minutes ago at midnight-ish anchor
    // overnight sleep
    addRange('sleep', base + 60, base + 60 + 9.5 * 60, { quality: 'good' });
    // morning nap
    addRange('sleep', base - 6.3 * 60 + 24 * 60, base - 4.9 * 60 + 24 * 60, {});
    // feeds & diapers scattered
    add('bottle', base + 7 * 60, { amount: 120, unit: 'ml', contents: 'Formula' });
    add('feed', base + 11 * 60, { side: 'Left', duration: 16 });
    add('diaper', base + 9 * 60, { kind: 'Wet' });
    add('diaper', base + 13 * 60, { kind: 'Dirty' });
    add('feed', base + 15 * 60, { side: 'Both', duration: 22 });
    add('bottle', base + 18 * 60, { amount: 150, unit: 'ml', contents: 'Breast milk' });
    add('medicine', base + 8 * 60, { medId: 'm1', name: 'Vitamin D', dose: '1 drop' });
  }
  function addRange(type, startMinAgo, endMinAgo, extra) {
    const start = new Date(now.getTime() - startMinAgo * MIN);
    const end = new Date(now.getTime() - endMinAgo * MIN);
    // ensure start<end chronologically
    const a = start < end ? start : end, b = start < end ? end : start;
    log.push(Object.assign({ id: uid(), type, start: a.toISOString(), end: b.toISOString() }, extra));
  }
  // today's morning so home looks alive
  add('feed', 281, { side: 'Left', duration: 18 });          // 5:40-ish
  add('diaper', 206, { kind: 'Wet' });                       // 6:15
  addRange('sleep', 261, 119, {});                            // nap 6:20–7:42 (ended ~ now-119)
  add('bottle', 96, { amount: 120, unit: 'ml', contents: 'Formula' }); // 8:05
  add('medicine', 70, { medId: 'm1', name: 'Vitamin D', dose: '1 drop' });

  log.sort((a, b) => b.start < a.start ? -1 : b.start > a.start ? 1 : 0);
  _state.log = log;

  // seed growth history (monthly weights/heights up to today)
  const ageM = ageMonths();
  const g = [];
  const startM = Math.max(0, ageM - 5);
  let wKg = 3.4 + startM * 0.7, hCm = 50 + startM * 3.2, headCm = 35 + startM * 1.2;
  for (let m = startM; m <= ageM; m++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - (ageM - m));
    g.push({ id: uid(), date: d.toISOString().slice(0, 10), weightKg: Math.round(wKg * 10) / 10, heightCm: Math.round(hCm * 10) / 10, headCm: Math.round(headCm * 10) / 10 });
    wKg += 0.55 + Math.random() * 0.25; hCm += 1.8 + Math.random(); headCm += 0.6 + Math.random() * 0.3;
  }
  _state.growth = g;
  save();
}

export function applySyncResponse(resp) {
  if (resp.baby) Object.assign(_state.baby, resp.baby);
  if (resp.settings) { Object.assign(_state.settings, resp.settings); normalizeSettings(_state.settings); }
  _state.log = mergeById(_state.log, resp.entries || []);
  _state.log.sort((a, b) => b.start < a.start ? -1 : b.start > a.start ? 1 : 0);
  _state.growth = mergeById(_state.growth, resp.growth || []);
  if (resp.currentCaregiverId) _state.currentCaregiverId = resp.currentCaregiverId;
  _state.caregivers = mergeById(_state.caregivers || [], resp.caregivers || []);
  save();
}

export function enqueueBabySync() {
  enqueue({ url: '/api/baby', method: 'PATCH', body: _state.baby });
}

export function enqueueSettingsSync() {
  const s = _state.settings;
  enqueue({
    url: '/api/settings', method: 'PATCH',
    body: { bottleIntervalH: s.bottleIntervalH, meds: s.meds, units: s.units, reminders: s.reminders, cards: s.cards, playTypes: s.playTypes }
  });
}
