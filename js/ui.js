// ui.js: formatting, icon map, sheet/modal machinery, toast, theme.
import { state } from './store.js';
import { log } from './log.js';

// ---------- formatting ----------
const pad = (n) => String(n).padStart(2, '0');
export const fmt = {
  clock(d) {
    d = new Date(d);
    let h = d.getHours(), m = d.getMinutes();
    if (state().settings.clock24 === '24h') return pad(h) + ':' + pad(m);
    const ap = h < 12 ? 'AM' : 'PM';
    h = h % 12 || 12;
    return h + ':' + pad(m) + ' ' + ap;
  },
  dur(min) {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60), m = min % 60;
    if (h <= 0) return m + 'm';
    if (m === 0) return h + 'h';
    return h + 'h ' + m + 'm';
  },
  durBig(min) {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60), m = min % 60;
    return { h, m };
  },
  rel(d) {
    const diff = (Date.now() - new Date(d)) / 60000;
    if (diff < 1) return 'just now';
    if (diff < 60) return Math.round(diff) + 'm ago';
    const h = diff / 60;
    if (h < 24) return Math.round(h) + 'h ago';
    return Math.round(h / 24) + 'd ago';
  },
  untilOrAgo(d) {
    const diff = (new Date(d) - Date.now()) / 60000;
    if (Math.abs(diff) < 1) return 'now';
    if (diff > 0) return 'in ' + fmt.dur(diff);
    return fmt.dur(-diff) + ' ago';
  },
  vol(ml) {
    if (state().settings.units.volume === 'oz') return (ml / 29.5735).toFixed(1) + ' oz';
    return Math.round(ml) + ' ml';
  }
};

// type → icon + label + tone class
export const TYPES = {
  sleep:    { icon: 'icon-sleep',    label: 'Sleep',    tone: 'sleep'  },
  feed:     { icon: 'icon-feed',     label: 'Nursing',  tone: 'feed'   },
  bottle:   { icon: 'icon-bottle',   label: 'Bottle',   tone: 'feed'   },
  diaper:   { icon: 'icon-diaper',   label: 'Diaper',   tone: 'diaper' },
  medicine: { icon: 'icon-medicine', label: 'Medicine', tone: 'med'    },
  pump:     { icon: 'drop-half',     label: 'Pump',     tone: 'feed'   },
  note:     { icon: 'note-pencil',   label: 'Note',     tone: 'note'   },
  play:     { icon: 'icon-play',     label: 'Play',     tone: 'play'   },
  bath:     { icon: 'icon-bath',     label: 'Bath',     tone: 'bath'   },
  hygiene:  { icon: 'icon-hygiene',  label: 'Hygiene',  tone: 'hygiene' },
};
// Phosphor fallback for icons that may not exist
export function icon(name) {
  const map = { 'baby-bottle': 'milk', 'drop-half': 'droplet', 'pill': 'pill', 'note-pencil': 'notebook-pen' };
  return map[name] || name;
}
export function diaperIcon(kind) {
  if (kind === 'Dirty') return 'turtle';
  if (kind === 'Mixed') return 'layers';
  return 'icon-diaper';
}

// ---------- DOM helper ----------
export const $ = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
const _escChars = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => _escChars[c]);

export function positionThumb(group) {
  const thumb = group.querySelector('.seg-thumb');
  const active = group.querySelector('.seg-opt.on');
  if (!thumb || !active) return;
  const firstOpt = group.querySelector('.seg-opt');
  thumb.style.width = active.offsetWidth + 'px';
  thumb.style.transform = `translateX(${active.offsetLeft - firstOpt.offsetLeft}px)`;
  const opts = $$('.seg-opt', group);
  const idx = opts.indexOf(active);
  thumb.style.setProperty('--glare', opts.length > 1 ? idx / (opts.length - 1) : 0.5);
}

