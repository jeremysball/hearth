// home.js — home view + entry summary helper.
import { state, derive, ageLabel, awakeWindowMin } from './store.js';
const MIN = 60000;
import { fmt, esc, icon, TYPES, diaperIcon } from './ui.js';

export function summary(e) {
  const c = TYPES[e.type] || { label: e.type };
  let label = c.label, detail = '', meta = '';
  if (e.type === 'sleep') {
    label = e.end ? 'Slept' : 'Asleep';
    if (e.end) { detail = fmt.clock(e.start) + ' – ' + fmt.clock(e.end); meta = fmt.dur((new Date(e.end) - new Date(e.start)) / 60000); }
    else { detail = 'since ' + fmt.clock(e.start); meta = 'now'; }
  } else if (e.type === 'feed') {
    label = 'Nursing · ' + (e.side || '').toLowerCase(); detail = fmt.clock(e.start); meta = (e.duration || 0) + 'm';
  } else if (e.type === 'bottle') {
    label = 'Bottle · ' + (e.contents || '').toLowerCase(); detail = fmt.clock(e.start); meta = fmt.vol(e.amount);
  } else if (e.type === 'diaper') {
    label = 'Diaper · ' + (e.kind || '').toLowerCase(); detail = fmt.clock(e.start); meta = e.size || '';
  } else if (e.type === 'medicine') {
    label = e.name || 'Medicine'; detail = fmt.clock(e.start); meta = e.dose || '';
  } else if (e.type === 'pump') {
    label = 'Pump · ' + (e.side || '').toLowerCase(); detail = fmt.clock(e.start); meta = fmt.vol(e.amount);
  } else if (e.type === 'note') {
    label = 'Note'; detail = e.note || ''; meta = fmt.clock(e.start);
  }
  return { label, detail, meta, tone: c.tone, icon: e.type === 'diaper' ? diaperIcon(e.kind) : icon(c.icon) };
}

let todayEditMode = false;
export function exitTodayEditMode() { todayEditMode = false; }
export function enterTodayEditMode() {
  if (!derive.today().length) return false;
  todayEditMode = true;
  return true;
}
let cardEditMode = false;
export function exitCardEditMode() { cardEditMode = false; }
export function enterCardEditMode() {
  if (cardEditMode) return false;
  // Count only cards that would actually render, mirroring home()'s filter, so a
  // legacy non-renderable key can't let edit mode engage on a single visible card.
  const cards = state().settings.cards;
  if ((cards.order || CARD_KEYS).filter((k) => renderable(k) && cards[k] !== false).length < 2) return false;
  cardEditMode = true;
  return true;
}

function logRow(e) {
  const s = summary(e);
  if (todayEditMode) {
    return `<div class="row row-edit" data-id="${e.id}">
      <span class="row-ic tone-${s.tone}"><svg class="icon"><use href="#${s.icon}"></use></svg></span>
      <span class="row-txt"><span class="what">${esc(s.label)}</span><span class="when">${esc(s.detail)}</span></span>
      <button class="row-act edit" data-action="entry:edit" data-id="${e.id}" aria-label="Edit"><svg class="icon"><use href="#pencil"></use></svg></button>
      <button class="row-act del" data-action="entry:delete" data-id="${e.id}" aria-label="Delete"><svg class="icon"><use href="#trash-2"></use></svg></button>
    </div>`;
  }
  return `<div class="row" data-action="entry:open" data-id="${e.id}">
    <span class="row-ic tone-${s.tone}"><svg class="icon"><use href="#${s.icon}"></use></svg></span>
    <span class="row-txt"><span class="what">${esc(s.label)}</span><span class="when">${esc(s.detail)}</span></span>
    ${s.meta ? `<span class="meta">${esc(s.meta)}</span>` : ''}
  </div>`;
}

function avatar() {
  const b = state().baby;
  const inner = b.photo
    ? `<span class="avatar" style="background-image:url('${esc(b.photo)}')"></span>`
    : `<span class="avatar">${esc((b.name || 'B')[0].toUpperCase())}</span>`;
  return `<button class="avatar-btn" data-action="baby:photo" aria-label="View ${esc(b.name || 'baby')}'s photo">${inner}</button>`;
}

