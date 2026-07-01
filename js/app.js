// app.js — shell, router, event delegation, binders, PWA.
import { state, save, reset, addEntry, removeEntry, removeMeasure, enqueueBabySync, enqueueSettingsSync, applySyncResponse, markSynced, setSyncTrigger } from './store.js';
import { drainOutbox, getLastSync, setLastSync, syncChangeCount } from './sync.js';
import { $, $$, esc, applyTheme, toast, runUndo, sheet, positionThumb, initThumbs } from './ui.js';
import { log } from './log.js';
import { home, summary, enterTodayEditMode, exitTodayEditMode, enterCardEditMode, exitCardEditMode, refreshOverdueLabels } from './home.js';
import { trends } from './trends.js';
import { sleep } from './sleep.js';
import { growth } from './growth.js';
import { profile, loadCaregivers, caregiversSnapshot } from './profile.js';
import { onboarding, onboardTheme, onboardPhoto, onboardFinish } from './onboarding.js';
import { joinView, joinFinish } from './join.js';
import { openLog, saveLog, openTypeChooser, editCard, saveBottle, saveMeds, hideCard, showCard, openMeasure, saveMeasure, medRow, openSpinner, openCardPicker, pickCard, saveNewCard, saveCardInterval, removeCard, openMedCard, logMedDose } from './sheets.js';
import { enableNotifs, notify } from './reminders.js';
import { animateGrow, buzz } from './fx.js';
import { timeline, toggleFilter, toggleFilterMenu, initTimelineFilters } from './timeline.js';
import { currentVersion } from './changelog.js';
import { beginSignIn, signOut, resolveConflict, handleAuthRedirect, loadMe } from './account.js';

let current = 'home';
const VIEWS = { home, trends, sleep, growth, profile, timeline };

const TABS = [
  { v: 'home', icon: 'house', label: 'Home' }, { v: 'sleep', icon: 'moon', label: 'Sleep' },
  { v: 'trends', icon: 'chart-bar', label: 'Trends' }, { v: 'growth', icon: 'ruler', label: 'Growth' },
  { v: 'profile', icon: 'user', label: 'Profile' }
];

function enterTrends() {
  const bars = [...document.querySelectorAll('#view .bar')];
  bars.forEach((b, i) => {
    animateGrow(b, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], i * 20);
  });
}

function enterSleep() {
  const C = 2 * Math.PI * 86;
  const circles = [...document.querySelectorAll('#view .ringwrap svg circle[stroke-dasharray]')];
  circles.forEach((c, i) => {
    const finalDA = c.getAttribute('stroke-dasharray');
    animateGrow(c, [
      { strokeDasharray: `0 ${C.toFixed(2)}` },
      { strokeDasharray: finalDA }
    ], i * 35, 'ease-out');
  });
}

function enterGrowth() {
  const poly = document.querySelector('#view .growth-svg polyline');
  if (poly) {
    const len = poly.getTotalLength();
    animateGrow(poly, [
      { strokeDasharray: String(len), strokeDashoffset: len },
      { strokeDasharray: String(len), strokeDashoffset: 0 }
    ], 0, 'ease-out');
  }
  const polygon = document.querySelector('#view .growth-svg polygon');
  if (polygon) {
    animateGrow(polygon, [{ opacity: 0 }, { opacity: 0.5 }], 200, 'ease-out');
  }
  const dots = [...document.querySelectorAll('#view .growth-svg circle')];
  dots.forEach((d, i) => {
    animateGrow(d, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], 200 + i * 50);
  });
}

function hasUnseenChangelog() {
  const version = currentVersion();
  return !!version && state().settings.seenChangelog !== version;
}

function scrollToChangelog() {
  const view = $('#view');
  const card = $('#changelog-card');
  if (view && card) view.scrollTo({ top: card.offsetTop - 12, behavior: 'smooth' });
}

