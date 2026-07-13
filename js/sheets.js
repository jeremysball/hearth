// sheets.js: logging bottom sheet (detailed) + card config sheets.
import { state, save, addEntry, removeEntry, updateEntry, addMeasure, enqueueSettingsSync, maybeInterruptSleep, undoInterruptSleep, autoCloseOngoingSleep, undoAutoCloseSleep, derive } from './store.js';
import { $, $$, esc, icon, TYPES, sheet, toast, nowLocalDT, dtToISO, isoToLocalDT, bindDragSeg, positionThumb } from './ui.js';
import { router } from './app.js';
import { chime, tick, buzz, confetti } from './fx.js';
import { addableCardTypes, SIZE_OPTS } from './home.js';

// segmented control
function seg(group, opts, sel) {
  return `<div class="segctl" data-seg="${group}">` +
    `<div class="seg-thumb"></div>` +
    opts.map((o) => {
      const val = typeof o === 'string' ? o : o.val;
      const label = typeof o === 'string' ? o : o.label;
      return `<button type="button" class="seg-opt ${val === sel ? 'on' : ''}" data-val="${esc(val)}">${esc(label)}</button>`;
    }).join('') +
    `</div>`;
}

export function iconGrid(group, opts, sel) {
  return `<div class="icongrid" data-icongrid="${group}">` +
    opts.map((o) => `<button type="button" class="icongrid-opt ${o.val === sel ? 'on' : ''}" data-val="${esc(o.val)}" data-action="icongrid:pick">` +
      `<svg class="icon"><use href="#${esc(o.icon)}"></use></svg><span>${esc(o.label)}</span></button>`).join('') +
    `</div>`;
}
function field(label, inner) { return `<label class="fld"><span class="fld-l">${label}</span>${inner}</label>`; }
function stepperField(label, id, min, max, step, val) {
  return field(label, `<div class="stepper">
    <button type="button" class="stepper-btn" data-action="stepper:down" data-target="${id}" aria-label="Decrease"><svg class="icon"><use href="#minus"></use></svg></button>
    <div class="stepper-val" id="${id}" tabindex="0" role="spinbutton" aria-valuenow="${val}" aria-valuemin="${min != null ? min : ''}" aria-valuemax="${max != null ? max : ''}" data-step="${step}" data-min="${min != null ? min : ''}" data-max="${max != null ? max : ''}" data-value="${val}" data-action="stepper:open">${val}</div>
    <button type="button" class="stepper-btn" data-action="stepper:up" data-target="${id}" aria-label="Increase"><svg class="icon"><use href="#plus"></use></svg></button>
  </div>`);
}

