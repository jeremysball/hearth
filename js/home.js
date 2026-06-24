// home.js — home view + entry summary helper.
import { state, derive, ageLabel, awakeWindowMin } from './store.js';
import { fmt, esc, icon, TYPES } from './ui.js';

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
    label = 'Diaper · ' + (e.kind || '').toLowerCase(); detail = fmt.clock(e.start);
  } else if (e.type === 'medicine') {
    label = e.name || 'Medicine'; detail = fmt.clock(e.start); meta = e.dose || '';
  } else if (e.type === 'pump') {
    label = 'Pump · ' + (e.side || '').toLowerCase(); detail = fmt.clock(e.start); meta = fmt.vol(e.amount);
  } else if (e.type === 'note') {
    label = 'Note'; detail = e.note || ''; meta = fmt.clock(e.start);
  }
  return { label, detail, meta, tone: c.tone, icon: icon(c.icon) };
}

let todayEditMode = false;
export function exitTodayEditMode() { todayEditMode = false; }
export function enterTodayEditMode() {
  if (!derive.today().length) return false;
  todayEditMode = true;
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
  const elapsed = (Date.now() - st.since) / 60000;
  if (st.state === 'asleep') {
    const t = fmt.durBig(elapsed);
    const pct = Math.min(100, (elapsed / 70) * 100);
    return `<div class="card hero asleep">
      <div class="state"><span class="livedot sleeping"></span><span class="state-lbl">Asleep since ${fmt.clock(st.since)}</span></div>
      <div class="timer">${t.h ? t.h + '<span class="u">h</span> ' : ''}${t.m}<span class="u">m</span></div>
      <div class="hero-sub">Resting peacefully. 💤</div>
      <div class="track sleep"><i style="width:${pct}%"></i></div>
      <div class="track-cap"><span>asleep</span><span>~70m typical nap</span></div>
    </div>`;
  }
  const win = awakeWindowMin();
  const t = fmt.durBig(elapsed);
  const pct = Math.min(100, (elapsed / win) * 100);
  const healthy = elapsed < win * 0.85 ? 'Awake window looking healthy.' : (elapsed < win ? 'Getting close to nap time.' : 'Past the ideal awake window.');
  return `<div class="card hero">
    <div class="state"><span class="livedot"></span><span class="state-lbl">Awake since ${fmt.clock(st.since)}</span></div>
    <div class="timer">${t.h ? t.h + '<span class="u">h</span> ' : ''}${t.m}<span class="u">m</span></div>
    <div class="hero-sub">${healthy}</div>
    <div class="track"><i style="width:${pct}%"></i></div>
    <div class="track-cap"><span>0h</span><span>typical ${fmt.dur(win)}</span></div>
  </div>`;
}

function sweetCard() {
  const sp = derive.sweetSpot();
  return `<div class="info-card sweet" data-action="log:open" data-type="sleep">
    <div class="ic-ring sleep"><svg class="icon"><use href="#moon-star"></use></svg></div>
    <div class="ic-txt">
      <div class="ic-lbl">SweetSpot · ${sp.napping ? 'after this nap' : 'next nap'}</div>
      <div class="ic-val">${fmt.clock(sp.from)} – ${fmt.clock(sp.to)}</div>
    </div>
    <button class="ic-edit" data-action="card:edit" data-card="sweetspot" aria-label="Edit"><svg class="icon"><use href="#sliders-horizontal"></use></svg></button>
  </div>`;
}
function bottleCard() {
  const nb = derive.nextBottle();
  const overdue = nb.due < new Date();
  return `<div class="info-card ${overdue ? 'due' : ''}" data-action="log:open" data-type="bottle">
    <div class="ic-ring feed"><svg class="icon"><use href="#${icon('baby-bottle')}"></use></svg></div>
    <div class="ic-txt">
      <div class="ic-lbl">Next bottle · every ${state().settings.bottleIntervalH}h</div>
      <div class="ic-val">${fmt.clock(nb.due)} <span class="ic-rel">${overdue ? 'due now' : fmt.untilOrAgo(nb.due)}</span></div>
    </div>
    <button class="ic-edit" data-action="card:edit" data-card="bottle" aria-label="Edit"><svg class="icon"><use href="#sliders-horizontal"></use></svg></button>
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
  return `<div class="info-card" data-action="log:open" data-type="medicine">
    <div class="ic-ring med"><svg class="icon"><use href="#${icon('pill')}"></use></svg></div>
    <div class="ic-txt"><div class="ic-lbl">Next medicine</div><div class="ic-val">${val}</div><div class="ic-lbl2">${esc(lbl)}</div></div>
    <button class="ic-edit" data-action="card:edit" data-card="medicine" aria-label="Edit"><svg class="icon"><use href="#sliders-horizontal"></use></svg></button>
  </div>`;
}

function hiddenRow() {
  const c = state().settings.cards;
  const hidden = Object.keys(c).filter((k) => !c[k]);
  if (!hidden.length) return '';
  const names = { sweetspot: 'SweetSpot', bottle: 'Bottle', medicine: 'Medicine' };
  return `<div class="hidden-row">${hidden.map((k) => `<button class="chip" data-action="card:show" data-card="${k}"><svg class="icon"><use href="#plus"></use></svg> ${names[k]}</button>`).join('')}</div>`;
}

const QUICK = [
  { t: 'sleep', primary: true }, { t: 'feed' }, { t: 'bottle' }, { t: 'diaper' }, { t: 'medicine' }
];

export function home() {
  const b = state().baby;
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const cards = state().settings.cards;
  const today = derive.today();
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
    <div class="info-stack">
      ${cards.sweetspot ? sweetCard() : ''}
      ${cards.bottle ? bottleCard() : ''}
      ${cards.medicine ? medicineCard() : ''}
    </div>
    ${hiddenRow()}
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