function shell() {
  return `<main class="phone app">
    <div id="ptr" class="ptr-wrap"><svg class="icon ptr-spinner"><use href="#refresh-cw"></use></svg></div>
    <div id="view" class="screen"></div>
    <nav class="tabbar">${TABS.map((t) => `<button class="tab" data-action="nav:${t.v}" data-tab="${t.v}" aria-label="${t.label}"><svg class="icon"><use href="#${t.icon}"></use></svg>${t.v === 'profile' && hasUnseenChangelog() ? '<span class="tab-badge"></span>' : ''}</button>`).join('')}</nav>
  </main>`;
}

export const router = {
  boot() {
    $('#app').innerHTML = shell();
  },
  go(view) {
    exitTodayEditMode();
    exitCardEditMode();
    current = view;
    if (!$('#view')) { router.boot(); }
    $('#view').innerHTML = VIEWS[view]();
    initThumbs($('#view'));
    if (view === 'timeline') initTimelineFilters();
    $('#view').scrollTop = 0;
    $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === view));
    $$('.tab[data-tab="profile"]').forEach((t) => {
      const badge = t.querySelector('.tab-badge');
      if (hasUnseenChangelog() && !badge) t.insertAdjacentHTML('beforeend', '<span class="tab-badge"></span>');
      else if (!hasUnseenChangelog() && badge) badge.remove();
    });
    if (view === 'trends') enterTrends();
    else if (view === 'sleep') enterSleep();
    else if (view === 'growth') enterGrowth();
  },
  refresh() {
    if ($('#view')) { $('#view').innerHTML = VIEWS[current]({}); initThumbs($('#view')); if (current === 'timeline') initTimelineFilters(); }
    $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === current));
    $$('.tab[data-tab="profile"]').forEach((t) => {
      const badge = t.querySelector('.tab-badge');
      if (hasUnseenChangelog() && !badge) t.insertAdjacentHTML('beforeend', '<span class="tab-badge"></span>');
      else if (!hasUnseenChangelog() && badge) badge.remove();
    });
  }
};

// ---------- path helpers ----------
function setPath(path, val) {
  const parts = path.split('.'); let o = state();
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = val;
  save();
  if (path.startsWith('baby.')) enqueueBabySync();
  else if (path.startsWith('settings.') && path !== 'settings.darkMode' && path !== 'settings.clock24' && path !== 'settings.sound' && path !== 'settings.theme') enqueueSettingsSync();
}
function getPath(path) { return path.split('.').reduce((o, k) => (o ? o[k] : undefined), state()); }

// ---------- entry detail ----------
function openEntry(id) {
  const e = state().log.find((x) => x.id === id); if (!e) return;
  const s = summary(e);
  const caregivers = state().caregivers?.length ? state().caregivers : [];
  const author = caregivers.find((c) => c.id === e.caregiverId);
  sheet.open(`
    <div class="entry-view">
      <span class="ic-ring ${s.tone}"><svg class="icon"><use href="#${s.icon}"></use></svg></span>
      <div><div class="entry-title">${esc(s.label)}</div><div class="entry-sub">${esc(s.detail)}${s.meta ? ' · ' + esc(s.meta) : ''}</div></div>
    </div>
    ${author ? `<div class="entry-author">Logged by ${esc(author.displayName)}</div>` : ''}
    ${e.note ? `<div class="entry-note">${esc(e.note)}</div>` : ''}
    <button class="btn-primary" data-action="entry:edit" data-id="${e.id}"><svg class="icon"><use href="#pencil"></use></svg> Edit entry</button>
    <button class="btn-ghost danger" data-action="entry:delete" data-id="${e.id}"><svg class="icon"><use href="#trash-2"></use></svg> Delete entry</button>`,
    { title: 'Entry' });
}

function openBabyPhoto() {
  const b = state().baby;
  sheet.open(`
    <div class="photo-view">
      ${b.photo ? `<img src="${esc(b.photo)}" alt="${esc(b.name || 'Baby')}" />` : `<span class="avatar lg">${esc((b.name || 'B')[0].toUpperCase())}</span>`}
    </div>
    <button class="btn-primary" data-action="baby:photo-edit"><svg class="icon"><use href="#camera"></use></svg> Change photo</button>`,
    { title: b.name || 'Baby' });
}