export function openSpinner(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const step = parseFloat(el.dataset.step || 1);
  const min = el.dataset.min !== '' ? parseFloat(el.dataset.min) : -Infinity;
  const max = el.dataset.max !== '' ? parseFloat(el.dataset.max) : Infinity;
  let val = parseFloat(el.dataset.value) || 0;

  const ITEM_H = 44;
  const OFF = 7;
  const ANGLE_PER_ITEM = 20;
  const CYLINDER_R = 120;
  const PERSPECTIVE = 800;
  const DEG2RAD = Math.PI / 180;
  // Pre-computed per-item angles (i * ANGLE_PER_ITEM * DEG2RAD): the only thing
  // that changes frame-to-frame inside updateDrum is drumAngle, so we lift the
  // fixed part out of the hot loop and store it in a typed array.
  const itemAngles = new Float64Array(OFF * 2 + 1);
  for (let k = 0; k < itemAngles.length; k++) itemAngles[k] = (k - OFF) * ANGLE_PER_ITEM * DEG2RAD;
  const fmtVal = (v) => String(step % 1 !== 0 ? v.toFixed(1) : v);
  // These closures always reference the current `val`: callers must not cache
  // the result across a commit() call that changes val.
  const pxToVal = (px) => val - (px / ITEM_H) * step;
  const valToPx = (v) => (val - v) / step * ITEM_H;

  let lastCenter = val;
  let offsetY = 0;
  let dragging = false, pid = null, dragged = false, downY = 0, dragY = 0;
  let velSamples = [];
  let rafId = 0;
  let renderPending = false;
  let curVel = 0;   // px/ms during momentum, for buzz gating
  let lastBuzz = 0;
  let snapTimeout = 0; // failsafe: commits within 500ms even if rAF is throttled

  // --- Helpers ---

  function clampValue(v) {
    return Math.min(max, Math.max(min, Math.round(v * 1e6) / 1e6));
  }

  function clampOffset(offset) {
    if (min !== -Infinity) offset = Math.min(valToPx(min), offset);
    if (max !== Infinity)  offset = Math.max(valToPx(max), offset);
    return offset;
  }

  // Rubber-band: allow a decaying overshoot past the boundary during drag/momentum.
  function softClamp(offset) {
    if (min !== -Infinity) {
      const bound = valToPx(min);
      if (offset > bound) offset = bound + (offset - bound) * 0.25;
    }
    if (max !== Infinity) {
      const bound = valToPx(max);
      if (offset < bound) offset = bound + (offset - bound) * 0.25;
    }
    return offset;
  }

  // commit() advances val to v, adjusting offsetY so the visible drum position
  // is unchanged: essential for interrupt-on-pointerdown to work without a jump.
  function commit(v, silent = false) {
    v = clampValue(Math.round(v / step) * step);
    offsetY += (v - val) / step * ITEM_H;
    val = v;
    el.dataset.value = val;
    el.textContent = fmtVal(val);
    el.setAttribute('aria-valuenow', val);
    if (!silent) {
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (state().settings.sound !== false) tick();
    }
  }

  function trackHTML(center) {
    let html = '';
    for (let i = -OFF; i <= OFF; i++) {
      const v = center + i * step;
      const inRange = v >= min && v <= max;
      const cls = i === 0 ? 'spinner-item on' : 'spinner-item';
      html += `<div class="${cls}">${inRange ? fmtVal(v) : ''}</div>`;
    }
    return html;
  }

  // --- DOM setup ---

  const overlay = document.createElement('div');
  overlay.className = 'spinner-overlay';
  overlay.innerHTML = `<div class="spinner-popup">
    <div class="spinner-window">
      <div class="spinner-highlight"></div>
      <div class="spinner-items" id="spinner-items">${trackHTML(val)}</div>
    </div>
  </div>`;

  const items = overlay.querySelector('#spinner-items');
  // Cached node list: avoids re-querying the DOM inside the animation loop.
  let itemEls = Array.from(items.querySelectorAll('.spinner-item'));

  function rebuildItemEls() {
    itemEls = Array.from(items.querySelectorAll('.spinner-item'));
  }

  // Update label text in place: no DOM rebuild, no node churn.
  function updateLabels(center) {
    for (let idx = 0; idx < itemEls.length; idx++) {
      const i = idx - OFF;
      const v = center + i * step;
      itemEls[idx].textContent = (v >= min && v <= max) ? fmtVal(v) : '';
      itemEls[idx].classList.toggle('on', i === 0);
    }
  }

  // Positions items on a virtual cylinder using 2D transforms computed from 3D geometry.
  // drumAngle (degrees): rotation of the cylinder; positive = top toward viewer.
  function updateDrum(drumAngle) {
    const drumRad = drumAngle * DEG2RAD;
    for (let idx = 0; idx < itemEls.length; idx++) {
      const effRad = itemAngles[idx] - drumRad;
      const cosA = Math.cos(effRad);
      const sinA = Math.sin(effRad);
      const z = CYLINDER_R * cosA;
      const ps = PERSPECTIVE / (PERSPECTIVE - z);
      const vy = CYLINDER_R * sinA * ps;
      const el = itemEls[idx];
      // Always update transform even when cosA≤0; leaving a stale transform on
      // back-half items lets them intercept clicks they should not (visible ·on
      // item's input/check button gets occluded during tap-to-type mode).
      el.style.transform = 'translate3d(0,' + vy + 'px,0) scaleY(' + (cosA > 0 ? cosA * ps : 0) + ')';
      el.style.opacity = cosA > 0 ? cosA : 0;
    }
  }

  // Suppress haptics during fast fling; throttle to one buzz per 40 ms.
  function maybeBuzz() {
    if (Math.abs(curVel) > 0.9) return;
    const t = performance.now();
    if (t - lastBuzz > 40) { buzz(3); lastBuzz = t; }
  }

  function render(offset) {
    const center = Math.round(pxToVal(offset) / step) * step;
    if (center !== lastCenter) {
      lastCenter = center;
      updateLabels(center);
      maybeBuzz();
    }
    // Residual must be measured from the rounded `center`, not offset % ITEM_H:
    // that modulo floors toward zero, which disagrees with rounding for the back
    // half of every step and snaps the track a full row out of place mid-drag.
    const residual = offset - valToPx(center);
    updateDrum(-(residual / ITEM_H) * ANGLE_PER_ITEM);
    return center;
  }

  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    rafId = requestAnimationFrame(() => { renderPending = false; rafId = 0; render(offsetY); });
  }

  // Force a render synchronously (before computing release velocity in onUp,
  // or before committing on interrupt in onDown).
  function flushRender() {
    if (!renderPending) return;
    cancelAnimationFrame(rafId);
    renderPending = false; rafId = 0;
    render(offsetY);
  }

  // --- Event handlers ---

  function close() {
    overlay._closed = true;
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  function onDown(e) {
    if (e.target.closest('.spinner-type')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (dragging) return;

    // Commit whatever is currently displayed before cancelling any in-flight
    // animation. This rebases `val` to the visible center so the next flick's
    // steps and targetOffset are anchored to the actual displayed position:
    // without this, rapid spam flicks leave val frozen while offsetY drifts
    // hundreds of pixels, and the ±30-step cap causes backward settle (reset).
    clearTimeout(snapTimeout); snapTimeout = 0;
    if (rafId || renderPending) {
      flushRender();
      cancelAnimationFrame(rafId); rafId = 0; renderPending = false;
      const center = Math.round(pxToVal(offsetY) / step) * step;
      if (center !== val) commit(center, true);
    }

    dragging = true; pid = e.pointerId; dragged = false;
    downY = dragY = e.clientY;
    curVel = 0;
    velSamples = [{ y: e.clientY, t: e.timeStamp || performance.now() }];
    items.setPointerCapture(pid);
  }

  function onMove(e) {
    if (!dragging || e.pointerId !== pid) return;
    e.preventDefault();

    // getCoalescedEvents gives all raw samples between frames on 120Hz panels,
    // avoiding the velocity spike from a single large jump per frame.
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs) {
      const dy = ev.clientY - dragY;
      dragY = ev.clientY;
      offsetY += dy;
      velSamples.push({ y: ev.clientY, t: ev.timeStamp || performance.now() });
    }

    // Keep velocity window to ~120 ms
    const now = performance.now();
    while (velSamples.length > 2 && now - velSamples[0].t > 120) velSamples.shift();
    if (velSamples.length > 12) velSamples.shift();

    if (Math.abs(e.clientY - downY) > 3) dragged = true;
    offsetY = softClamp(offsetY);
    scheduleRender();
  }

  function releaseVelocity() {
    const n = velSamples.length;
    if (n < 2) return 0;
    // Use a reference sample ~80 ms old rather than the oldest to avoid
    // velocity inflation when the finger paused before lifting.
    const last = velSamples[n - 1];
    let ref = velSamples[0];
    for (let i = n - 1; i >= 0; i--) {
      if (last.t - velSamples[i].t > 80) { ref = velSamples[i]; break; }
    }
    const dt = Math.max(1, last.t - ref.t);
    const v = (last.y - ref.y) / dt; // px/ms
    return Math.max(-4.2, Math.min(4.2, v));
  }

  // Frame-by-frame exponential decay: v(t) = v0·e^(-t/τ). The longer τ range
  // (450–700 ms, was 300–480 ms) gives a more iOS-feeling coast — a heavy
  // fling keeps spinning visibly before the spring takes over. The phase cap
  // (600 ms, slightly above τ_max) bounds the worst case so the snap spring
  // always gets to finish well inside the 700 ms wait the e2e tests allow.
  function startMomentum(v0) {
    const tau = (0.45 + Math.min(Math.abs(v0) / 9, 0.25)) * 1000; // ms
    const tStart = performance.now();
    let lastT = tStart;
    const phaseMaxMs = 600;
    function tick(now) {
      if (overlay._closed) return;
      const dt = Math.min(now - lastT, 32); lastT = now; // ms
      v0 *= Math.exp(-dt / tau);
      offsetY = softClamp(offsetY + v0 * dt);
      render(offsetY);
      if (now - tStart < phaseMaxMs && Math.abs(v0) > 0.02) {
        rafId = requestAnimationFrame(tick);
      } else {
        curVel = 0;
        startSnap(); // spring corrects the small residual (<½ step)
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  // Spring onto targetVal (defaults to nearest step from current offsetY).
  // initVelMs carries the release velocity so the spring continues smoothly
  // from any preceding momentum phase. k=300 (was 360) and a damping ratio of
  // 0.86 (was 0.92) give a slower settle (~150 ms) with a subtle bounce —
  // closer to the iOS picker feel than the previous "snap hard, no bounce".
  function startSnap(initVelMs = 0, targetVal = null) {
    if (overlay._closed) return;
    if (targetVal === null) {
      targetVal = clampValue(Math.round(pxToVal(offsetY) / step) * step);
    }
    const targetPx = clampOffset(valToPx(targetVal));

    let pos = offsetY;
    let vel = initVelMs * 1000; // px/ms → px/s; spring math uses seconds
    const k = 300, c = 2 * Math.sqrt(k) * 0.86; // under-critical for a gentle bounce
    let lastT = performance.now();

    function frame(now) {
      if (overlay._closed) return;
      const dt = Math.min((now - lastT) / 1000, 0.032); lastT = now; // seconds
      const acc = -k * (pos - targetPx) - c * vel;
      vel += acc * dt;
      pos += vel * dt;
      offsetY = clampOffset(pos);
      render(offsetY);

      if (Math.abs(vel) < 2 && Math.abs(pos - targetPx) < 0.5) {
        clearTimeout(snapTimeout); snapTimeout = 0;
        offsetY = targetPx;
        render(offsetY);
        commit(targetVal);
        curVel = 0; rafId = 0;
        return;
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  function onUp(e) {
    if (!dragging || e.pointerId !== pid) return;
    flushRender();
    dragging = false; pid = null;

    if (!dragged) {
      const onItem = items.querySelector('.spinner-item.on');
      if (onItem) { enterTypeMode(onItem); return; }
    }

    const v0 = releaseVelocity(); // px/ms
    if (Math.abs(v0) < 0.04) {
      startSnap();
    } else {
      startMomentum(v0);
    }
    // Fallback: if rAF is throttled (e.g. parallel headless tests), commit within
    // 500ms rather than relying on rAF alone. clearTimeout in startSnap's natural
    // commit path and in onDown cancel this before it fires in normal operation.
    snapTimeout = setTimeout(() => {
      snapTimeout = 0;
      if (dragging || overlay._closed || !rafId) return;
      cancelAnimationFrame(rafId); rafId = 0;
      const sv = clampValue(Math.round(pxToVal(offsetY) / step) * step);
      offsetY = clampOffset(valToPx(sv));
      render(offsetY); commit(sv); curVel = 0;
    }, 500);
  }

  function onCancel(e) {
    if (!dragging || e.pointerId !== pid) return;
    flushRender();
    dragging = false; pid = null;
    startSnap();
    snapTimeout = setTimeout(() => {
      snapTimeout = 0;
      if (dragging || overlay._closed || !rafId) return;
      cancelAnimationFrame(rafId); rafId = 0;
      const sv = clampValue(Math.round(pxToVal(offsetY) / step) * step);
      offsetY = clampOffset(valToPx(sv));
      render(offsetY); commit(sv); curVel = 0;
    }, 500);
  }

  items.addEventListener('pointerdown', onDown);
  items.addEventListener('pointermove', onMove);
  items.addEventListener('pointerup', onUp);
  items.addEventListener('pointercancel', onCancel);

  // tap-to-type: tapping the centered value opens an inline input
  items.addEventListener('click', (e) => {
    if (dragged) return;
    const onItem = e.target.closest('.spinner-item.on');
    if (!onItem) return;
    enterTypeMode(onItem);
  });

  function enterTypeMode(onItem) {
    if (onItem.querySelector('input')) return;
    const current = val;
    onItem.innerHTML = `<div class="spinner-type"><input type="text" inputmode="decimal" value="${fmtVal(current)}" /><button class="spinner-check" aria-label="Confirm"><svg class="icon"><use href="#check"></use></svg></button></div>`;
    const inp = onItem.querySelector('input');
    const btn = onItem.querySelector('.spinner-check');

    let confirmed = false;
    function confirm() {
      if (confirmed) return;
      confirmed = true;
      const raw = inp.value.trim();
      const num = Number(raw);
      if (raw === '' || isNaN(num)) { exitTypeMode(onItem); return; }
      const snapped = clampValue(Math.round(num / step) * step);
      commit(snapped);
      items.innerHTML = trackHTML(snapped);
      rebuildItemEls();
      updateDrum(0);
      offsetY = 0; lastCenter = snapped;
    }
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); confirm(); } });
    btn.addEventListener('pointerdown', (ev) => { ev.preventDefault(); confirm(); });
    btn.addEventListener('click', confirm);
    inp.addEventListener('blur', () => confirm());
    requestAnimationFrame(() => inp.focus());
  }

  function exitTypeMode(onItem) {
    if (!onItem || !onItem.querySelector('input')) return;
    items.innerHTML = trackHTML(lastCenter);
    rebuildItemEls();
    updateDrum(0);
  }

  document.body.appendChild(overlay);
  updateDrum(0);
  requestAnimationFrame(() => overlay.classList.add('show'));
  el._closeSpinner = close;
}
function splitDT(localDT) {
  const [date, time] = (localDT || '').split('T');
  return { date: date || '', time: time || '' };
}
function dtPair(prefix, localDT) {
  const { date, time } = splitDT(localDT);
  return `<div class="dt-row"><input type="date" id="${prefix}-date" value="${date}" /><input type="time" id="${prefix}-time" value="${time}" /></div>`;
}
function readDT(prefix) {
  const d = $(`#${prefix}-date`), t = $(`#${prefix}-time`);
  if (!d || !t || !d.value || !t.value) return '';
  return `${d.value}T${t.value}`;
}
function writeDT(prefix, iso) {
  const d = $(`#${prefix}-date`), t = $(`#${prefix}-time`);
  if (!d || !t) return;
  const { date, time } = splitDT(isoToLocalDT(iso));
  d.value = date; t.value = time;
}
const timeRow = () => field('Time', dtPair('f-time', nowLocalDT()));
const noteRow = () => field('Note', `<textarea id="f-note" rows="2" placeholder="Optional…"></textarea>`);
const segVal = (group) => { const el = $(`[data-seg="${group}"] .seg-opt.on`); return el ? el.dataset.val : null; };

// Prefills a new bottle log with the last bottle's amount rather than the
// fixed settings default, since actual intake tracks the baby's current
// appetite far better than a one-time-configured number.
function defaultBottleAmount() {
  const lastMl = derive.lastBottleAmount();
  if (lastMl == null) return state().settings.bottleAmountDefault; // already stored in display units
  return state().settings.units.volume === 'oz' ? Math.round((lastMl / 29.5735) * 10) / 10 : lastMl;
}

const FORMS = {
  sleep: () => `
    ${field('Fell asleep', dtPair('f-time', nowLocalDT()))}
    ${field('Woke (leave blank if still asleep)', dtPair('f-end', nowLocalDT().slice(0, 10)))}
    ${field('Quality', seg('quality', ['Restless', 'Okay', 'Good', 'Great'], 'Good'))}
    ${noteRow()}
    <details class="sleep-details">
      <summary>Details - Optional <svg class="icon sleep-details-chevron"><use href="#chevron-down"></use></svg></summary>
      ${field('Mood at bedtime', seg('startMood', ['Upset', 'Content'], null))}
      ${field('Time to fall asleep', seg('fallAsleep', ['Under 10 min', '10-20 min', 'Long time to fall asleep'], null))}
      ${field('How it happened', iconGrid('method', [
        { val: 'On own in bed', icon: 'bed-single', label: 'On own' },
        { val: 'Nursing', icon: 'milk', label: 'Nursing' },
        { val: 'Worn or held', icon: 'user', label: 'Held' },
        { val: 'Next to carer', icon: 'users', label: 'Next to carer' },
        { val: 'Co-sleep', icon: 'bed-double', label: 'Co-sleep' },
        { val: 'Bottle', icon: 'icon-bottle', label: 'Bottle' },
        { val: 'Stroller', icon: 'footprints', label: 'Stroller' },
        { val: 'Car', icon: 'car', label: 'Car' },
        { val: 'Swing', icon: 'wind', label: 'Swing' }
      ], null))}
      ${field('How sleep ended', seg('endMood', ['Woke up child', 'Upset', 'Content'], null))}
    </details>`,
  feed: () => `
    ${field('Side', seg('side', ['Left', 'Right', 'Both'], 'Left'))}
    ${stepperField('Duration (min)', 'f-dur', 0, 120, 1, 15)}
    ${timeRow()} ${noteRow()}`,
  bottle: () => `
    ${field('Contents', seg('contents', ['Formula', 'Breast milk', 'Water'], 'Formula'))}
    ${stepperField('Amount (' + state().settings.units.volume + ')', 'f-amt', 0, 9999, 5, defaultBottleAmount())}
    ${timeRow()} ${noteRow()}`,
  diaper: () => `
    ${field('Type', seg('kind', ['Wet', 'Dirty', 'Mixed'], 'Wet'))}
    <div id="diaper-size-single">${field('Size', seg('size', SIZE_OPTS, 'Medium'))}</div>
    <div id="diaper-size-mixed" hidden>
      ${field('Wet size', seg('wetSize', SIZE_OPTS, 'Medium'))}
      ${field('Dirty size', seg('dirtySize', SIZE_OPTS, 'Medium'))}
    </div>
    ${field('Rash', `<button type="button" class="switch" id="f-rash" role="switch" aria-checked="false" data-action="form:toggle"><span class="knob"></span></button>`)}
    ${timeRow()} ${noteRow()}`,
  medicine: () => {
    const meds = state().settings.meds;
    if (!meds.length) return `<p class="empty-note">No medicines yet. Add one from the Medicine card on Home.</p>`;
    return `
    ${field('Medicine', `<select id="f-med">${meds.map((m) => `<option value="${m.id}">${esc(m.name)} · ${esc(m.dose)}${esc(m.unit)}</option>`).join('')}<option value="__manage__">+ Add or edit medicines</option></select>`)}
    ${timeRow()} ${noteRow()}`;
  },
  pump: () => `
    ${field('Side', seg('side', ['Left', 'Right', 'Both'], 'Both'))}
    ${stepperField('Amount (' + state().settings.units.volume + ')', 'f-amt', 0, 9999, 5, 90)}
    ${timeRow()} ${noteRow()}`,
  note: () => `${timeRow()} ${field('Note', `<textarea id="f-note" rows="3" placeholder="What happened?"></textarea>`)}`,
  play: () => {
    const types = state().settings.playTypes;
    return `${types.length ? field('Type', seg('playType', types, types[0])) : ''}
    <button type="button" class="btn-ghost" data-action="playtypes:open"><svg class="icon"><use href="#pencil"></use></svg> Manage play types</button>
    ${timeRow()} ${noteRow()}`;
  },
  bath: () => `${timeRow()} ${noteRow()}`,
  hygiene: () => {
    const items = state().settings.hygiene;
    if (!items.length) return `<p class="empty-note">No hygiene items yet. Add one from the Hygiene card on Home.</p>`;
    return `
    ${field('Item', `<select id="f-hyg">${items.map((it) => `<option value="${it.id}">${esc(it.name)}</option>`).join('')}</select>`)}
    ${timeRow()} ${noteRow()}`;
  },
};

function gather(type) {
  const timeLocal = readDT('f-time');
  const time = timeLocal ? dtToISO(timeLocal) : new Date().toISOString();
  const note = $('#f-note') ? $('#f-note').value.trim() : '';
  const base = { type, start: time };
  base.note = note || null;
  if (type === 'sleep') {
    base.quality = segVal('quality');
    const endLocal = readDT('f-end');
    base.end = endLocal ? dtToISO(endLocal) : null;
    base.startMood = segVal('startMood');
    base.fallAsleep = segVal('fallAsleep');
    const m = $('[data-icongrid="method"] .icongrid-opt.on');
    base.method = m ? m.dataset.val : null;
    base.endMood = segVal('endMood');
  } else if (type === 'feed') {
    base.side = segVal('side'); base.duration = Number($('#f-dur').dataset.value) || 0;
  } else if (type === 'bottle' || type === 'pump') {
    base.side = segVal('side');
    if (type === 'bottle') base.contents = segVal('contents');
    let amt = Number($('#f-amt').dataset.value) || 0;
    if (state().settings.units.volume === 'oz') amt = amt * 29.5735; // store ml
    base.amount = Math.round(amt); base.unit = 'ml';
  } else if (type === 'diaper') {
    base.kind = segVal('kind');
    if (base.kind === 'Mixed') {
      base.size = null; base.wetSize = segVal('wetSize'); base.dirtySize = segVal('dirtySize');
    } else {
      base.size = segVal('size'); base.wetSize = null; base.dirtySize = null;
    }
    base.rash = $('#f-rash') ? $('#f-rash').classList.contains('on') : false;
  } else if (type === 'medicine') {
    const id = $('#f-med').value;
    const m = state().settings.meds.find((x) => x.id === id);
    if (!m) return base;
    base.medId = id; base.name = m.name; base.dose = m.dose + m.unit;
  } else if (type === 'play') {
    base.playType = segVal('playType') || null;
  } else if (type === 'hygiene') {
    const id = $('#f-hyg').value;
    const it = state().settings.hygiene.find((x) => x.id === id);
    if (!it) return base;
    base.itemId = id; base.name = it.name;
  }
  return base;
}

const DRAFT_KEY = 'hearth:log-draft';
const DRAFT_MAX_AGE_MS = 5 * 60 * 1000;

function saveDraft() {
  const saveBtn = $('#scrim.show [data-action="log:save"]');
  if (!saveBtn) return;
  try {
    const type = saveBtn.dataset.type;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ type, id: saveBtn.dataset.id || null, savedAt: Date.now(), entry: gather(type) }));
  } catch (e) { /* private browsing / quota: draft persistence is best-effort */ }
}
// id is the entry being edited, or null when logging a new one — a draft only
// applies to the same entry (or the same "new" context) it was saved for, so
// reopening a *different* entry's edit sheet never pulls in someone else's
// unsaved text.
function loadDraft(type, id = null) {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.type !== type || (parsed.id || null) !== id || Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) return null;
    return parsed.entry;
  } catch (e) { return null; }
}
function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
}
['input', 'change', 'click'].forEach((evt) => document.addEventListener(evt, saveDraft));