export function bindDragSeg(el) {
  if (el._dragBound) return;
  el._dragBound = true;
  const LONG_PRESS_MS = 280;
  const MOVE_THRESHOLD = 4;
  let timer = null, dragging = false, startX = 0;

  function optionAt(x) {
    let nearest = null, bestDist = Infinity;
    el.querySelectorAll('.seg-opt').forEach((o) => {
      const r = o.getBoundingClientRect();
      const dist = Math.abs(x - (r.left + r.width / 2));
      if (dist < bestDist) { bestDist = dist; nearest = o; }
    });
    return nearest;
  }

  function highlight(active) {
    el.querySelectorAll('.seg-opt').forEach((o) => {
      o.classList.toggle('on', o === active);
      o.style.opacity = (active && o !== active) ? '0.55' : '';
    });
  }

  function bouncePill(pill) {
    if (!pill) return;
    pill.style.transition = 'none';
    pill.style.transform = 'scale(1.14)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pill.style.transition = 'transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1)';
      pill.style.transform = '';
    }));
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX = e.clientX; dragging = false;
    timer = setTimeout(() => {
      dragging = true;
      el.setPointerCapture(e.pointerId);
      bouncePill(el.querySelector('.seg-thumb'));
      highlight(optionAt(e.clientX));
    }, LONG_PRESS_MS);
  });

  el.addEventListener('pointermove', (e) => {
    if (!dragging) {
      if (Math.abs(e.clientX - startX) > MOVE_THRESHOLD && timer) { clearTimeout(timer); timer = null; }
      return;
    }
    e.stopPropagation();
    highlight(optionAt(e.clientX));
  });

  function resetOpts() {
    el.querySelectorAll('.seg-opt').forEach((o) => { o.style.opacity = ''; o.style.transform = ''; o.style.transition = ''; });
  }

  function release() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dragging) return;
    dragging = false;
    resetOpts();
    // Fire a synthetic click on the settled option so data-bind-seg paths update
    const active = el.querySelector('.seg-opt.on');
    if (active) active.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    positionThumb(el);
  }

  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', () => { if (timer) { clearTimeout(timer); timer = null; } dragging = false; resetOpts(); });
}

export function initThumbs(container) {
  $$('.segctl', container).forEach(group => {
    const thumb = group.querySelector('.seg-thumb');
    if (!thumb) return;
    thumb.style.transition = 'none';
    positionThumb(group);
    requestAnimationFrame(() => { thumb.style.transition = ''; });
    bindDragSeg(group);
  });
}

// ---------- theme ----------
export function resolveMode() {
  const m = state().settings.darkMode || 'auto';
  if (m === 'auto') return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  return m;
}
export const THEME_COLORS = {
  girl:          { light: '#f3eee0', dark: '#211f17' },
  boy:           { light: '#eef0e4', dark: '#1c1f1b' },
  'dayjob-girl': { light: '#f3ead9', dark: '#221d17' },
  'dayjob-boy':  { light: '#f3ead9', dark: '#221d17' },
  dayjob:        { light: '#f3ead9', dark: '#221d17' }
};
export function applyTheme() {
  const st = state();
  const t = st.settings.theme || st.baby.theme || 'girl';
  const mode = resolveMode();
  document.body.dataset.theme = t;
  document.body.dataset.mode = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const c = THEME_COLORS[t] || THEME_COLORS.girl;
    meta.content = mode === 'dark' ? c.dark : c.light;
  }
  log.event('theme', 'apply', t, mode);
}
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((state().settings.darkMode || 'auto') === 'auto') applyTheme();
  });
}