// ---------- click delegation ----------
document.addEventListener('click', (ev) => {
  if (Date.now() < suppressClickUntil) { ev.preventDefault(); ev.stopPropagation(); return; }
  if (ev.target.closest('.info-stack[data-card-edit]')) { ev.preventDefault(); return; }
  // segmented visual toggle (+persist if bound)
  const opt = ev.target.closest('.seg-opt');
  if (opt) {
    const group = opt.closest('.segctl');
    if (group) {
      $$('.seg-opt', group).forEach((b) => b.classList.remove('on'));
      opt.classList.add('on');
      positionThumb(group);
      const bind = group.dataset.bindSeg;
      if (bind) { setPath(bind, opt.dataset.val); if (bind === 'baby.theme' || bind === 'settings.theme' || bind === 'settings.darkMode') applyTheme(); }
    }
    // don't return; seg-opt has no data-action
  }

  const el = ev.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action;
  const d = el.dataset;
  const map = {
    'nav:home': () => router.go('home'),
    'nav:trends': () => router.go('trends'),
    'nav:sleep': () => router.go('sleep'),
    'nav:growth': () => router.go('growth'),
    'nav:profile': () => {
      const scrollAfterOpen = hasUnseenChangelog();
      router.go('profile');
      Promise.all([loadCaregivers(), loadMe()]).then(() => {
        if (current === 'profile') {
          router.refresh();
          if (scrollAfterOpen) setTimeout(scrollToChangelog, 50);
        }
      });
    },
    'nav:timeline': () => router.go('timeline'),
    'timeline:more': () => { toggleFilterMenu(); router.refresh(); },
    'timeline:toggle': () => { toggleFilter(d.type); router.refresh(); },
    'log:open': () => openLog(d.type),
    'log:more': () => openTypeChooser(),
    'log:save': () => saveLog(d.type, d.id),
    'sheet:close': () => sheet.close(),
    'card:edit': () => editCard(d.card),
    'card:show': () => showCard(d.card),
    'card:hide': () => hideCard(d.card),
    'card:add': () => openCardPicker(),
    'card:pick': () => pickCard(d.type),
    'card:save-new': () => saveNewCard(d.card),
    'card:save-interval': () => saveCardInterval(d.card),
    'card:remove': () => removeCard(d.card),
    'card:save-bottle': () => saveBottle(),
    'card:save-meds': () => saveMeds(),
    'med:add': () => addMed(),
    'med:card': () => openMedCard(),
    'med:dose': () => logMedDose(d.mid),
    'med:remove': () => { const r = $(`.med-edit[data-mid="${d.mid}"]`); if (r) r.remove(); },
    'tip:dismiss': () => {
      const tip = el.dataset.tip;
      if (tip === 'morning-light') {
        state().settings.tipMorningLightDismissed = true;
        save();
        router.refresh();
      } else if (tip) {
        const s = state().settings;
        if (!Array.isArray(s.dismissedTips)) s.dismissedTips = [];
        if (!s.dismissedTips.includes(tip)) s.dismissedTips.push(tip);
        save();
        router.refresh();
      }
    },
    'regression:dismiss': () => {
      const rid = el.dataset.rid;
      if (rid) {
        const s = state().settings;
        if (!Array.isArray(s.dismissedRegressions)) s.dismissedRegressions = [];
        if (!s.dismissedRegressions.includes(rid)) s.dismissedRegressions.push(rid);
        save();
        enqueueSettingsSync();
        router.refresh();
      }
    },
    'entry:open': () => openEntry(d.id),
    'entry:edit': () => { const e = state().log.find((x) => x.id === d.id); if (e) openLog(e.type, e); },
    'measure:open': () => openMeasure(d.id || ''),
    'measure:save': () => saveMeasure(d.id),
    'measure:delete': () => { removeMeasure(d.id); sheet.close(); toast('Measurement deleted'); router.refresh(); },
    'notif:enable': () => enableNotifs(),
    'notif:test': () => { notify('Hearth', 'Reminders are working 🤍').then((ok) => { if (!ok) toast('Could not show a notification'); }); },
    'entry:delete': () => {
      const e = state().log.find((x) => x.id === d.id);
      removeEntry(d.id); sheet.close(); router.refresh();
      toast('Entry deleted', () => { if (e) { addEntry(e); router.refresh(); } });
    },
    'toast:undo': () => runUndo(),
    'onboard:theme': () => onboardTheme(d.theme),
    'onboard:photo': () => onboardPhoto(),
    'onboard:finish': () => onboardFinish(),
    'profile:photo': () => profilePhoto(),
    'baby:photo': () => openBabyPhoto(),
    'baby:photo-edit': () => { sheet.close(); profilePhoto(); },
    'toggle': () => toggle(el, d.path),
    'cg:photo': () => caregiverPhoto(d.id),
    'cg:invite': () => inviteCaregiver(),
    'cg:invite-share': () => shareInviteLink(d.url),
    'join:finish': () => joinFinish(d.token),
    'today:edit-done': () => { exitTodayEditMode(); router.refresh(); },
    'cards:edit-done': () => { exitCardEditMode(); router.refresh(); },
    'theme:pick': () => {
      state().settings.theme = d.theme;
      state().baby.theme = d.theme;
      save();
      enqueueBabySync();
      applyTheme();
      router.refresh();
    },
    'app:reset': () => resetConfirm(),
    'stepper:up': () => { if (!_stepperPointerActive) stepValue(d.target, 1); },
    'stepper:down': () => { if (!_stepperPointerActive) stepValue(d.target, -1); },
    'stepper:open': () => openSpinner(el.id),
    'auth:signin': () => beginSignIn(d.provider),
    'auth:signout': () => signOut(() => router.refresh()),
    'auth:resolve': () => resolveConflict(d.choice, d.pending, () => { syncOnce(); router.go('home'); }),
  };
  if (map[a]) { ev.preventDefault(); map[a](); }
});