export function openLog(type, entry) {
  const cfg = TYPES[type];
  const editing = entry && entry.id;
  sheet.open(
    FORMS[type]() + `<button class="btn-primary" data-action="log:save" data-type="${type}" data-id="${editing ? entry.id : ''}"><svg class="icon"><use href="#check"></use></svg> ${editing ? 'Save changes' : 'Log ' + cfg.label.toLowerCase()}</button>` +
      (editing ? `<button class="btn-ghost danger" data-action="entry:delete" data-id="${entry.id}"><svg class="icon"><use href="#trash-2"></use></svg> Delete</button>` : ''),
    { title: (editing ? 'Edit ' : 'Log ') + cfg.label.toLowerCase(), size: 'sheet-form' }
  );
  if (editing) {
    prefill(type, entry);
    const draft = loadDraft(type, entry.id);
    if (draft) prefill(type, draft);
  } else {
    writeDT('f-time', new Date().toISOString());
    const draft = loadDraft(type);
    if (draft) prefill(type, draft);
  }
  $$('.segctl').forEach(bindDragSeg);
}

function setSeg(group, val) {
  const g = $(`[data-seg="${group}"]`); if (!g || val == null) return;
  $$('.seg-opt', g).forEach((b) => b.classList.toggle('on', b.dataset.val === val));
}
function setIconGrid(group, val) {
  const g = $(`[data-icongrid="${group}"]`); if (!g || val == null) return;
  $$('.icongrid-opt', g).forEach((b) => b.classList.toggle('on', b.dataset.val === val));
}
export function syncDiaperSizeVisibility(kind) {
  const single = $('#diaper-size-single'), mixed = $('#diaper-size-mixed');
  if (!single || !mixed) return;
  const isMixed = kind === 'Mixed';
  single.hidden = isMixed; mixed.hidden = !isMixed;
  $$('.segctl', isMixed ? mixed : single).forEach(positionThumb);
}
function prefill(type, e) {
  writeDT('f-time', e.start);
  if ($('#f-note')) $('#f-note').value = e.note || '';
  if (type === 'sleep') {
    setSeg('quality', e.quality); if (e.end) writeDT('f-end', e.end);
    setSeg('startMood', e.startMood); setSeg('fallAsleep', e.fallAsleep);
    setIconGrid('method', e.method); setSeg('endMood', e.endMood);
    const details = $('.sleep-details');
    if (details && (e.startMood || e.fallAsleep || e.method || e.endMood)) details.open = true;
  }
  else if (type === 'feed') { setSeg('side', e.side); const fdur = $('#f-dur'); if (fdur) { fdur.dataset.value = e.duration || 0; fdur.textContent = e.duration || 0; } }
  else if (type === 'bottle' || type === 'pump') {
    setSeg('side', e.side); setSeg('contents', e.contents);
    let a = Number(e.amount) || 0; if (state().settings.units.volume === 'oz') a = Math.round((a / 29.5735) * 10) / 10;
    const famt = $('#f-amt'); if (famt) { famt.dataset.value = a; famt.textContent = a; }
  } else if (type === 'diaper') {
    setSeg('kind', e.kind); setSeg('size', e.size);
    setSeg('wetSize', e.wetSize); setSeg('dirtySize', e.dirtySize);
    syncDiaperSizeVisibility(e.kind);
    const rashEl = $('#f-rash');
    if (rashEl) { rashEl.classList.toggle('on', !!e.rash); rashEl.setAttribute('aria-checked', !!e.rash); }
  } else if (type === 'medicine') { if ($('#f-med')) $('#f-med').value = e.medId; }
  else if (type === 'play') { setSeg('playType', e.playType); }
  else if (type === 'hygiene') { if ($('#f-hyg')) $('#f-hyg').value = e.itemId; }
}

