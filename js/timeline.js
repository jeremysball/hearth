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