// keyboard activation for spinbuttons (Enter / Space)
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const el = ev.target.closest('[data-action="stepper:open"]');
  if (el) { ev.preventDefault(); openSpinner(el.id); }
});

function stepValue(id, dir) {
  const el = document.getElementById(id);
  if (!el) return;
  const step = parseFloat(el.dataset.step || 1);
  const min = el.dataset.min !== '' ? parseFloat(el.dataset.min) : -Infinity;
  const max = el.dataset.max !== '' ? parseFloat(el.dataset.max) : Infinity;
  let val = parseFloat(el.dataset.value) || 0;
  val = Math.round((val + dir * step) * 1e6) / 1e6;
  if (val < min) val = min;
  if (val > max) val = max;
  el.dataset.value = val;
  el.textContent = String(step % 1 !== 0 ? val.toFixed(1) : val);
  el.setAttribute('aria-valuenow', val);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---------- stepper long-press repeat ----------
let _stepperTimer = null;
let _stepperBtn = null;
let _stepperPointerActive = false;

document.addEventListener('pointerdown', (ev) => {
  const btn = ev.target.closest('.stepper-btn');
  if (!btn) return;
  const a = btn.dataset.action;
  if (a !== 'stepper:up' && a !== 'stepper:down') return;
  ev.preventDefault();
  const dir = a === 'stepper:up' ? 1 : -1;
  const target = btn.dataset.target;
  _stepperBtn = btn;
  _stepperPointerActive = true;
  btn.classList.add('pressing');
  stepValue(target, dir);
  const repeat = () => { stepValue(target, dir); _stepperTimer = setTimeout(repeat, 75); };
  _stepperTimer = setTimeout(repeat, 450);
}, { passive: false });

function _cancelStepperRepeat() {
  if (_stepperTimer) { clearTimeout(_stepperTimer); _stepperTimer = null; }
  if (_stepperBtn) { _stepperBtn.classList.remove('pressing'); _stepperBtn = null; }
  // Defer clearing pointer flag so the click handler can check it synchronously
  requestAnimationFrame(() => { _stepperPointerActive = false; });
}
document.addEventListener('pointerup', _cancelStepperRepeat);
document.addEventListener('pointercancel', _cancelStepperRepeat);

// ---------- long-press to enter edit modes ----------
let suppressClickUntil = 0;
let lpTimer = null, lpStartX = 0, lpStartY = 0, lpActive = false;
const LONGPRESS = { today: enterTodayEditMode, cards: enterCardEditMode };
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const target = e.target.closest('[data-longpress]');
  if (!target) return;
  const enter = LONGPRESS[target.dataset.longpress];
  if (!enter) return;
  lpStartX = e.clientX; lpStartY = e.clientY; lpActive = true;
  clearTimeout(lpTimer);
  lpTimer = setTimeout(() => {
    if (!lpActive) return;
    lpActive = false;
    if (enter()) {
      suppressClickUntil = Date.now() + 400;
      router.refresh();
      buzz(12);
    }
  }, 480);
});
document.addEventListener('pointermove', (e) => {
  if (!lpActive) return;
  if (Math.abs(e.clientX - lpStartX) > 10 || Math.abs(e.clientY - lpStartY) > 10) { lpActive = false; clearTimeout(lpTimer); }
});
['pointerup', 'pointercancel'].forEach((evt) => document.addEventListener(evt, () => { lpActive = false; clearTimeout(lpTimer); }));