export function saveLog(type, id) {
  const e = gather(type);
  clearDraft();
  if (id) {
    updateEntry(id, e);
    sheet.close(); toast(TYPES[type].label + ' updated'); router.refresh();
    return;
  }
  // autoClose must run before maybeInterrupt: close any existing open sleep first so
  // maybeInterruptSleep does not see it as an active sleep to split.
  const closed = type === 'sleep' ? autoCloseOngoingSleep(e.start) : null;
  const split = maybeInterruptSleep(type, e.start);
  const added = addEntry(e);
  sheet.close();
  if (state().settings.sound !== false) { chime(); buzz(15); }
  confetti();
  toast(TYPES[type].label + ' logged', () => { removeEntry(added.id); undoAutoCloseSleep(closed); undoInterruptSleep(split); router.refresh(); });
  router.refresh();
}

export function openTypeChooser() {
  const types = ['sleep', 'feed', 'bottle', 'diaper', 'medicine', 'pump', 'note', 'play', 'bath', 'hygiene'];
  sheet.open(
    `<div class="chooser">` + types.map((t) => {
      const c = TYPES[t];
      return `<button class="chooser-item" data-action="log:open" data-type="${t}">
        <span class="chooser-ic tone-${c.tone}"><svg class="icon"><use href="#${icon(c.icon)}"></use></svg></span>
        <span>${c.label}</span></button>`;
    }).join('') + `</div>`,
    { title: 'Log activity' }
  );
}

