// app.js — shell, router, event delegation, binders, PWA.
import { state, save, reset, addEntry, removeEntry, removeMeasure, enqueueBabySync, enqueueSettingsSync, applySyncResponse } from './store.js';
import { drainOutbox, getLastSync, setLastSync } from './sync.js';
import { $, $$, esc, fmt, applyTheme, toast, runUndo, sheet } from './ui.js';
import { home, summary, enterTodayEditMode, exitTodayEditMode } from './home.js';
import { trends } from './trends.js';
import { sleep } from './sleep.js';
import { growth } from './growth.js';
import { profile, cgRow } from './profile.js';
import { onboarding, onboardTheme, onboardPhoto, onboardFinish } from './onboarding.js';
import { joinView, joinFinish } from './join.js';
import { openLog, saveLog, openTypeChooser, editCard, saveBottle, saveMeds, hideCard, showCard, openMeasure, saveMeasure, medRow } from './sheets.js';
import { enableNotifs, notify } from './reminders.js';

let current = 'home';
const VIEWS = { home, trends, sleep, growth, profile };

const TABS = [
  { v: 'home', icon: 'house', label: 'Home' }, { v: 'sleep', icon: 'moon', label: 'Sleep' },
  { v: 'trends', icon: 'chart-bar', label: 'Trends' }, { v: 'growth', icon: 'ruler', label: 'Growth' },
  { v: 'profile', icon: 'user', label: 'Profile' }
];

function shell() {
  return `<main class="phone app">
    <div class="statusbar"><span>${fmt.clock(new Date())}</span><span class="dots"><span></span><span></span><span></span></span></div>
    <div id="view" class="screen"></div>
    <nav class="tabbar">${TABS.map((t) => `<button class="tab" data-action="nav:${t.v}" data-tab="${t.v}" aria-label="${t.label}"><i class="ph ph-${t.icon}"></i></button>`).join('')}</nav>
  </main>`;
}

export const router = {
  boot() {
    $('#app').innerHTML = shell();
  },
  go(view) {
    exitTodayEditMode();
    current = view;
    const v = $('#view');
    if (!v) { router.boot(); }
    $('#view').innerHTML = VIEWS[view]();
    $('#view').scrollTop = 0;
    $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === view));
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
  else if (path.startsWith('settings.') && path !== 'settings.darkMode') enqueueSettingsSync();
}
function getPath(path) { return path.split('.').reduce((o, k) => (o ? o[k] : undefined), state()); }

// ---------- entry detail ----------
function openEntry(id) {
  const e = state().log.find((x) => x.id === id); if (!e) return;
  const s = summary(e);
  sheet.open(`
    <div class="entry-view">
      <span class="ic-ring ${s.tone}"><i class="ph ph-${s.icon}"></i></span>
      <div><div class="entry-title">${esc(s.label)}</div><div class="entry-sub">${esc(s.detail)}${s.meta ? ' · ' + esc(s.meta) : ''}</div></div>
    </div>
    ${e.note ? `<div class="entry-note">${esc(e.note)}</div>` : ''}
    <button class="btn-primary" data-action="entry:edit" data-id="${e.id}"><i class="ph ph-pencil-simple"></i> Edit entry</button>
    <button class="btn-ghost danger" data-action="entry:delete" data-id="${e.id}"><i class="ph ph-trash"></i> Delete entry</button>`,
    { title: 'Entry' });
}

function openBabyPhoto() {
  const b = state().baby;
  sheet.open(`
    <div class="photo-view">
      ${b.photo ? `<img src="${esc(b.photo)}" alt="${esc(b.name || 'Baby')}" />` : `<span class="avatar lg">${esc((b.name || 'B')[0].toUpperCase())}</span>`}
    </div>
    <button class="btn-primary" data-action="baby:photo-edit"><i class="ph ph-camera"></i> Change photo</button>`,
    { title: b.name || 'Baby' });
}