// ---------- drag-to-reorder cards (independent of long-press) ----------
let dragKey = null;
document.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.ic-edit.drag'); if (!handle) return;
  // Cancel any pending long-press so holding a drag handle doesn't re-trigger edit mode mid-drag.
  lpActive = false; clearTimeout(lpTimer);
  dragKey = handle.dataset.card;
  handle.setPointerCapture(e.pointerId);
  handle.closest('.info-card').classList.add('dragging');
});
document.addEventListener('pointermove', (e) => {
  if (!dragKey) return;
  const stack = $('.info-stack'); if (!stack) return;
  const dragging = stack.querySelector('.info-card.dragging'); if (!dragging) return;
  const cards = [...stack.querySelectorAll('.info-card')];
  const dragIdx = cards.indexOf(dragging);
  const over = cards.find((el) => {
    if (el === dragging) return false;
    const r = el.getBoundingClientRect();
    return e.clientY > r.top && e.clientY < r.bottom;
  });
  if (!over) return;
  // Direction-based insertion: dragging down → place after over; dragging up → place before.
  // No midpoint threshold — avoids the dead zone that trapped the first card.
  stack.insertBefore(dragging, dragIdx < cards.indexOf(over) ? over.nextSibling : over);
});
['pointerup', 'pointercancel'].forEach((evt) => document.addEventListener(evt, () => {
  if (!dragKey) return;
  dragKey = null;
  const stack = $('.info-stack'); if (!stack) return;
  state().settings.cards.order = [...stack.querySelectorAll('.info-card')].map((el) => el.dataset.card);
  save(); enqueueSettingsSync();
  const d = stack.querySelector('.info-card.dragging'); if (d) d.classList.remove('dragging');
}));

// ---------- pull-to-refresh ----------
// Permanent non-passive listener — pointermove fires before touchmove, so by the
// time this runs ptrPulling already reflects direction. Zero cost on normal scroll.
function blockScroll(e) { if ((ptrActive && ptrPulling) || dragKey) e.preventDefault(); }
document.addEventListener('touchmove', blockScroll, { passive: false });

let ptrActive = false, ptrPid = null, ptrStartY = 0, ptrArmed = false, ptrSyncing = false, ptrTimeout = null;
let ptrPulling = false, ptrRafId = null, ptrLatestY = 0;
const PTR_THRESHOLD = 70; // visual px to arm refresh
const PTR_MAX = 80;       // visual px cap
// Must match .ptr-wrap height in CSS: PTR_MAX (80) + padding-bottom (12).
const PTR_WRAP_H = PTR_MAX + 12;

function ptrDist(raw) {
  // Two-phase resistance: 1:1 until 40px, then 0.5 damping.
  return raw <= 40 ? raw : 40 + (raw - 40) * 0.5;
}