// ---------- medicine card dosing ----------
export function logMedDose(medId) {
  const m = state().settings.meds.find((x) => x.id === medId);
  if (!m) return;
  const e = { type: 'medicine', start: new Date().toISOString(), medId: m.id, name: m.name, dose: m.dose + m.unit };
  const added = addEntry(e);
  sheet.close();
  if (state().settings.sound !== false) { chime(); buzz(15); }
  confetti();
  toast(m.name + ' logged', () => { removeEntry(added.id); router.refresh(); });
  router.refresh();
}

export function openMedCard() {
  const meds = state().settings.meds;
  if (!meds.length) { editCard('medicine'); return; }
  if (meds.length === 1) { logMedDose(meds[0].id); return; }
  sheet.open(
    `<div class="chooser">` + meds.map((m) => `
      <button class="chooser-item" data-action="med:dose" data-mid="${m.id}">
        <span class="chooser-ic tone-med"><svg class="icon"><use href="#${icon('pill')}"></use></svg></span>
        <span>${esc(m.name)} · ${esc(m.dose)}${esc(m.unit)}</span>
      </button>`).join('') + `</div>`,
    { title: 'Log a dose' }
  );
}

// ---------- hygiene card logging ----------
export function logHygieneItem(itemId) {
  const it = state().settings.hygiene.find((x) => x.id === itemId);
  if (!it) return;
  const e = { type: 'hygiene', start: new Date().toISOString(), itemId: it.id, name: it.name };
  const added = addEntry(e);
  sheet.close();
  if (state().settings.sound !== false) { chime(); buzz(15); }
  confetti();
  toast(it.name + ' logged', () => { removeEntry(added.id); router.refresh(); });
  router.refresh();
}

