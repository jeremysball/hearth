// trends.js: weekly trends with CSS bar charts.
import { state, derive } from './store.js';
import { fmt, esc } from './ui.js';

function barChart(data, key, unit, fmtFn, tone) {
  const max = Math.max(1, ...data.map((d) => d[key]));
  return `<div class="chart">
    ${data.map((d, i) => {
      const v = d[key];
      const h = Math.round((v / max) * 100);
      const isToday = i === data.length - 1;
      return `<div class="bar-col ${isToday ? 'today' : ''}">
        <div class="bar-val">${fmtFn ? fmtFn(v) : v}</div>
        <div class="bar-wrap"><div class="bar tone-${tone}" style="height:${Math.max(4, h)}%"></div></div>
        <div class="bar-lbl">${d.label}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function insightsCard() {
  // insightWakeCalibration takes a single day-position; check all three so a
  // drift that only shows up at the first or last nap isn't silently missed
  // just because 'middle' happens to look on-track.
  const wakeCalibration = ['first', 'middle', 'last']
    .map((position) => derive.insightWakeCalibration(position))
    .filter(Boolean)
    .reduce((most, next) => (most && Math.abs(most.gapMin) >= Math.abs(next.gapMin) ? most : next), null);
  const insights = [
    wakeCalibration,
    derive.insightOvertiredLag(),
    derive.insightDurationTrend(),
    derive.insightMethodQuality(),
  ].filter(Boolean);
  if (!insights.length) return '';
  return `<div class="card chart-card insight-card">
    <div class="chart-hd"><h2>Insights</h2></div>
    <ul class="insight-list">
      ${insights.map((i) => `<li>${esc(i.text)}</li>`).join('')}
    </ul>
  </div>`;
}

export function trends() {
  const week = derive.week();
  const days = week.length || 1;
  const avgSleep = week.reduce((a, d) => a + d.sleepMin, 0) / days;
  const avgFeeds = week.reduce((a, d) => a + d.feeds, 0) / days;
  const avgDia = week.reduce((a, d) => a + d.diapers, 0) / days;
  const avgBottleVol = week.reduce((a, d) => a + d.bottleVol, 0) / days;
  const avgFeedVol = week.reduce((a, d) => a + d.feedVol, 0) / days;
  const avgNaps = week.reduce((a, d) => a + d.naps, 0) / days;

  return `
    <div class="page-hd">
      <h1 class="page-title">Trends</h1>
      <div class="page-sub">Last 7 days · ${esc(state().baby.name || 'Baby')}</div>
    </div>
    <div class="stat-grid">
      <div class="card stat"><div class="stat-k">Avg sleep / day</div><div class="stat-v">${fmt.dur(avgSleep)}</div></div>
      <div class="card stat"><div class="stat-k">Avg feeds / day</div><div class="stat-v">${avgFeeds.toFixed(1)}</div></div>
      <div class="card stat"><div class="stat-k">Avg naps / day</div><div class="stat-v">${avgNaps.toFixed(1)}</div></div>
      <div class="card stat"><div class="stat-k">Avg diapers / day</div><div class="stat-v">${avgDia.toFixed(1)}</div></div>
      <div class="card stat"><div class="stat-k">Avg bottle vol / day</div><div class="stat-v">${fmt.vol(avgBottleVol)}</div></div>
      <div class="card stat"><div class="stat-k">Avg feed vol / day</div><div class="stat-v">${fmt.vol(avgFeedVol)}</div></div>
    </div>
    ${insightsCard()}

    <div class="card chart-card">
      <div class="chart-hd"><h2>Sleep</h2><span class="chart-note">hours per day</span></div>
      ${barChart(week, 'sleepMin', 'h', (v) => (v / 60).toFixed(1), 'sleep')}
    </div>
    <div class="card chart-card">
      <div class="chart-hd"><h2>Feeds</h2><span class="chart-note">count per day</span></div>
      ${barChart(week, 'feeds', '', null, 'feed')}
    </div>
    <div class="card chart-card">
      <div class="chart-hd"><h2>Diapers</h2><span class="chart-note">count per day</span></div>
      ${barChart(week, 'diapers', '', null, 'diaper')}
    </div>
    <div class="card chart-card">
      <div class="chart-hd"><h2>Bottle volume</h2><span class="chart-note">volume per day</span></div>
      ${barChart(week, 'bottleVol', 'ml', (v) => fmt.vol(v), 'feed')}
    </div>
    <div class="card chart-card">
      <div class="chart-hd"><h2>Feed volume</h2><span class="chart-note">bottle plus pump</span></div>
      ${barChart(week, 'feedVol', 'ml', (v) => fmt.vol(v), 'feed')}
    </div>`;
}