function ptrUpdate() {
  ptrRafId = null;
  if (!ptrActive) return;
  const dist = Math.min(PTR_MAX, ptrDist(ptrLatestY - ptrStartY));
  const ptr = document.getElementById('ptr');
  if (!ptr) return;
  ptr.style.transition = 'none';
  ptr.style.transform = `translateY(${dist - PTR_WRAP_H}px)`;
  const spinner = ptr.querySelector('.ptr-spinner');
  if (spinner) {
    spinner.style.transform = `rotate(${(dist / PTR_MAX) * 270}deg)`;
    spinner.style.opacity = String(Math.min(1, dist / 28));
  }
  if (!ptrArmed && dist >= PTR_THRESHOLD) { ptrArmed = true; buzz(12); }
}

function ptrReset() {
  if (ptrRafId) { cancelAnimationFrame(ptrRafId); ptrRafId = null; }
  const ptr = document.getElementById('ptr');
  if (!ptr) return;
  ptr.classList.remove('ptr-spinning');
  const spinner = ptr.querySelector('.ptr-spinner');
  if (spinner && parseFloat(spinner.style.opacity) > 0) {
    ptr.classList.add('ptr-releasing');
    requestAnimationFrame(() => {
      spinner.style.transform = 'rotate(0deg)';
      spinner.style.opacity = '0';
      const cleanup = () => {
        ptr.classList.remove('ptr-releasing');
        spinner.style.transform = '';
        spinner.style.opacity = '';
      };
      spinner.addEventListener('transitionend', cleanup, { once: true });
      setTimeout(cleanup, 700);
    });
  }
  ptr.style.transition = 'transform .3s ease-out';
  ptr.style.transform = `translateY(-${PTR_WRAP_H}px)`;
}

function ptrCollapse() {
  if (!ptrSyncing) return;
  ptrSyncing = false;
  clearTimeout(ptrTimeout);
  ptrReset();
}

document.addEventListener('pointerdown', (e) => {
  if (ptrSyncing || e.pointerType === 'mouse') return;
  const screen = e.target.closest('.screen');
  if (!screen || screen.scrollTop > 0) return;
  ptrActive = true; ptrPid = e.pointerId; ptrStartY = e.clientY; ptrArmed = false; ptrPulling = false; ptrLatestY = e.clientY;
});
document.addEventListener('pointermove', (e) => {
  if (!ptrActive || e.pointerId !== ptrPid) return;
  const raw = e.clientY - ptrStartY;
  // Moving up (or no movement) = user is scrolling; flip off pulling so blockScroll
  // won't preventDefault and will let the browser scroll freely.
  if (raw <= 0) { ptrPulling = false; if (raw < 0) ptrActive = false; return; }
  ptrPulling = true;
  ptrLatestY = e.clientY;
  if (!ptrRafId) ptrRafId = requestAnimationFrame(ptrUpdate);
});
['pointerup', 'pointercancel'].forEach((evt) => document.addEventListener(evt, (e) => {
  if (!ptrActive || e.pointerId !== ptrPid) return;
  ptrActive = false; ptrPid = null; ptrPulling = false;
  if (ptrArmed && !ptrSyncing) {
    ptrArmed = false;
    ptrSyncing = true;
    const ptr = document.getElementById('ptr');
    if (ptr) { ptr.style.transition = 'none'; ptr.style.transform = 'translateY(0)'; ptr.classList.add('ptr-spinning'); }
    ptrTimeout = setTimeout(ptrCollapse, 4000);
    syncOnce().then(ptrCollapse);
  } else {
    ptrArmed = false;
    ptrReset();
  }
}));

// change/input binders
document.addEventListener('change', (ev) => {
  const b = ev.target.closest('[data-bind]');
  if (b) { setPath(b.dataset.bind, ev.target.value); if (b.dataset.bind === 'baby.theme' || b.dataset.bind === 'settings.theme') applyTheme(); }
});