export function openHygieneCard() {
  const items = state().settings.hygiene;
  if (!items.length) { editCard('hygiene'); return; }
  if (items.length === 1) { logHygieneItem(items[0].id); return; }
  sheet.open(
    `<div class="chooser">` + items.map((it) => `
      <button class="chooser-item" data-action="hygiene:log" data-hid="${esc(it.id)}">
        <span class="chooser-ic tone-hygiene"><svg class="icon"><use href="#icon-hygiene"></use></svg></span>
        <span>${esc(it.name)}</span>
      </button>`).join('') + `</div>`,
    { title: 'Log hygiene' }
  );
}

// ---------- card config ----------
export function editCard(which) {
  const s = state().settings;
  if (which === 'bottle') {
    sheet.open(`
      ${stepperField('Remind every (hours)', 'c-int', 1, 8, 0.5, s.bottleIntervalH)}
      ${stepperField('Default amount (' + s.units.volume + ')', 'c-amt', 0, 9999, 5, s.bottleAmountDefault)}
      <p class="empty-note">This interval predicts your next bottle from your last feed.</p>
      <button class="btn-primary" data-action="card:save-bottle"><svg class="icon"><use href="#check"></use></svg> Save</button>
      <button class="btn-ghost" data-action="card:hide" data-card="bottle">Hide this card</button>`,
      { title: 'Bottle reminder' });
  } else if (which === 'medicine') {
    sheet.open(medForm(), { title: 'Medicines', size: 'sheet-form' });
  } else if (which === 'bath') {
    sheet.open(`
      <p class="empty-note">The bath card shows how long since the last bath. It has no reminder interval to set.</p>
      <button class="btn-ghost danger" data-action="card:remove" data-card="bath"><svg class="icon"><use href="#trash-2"></use></svg> Remove card</button>`,
      { title: 'Bath card' });
  } else if (which === 'hygiene') {
    sheet.open(hygieneForm(), { title: 'Hygiene items', size: 'sheet-form' });
  } else {
    const c = TYPES[which] || { label: which };
    const cur = (s.cards.intervals || {})[which] ?? 3;
    sheet.open(`
      ${stepperField('Remind every (hours)', 'c-int', 1, 24, 0.5, cur)}
      <p class="empty-note">This interval predicts the next ${esc(c.label.toLowerCase())} from the last entry.</p>
      <button class="btn-primary" data-action="card:save-interval" data-card="${which}"><svg class="icon"><use href="#check"></use></svg> Save</button>
      <button class="btn-ghost danger" data-action="card:remove" data-card="${which}"><svg class="icon"><use href="#trash-2"></use></svg> Remove card</button>`,
      { title: c.label + ' reminder' });
  }
}