function heroCard() {
  const st = derive.status();
  const sp = derive.sweetSpot();
  const win = awakeWindowMin();
  const now = Date.now();
  const since = new Date(st.since).getTime();
  const elapsed = (now - since) / MIN;
  const t = fmt.durBig(elapsed);
  const asleep = st.state === 'asleep';
  const N = 16; // coals in the ember bed

  if (asleep) {
    // Banked overnight embers — coals warm left→right by nap progress, low and slow.
    const pct = Math.min(100, (elapsed / 70) * 100);
    let coals = '';
    for (let i = 0; i < N; i++) {
      const c = (i + 0.5) / N * 100;
      coals += `<i class="coal ${c <= pct ? 'banked' : ''}"></i>`;
    }
    return `<div class="card hero" data-state="asleep">
      <svg class="hero-moon" aria-hidden="true"><use href="#moon-filled"></use></svg>
      <div class="state"><span class="livedot sleeping"></span><span class="state-lbl">Asleep since ${fmt.clock(st.since)}</span></div>
      <div class="timer">${t.h ? t.h + '<span class="u">h</span> ' : ''}${t.m}<span class="u">m</span></div>
      <div class="hero-sub">Resting peacefully.</div>
      <div class="sh-rail-wrap">
        <div class="sh-bed banked">${coals}</div>
        <div class="sh-rail-cap"><span>asleep</span><span>~70m typical nap</span></div>
      </div>
    </div>`;
  }

  // Awake: the bed spans the awake window plus an hour of "overdue" runway,
  // so the gold sweetspot band (at the window's end) and any overshoot past it
  // both have room to show. Without the headroom the sweetspot sits exactly at
  // 100% and never renders.
  const sf = sp.from.getTime(), sto = sp.to.getTime();
  const railSpan = (win + 60) * MIN;
  const nowPct = Math.min(100, (now - since) / railSpan * 100);
  const sweetFromPct = Math.max(0, Math.min(100, (sf - since) / railSpan * 100));
  const sweetToPct   = Math.max(0, Math.min(100, (sto - since) / railSpan * 100));
  const bandWidth = Math.max(0, sweetToPct - sweetFromPct);

  let sweetState = 'before';
  if (now < sf - 15 * MIN) sweetState = 'before';
  else if (now < sf)       sweetState = 'entering';
  else if (now <= sto)     sweetState = 'now';
  else if (now < sto + 15 * MIN) sweetState = 'passing';
  else sweetState = 'passed';

  const timeRange = `${fmt.clock(sp.from)} – ${fmt.clock(sp.to)}`;
  const sweetLabel = { before: `Sweetspot · ${timeRange}`, entering: 'Sweetspot approaching', now: 'Sweetspot now', passing: 'Sweetspot passing', passed: `Sweetspot · ${timeRange}` }[sweetState];

  // Overdue begins only after the 30-min sweetspot grace window passes, so the
  // gold "good nap window" and the red overtired state don't fire at once.
  const pastWindow = now > sto;
  const overMin = Math.round((now - sto) / MIN);
  const healthy = elapsed < win * 0.85
    ? 'Awake window looking healthy.'
    : now < sf ? 'Getting close to nap time.'
    : now <= sto ? 'Sweet spot — good time for a nap.'
    : `Nap overdue by ${overMin}m.`;

  // Ember bed — coals ignite left→right as the awake window elapses.
  let coals = '';
  for (let i = 0; i < N; i++) {
    const c = (i + 0.5) / N * 100;
    const isLit = c <= nowPct;
    const isSweet = bandWidth > 0 && c >= sweetFromPct && c <= sweetToPct;
    let cls;
    if (pastWindow && isLit && c > sweetToPct) cls = 'toohot'; // overshoot past sweetspot burns too hot
    else if (isSweet && isLit) cls = 'caught';                 // sweetspot coal that has caught — gold
    else if (isSweet) cls = 'ready';                           // sweetspot ahead — dim gold target
    else if (isLit) cls = 'lit';                               // ordinary lit ember
    else cls = '';                                             // cool, unlit coal
    const isFront = cls === 'lit' && (i + 1.5) / N * 100 > nowPct; // hottest leading ember
    coals += `<i class="coal ${cls}${isFront ? ' front' : ''}"></i>`;
  }

  return `<div class="card hero" data-sweet="${sweetState}" data-state="awake"${pastWindow ? ' data-overtired' : ''}>
    <svg class="hero-moon" aria-hidden="true"><use href="#moon-filled"></use></svg>
    <div class="state"><span class="livedot"></span><span class="state-lbl">Awake since ${fmt.clock(st.since)}</span></div>
    <div class="timer">${t.h ? t.h + '<span class="u">h</span> ' : ''}${t.m}<span class="u">m</span>${pastWindow ? '<span class="overtired-flag">nap overdue</span>' : ''}</div>
    <div class="hero-sub">${healthy}</div>
    <div class="sh-sweet-lbl">${sweetLabel}</div>
    <div class="sh-rail-wrap">
      <div class="sh-bed">${coals}</div>
      <div class="sh-rail-cap"><span>${fmt.clock(st.since)}</span><span>typical ${fmt.dur(win)}</span></div>
    </div>
  </div>`;
}