function toggle(el, path) {
  const val = !getPath(path);
  setPath(path, val);
  el.classList.toggle('on', val); el.setAttribute('aria-checked', val);
}
function addMed() {
  const list = $('#med-list'); if (!list) return;
  const empty = $('.empty-note', list); if (empty) empty.remove();
  const id = 'm' + Date.now().toString(36);
  list.insertAdjacentHTML('beforeend', medRow({ id, name: '', dose: '1', unit: '', everyH: 24 }));
}
function shareInviteLink(url) {
  if (navigator.share) {
    navigator.share({ title: 'Join us on Hearth', url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => toast('Link copied'));
  }
}
async function ensureFamily() {
  const baby = state().baby;
  try {
    const res = await fetch('/api/family', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        babyName: baby.name || 'Baby', birthdate: baby.birthdate || '',
        theme: baby.theme || 'girl', caregiverName: baby.caregiver || 'Parent'
      })
    });
    if (res.ok) markSynced();
    else log.warn('sync', 'ensureFamily failed', res.status);
  } catch (e) { log.warn('sync', 'ensureFamily offline', e.message); }
}
async function inviteCaregiver() {
  try {
    let res = await fetch('/api/invites', { method: 'POST', credentials: 'include' });
    if (res.status === 401 && !state().synced) {
      await ensureFamily();
      res = await fetch('/api/invites', { method: 'POST', credentials: 'include' });
    }
    if (res.status === 401) return toast('Finish setup sync before inviting');
    if (!res.ok) return toast('Server error creating the invite — try again');
    const { token } = await res.json();
    const url = location.origin + '/join/' + token;
    sheet.open(`
      <p class="empty-note">Share this link with the person you want to invite. It works once and expires in 48 hours.</p>
      <div class="invite-link">${esc(url)}</div>
      <button class="btn-primary" data-action="cg:invite-share" data-url="${esc(url)}"><svg class="icon"><use href="#share-2"></use></svg> Share link</button>`,
      { title: 'Invite a caregiver' });
  } catch (e) {
    log.warn('invite', 'inviteCaregiver failed', e.message);
    toast('Could not reach the server — check your connection');
  }
}
function caregiverPhoto(caregiverId) {
  if (!caregiverId || caregiverId !== state().currentCaregiverId) return toast('You can change your own photo');
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const sz = 240, cv = document.createElement('canvas'); cv.width = sz; cv.height = sz;
        const cx = cv.getContext('2d'); const s = Math.min(img.width, img.height);
        cx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, sz, sz);
        const photo = cv.toDataURL('image/jpeg', 0.82);
        const caregivers = caregiversSnapshot().map((c) => c.id === caregiverId ? { ...c, photo } : c);
        state().caregivers = caregivers;
        save();
        router.refresh();
        try {
          const res = await fetch('/api/caregivers/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ photo }) });
          if (!res.ok) toast('Could not sync caregiver photo');
        } catch (e) {
          toast('Caregiver photo saved on this device');
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  };
  inp.click();
}

function profilePhoto() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sz = 240, cv = document.createElement('canvas'); cv.width = sz; cv.height = sz;
        const cx = cv.getContext('2d'); const s = Math.min(img.width, img.height);
        cx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, sz, sz);
        state().baby.photo = cv.toDataURL('image/jpeg', 0.82); save(); enqueueBabySync(); router.refresh();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  };
  inp.click();
}
function resetConfirm() {
  sheet.open(`<p class="empty-note">This clears all logged activity and setup on this device. This can't be undone.</p>
    <button class="btn-primary danger-btn" data-action="app:reset-confirm"><svg class="icon"><use href="#trash-2"></use></svg> Reset everything</button>
    <button class="btn-ghost" data-action="sheet:close">Cancel</button>`, { title: 'Reset app?' });
}
document.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-action="app:reset-confirm"]')) {
    reset(); sheet.close(); document.body.dataset.theme = 'girl'; init();
  }
});

// ---------- live clock + auto refresh ----------
function tick() {
  if (current === 'home' && $('#view') && !$('#scrim.show')) router.refresh();
}
setInterval(tick, 60000);
setInterval(() => {
  if (current === 'home' && $('#view') && !$('#scrim.show')) refreshOverdueLabels();
}, 15000);

