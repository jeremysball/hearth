// timeline.js: filterable, day-grouped activity feed opened from Home.
import { state } from './store.js';
import { fmt, esc, icon, TYPES } from './ui.js';
import { summary, hasUnshownNote } from './home.js';

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

const PINNED_FILTERS = ['bottle', 'sleep', 'medicine'];
const OPTIONAL_FILTERS = ['feed', 'diaper', 'pump', 'note', 'play', 'bath'];
const FILTER_TYPES = [...PINNED_FILTERS, ...OPTIONAL_FILTERS];
let filterMenuOpen = false;
let filterResizeBound = false;
let filterLayoutFrame = 0;

export function toggleFilterMenu() {
  filterMenuOpen = !filterMenuOpen;
}

export function initTimelineFilters() {
  if (!filterResizeBound) {
    filterResizeBound = true;
    window.addEventListener('resize', () => {
      if (document.querySelector('.tl-chipbar')) scheduleFilterLayout();
    });
  }
  scheduleFilterLayout();
}

function scheduleFilterLayout() {
  cancelAnimationFrame(filterLayoutFrame);
  filterLayoutFrame = requestAnimationFrame(layoutFilters);
}

function layoutFilters() {
  const bar = document.querySelector('.tl-chipbar');
  if (!bar) return;
  const more = bar.querySelector('.tl-more');
  const optionals = [...bar.querySelectorAll('.tl-chip[data-optional="true"]')];
  const menu = document.querySelector('.tl-filter-menu');
  bar.dataset.ready = 'false';
  optionals.forEach((chip) => { chip.hidden = false; });
  if (more) more.hidden = true;

  if (more && bar.scrollWidth > bar.clientWidth + 1) {
    more.hidden = false;
    for (let i = optionals.length - 1; i >= 0 && bar.scrollWidth > bar.clientWidth + 1; i--) {
      optionals[i].hidden = true;
    }
  }

  const hiddenTypes = new Set(optionals.filter((chip) => chip.hidden).map((chip) => chip.dataset.type));
  if (!hiddenTypes.size) filterMenuOpen = false;
  if (more) {
    more.hidden = !hiddenTypes.size;
    more.classList.toggle('on', filterMenuOpen && hiddenTypes.size > 0);
    more.setAttribute('aria-expanded', filterMenuOpen && hiddenTypes.size > 0 ? 'true' : 'false');
  }
  if (menu) {
    menu.hidden = !(filterMenuOpen && hiddenTypes.size);
    menu.querySelectorAll('.tl-chip').forEach((chip) => { chip.hidden = !hiddenTypes.has(chip.dataset.type); });
  }
  bar.dataset.ready = 'true';
}

function chipHTML(t, opts = {}) {
  const on = selectedTypes.has(t);
  const optional = opts.optional ? ' data-optional="true"' : '';
  return `<button class="tl-chip${on ? ' on' : ''}" data-action="timeline:toggle" data-type="${t}"${optional}>
    <svg class="icon"><use href="#${icon(TYPES[t].icon)}"></use></svg>${esc(TYPES[t].label)}</button>`;
}

function rowHTML(e) {
  const s = summary(e);
  const detail = [s.detail, s.meta].filter(Boolean).join(' · ');
  const noteDot = hasUnshownNote(e, s) ? '<span class="row-note-dot" aria-label="Has note"></span>' : '';
  return `<div class="tl-row" data-action="entry:edit" data-id="${e.id}">
    <span class="row-ic tone-${s.tone}"><svg class="icon"><use href="#${s.icon}"></use></svg></span>
    <span class="row-txt"><span class="what">${esc(s.label)}</span><span class="when">${esc(detail)}</span></span>
    ${noteDot}
    <span class="meta">${esc(fmt.rel(e.start))}</span>
  </div>`;
}

export function timeline() {
  const all = state().log; // already excludes soft-deleted (mergeById tombstones them)
  const active = selectedTypes;
  const filtered = active.size ? all.filter((e) => active.has(e.type)) : all;
  const groups = groupByDay(filtered);
  const chips = FILTER_TYPES.map((t) => chipHTML(t, { optional: OPTIONAL_FILTERS.includes(t) })).join('');
  const menuChips = OPTIONAL_FILTERS.map((t) => chipHTML(t)).join('');

  let body;
  if (!all.length) {
    body = `<div class="tl-empty">No entries yet. Log an activity from Home and it'll show up here.</div>`;
  } else if (!filtered.length) {
    body = `<div class="tl-empty">Nothing matches these filters.</div>`;
  } else {
    body = groups.map((g) => `
      <div class="tl-day"><h2 class="tl-day-hd"><span>${esc(g.label)}</span><span class="tl-day-ct">${g.items.length}</span></h2>
        <div class="card log">${g.items.map(rowHTML).join('')}</div>
      </div>`).join('');
  }

  return `
    <div class="page-hd tl-hd">
      <button class="tl-back" data-action="nav:home" aria-label="Back to Home"><svg class="icon"><use href="#chevron-left"></use></svg></button>
      <h1 class="page-title">Timeline</h1>
    </div>
    <div class="tl-filter-wrap${filterMenuOpen ? ' open' : ''}">
      <div class="tl-chipbar">${chips}<button class="tl-more" data-action="timeline:more" aria-label="Show more filters" aria-expanded="false" hidden><svg class="icon"><use href="#chevron-down"></use></svg></button></div>
      <div class="tl-filter-menu" hidden>${menuChips}</div>
    </div>
    ${body}`;
}
