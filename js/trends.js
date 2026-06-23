// trends.js — weekly trends with CSS bar charts.
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

export function trends() {
  const week = derive.week();
  const days = week.length || 1;
  const avgSleep = week.reduce((a, d) => a + d.sleepMin, 0) / days;
  const avgFeeds = week.reduce((a, d) => a + d.feeds, 0) / days;
  const avgDia = week.reduce((a, d) => a + d.diapers, 0) / days;
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
    </div>

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
    </div>`;
}