// ---------- init ----------
async function init() {
  applyTheme();

  const launch = new URLSearchParams(location.search).get('launch');
  if (launch) {
    history.replaceState(null, '', '/');
    if (!state().setup) {
      const res = await fetch('/api/launch/' + launch, { credentials: 'include' });
      if (!res.ok) {
        $('#app').innerHTML = `<div class="onboard"><div class="onb-top"><div class="onb-mark"><svg class="icon"><use href="#heart"></use></svg></div><h1 class="onb-title">Install link expired</h1><p class="onb-sub">This install link has expired — ask to be invited again.</p></div></div>`;
        return;
      }
      const syncRes = await fetch('/api/sync', { credentials: 'include' });
      if (!syncRes.ok) {
        $('#app').innerHTML = `<div class="onboard"><div class="onb-top"><div class="onb-mark"><svg class="icon"><use href="#heart"></use></svg></div><h1 class="onb-title">Something went wrong</h1><p class="onb-sub">Could not load your data. Please try again.</p></div></div>`;
        return;
      }
      const data = await syncRes.json();
      applySyncResponse(data);
      state().setup = true;
      save();
    }
  }

  const joinMatch = location.pathname.match(/^\/join\/([^/]+)$/);
  if (joinMatch && !state().setup) {
    $('#app').innerHTML = joinView(joinMatch[1]);
    return;
  }
  if (!state().setup) {
    $('#app').innerHTML = onboarding();
    handleAuthRedirect(null, async () => {
      // signedup on a fresh device: pull the new family down and boot.
      try {
        const syncRes = await fetch('/api/sync', { credentials: 'include' });
        if (syncRes.ok) applySyncResponse(await syncRes.json());
        state().setup = true; save();
      } catch (e) { /* offline — proceed with empty state */ }
      router.boot(); router.go('home');
      syncOnce(); connectEvents();
      toast('Signed in');
    });
  } else {
    router.boot();
    router.go('home');
    handleAuthRedirect(() => router.refresh());
    syncOnce();
    connectEvents();
  }
}

// ---------- PWA ----------
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  let refreshing = false;
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e;
  setTimeout(() => {
    if (!state().setup) return;
    toast('Add Hearth to your home screen');
    const t = $('#toast'); if (t) { t.innerHTML += `<button data-action="pwa:install">Install</button>`; }
  }, 2500);
});
document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-action="pwa:install"]') && deferredPrompt) {
    $('#toast').classList.remove('show'); deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null;
  }
});

// ---------- server sync loop ----------
async function syncOnce() {
  if (document.visibilityState === 'hidden') return;
  log.info('sync', 'start');
  const drained = await drainOutbox(fetch);
  if (!drained) { log.warn('sync', 'outbox drain failed — aborting pull'); return; }
  try {
    const res = await fetch('/api/sync?since=' + encodeURIComponent(getLastSync()), { credentials: 'include' });
    if (!res.ok) { log.warn('sync', 'pull failed', res.status); return; }
    const data = await res.json();
    const n = syncChangeCount(data);
    applySyncResponse(data);
    setLastSync(data.serverTime);
    log.info('sync', `OK — ${n} row${n !== 1 ? 's' : ''} from server`);
    if (n > 0 && (current !== 'home' || $('#view'))) router.refresh();
  } catch (e) {
    log.warn('sync', 'syncOnce failed', e.message);
  }
}

let eventSource = null;
function connectEvents() {
  if (eventSource || !('EventSource' in window)) return;
  log.info('sync', 'SSE connecting…');
  eventSource = new EventSource('/api/events');
  eventSource.onopen = () => log.info('sync', 'SSE connected');
  eventSource.onmessage = () => { log.info('sync', 'SSE push — syncing'); syncOnce(); };
  eventSource.onerror = () => { log.warn('sync', 'SSE error, reconnecting in 5s'); eventSource.close(); eventSource = null; setTimeout(connectEvents, 5000); };
}

window.addEventListener('online', syncOnce);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  syncOnce();
  if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
    eventSource?.close();
    eventSource = null;
    connectEvents();
  }
});
setInterval(syncOnce, 15000);
setSyncTrigger(() => { drainOutbox(); syncOnce(); });

document.addEventListener('DOMContentLoaded', init);