function icEdit(key) {
  return cardEditMode
    ? `<button class="ic-edit drag" aria-label="Drag to reorder" data-card="${key}"><svg class="icon"><use href="#menu"></use></svg></button>`
    : `<button class="ic-edit" data-action="card:edit" data-card="${key}" aria-label="Edit"><svg class="icon"><use href="#sliders-horizontal"></use></svg></button>`;
}

function bottleCard() {
  const nb = derive.nextBottle();
  const overdue = nb.due < new Date();
  return `<div class="info-card ${overdue ? 'due' : ''}" ${cardEditMode ? '' : 'data-action="log:open"'} data-type="bottle" data-card="bottle">
    <div class="ic-ring feed"><svg class="icon"><use href="#${icon('baby-bottle')}"></use></svg></div>
    <div class="ic-txt">
      <div class="ic-lbl">Next bottle · every ${state().settings.bottleIntervalH}h</div>
      <div class="ic-val">${fmt.clock(nb.due)} <span class="ic-rel">${overdue ? 'due now' : fmt.untilOrAgo(nb.due)}</span></div>
    </div>
    ${icEdit('bottle')}
  </div>`;
}
function medicineCard() {
  const meds = derive.nextMeds();
  const next = meds.find((m) => m.due) || meds[0];
  let val, lbl;
  if (!next) { lbl = 'No medicines'; val = 'Tap to add'; }
  else if (!next.due) { lbl = next.med.name + ' · every ' + next.med.everyH + 'h'; val = 'Not given yet'; }
  else {
    const overdue = next.due < new Date();
    lbl = next.med.name + ' · ' + next.med.dose + next.med.unit;
    val = `${fmt.clock(next.due)} <span class="ic-rel">${overdue ? 'due now' : fmt.untilOrAgo(next.due)}</span>`;
  }
  return `<div class="info-card" ${cardEditMode ? '' : 'data-action="log:open"'} data-type="medicine" data-card="medicine">
    <div class="ic-ring med"><svg class="icon"><use href="#${icon('pill')}"></use></svg></div>
    <div class="ic-txt"><div class="ic-lbl">Next medicine</div><div class="ic-val">${val}</div><div class="ic-lbl2">${esc(lbl)}</div></div>
    ${icEdit('medicine')}
  </div>`;
}

