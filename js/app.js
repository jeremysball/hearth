// app.js — shell, router, event delegation, binders, PWA.
import { state, save, reset, addEntry, removeEntry, removeMeasure, enqueueBabySync, enqueueSettingsSync, applySyncResponse, markSynced } from './store.js';
import { drainOutbox, getLastSync, setLastSync } from './sync.js';
import { $, $$, esc, fmt, applyTheme, toast, runUndo, sheet, positionThumb } from './ui.js';
import { log } from './log.js';
import { home, summary, enterTodayEditMode, exitTodayEditMode, enterCardEditMode, exitCardEditMode } from './home.js';
import { trends } from './trends.js';
import { sleep } from './sleep.js';
import { growth } from './growth.js';
import { profile, loadCaregivers, caregiversSnapshot } from './profile.js';
import { onboarding, onboardTheme, onboardPhoto, onboardFinish } from './onboarding.js';
import { joinView, joinFinish } from './join.js';
import { openLog, saveLog, openTypeChooser, editCard, saveBottle, saveMeds, hideCard, showCard, openMeasure, saveMeasure, medRow, openSpinner } from './sheets.js';
import { enableNotifs, notify } from './reminders.js';
import { animateGrow, buzz } from './fx.js';

let current = 'home';
const VIEWS = { home, trends, sleep, growth, profile };

const TABS = [
  { v: 'home', icon: 'house', label: 'Home' }, { v: 'sleep', icon: 'moon', label: 'Sleep' },
  { v: 'trends', icon: 'chart-bar', label: 'Trends' }, { v: 'growth', icon: 'ruler', label: 'Growth' },
  { v: 'profile', icon: 'user', label: 'Profile' }
];

let homeEntered = false;
function enterHome() {
  homeEntered = true;
  document.querySelectorAll('#view .track i').forEach((el) => {
    animateGrow(el, [{ width: '0%' }, { width: el.style.width }], 0, 'ease-out');
  });
}

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

