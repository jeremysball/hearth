// home.js: home view + entry summary helper.
import { state, derive, ageLabel } from './store.js';
const MIN = 60000;
import { fmt, esc, icon, TYPES, diaperIcon } from './ui.js';
import { predictionSourceInfo } from './sleep.js';
import { heroSky, emberGlow } from './sky.js';

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
    const size = e.kind === 'Mixed' ? [e.wetSize, e.dirtySize].filter(Boolean).join('/') : e.size;
    meta = [size, e.rash ? 'Rash' : ''].filter(Boolean).join(' · ');
  } else if (e.type === 'medicine') {
    label = e.name || 'Medicine'; detail = fmt.clock(e.start); meta = e.dose || '';
  } else if (e.type === 'pump') {
    label = 'Pump · ' + (e.side || '').toLowerCase(); detail = fmt.clock(e.start); meta = fmt.vol(e.amount);
  } else if (e.type === 'note') {
    label = 'Note'; detail = e.note || ''; meta = fmt.clock(e.start);
  } else if (e.type === 'bath') {
    detail = fmt.clock(e.start); meta = e.note || '';
  } else if (e.type === 'play') {
    label = e.playType ? 'Play · ' + e.playType.toLowerCase() : 'Play';
    detail = fmt.clock(e.start); meta = e.note || '';
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

const NOTE_SHOWN_INLINE_TYPES = new Set(['note', 'bath', 'play']);
export function hasUnshownNote(e) {
  return Boolean(e.note) && !NOTE_SHOWN_INLINE_TYPES.has(e.type);
}

function logRow(e) {
  const s = summary(e);
  const noteDot = hasUnshownNote(e) ? '<span class="row-note-dot" role="img" aria-label="Has note"></span>' : '';
  if (todayEditMode) {
    return `<div class="row row-edit" data-id="${e.id}">
      <span class="row-ic tone-${s.tone}"><svg class="icon"><use href="#${s.icon}"></use></svg></span>
      <span class="row-txt"><span class="what">${esc(s.label)}</span><span class="when">${esc(s.detail)}</span></span>
      ${noteDot}
      <button class="row-act edit" data-action="entry:edit" data-id="${e.id}" aria-label="Edit"><svg class="icon"><use href="#pencil"></use></svg></button>
      <button class="row-act del" data-action="entry:delete" data-id="${e.id}" aria-label="Delete"><svg class="icon"><use href="#trash-2"></use></svg></button>
    </div>`;
  }
  return `<div class="row" data-action="entry:open" data-id="${e.id}">
    <span class="row-ic tone-${s.tone}"><svg class="icon"><use href="#${s.icon}"></use></svg></span>
    <span class="row-txt"><span class="what">${esc(s.label)}</span><span class="when">${esc(s.detail)}</span></span>
    ${noteDot}
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

// One-time morning light tip card. Shown when the circadian anchor reaches
// medium+ confidence. Dismissed to settings: never shown again after tap.
function morningLightTip() {
  if (state().settings.tipMorningLightDismissed) return '';
  const anchor = derive.circadianAnchor();
  if (!anchor || anchor.confidence === 'low') return '';
  const name = esc(state().baby.name || 'Your baby');
  const h = Math.floor(anchor.morningWakeMinutes / 60);
  const m = anchor.morningWakeMinutes % 60;
  const todayBase = new Date(); todayBase.setHours(h, m, 0, 0);
  const timeStr = fmt.clock(todayBase);
  return `<div class="card tip-card">
    <div class="tip-hd"><span class="tip-icon"><svg class="icon"><use href="#${icon('sunrise')}"></use></svg></span>Morning light</div>
    <p>${name} wakes around ${timeStr} most mornings. Open the curtains or step outside in the first 30 minutes — that light-dark contrast is one of the strongest cues for a predictable sleep clock.</p>
    <div class="tip-source">Source: Yates 2018; Kok 2024</div>
    <button class="tip-dismiss" data-action="tip:dismiss" data-tip="morning-light">Got it</button>
  </div>`;
}

// Bedtime estimate chip. Shown in the evening (after 4pm) when the circadian
// anchor has medium+ confidence.
function bedtimeBanner() {
  if (new Date().getHours() < 16) return '';
  const bw = derive.bedtimeWindow();
  if (!bw) return '';
  return `<div class="bedtime-chip">
    <svg class="icon"><use href="#${icon('moon')}"></use></svg> Sleep clock pointing toward bed ${fmt.clock(bw.from)}–${fmt.clock(bw.to)}
  </div>`;
}

function regressionBanner() {
  const r = derive.regressionAlert();
  if (!r) return '';
  const name = esc(state().baby.name || 'Your baby');
  return `<div class="card tip-card regression-banner">
    <div class="tip-hd"><span class="tip-icon"><svg class="icon"><use href="#${icon('info')}"></use></svg></span>${esc(r.name)}</div>
    <p>${name} is approaching the ${esc(r.name.toLowerCase())}, a normal developmental stage rather than a problem to fix. ${esc(r.text)}</p>
    <div class="tip-source">Source: ${esc(r.sources)}</div>
    <button class="tip-dismiss" data-action="regression:dismiss" data-rid="${esc(r.id)}" aria-label="Dismiss">Got it</button>
  </div>`;
}

function stageTipCard() {
  const tip = derive.stageTip();
  if (!tip) return '';
  const name = esc(state().baby.name || 'Your baby');
  return `<div class="card tip-card">
    <div class="tip-hd"><span class="tip-icon"><svg class="icon"><use href="#${icon(tip.icon)}"></use></svg></span>${esc(tip.title)}</div>
    <p>${tip.body(name)}</p>
    <div class="tip-source">Source: ${esc(tip.sources)}</div>
    <button class="tip-dismiss" data-action="tip:dismiss" data-tip="${esc(tip.id)}">Got it</button>
  </div>`;
}

function heroCard() {
  const st = derive.status();
  const sp = derive.sweetSpot();
  const now = Date.now();
  const since = new Date(st.since).getTime();
  const elapsed = (now - since) / MIN;
  const t = fmt.durBig(elapsed);
  const asleep = st.state === 'asleep';
  const sky = heroSky(st, sp);
  const open = (attrs, glowHTML = '') => `<div class="card hero hero-sky" data-sky-mode="${sky.mode}" ${attrs} style="${sky.cardStyle}">${sky.html}${glowHTML}<div class="hero-fg">`;
  const close = `</div></div>`;
  const timer = `<div class="timer">${t.h ? t.h + '<span class="u">h</span> ' : ''}${t.m}<span class="u">m</span></div>`;
  // The ember-glow ground+field replaces the 16-coal bed: same warm ember
  // material, now a continuous card-level glow instead of discrete tiles.
  const emberGlowHTML = (x, glow) => `<div class="ember-glow">
    <div class="ember-ground" style="background:linear-gradient(180deg, transparent 0%, ${glow.mid} 70%, ${glow.core} 100%); opacity:${glow.groundOp}"></div>
    <div class="ember-field" style="left:calc(${x.toFixed(1)}% - ${glow.size / 2}%); width:${glow.size}%; height:${(glow.size * 0.55).toFixed(0)}%; background:radial-gradient(ellipse at center, ${glow.core} 0%, ${glow.mid} 40%, transparent 72%); opacity:${glow.fieldOp}"></div>
  </div>`;

  // Night hours (midnight–6am): suppress the sweet spot rail entirely.
  // Overnight sleep is not a nap; arousals are circadian, not homeostatic.
  // No coal bed today, so no ember-glow here either — untouched.
  if (sp.night) {
    if (asleep) {
      return open('data-state="asleep" data-night') + `
        <div class="state"><span class="livedot sleeping"></span><span class="state-lbl">Asleep since ${fmt.clock(st.since)}</span></div>
        ${timer}
        <div class="hero-sub">Resting peacefully.</div>` + close;
    }
    return open('data-state="awake" data-night') + `
      <div class="state"><span class="livedot"></span><span class="state-lbl">Awake since ${fmt.clock(st.since)}</span></div>
      ${timer}
      <div class="hero-sub">Nighttime wake: circadian drive is still high. Settle back to sleep now.</div>` + close;
  }

  if (asleep) {
    // Banked ember: a low, steady glow that eases in as the nap settles —
    // restful, not building tension like the awake state below.
    const pct = Math.min(100, (elapsed / 70) * 100);
    const glow = emberGlow(0.22);
    return open('data-state="asleep"', emberGlowHTML(pct, glow)) + `
      <div class="state"><span class="livedot sleeping"></span><span class="state-lbl">Asleep since ${fmt.clock(st.since)}</span></div>
      ${timer}
      <div class="hero-sub">Resting peacefully.</div>
      <div class="sh-rail-wrap">
        <div class="sh-rail-cap"><span>asleep</span><span>~70m typical nap</span></div>
      </div>` + close;
  }

  // Under 6 weeks: no reliable wake windows or circadian rhythm.
  // Show cue-following guidance instead of the sleep pressure rail.
  if (sp.newborn) {
    const name = esc(state().baby.name || 'Baby');
    return open('data-state="awake" data-newborn') + `
      <div class="state"><span class="livedot"></span><span class="state-lbl">Awake since ${fmt.clock(st.since)}</span></div>
      ${timer}
      <div class="hero-sub">Watch for tired cues: yawning, eye-rubs, looking away. ${name} sets the rhythm now.</div>` + close;
  }

  // Awake: the rail spans the awake window plus an hour of "overdue" runway,
  // so the ember can still track progress after the sweetspot has passed.
  const sf = sp.from.getTime(), sto = sp.to.getTime();
  const railSpan = (sp.prediction.high + 60) * MIN;
  const nowPct = Math.min(100, (now - since) / railSpan * 100);

  let sweetState = 'before';
  if (now < sf - 15 * MIN) sweetState = 'before';
  else if (now < sf)       sweetState = 'entering';
  else if (now <= sto)     sweetState = 'now';
  else if (now < sto + 15 * MIN) sweetState = 'passing';
  else sweetState = 'passed';

  const timeRange = `${fmt.clock(sp.from)} – ${fmt.clock(sp.to)}`;
  const sweetLabel = { before: `Sweetspot · ${timeRange}`, entering: 'Sweetspot approaching', now: 'Sweetspot now', passing: 'Sweetspot passing', passed: `Sweetspot · ${timeRange}` }[sweetState];

  // Optional clock-time anchor label when circadian confidence is medium+.
  const anchor = derive.circadianAnchor();
  let clockTimeNote = '';
  if (anchor && anchor.confidence !== 'low' && !sp.napping) {
    const todayBase = new Date(); todayBase.setHours(0, 0, 0, 0);
    const anchorMs = todayBase.getTime() + anchor.morningWakeMinutes * MIN;
    const clockFrom = new Date(anchorMs + sp.prediction.low * MIN);
    const clockTo   = new Date(anchorMs + sp.prediction.high * MIN);
    clockTimeNote = `<span class="sweet-clock">usually ${fmt.clock(clockFrom)}–${fmt.clock(clockTo)}</span>`;
  }

  // Overdue begins only after the 30-min sweetspot grace window passes, so the
  // gold "good nap window" and the overtired state don't fire at once.
  const pastWindow = now > sto;
  const healthy = elapsed < sp.prediction.low * 0.85
    ? 'Sleep pressure building: adenosine is rising.'
    : now < sf ? 'Nap window opening. Watch for yawning or looking away.'
    : now <= sto ? 'Sleep pressure is high, good time for a nap.'
    : 'Past the usual window. Settling may take a little longer.';

  // Ember heat mirrors the same four pressure tiers as `healthy` above:
  // building, approaching, in the sweetspot, then a hot overtired overshoot.
  const heat = elapsed < sp.prediction.low * 0.85 ? 0.15
    : now < sf ? 0.35
    : now <= sto ? 0.55
    : 0.95;
  const glow = emberGlow(heat);

  // Bottom-left previously repeated "Awake since" from the state line above.
  // Show the sweetspot boundary instead: the window's start before it opens,
  // its end (the latest good time to start the nap) once it's open or past.
  const railTime = now < sf ? `Starts ${fmt.clock(sp.from)}` : `Ends ${fmt.clock(sp.to)}`;

  return open(`data-sweet="${sweetState}" data-state="awake"${pastWindow ? ' data-overtired' : ''}`, emberGlowHTML(nowPct, glow)) + `
    <div class="state"><span class="livedot"></span><span class="state-lbl">Awake since ${fmt.clock(st.since)}</span></div>
    <div class="timer">${t.h ? t.h + '<span class="u">h</span> ' : ''}${t.m}<span class="u">m</span>${pastWindow ? '<span class="overtired-flag">past window</span>' : ''}</div>
    <div class="hero-sub">${healthy}</div>
    <div class="sh-sweet-lbl">${sweetLabel}${clockTimeNote}</div>
    <div class="sh-rail-wrap">
      <div class="sh-rail-cap"><span>${railTime}</span><span>${sp.prediction.label}<button class="src-info-btn ${predictionSourceInfo(sp.prediction).cls}" data-action="prediction:info" aria-label="About this prediction"><svg class="icon"><use href="#info"></use></svg></button></span></div>
    </div>` + close;
}

function icEdit(key) {
  return cardEditMode
    ? `<button class="ic-edit drag" aria-label="Drag to reorder" data-card="${key}"><svg class="icon"><use href="#menu"></use></svg></button>`
    : `<button class="ic-edit" data-action="card:edit" data-card="${key}" aria-label="Edit"><svg class="icon"><use href="#sliders-horizontal"></use></svg></button>`;
}

function bottleCard() {
  const nb = derive.nextBottle();
  const overdue = nb.due <= new Date();
  const lbl = overdue ? `Bottle due · ${fmt.untilOrAgo(nb.due)}` : `Next bottle · every ${state().settings.bottleIntervalH}h`;
  return `<div class="info-card ${overdue ? 'due' : ''}" ${cardEditMode ? '' : 'data-action="log:open"'} data-type="bottle" data-card="bottle">
    <div class="ic-ring feed"><svg class="icon"><use href="#${icon('baby-bottle')}"></use></svg></div>
    <div class="ic-txt">
      <div class="ic-lbl">${lbl}</div>
      <div class="ic-val">${fmt.clock(nb.due)} <span class="ic-rel">${fmt.untilOrAgo(nb.due)}</span></div>
    </div>
    ${icEdit('bottle')}
  </div>`;
}
function medicineCard() {
  const meds = derive.nextMeds();
  const next = meds.find((m) => m.due) || meds[0];
  const action = cardEditMode ? '' : 'data-action="med:card"';
  if (!next) {
    return `<div class="info-card" ${action} data-card="medicine">
      <div class="ic-ring med"><svg class="icon"><use href="#plus"></use></svg></div>
      <div class="ic-txt"><div class="ic-lbl">Medicine</div><div class="ic-val">Add a medicine</div></div>
      ${icEdit('medicine')}
    </div>`;
  }
  let val, lbl;
  if (!next.due) { lbl = next.med.name + ' · every ' + next.med.everyH + 'h'; val = 'Not given yet'; }
  else {
    lbl = next.med.name + ' · ' + next.med.dose + next.med.unit;
    val = `${fmt.clock(next.due)} <span class="ic-rel">${fmt.untilOrAgo(next.due)}</span>`;
  }
  const overdue = next.due && next.due <= new Date();
  const top = overdue ? `Medicine due · ${fmt.untilOrAgo(next.due)}` : 'Next medicine';
  return `<div class="info-card ${overdue ? 'due' : ''}" ${action} data-card="medicine">
    <div class="ic-ring med"><svg class="icon"><use href="#${icon('pill')}"></use></svg></div>
    <div class="ic-txt"><div class="ic-lbl">${top}</div><div class="ic-val">${val}</div><div class="ic-lbl2">${esc(lbl)}</div></div>
    ${icEdit('medicine')}
  </div>`;
}

// Generic timer card for any activity type configured with an interval.
function genericCard(type) {
  const c = TYPES[type] || { label: type, tone: 'note', icon: 'note-pencil' };
  const n = derive.nextForType(type);
  const overdue = n.due <= new Date();
  const lbl = overdue ? `${esc(c.label)} due · ${fmt.untilOrAgo(n.due)}` : `Next ${esc(c.label.toLowerCase())} · every ${n.intervalH}h`;
  return `<div class="info-card ${overdue ? 'due' : ''}" ${cardEditMode ? '' : 'data-action="log:open"'} data-type="${type}" data-card="${type}">
    <div class="ic-ring tone-${c.tone}"><svg class="icon"><use href="#${icon(c.icon)}"></use></svg></div>
    <div class="ic-txt">
      <div class="ic-lbl">${lbl}</div>
      <div class="ic-val">${fmt.clock(n.due)} <span class="ic-rel">${fmt.untilOrAgo(n.due)}</span></div>
    </div>
    ${icEdit(type)}
  </div>`;
}

export function refreshOverdueLabels() {
  const cards = document.querySelectorAll('.info-card.due');
  cards.forEach((card) => {
    const type = card.dataset.type || card.dataset.card;
    if (type === 'bottle') {
      const nb = derive.nextBottle();
      const lbl = card.querySelector('.ic-lbl');
      const rel = card.querySelector('.ic-rel');
      if (lbl) lbl.textContent = `Bottle due · ${fmt.untilOrAgo(nb.due)}`;
      if (rel) rel.textContent = fmt.untilOrAgo(nb.due);
    } else if (type === 'medicine') {
      const meds = derive.nextMeds();
      const next = meds.find((m) => m.due) || meds[0];
      if (!next || !next.due) return;
      const lbl = card.querySelector('.ic-lbl');
      const rel = card.querySelector('.ic-rel');
      if (lbl) lbl.textContent = `Medicine due · ${fmt.untilOrAgo(next.due)}`;
      if (rel) rel.textContent = fmt.untilOrAgo(next.due);
    } else {
      const n = derive.nextForType(type);
      const c = TYPES[type] || { label: type };
      const lbl = card.querySelector('.ic-lbl');
      const rel = card.querySelector('.ic-rel');
      if (lbl) lbl.textContent = `${c.label} due · ${fmt.untilOrAgo(n.due)}`;
      if (rel) rel.textContent = fmt.untilOrAgo(n.due);
    }
  });
}

export function bathDaysSinceLabel(iso) {
  if (!iso) return 'Never';
  const midnight = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((midnight(Date.now()) - midnight(iso)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return days + ' days ago';
}

function bathCard() {
  const items = state().log.filter((e) => e.type === 'bath');
  const last = items.length ? items[0] : null;
  const label = bathDaysSinceLabel(last ? last.start : null);
  return `<div class="info-card" ${cardEditMode ? '' : 'data-action="log:open"'} data-type="bath" data-card="bath">
    <div class="ic-ring tone-${TYPES.bath.tone}"><svg class="icon"><use href="#${icon(TYPES.bath.icon)}"></use></svg></div>
    <div class="ic-txt">
      <div class="ic-lbl">Last bath</div>
      <div class="ic-val">${esc(label)}</div>
    </div>
    ${icEdit('bath')}
  </div>`;
}

const CARD_KEYS = ['bottle', 'medicine'];
const CARD_RENDER = { bottle: bottleCard, medicine: medicineCard, bath: bathCard };
// Activity types eligible as timer cards (everything loggable except notes).
export const CARD_TYPES = ['feed', 'bottle', 'diaper', 'medicine', 'play', 'bath', 'pump'];

// A generic (non-default) card only renders once it has an interval configured,
// so legacy saved state never resurrects a card the user didn't add.
function renderable(k) {
  if (CARD_RENDER[k]) return true;
  return (state().settings.cards.intervals || {})[k] != null;
}
function cardHTML(k) { return CARD_RENDER[k] ? CARD_RENDER[k]() : genericCard(k); }

// Types not currently shown as a card: offered in the "Add card" picker.
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
    ${regressionBanner()}
    ${morningLightTip()}
    ${stageTipCard()}
    ${bedtimeBanner()}
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
      <div class="today-hd"><h2>Today</h2>${todayEditMode ? `<a data-action="today:edit-done">Done</a>` : `<a data-action="nav:timeline">Timeline</a>`}</div>
      <div class="card log" data-longpress="today">${today.length ? today.map(logRow).join('') : `<div class="empty-log">No entries yet today. Tap a button above to log.</div>`}</div>
    </div>`;
}
