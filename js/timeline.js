// timeline.js — filterable, day-grouped activity feed opened from Home.
import { state } from './store.js';
import { fmt, esc, icon, TYPES, sheet } from './ui.js';
import { summary } from './home.js';

const dayKey = (d) => {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};

export function groupByDay(entries, now = Date.now()) {
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(now - 86400000);
  const buckets = new Map();
  for (const e of entries) {
    const k = dayKey(e.start);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(e);
  }
  const keys = [...buckets.keys()].sort().reverse(); // YYYY-MM-DD sorts chronologically
  return keys.map((k) => {
    const items = buckets.get(k).slice().sort((a, b) => new Date(b.start) - new Date(a.start));
    let label;
    if (k === todayKey) label = 'Today';
    else if (k === yesterdayKey) label = 'Yesterday';
    else label = new Date(items[0].start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return { key: k, label, items };
  });
}

// Session-only filter (not persisted). Empty set = show all types.
let selectedTypes = new Set();
export function toggleFilter(type) {
  if (selectedTypes.has(type)) selectedTypes.delete(type);
  else selectedTypes.add(type);
}

const FILTER_TYPES = ['sleep', 'feed', 'bottle', 'diaper', 'medicine', 'pump', 'note', 'play', 'bath'];

function rowHTML(e) {
  const s = summary(e);
  const detail = [s.detail, s.meta].filter(Boolean).join(' · ');
  return `<div class="tl-row" data-action="entry:edit" data-id="${e.id}">
    <span class="row-ic tone-${s.tone}"><svg class="icon"><use href="#${s.icon}"></use></svg></span>
    <span class="row-txt"><span class="what">${esc(s.label)}</span><span class="when">${esc(detail)}</span></span>
    <span class="meta">${esc(fmt.rel(e.start))}</span>
  </div>`;
}

export function timeline() {
  const all = state().log; // already excludes soft-deleted (mergeById tombstones them)
  const active = selectedTypes;
  const filtered = active.size ? all.filter((e) => active.has(e.type)) : all;
  const groups = groupByDay(filtered);
  const chips = FILTER_TYPES.map((t) => {
    const on = active.has(t);
    return `<button class="tl-chip${on ? ' on' : ''}" data-action="timeline:toggle" data-type="${t}">
      <svg class="icon"><use href="#${icon(TYPES[t].icon)}"></use></svg>${esc(TYPES[t].label)}</button>`;
  }).join('');

  let body;
  if (!all.length) {
    body = `<div class="tl-empty">No entries yet. Log an activity from Home and it'll show up here.</div>`;
  } else if (!filtered.length) {
    body = `<div class="tl-empty">Nothing matches these filters.</div>`;
  } else {
    body = groups.map((g) => `
      <div class="tl-day"><h2 class="tl-day-hd">${esc(g.label)}</h2>
        <div class="card log">${g.items.map(rowHTML).join('')}</div>
      </div>`).join('');
  }

  return `
    <div class="page-hd tl-hd">
      <button class="tl-back" data-action="nav:home" aria-label="Back to Home"><svg class="icon"><use href="#chevron-left"></use></svg></button>
      <h1 class="page-title">Timeline</h1>
    </div>
    <div class="tl-chipbar">${chips}</div>
    ${body}`;
}