// ---------- click delegation ----------
document.addEventListener('click', (ev) => {
  if (Date.now() < suppressClickUntil) { ev.preventDefault(); ev.stopPropagation(); return; }
  // segmented visual toggle (+persist if bound)
  const opt = ev.target.closest('.seg-opt');
  if (opt) {
    const group = opt.closest('.segctl');
    if (group) {
      $$('.seg-opt', group).forEach((b) => b.classList.remove('on'));
      opt.classList.add('on');
      const bind = group.dataset.bindSeg;
      if (bind) { setPath(bind, opt.dataset.val); if (bind === 'baby.theme' || bind === 'settings.darkMode') applyTheme(); }
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
    'nav:profile': () => router.go('profile'),
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
    'cg:add': () => cgAdd(),
    'cg:remove': () => cgRemove(d.cgi),
    'cg:confirm': () => cgConfirm(d.cgi),
    'cg:discard': () => cgDiscard(d.cgi),
    'join:finish': () => joinFinish(d.token),
    'today:edit-done': () => { exitTodayEditMode(); router.refresh(); },
    'app:reset': () => resetConfirm()
  };
  if (map[a]) { ev.preventDefault(); map[a](); }
});

// ---------- long-press to enter Today edit mode ----------
let suppressClickUntil = 0;
let lpTimer = null, lpStartX = 0, lpStartY = 0, lpActive = false;
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const target = e.target.closest('[data-longpress="today"]');
  if (!target) return;
  lpStartX = e.clientX; lpStartY = e.clientY; lpActive = true;
  clearTimeout(lpTimer);
  lpTimer = setTimeout(() => {
    if (!lpActive) return;
    lpActive = false;
    if (enterTodayEditMode()) {
      suppressClickUntil = Date.now() + 400;
      router.refresh();
      if (navigator.vibrate) navigator.vibrate(12);
    }
  }, 480);
});
document.addEventListener('pointermove', (e) => {
  if (!lpActive) return;
  if (Math.abs(e.clientX - lpStartX) > 10 || Math.abs(e.clientY - lpStartY) > 10) { lpActive = false; clearTimeout(lpTimer); }
});
['pointerup', 'pointercancel'].forEach((evt) => document.addEventListener(evt, () => { lpActive = false; clearTimeout(lpTimer); }));

// change/input binders
document.addEventListener('change', (ev) => {
  const b = ev.target.closest('[data-bind]');
  if (b) { setPath(b.dataset.bind, ev.target.value); if (b.dataset.bind === 'baby.theme') applyTheme(); }
  const row = ev.target.closest('.cg-row');
  if (row && row.dataset.pending === 'true') return; // wait for explicit confirm
  if (ev.target.classList.contains('cg-name')) saveCg();
  if (ev.target.classList.contains('cg-role')) saveCg();
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
function saveCg() {
  const rows = $$('#cg-list .cg-row');
  state().settings.caregivers = rows.map((r) => ({
    name: $('.cg-name', r).value.trim(),
    role: $('.cg-role', r).value
  }));
  save();
}
function cgAdd() {
  const list = $('#cg-list');
  const existingPending = $('.cg-row[data-pending="true"]', list);
  if (existingPending) { $('.cg-name', existingPending).focus(); return; }
  const i = $$('.cg-row', list).length;
  $('.add-row', list).insertAdjacentHTML('beforebegin', cgRow({ name: '', role: 'Parent' }, i, true));
  $(`.cg-row[data-cgi="${i}"] .cg-name`, list).focus();
}
function cgConfirm(i) {
  const row = $(`#cg-list .cg-row[data-cgi="${i}"]`); if (!row) return;
  const nameInput = $('.cg-name', row);
  if (!nameInput.value.trim()) {
    nameInput.focus(); nameInput.classList.add('shake'); setTimeout(() => nameInput.classList.remove('shake'), 500);
    toast('Enter a name'); return;
  }
  saveCg();
  router.refresh();
}
function cgDiscard(i) {
  const row = $(`#cg-list .cg-row[data-cgi="${i}"]`); if (row) row.remove();
}
function cgRemove(i) {
  state().settings.caregivers.splice(Number(i), 1); save(); router.refresh();
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
    <button class="btn-primary danger-btn" data-action="app:reset-confirm"><i class="ph ph-trash"></i> Reset everything</button>
    <button class="btn-ghost" data-action="sheet:close">Cancel</button>`, { title: 'Reset app?' });
}
document.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-action="app:reset-confirm"]')) {
    reset(); sheet.close(); document.body.dataset.theme = 'girl'; init();
  }
});

// ---------- live clock + auto refresh ----------
function tick() {
  const sb = $('.statusbar span'); if (sb) sb.textContent = fmt.clock(new Date());
  if (current === 'home' && $('#view') && !$('#scrim.show')) router.refresh();
}
setInterval(tick, 60000);

// ---------- init ----------
function init() {
  applyTheme();
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
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
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
  const drained = await drainOutbox(fetch);
  if (!drained) return;
  try {
    const res = await fetch('/api/sync?since=' + encodeURIComponent(getLastSync()), { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    applySyncResponse(data);
    setLastSync(data.serverTime);
    if (current !== 'home' || $('#view')) router.refresh();
  } catch (e) {
    // offline or server unreachable; the next trigger (timer/online/SSE) retries
  }
}

let eventSource = null;
function connectEvents() {
  if (eventSource || !('EventSource' in window)) return;
  eventSource = new EventSource('/api/events');
  eventSource.onmessage = () => syncOnce();
  eventSource.onerror = () => { eventSource.close(); eventSource = null; setTimeout(connectEvents, 5000); };
}

window.addEventListener('online', syncOnce);
setInterval(syncOnce, 30000);

document.addEventListener('DOMContentLoaded', init);