function shell() {
  return `<main class="phone app">
    <div id="ptr" class="ptr-wrap"><svg class="icon ptr-spinner"><use href="#refresh-cw"></use></svg></div>
    <div id="view" class="screen"></div>
    <nav class="tabbar">${TABS.map((t) => `<button class="tab" data-action="nav:${t.v}" data-tab="${t.v}" aria-label="${t.label}"><svg class="icon"><use href="#${t.icon}"></use></svg></button>`).join('')}</nav>
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
    const v = $('#view');
    if (!v) { router.boot(); }
    $('#view').innerHTML = VIEWS[view]();
    $('#view').scrollTop = 0;
    $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === view));
    if (view === 'home' && !homeEntered) enterHome();
    else if (view === 'trends') enterTrends();
    else if (view === 'sleep') enterSleep();
    else if (view === 'growth') enterGrowth();
  },
  refresh() { if ($('#view')) $('#view').innerHTML = VIEWS[current]({}); $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === current)); }
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
  sheet.open(`
    <div class="entry-view">
      <span class="ic-ring ${s.tone}"><svg class="icon"><use href="#${s.icon}"></use></svg></span>
      <div><div class="entry-title">${esc(s.label)}</div><div class="entry-sub">${esc(s.detail)}${s.meta ? ' · ' + esc(s.meta) : ''}</div></div>
    </div>
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
    'nav:profile': () => { router.go('profile'); loadCaregivers().then(() => { if (current === 'profile') router.refresh(); }); },
    'log:open': () => openLog(d.type),
    'log:more': () => openTypeChooser(),
    'log:save': () => saveLog(d.type, d.id),
    'sheet:close': () => sheet.close(),
    'card:edit': () => editCard(d.card),
    'card:show': () => showCard(d.card),
    'card:hide': () => hideCard(d.card),
    'card:save-bottle': () => saveBottle(),
    'card:save-meds': () => saveMeds(),
    'med:add': () => addMed(),
    'med:remove': () => { const r = $(`.med-edit[data-mid="${d.mid}"]`); if (r) r.remove(); },
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
    'stepper:open': () => openSpinner(el.id)
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
let ptrActive = false, ptrPid = null, ptrStartY = 0, ptrArmed = false, ptrSyncing = false, ptrTimeout = null;
const PTR_THRESHOLD = 70; // visual px to arm refresh
const PTR_MAX = 80;       // visual px cap

function ptrDist(raw) {
  // Two-phase resistance: 1:1 until 40px, then 0.5 damping.
  // Threshold (70px) reached at raw=100; cap (80px) at raw=120.
  return raw <= 40 ? raw : 40 + (raw - 40) * 0.5;
}

function ptrReset() {
  const ptr = document.getElementById('ptr');
  if (!ptr) return;
  ptr.classList.remove('ptr-spinning');
  const spinner = ptr.querySelector('.ptr-spinner');
  if (spinner && parseFloat(spinner.style.opacity) > 0) {
    ptr.classList.add('ptr-releasing');
    // rAF ensures .ptr-releasing transition is painted before we mutate transform/opacity
    requestAnimationFrame(() => {
      spinner.style.transform = 'rotate(0deg)';
      spinner.style.opacity = '0';
      const cleanup = () => {
        ptr.classList.remove('ptr-releasing');
        spinner.style.transform = '';
        spinner.style.opacity = '';
      };
      spinner.addEventListener('transitionend', cleanup, { once: true });
      setTimeout(cleanup, 700); // fallback if transitionend doesn't fire
    });
  }
  ptr.style.transition = 'height .3s ease-out';
  ptr.style.height = '0';
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
  ptrActive = true; ptrPid = e.pointerId; ptrStartY = e.clientY; ptrArmed = false;
});
// Non-passive touchmove blocks the browser's scroll-claim so pointercancel never fires mid-pull or mid-drag.
document.addEventListener('touchmove', (e) => { if (ptrActive || dragKey) e.preventDefault(); }, { passive: false });
document.addEventListener('pointermove', (e) => {
  if (!ptrActive || e.pointerId !== ptrPid) return;
  const raw = e.clientY - ptrStartY;
  if (raw < 0) { ptrActive = false; return; }
  const dist = Math.min(PTR_MAX, ptrDist(raw));
  const ptr = document.getElementById('ptr');
  if (!ptr) return;
  ptr.style.transition = 'none';
  ptr.style.height = dist + 'px';
  const spinner = ptr.querySelector('.ptr-spinner');
  if (spinner) {
    spinner.style.transform = `rotate(${(dist / PTR_MAX) * 270}deg)`;
    spinner.style.opacity = String(Math.min(1, dist / 28));
  }
  if (!ptrArmed && dist >= PTR_THRESHOLD) {
    ptrArmed = true;
    buzz(12);
  }
});
['pointerup', 'pointercancel'].forEach((evt) => document.addEventListener(evt, (e) => {
  if (!ptrActive || e.pointerId !== ptrPid) return;
  ptrActive = false; ptrPid = null;
  if (ptrArmed && !ptrSyncing) {
    ptrArmed = false;
    ptrSyncing = true;
    document.getElementById('ptr')?.classList.add('ptr-spinning');
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
  } else {
    router.boot();
    router.go('home');
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
  log.info('sync', 'start');
  const drained = await drainOutbox(fetch);
  if (!drained) { log.warn('sync', 'outbox drain failed — aborting pull'); return; }
  try {
    const res = await fetch('/api/sync?since=' + encodeURIComponent(getLastSync()), { credentials: 'include' });
    if (!res.ok) { log.warn('sync', 'pull failed', res.status); return; }
    const data = await res.json();
    const n = (data.log?.length || 0) + (data.measures?.length || 0);
    applySyncResponse(data);
    setLastSync(data.serverTime);
    log.info('sync', `OK — ${n} row${n !== 1 ? 's' : ''} from server`);
    if (current !== 'home' || $('#view')) router.refresh();
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
setInterval(syncOnce, 30000);

document.addEventListener('DOMContentLoaded', init);