// ---------- add-card picker + generic card config ----------
export function openCardPicker() {
  const types = addableCardTypes();
  if (!types.length) { toast('All cards are already shown'); return; }
  sheet.open(
    `<div class="chooser">` + types.map((t) => {
      const c = TYPES[t];
      return `<button class="chooser-item" data-action="card:pick" data-type="${t}">
        <span class="chooser-ic tone-${c.tone}"><svg class="icon"><use href="#${icon(c.icon)}"></use></svg></span>
        <span>${c.label}</span></button>`;
    }).join('') + `</div>`,
    { title: 'Add a card' }
  );
}

export function pickCard(type) {
  // Re-adding a hidden default just unhides it; bath/hygiene are no-interval cards; generic types need an interval.
  if (type === 'bottle' || type === 'medicine' || type === 'bath' || type === 'hygiene') {
    if (type === 'bath' || type === 'hygiene') {
      const cards = state().settings.cards;
      cards.order = cards.order || ['bottle', 'medicine'];
      if (!cards.order.includes(type)) cards.order.push(type);
      cards[type] = true;
      save(); enqueueSettingsSync(); sheet.close(); toast((TYPES[type] || {}).label + ' card added'); router.refresh();
      return;
    }
    showCard(type); return;
  }
  const c = TYPES[type] || { label: type };
  sheet.open(`
    ${stepperField('Remind every (hours)', 'c-int', 1, 24, 0.5, 3)}
    <p class="empty-note">This interval predicts the next ${esc(c.label.toLowerCase())} from the last entry.</p>
    <button class="btn-primary" data-action="card:save-new" data-card="${type}"><svg class="icon"><use href="#check"></use></svg> Add card</button>`,
    { title: 'Add ' + c.label });
}

export function saveNewCard(type) {
  const cards = state().settings.cards;
  cards.intervals = cards.intervals || {};
  cards.intervals[type] = Number($('#c-int').dataset.value) || 3;
  cards[type] = true;
  cards.order = cards.order || ['bottle', 'medicine'];
  if (!cards.order.includes(type)) cards.order.push(type);
  save(); enqueueSettingsSync(); sheet.close(); toast((TYPES[type] || {}).label + ' card added'); router.refresh();
}

export function saveCardInterval(type) {
  const cards = state().settings.cards;
  cards.intervals = cards.intervals || {};
  cards.intervals[type] = Number($('#c-int').dataset.value) || 3;
  save(); enqueueSettingsSync(); sheet.close(); toast('Card updated'); router.refresh();
}

export function removeCard(type) {
  const cards = state().settings.cards;
  if (cards.order) cards.order = cards.order.filter((k) => k !== type);
  if (cards.intervals) delete cards.intervals[type];
  delete cards[type];
  save(); enqueueSettingsSync(); sheet.close(); toast('Card removed'); router.refresh();
}

function medForm() {
  const meds = state().settings.meds;
  return `<div id="med-list" class="med-list">` +
    (meds.length ? meds.map(medRow).join('') : `<p class="empty-note">No medicines yet.</p>`) +
    `</div>
    <button class="btn-ghost" data-action="med:add"><svg class="icon"><use href="#plus"></use></svg> Add medicine</button>
    <button class="btn-primary" data-action="card:save-meds"><svg class="icon"><use href="#check"></use></svg> Save</button>
    <button class="btn-ghost" data-action="card:hide" data-card="medicine">Hide this card</button>`;
}
export function medRow(m) {
  return `<div class="med-edit" data-mid="${m.id}">
    <input class="med-name" placeholder="Name" value="${esc(m.name)}" />
    <div class="med-sub">
      <input class="med-dose" placeholder="Dose" value="${esc(m.dose)}" />
      <input class="med-unit" placeholder="unit" value="${esc(m.unit)}" />
      <span class="med-every">every</span>
      <input class="med-eh" type="number" min="1" max="48" value="${m.everyH}" /><span class="med-every">h</span>
      <button class="med-del" data-action="med:remove" data-mid="${m.id}" aria-label="Remove"><svg class="icon"><use href="#trash-2"></use></svg></button>
    </div>
  </div>`;
}

function hygieneForm() {
  const items = state().settings.hygiene;
  return `<div id="hygiene-list" class="med-list">` +
    (items.length ? items.map(hygieneRow).join('') : `<p class="empty-note">No hygiene items yet.</p>`) +
    `</div>
    <button class="btn-ghost" data-action="hygiene:add"><svg class="icon"><use href="#plus"></use></svg> Add item</button>
    <button class="btn-primary" data-action="card:save-hygiene"><svg class="icon"><use href="#check"></use></svg> Save</button>
    <button class="btn-ghost" data-action="card:hide" data-card="hygiene">Hide this card</button>`;
}
export function hygieneRow(it) {
  return `<div class="med-edit" data-hid="${esc(it.id)}">
    <input class="hyg-name" placeholder="Name" value="${esc(it.name)}" />
    <div class="med-sub">
      <span class="med-every">every</span>
      <input class="hyg-eh" type="number" min="1" max="720" value="${it.everyH}" /><span class="med-every">h</span>
      <button class="med-del" data-action="hygiene:remove" data-hid="${esc(it.id)}" aria-label="Remove"><svg class="icon"><use href="#trash-2"></use></svg></button>
    </div>
  </div>`;
}

