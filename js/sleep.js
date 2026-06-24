// sleep.js — 24h ring, naps, SweetSpot schedule, night summary.
import { state, derive, startOfDay, ageLabel, awakeWindowMin } from './store.js';
import { fmt } from './ui.js';

const MIN = 60000;
function hoursInto(d, dayStart) { return (new Date(d) - dayStart) / 3600000; }

export function sleep() {
  const dayStart = startOfDay(Date.now());
  const now = new Date();
  const todaySleeps = state().log.filter((e) => e.type === 'sleep').map((e) => {
    const s = new Date(e.start), en = e.end ? new Date(e.end) : now;
    return { s, en, ongoing: !e.end, raw: e };
  }).filter((e) => e.en > dayStart);

  // ring segments (clamp to today)
  const r = 86, C = 2 * Math.PI * r;
  const segs = todaySleeps.map((e) => {
    const h0 = Math.max(0, hoursInto(e.s, dayStart));
    const h1 = Math.min(24, hoursInto(e.en, dayStart));
    if (h1 <= h0) return '';
    const len = (h1 - h0) / 24 * C, off = -(h0 / 24) * C;
    return `<circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--good)" stroke-width="13" stroke-linecap="round"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${off}" />`;
  }).join('');
  // now marker
  const nowFrac = hoursInto(now, dayStart) / 24;

  const totalMin = derive.todayStats().sleepMin;
  const tb = fmt.durBig(totalMin);

  // naps list (today, exclude overnight long >5h that started yesterday)
  const naps = todaySleeps.filter((e) => !(hoursInto(e.s, dayStart) < 0)).sort((a, b) => b.s - a.s);
  const napsHTML = naps.length ? naps.map((e) => {
    const dur = (e.en - e.s) / MIN;
    return `<div class="row">
      <span class="row-ic tone-sleep"><svg class="icon"><use href="#moon"></use></svg></span>
      <span class="row-txt"><span class="what">${e.ongoing ? 'Asleep now' : (dur > 240 ? 'Night sleep' : 'Nap')}</span>
      <span class="when">${fmt.clock(e.s)} – ${e.ongoing ? 'now' : fmt.clock(e.en)}</span></span>
      <span class="meta">${fmt.dur(dur)}</span></div>`;
  }).join('') : `<div class="empty-log">No sleep logged today yet.</div>`;

  // SweetSpot schedule — project remaining naps today
  const sched = [];
  const st = derive.status();
  let cursor = st.state === 'asleep' ? new Date(st.since.getTime() + 70 * MIN) : new Date(st.since);
  const win = awakeWindowMin();
  for (let i = 0; i < 4; i++) {
    const from = new Date(cursor.getTime() + win * MIN);
    if (from.getHours() >= 20) break;
    const to = new Date(from.getTime() + 30 * MIN);
    sched.push({ from, to, past: to < now });
    cursor = new Date(from.getTime() + 70 * MIN); // nap length
  }
  const schedHTML = sched.map((s) => `<div class="sched-item ${s.past ? 'past' : ''}">
    <span class="sched-dot"></span>
    <span class="sched-win">${fmt.clock(s.from)} – ${fmt.clock(s.to)}</span>
    <span class="sched-tag">${s.past ? 'passed' : fmt.untilOrAgo(s.from)}</span></div>`).join('');

  // last night summary
  const night = state().log.filter((e) => e.type === 'sleep' && e.end)
    .map((e) => ({ s: new Date(e.start), en: new Date(e.end), dur: (new Date(e.end) - new Date(e.start)) / MIN }))
    .filter((e) => e.dur > 240 && e.en > new Date(now.getTime() - 20 * 3600000))
    .sort((a, b) => b.en - a.en)[0];

  return `
    <div class="page-hd">
      <h1 class="page-title">Sleep</h1>
      <div class="page-sub">${now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
    </div>

    <div class="card ring-card">
      <div class="ringwrap">
        <svg viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="86" fill="none" stroke="var(--ring-track)" stroke-width="13" />
          ${segs}
          <circle cx="${100 + r}" cy="100" r="3.5" fill="var(--ink)" transform="rotate(${nowFrac * 360} 100 100)" />
        </svg>
        <div class="ring-center">
          <div class="ring-lbl">slept today</div>
          <div class="ring-big">${tb.h}<span class="u">h</span> ${tb.m}<span class="u">m</span></div>
        </div>
      </div>
      ${night ? `<div class="night-strip"><svg class="icon"><use href="#moon-star"></use></svg> Last night · <b>${fmt.dur(night.dur)}</b> · ${fmt.clock(night.s)}–${fmt.clock(night.en)}</div>` : ''}
    </div>

    <div class="sched-card card">
      <div class="chart-hd"><h2>SweetSpot schedule</h2><span class="chart-note">based on ${ageLabel()}</span></div>
      ${schedHTML || `<div class="empty-log">Past today's nap windows.</div>`}
    </div>

    <div class="today-block">
      <div class="today-hd"><h2>Today's sleep</h2><button class="today-add" data-action="log:open" data-type="sleep" aria-label="Log sleep"><svg class="icon"><use href="#plus"></use></svg></button></div>
      <div class="card log">${napsHTML}</div>
    </div>`;
}