// Generic timer card for any activity type configured with an interval.
function genericCard(type) {
  const c = TYPES[type] || { label: type, tone: 'note', icon: 'note-pencil' };
  const n = derive.nextForType(type);
  const overdue = n.due < new Date();
  return `<div class="info-card ${overdue ? 'due' : ''}" ${cardEditMode ? '' : 'data-action="log:open"'} data-type="${type}" data-card="${type}">
    <div class="ic-ring tone-${c.tone}"><svg class="icon"><use href="#${icon(c.icon)}"></use></svg></div>
    <div class="ic-txt">
      <div class="ic-lbl">Next ${esc(c.label.toLowerCase())} · every ${n.intervalH}h</div>
      <div class="ic-val">${fmt.clock(n.due)} <span class="ic-rel">${overdue ? 'due now' : fmt.untilOrAgo(n.due)}</span></div>
    </div>
    ${icEdit(type)}
  </div>`;
}

const CARD_KEYS = ['bottle', 'medicine'];
const CARD_RENDER = { bottle: bottleCard, medicine: medicineCard };
// Activity types eligible as timer cards (everything loggable except notes).
export const CARD_TYPES = ['feed', 'bottle', 'diaper', 'medicine', 'play', 'bath', 'pump'];

// A generic (non-default) card only renders once it has an interval configured,
// so legacy saved state never resurrects a card the user didn't add.
function renderable(k) {
  if (CARD_RENDER[k]) return true;
  return (state().settings.cards.intervals || {})[k] != null;
}
function cardHTML(k) { return CARD_RENDER[k] ? CARD_RENDER[k]() : genericCard(k); }

// Types not currently shown as a card — offered in the "Add card" picker.
export function addableCardTypes() {
  const cards = state().settings.cards;
  const shown = (k) => cards[k] !== false && (CARD_RENDER[k] || (cards.intervals || {})[k] != null) && (cards.order || CARD_KEYS).includes(k);
  return CARD_TYPES.filter((k) => !shown(k));
}

function addCardBtn() {
  if (cardEditMode) return '';
  return `<button class="add-card" data-action="card:add"><svg class="icon"><use href="#plus"></use></svg> Add card</button>`;
}

const QUICK = [
  { t: 'sleep', primary: true }, { t: 'feed' }, { t: 'bottle' }, { t: 'diaper' },
  { t: 'medicine' }, { t: 'play' }, { t: 'bath' }
];

export function home() {
  const b = state().baby;
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const cards = state().settings.cards;
  const today = derive.today();
  const isVisible = (k) => cards[k] !== false;
  const order = (cards.order || CARD_KEYS).filter((k) => renderable(k) && isVisible(k));
  return `
    <div class="hd">
      <div>
        <div class="greet">${greet}${b.caregiver ? ', ' + esc(b.caregiver) : ''}</div>
        <h1 class="baby">${esc(b.name || 'Baby')}</h1>
        <div class="age">${ageLabel()}</div>
      </div>
      ${avatar()}
    </div>
    ${heroCard()}
    ${cardEditMode ? '<div class="cards-hd"><a data-action="cards:edit-done">Done</a></div>' : ''}
    <div class="info-stack" data-longpress="cards"${cardEditMode ? ' data-card-edit' : ''}>
      ${order.map(cardHTML).join('')}
    </div>
    ${addCardBtn()}
    <div class="actions">
      ${QUICK.map((q) => {
        const c = TYPES[q.t];
        return `<button class="act ${q.primary ? 'primary' : ''}" data-action="log:open" data-type="${q.t}">
          <span class="tok tone-${c.tone}"><svg class="icon"><use href="#${icon(c.icon)}"></use></svg></span><span class="act-lbl">${c.label}</span></button>`;
      }).join('')}
      <button class="act" data-action="log:more"><span class="tok"><svg class="icon"><use href="#ellipsis"></use></svg></span><span class="act-lbl">More</span></button>
    </div>
    <div class="today-block">
      <div class="today-hd"><h2>Today</h2>${todayEditMode ? `<a data-action="today:edit-done">Done</a>` : `<a data-action="nav:sleep">Timeline</a>`}</div>
      <div class="card log" data-longpress="today">${today.length ? today.map(logRow).join('') : `<div class="empty-log">No entries yet today — tap a button above to log.</div>`}</div>
    </div>`;
}