function playTypesForm() {
  const types = state().settings.playTypes;
  return `<div id="playtype-list" class="playtype-list">` +
    (types.length ? types.map(playTypeRow).join('') : `<p class="empty-note">No play types yet.</p>`) +
    `</div>
    <button class="btn-ghost" data-action="playtype:add"><svg class="icon"><use href="#plus"></use></svg> Add type</button>
    <button class="btn-primary" data-action="playtypes:save"><svg class="icon"><use href="#check"></use></svg> Save</button>`;
}
export function playTypeRow(name) {
  return `<div class="playtype-row">
    <input class="playtype-name" placeholder="Type" value="${esc(name)}" />
    <button class="playtype-del" data-action="playtype:remove" aria-label="Remove"><svg class="icon"><use href="#trash-2"></use></svg></button>
  </div>`;
}
export function openPlayTypes() {
  sheet.open(playTypesForm(), { title: 'Play types', size: 'sheet-form' });
}
export function savePlayTypes() {
  const rows = $$('#playtype-list .playtype-row');
  state().settings.playTypes = rows
    .map((r) => $('.playtype-name', r).value.trim())
    .filter(Boolean);
  save(); enqueueSettingsSync(); sheet.close(); toast('Play types updated'); router.refresh();
}

export function saveBottle() {
  state().settings.bottleIntervalH = Number($('#c-int').dataset.value) || 3;
  state().settings.bottleAmountDefault = Number($('#c-amt').dataset.value) || 120;
  save(); enqueueSettingsSync(); sheet.close(); toast('Bottle reminder updated'); router.refresh();
}
export function saveMeds() {
  const rows = $$('#med-list .med-edit');
  state().settings.meds = rows.map((r) => ({
    id: r.dataset.mid,
    name: $('.med-name', r).value.trim() || 'Medicine',
    dose: $('.med-dose', r).value.trim() || '1',
    unit: $('.med-unit', r).value.trim() || '',
    everyH: Number($('.med-eh', r).value) || 24
  }));
  save(); enqueueSettingsSync(); sheet.close(); toast('Medicines updated'); router.refresh();
}
export function saveHygiene() {
  const rows = $$('#hygiene-list .med-edit');
  state().settings.hygiene = rows.map((r) => ({
    id: r.dataset.hid,
    name: $('.hyg-name', r).value.trim() || 'Hygiene',
    everyH: Number($('.hyg-eh', r).value) || 168
  }));
  save(); enqueueSettingsSync(); sheet.close(); toast('Hygiene items updated'); router.refresh();
}
export function hideCard(card) {
  state().settings.cards[card] = false;
  save(); enqueueSettingsSync(); sheet.close(); toast('Card hidden'); router.refresh();
}
export function showCard(card) { state().settings.cards[card] = true; save(); enqueueSettingsSync(); router.refresh(); }

// ---------- growth measurement sheet ----------
export function openMeasure(id) {
  const impW = state().settings.units.weight === 'lb';
  const impL = (state().settings.units.length || 'cm') === 'in';
  const wU = impW ? 'lb' : 'kg', lU = impL ? 'in' : 'cm';
  const m = id ? state().growth.find((x) => x.id === id) : null;
  const wVal = m ? (impW ? (m.weightKg * 2.2046).toFixed(1) : m.weightKg) : '';
  const hVal = m ? (impL ? (m.heightCm / 2.54).toFixed(1) : m.heightCm) : '';
  const hdVal = m && m.headCm ? (impL ? (m.headCm / 2.54).toFixed(1) : m.headCm) : '';
  sheet.open(`
    ${field('Date', `<input type="date" id="g-date" max="${new Date().toISOString().slice(0, 10)}" value="${m ? m.date : new Date().toISOString().slice(0, 10)}" />`)}
    ${stepperField('Weight (' + wU + ')', 'g-w', 0, 999, 0.1, wVal)}
    ${stepperField('Height (' + lU + ')', 'g-h', 0, 999, 0.1, hVal)}
    ${stepperField('Head circumference (' + lU + ')', 'g-hd', 0, 999, 0.1, hdVal)}
    ${field('Note', `<textarea id="f-note" rows="2" placeholder="Optional…">${m && m.note ? esc(m.note) : ''}</textarea>`)}
    <button class="btn-primary" data-action="measure:save" data-id="${id || ''}"><svg class="icon"><use href="#check"></use></svg> ${id ? 'Save changes' : 'Add measurement'}</button>
    ${id ? `<button class="btn-ghost danger" data-action="measure:delete" data-id="${id}"><svg class="icon"><use href="#trash-2"></use></svg> Delete</button>` : ''}`,
    { title: id ? 'Edit measurement' : 'Add measurement', size: 'sheet-form' });
}

export function saveMeasure(id) {
  const impW = state().settings.units.weight === 'lb';
  const impL = (state().settings.units.length || 'cm') === 'in';
  const w = Number($('#g-w').dataset.value), h = Number($('#g-h').dataset.value), hd = Number($('#g-hd').dataset.value);
  const m = {
    id: id || undefined,
    date: $('#g-date').value || new Date().toISOString().slice(0, 10),
    weightKg: w ? Math.round((impW ? w / 2.2046 : w) * 100) / 100 : null,
    heightCm: h ? Math.round((impL ? h * 2.54 : h) * 10) / 10 : null,
    headCm: hd ? Math.round((impL ? hd * 2.54 : hd) * 10) / 10 : null,
    note: $('#f-note') ? $('#f-note').value.trim() : ''
  };
  if (!m.weightKg && !m.heightCm) { toast('Enter a weight or height'); return; }
  addMeasure(m);
  sheet.close(); toast(id ? 'Measurement updated' : 'Measurement added'); router.refresh();
}
