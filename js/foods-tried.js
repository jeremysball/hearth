// foods-tried.js: rollup view of every distinct food ever logged, derived
// entirely from existing solid log entries -- no separate food-library
// table. Reached from the Solids Home card, not a bottom tab -- same
// "non-tab view with a back-to-Home button" pattern timeline.js used
// before it was promoted to a tab.
import { state } from './store.js';
import { esc, fmt } from './ui.js';
import { findFoodByKey } from './foods.js';

const REACTION_LABELS = { hates: 'Hates it', unsure: 'Unsure', likes: 'Likes it', loves: 'Loves it' };

function rollupRows() {
  const byIdentity = new Map(); // groups by catalog key, or lowercase custom label
  for (const e of state().log) {
    if (e.type !== 'solid' || !e.foods) continue;
    for (const row of e.foods) {
      const identity = row.key || (row.label || '').toLowerCase();
      if (!identity) continue;
      const catalogFood = row.key ? findFoodByKey(row.key) : null;
      const displayLabel = catalogFood ? catalogFood.label : (row.label || row.key);
      const icon = catalogFood ? catalogFood.icon : null;
      const existing = byIdentity.get(identity);
      const tried = { start: e.start, reaction: row.reaction, allergy: !!row.allergy };
      if (!existing) {
        byIdentity.set(identity, { identity, label: displayLabel, icon, timesTried: 1, lastTried: tried.start, latestReaction: tried.reaction, everAllergy: tried.allergy });
      } else {
        existing.timesTried += 1;
        existing.everAllergy = existing.everAllergy || tried.allergy;
        if (new Date(tried.start) > new Date(existing.lastTried)) {
          existing.lastTried = tried.start;
          existing.latestReaction = tried.reaction;
        }
      }
    }
  }
  return [...byIdentity.values()];
}

export function foodsTried() {
  const rows = rollupRows().sort((a, b) => (b.everAllergy - a.everAllergy) || new Date(b.lastTried) - new Date(a.lastTried));
  return `<div class="page-hd tl-hd">
      <button class="page-back" data-action="nav:home" aria-label="Back to Home"><svg class="icon"><use href="#chevron-left"></use></svg></button>
      <h1 class="page-title">Foods tried</h1>
    </div>
    <div class="card log">
      ${rows.length ? rows.map((r) => `<div class="log-row">
        <span class="tok tone-solid"><svg class="icon"><use href="#utensils"></use></svg></span>
        <span class="row-txt"><span class="what">${esc(r.label)}${r.everAllergy ? ' ⚠' : ''}</span>
        <span class="when">${r.timesTried}× · last ${fmt.untilOrAgo(new Date(r.lastTried))} · ${esc(REACTION_LABELS[r.latestReaction] || '')}</span></span>
      </div>`).join('') : `<div class="empty-log">No foods logged yet.</div>`}
    </div>`;
}