// ---------- toast ----------
let toastTimer;
let _undo = null;
export function toast(msg, undo, label = 'Undo') {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('data-action', 'toast:dismiss'); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(msg)}</span>` +
    (undo ? `<button data-action="toast:undo">${esc(label)}</button>` : '');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 4500 : 2200);
  _undo = undo || null;
}
export function runUndo() {
  if (_undo) { _undo(); _undo = null; }
  const el = $('#toast'); if (el) el.classList.remove('show');
}
export function dismissToast() {
  clearTimeout(toastTimer);
  _undo = null;
  const el = $('#toast'); if (el) el.classList.remove('show');
}

// ---------- bottom sheet ----------
let sheetCloseTimer = null;
export const sheet = {
  open(html, opts = {}) {
    // A sheet opened while the previous one's close() cleanup timer is still
    // pending would otherwise have its just-written content wiped out when
    // that stale timer fires — cancel it before writing the new sheet.
    clearTimeout(sheetCloseTimer);
    const host = $('.phone') || document.body;
    let scrim = $('#scrim');
    if (!scrim) { scrim = document.createElement('div'); scrim.id = 'scrim'; scrim.className = 'scrim'; }
    if (scrim.parentNode !== host) host.appendChild(scrim);
    scrim.innerHTML = `<div class="sheet ${opts.size || ''}" role="dialog" aria-modal="true">
        <div class="sheet-grab"></div>
        ${opts.title ? `<div class="sheet-hd"><h3>${esc(opts.title)}</h3><button class="x" data-action="sheet:close" aria-label="Close"><svg class="icon"><use href="#x"></use></svg></button></div>` : ''}
        <div class="sheet-body">${html}</div>
      </div>`;
    const sheetEl = scrim.querySelector('.sheet');
    if (sheetEl) {
      sheetEl.classList.add('sheet-opening');
      sheetEl.addEventListener('transitionend', () => sheetEl.classList.remove('sheet-opening'), { once: true });
    }
    requestAnimationFrame(() => { scrim.classList.add('show'); initThumbs(scrim); });
    scrim.onclick = (e) => { if (e.target === scrim) sheet.close(); };
    bindSwipe(scrim);
  },
  close() {
    const scrim = $('#scrim');
    if (!scrim) return;
    scrim.classList.remove('show');
    clearTimeout(sheetCloseTimer);
    sheetCloseTimer = setTimeout(() => { if (scrim) scrim.innerHTML = ''; }, 280);
    document.dispatchEvent(new CustomEvent('sheet:closed'));
  }
};

// ---------- swipe-down-to-dismiss ----------
// Drag is always live from the grab handle / header (both touch-action:none).
// From the rest of the sheet it only engages once scrolled to the top, so it
// never fights native scrolling of long forms.
function bindSwipe(scrim) {
  const sheetEl = scrim.querySelector('.sheet');
  if (!sheetEl) return;
  const grab = sheetEl.querySelector('.sheet-grab');
  const hd = sheetEl.querySelector('.sheet-hd');
  let startY = 0, dy = 0, dragging = false, active = false, pid = null;

  const eligible = (target) =>
    (grab && grab.contains(target)) ||
    (hd && hd.contains(target) && !target.closest('[data-action="sheet:close"]')) ||
    sheetEl.scrollTop <= 0;

  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!eligible(e.target)) return;
    startY = e.clientY; dy = 0; active = true; dragging = false; pid = e.pointerId;
  };
  const onMove = (e) => {
    if (!active || e.pointerId !== pid) return;
    dy = e.clientY - startY;
    if (!dragging) {
      if (dy < 8) return;
      dragging = true;
      sheetEl.setPointerCapture(pid);
      sheetEl.style.transition = 'none';
    }
    e.preventDefault();
    sheetEl.style.transform = `translateY(${Math.max(0, dy)}px)`;
  };
  const onUp = (e) => {
    if (!active || e.pointerId !== pid) return;
    active = false;
    if (dragging) {
      const pos = Math.max(0, dy);
      sheetEl.style.transition = '';
      if (pos > sheetEl.offsetHeight * 0.22 || pos > 130) {
        sheetEl.style.transition = 'transform .22s ease-in';
        sheetEl.style.transform = `translateY(${sheetEl.offsetHeight + 80}px)`;
        sheet.close();
      } else {
        sheetEl.style.transform = '';
      }
    }
    dragging = false;
  };

  sheetEl.addEventListener('pointerdown', onDown);
  sheetEl.addEventListener('pointermove', onMove);
  sheetEl.addEventListener('pointerup', onUp);
  sheetEl.addEventListener('pointercancel', onUp);
}

// datetime-local helpers
export function nowLocalDT() {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
export function dtToISO(local) { return local ? new Date(local).toISOString() : new Date().toISOString(); }
export function isoToLocalDT(iso) {
  const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
