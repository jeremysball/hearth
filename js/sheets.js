// sheets.js — logging bottom sheet (detailed) + card config sheets.
import { state, save, ageLabel, addEntry, removeEntry, updateEntry, addMeasure, enqueueSettingsSync, maybeInterruptSleep, undoInterruptSleep } from './store.js';
import { $, $$, esc, icon, TYPES, sheet, toast, nowLocalDT, dtToISO, isoToLocalDT, bindDragSeg } from './ui.js';
import { router } from './app.js';
import { chime, tick, buzz, confetti } from './fx.js';
import { addableCardTypes } from './home.js';

// segmented control
function seg(group, opts, sel) {
  return `<div class="segctl" data-seg="${group}">` +
    `<div class="seg-thumb"></div>` +
    opts.map((o) => `<button type="button" class="seg-opt ${o === sel ? 'on' : ''}" data-val="${esc(o)}">${esc(o)}</button>`).join('') +
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

  const ITEM_H = 52;
  const OFF = 8;
  const fmtVal = (v) => String(step % 1 !== 0 ? v.toFixed(1) : v);
  const pxToVal = (px) => val - (px / ITEM_H) * step;
  const valToPx = (v) => (val - v) / step * ITEM_H;

  let lastCenter = val;

  function commit(v) {
    v = Math.round(v * 1e6) / 1e6;
    if (v < min) v = min; else if (v > max) v = max;
    val = v;
    el.dataset.value = val;
    el.textContent = fmtVal(val);
    el.setAttribute('aria-valuenow', val);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (state().settings.sound !== false) tick();
  }

  function trackHTML(center) {
    let html = '';
    for (let i = -OFF; i <= OFF; i++) {
      const v = center + i * step;
      const inRange = v >= min && v <= max;
      const absOff = Math.abs(i);
      const cls = i === 0 ? 'spinner-item on pos-0' : `spinner-item pos-${absOff}`;
      html += `<div class="${cls}">${inRange ? fmtVal(v) : ''}</div>`;
    }
    return html;
  }

  const overlay = document.createElement('div');
  overlay.className = 'spinner-overlay';
  overlay.innerHTML = `<div class="spinner-popup">
    <div class="spinner-window">
      <div class="spinner-highlight"></div>
      <div class="spinner-items" id="spinner-items">${trackHTML(val)}</div>
    </div>
  </div>`;

  const items = overlay.querySelector('#spinner-items');

  function render(offset) {
    const raw = pxToVal(offset);
    const center = Math.round(raw / step) * step;
    if (center !== lastCenter) {
      lastCenter = center;
      items.innerHTML = trackHTML(center);
      buzz(3);
    }
    // Residual must be measured from the rendered `center` (chosen by
    // rounding), not `offset % ITEM_H` — that modulo implicitly floors
    // toward zero, which disagrees with the rounding for the back half of
    // every step and snaps the track a full row out of place mid-drag.
    const residual = offset - valToPx(center);
    items.style.transform = `translateY(calc(-50% + ${residual}px))`;
    items.style.transition = 'none';
    return center;
  }

  function close() {
    overlay._closed = true;
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  let dragging = false, pid = null, dragged = false;
  let offsetY = 0, dragY = 0;
  let velSamples = [];

  function clampOffset(offset) {
    if (min !== -Infinity) {
      const maxDown = valToPx(min); // most positive offset allowed
      offset = Math.min(maxDown, offset);
    }
    if (max !== Infinity) {
      const maxUp = valToPx(max); // most negative offset allowed
      offset = Math.max(maxUp, offset);
    }
    return offset;
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (dragging) return;
    dragging = true; pid = e.pointerId; dragged = false;
    dragY = e.clientY;
    offsetY = 0; velSamples = [{ y: e.clientY, t: performance.now() }];
    lastCenter = val;
    items.setPointerCapture(pid);
    items.style.transition = 'none';
  }

  function onMove(e) {
    if (!dragging || e.pointerId !== pid) return;
    e.preventDefault();
    const dy = e.clientY - dragY;
    dragY = e.clientY;
    offsetY += dy;
    if (Math.abs(offsetY) > 3) dragged = true;

    velSamples.push({ y: e.clientY, t: performance.now() });
    if (velSamples.length > 5) velSamples.shift();

    offsetY = clampOffset(offsetY);
    render(offsetY);
  }

  function onUp(e) {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false; pid = null;

    if (!dragged) {
      // tap without drag — enter type mode on the centered value
      const onItem = items.querySelector('.spinner-item.on');
      if (onItem) { enterTypeMode(onItem); return; }
    }

    // velocity from recent samples (px/ms → momentum mapper). Measured as
    // net position change over the exact span it's timed against — summing
    // per-event dy over a window whose dt only covers (n-1) of the n
    // intervals overstates speed by n/(n-1), worst for short flings.
    let vel = 0;
    if (velSamples.length > 1) {
      const first = velSamples[0], last = velSamples[velSamples.length - 1];
      const dt = last.t - first.t;
      if (dt > 0) vel = ((last.y - first.y) / dt) * 100;
    }
    const momentum = offsetY + vel;
    const steps = Math.round(momentum / ITEM_H);
    const targetOffset = clampOffset(steps * ITEM_H);

    // Animate the entire distance so all crossing steps are smooth.
    const startOffset = offsetY;
    const distance = targetOffset - startOffset;
    const duration = Math.min(Math.abs(distance) * 3 + 180, 500);
    const startTime = performance.now();

    function animate() {
      if (overlay._closed) return;
      const t = Math.min(1, (performance.now() - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic — fast start, settle
      offsetY = clampOffset(startOffset + distance * eased);
      render(offsetY);
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        // Final settle: snap to exact step boundary and commit
        const final = pxToVal(targetOffset);
        const snapped = Math.min(max, Math.max(min, Math.round(final / step) * step));
        offsetY = clampOffset(valToPx(snapped));
        render(offsetY);
        commit(snapped);
      }
    }
    requestAnimationFrame(animate);
  }

  items.addEventListener('pointerdown', onDown);
  items.addEventListener('pointermove', onMove);
  items.addEventListener('pointerup', onUp);
  items.addEventListener('pointercancel', onUp);

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

    function confirm() {
      const raw = inp.value.trim();
      const num = Number(raw);
      if (raw === '' || isNaN(num)) { exitTypeMode(onItem); return; }
      const snapped = Math.min(max, Math.max(min, Math.round(num / step) * step));
      commit(snapped);
      items.innerHTML = trackHTML(snapped);
      items.style.transform = 'translateY(calc(-50% + 0px))';
      offsetY = 0; lastCenter = snapped;
    }
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); confirm(); } });
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); confirm(); });
    inp.addEventListener('blur', () => exitTypeMode(onItem));
    requestAnimationFrame(() => inp.focus());
  }

  function exitTypeMode(onItem) {
    if (!onItem || !onItem.querySelector('input')) return;
    items.innerHTML = trackHTML(lastCenter);
    items.style.transform = 'translateY(calc(-50% + 0px))';
  }

  document.body.appendChild(overlay);
  items.style.transform = `translateY(calc(-50% + 0px))`;
  requestAnimationFrame(() => overlay.classList.add('show'));
  el._closeSpinner = close;
}
const timeRow = () => field('Time', `<input type="datetime-local" id="f-time" value="${nowLocalDT()}" />`);
const noteRow = () => field('Note', `<textarea id="f-note" rows="2" placeholder="Optional…"></textarea>`);
const segVal = (group) => { const el = $(`[data-seg="${group}"] .seg-opt.on`); return el ? el.dataset.val : null; };

const FORMS = {
  sleep: () => `
    ${field('Fell asleep', `<input type="datetime-local" id="f-time" value="${nowLocalDT()}" />`)}
    ${field('Woke (leave blank if still asleep)', `<input type="datetime-local" id="f-end" />`)}
    ${field('Quality', seg('quality', ['Restless', 'Okay', 'Good', 'Great'], 'Good'))}
    ${noteRow()}`,
  feed: () => `
    ${field('Side', seg('side', ['Left', 'Right', 'Both'], 'Left'))}
    ${stepperField('Duration (min)', 'f-dur', 0, 120, 1, 15)}
    ${timeRow()} ${noteRow()}`,
  bottle: () => `
    ${field('Contents', seg('contents', ['Formula', 'Breast milk', 'Water'], 'Formula'))}
    ${stepperField('Amount (' + state().settings.units.volume + ')', 'f-amt', 0, 9999, 5, 120)}
    ${timeRow()} ${noteRow()}`,
  diaper: () => `
    ${field('Type', seg('kind', ['Wet', 'Dirty', 'Mixed'], 'Wet'))}
    ${field('Size', seg('size', ['Small', 'Medium', 'Large'], 'Medium'))}
    ${timeRow()} ${noteRow()}`,
  medicine: () => {
    const meds = state().settings.meds;
    if (!meds.length) return `<p class="empty-note">No medicines yet. Add one from the Medicine card on Home.</p>`;
    return `
    ${field('Medicine', `<select id="f-med">${meds.map((m) => `<option value="${m.id}">${esc(m.name)} · ${esc(m.dose)}${esc(m.unit)}</option>`).join('')}</select>`)}
    ${timeRow()} ${noteRow()}`;
  },
  pump: () => `
    ${field('Side', seg('side', ['Left', 'Right', 'Both'], 'Both'))}
    ${stepperField('Amount (' + state().settings.units.volume + ')', 'f-amt', 0, 9999, 5, 90)}
    ${timeRow()} ${noteRow()}`,
  note: () => `${timeRow()} ${field('Note', `<textarea id="f-note" rows="3" placeholder="What happened?"></textarea>`)}`,
  play: () => `${timeRow()} ${noteRow()}`,
  bath: () => `${timeRow()} ${noteRow()}`,
};

function gather(type) {
  const time = $('#f-time') ? dtToISO($('#f-time').value) : new Date().toISOString();
  const note = $('#f-note') ? $('#f-note').value.trim() : '';
  const base = { type, start: time };
  if (note) base.note = note;
  if (type === 'sleep') {
    base.quality = segVal('quality');
    const end = $('#f-end').value;
    if (end) base.end = dtToISO(end);
  } else if (type === 'feed') {
    base.side = segVal('side'); base.duration = Number($('#f-dur').dataset.value) || 0;
  } else if (type === 'bottle' || type === 'pump') {
    base.side = segVal('side'); base.contents = segVal('contents');
    let amt = Number($('#f-amt').dataset.value) || 0;
    if (state().settings.units.volume === 'oz') amt = amt * 29.5735; // store ml
    base.amount = Math.round(amt); base.unit = 'ml';
  } else if (type === 'diaper') {
    base.kind = segVal('kind'); base.size = segVal('size');
  } else if (type === 'medicine') {
    const id = $('#f-med').value;
    const m = state().settings.meds.find((x) => x.id === id);
    base.medId = id; base.name = m.name; base.dose = m.dose + m.unit;
  }
  return base;
}

export function openLog(type, entry) {
  const cfg = TYPES[type];
  const editing = entry && entry.id;
  sheet.open(
    FORMS[type]() + `<button class="btn-primary" data-action="log:save" data-type="${type}" data-id="${editing ? entry.id : ''}"><svg class="icon"><use href="#check"></use></svg> ${editing ? 'Save changes' : 'Log ' + cfg.label.toLowerCase()}</button>` +
      (editing ? `<button class="btn-ghost danger" data-action="entry:delete" data-id="${entry.id}"><svg class="icon"><use href="#trash-2"></use></svg> Delete</button>` : ''),
    { title: (editing ? 'Edit ' : 'Log ') + cfg.label.toLowerCase(), size: 'sheet-form' }
  );
  if (editing) prefill(type, entry);
  $$('.segctl').forEach(bindDragSeg);
}

function setSeg(group, val) {
  const g = $(`[data-seg="${group}"]`); if (!g || val == null) return;
  $$('.seg-opt', g).forEach((b) => b.classList.toggle('on', b.dataset.val === val));
}
function prefill(type, e) {
  if ($('#f-time')) $('#f-time').value = isoToLocalDT(e.start);
  if ($('#f-note')) $('#f-note').value = e.note || '';
  if (type === 'sleep') { setSeg('quality', e.quality); if (e.end && $('#f-end')) $('#f-end').value = isoToLocalDT(e.end); }
  else if (type === 'feed') { setSeg('side', e.side); const fdur = $('#f-dur'); if (fdur) { fdur.dataset.value = e.duration || 0; fdur.textContent = e.duration || 0; } }
  else if (type === 'bottle' || type === 'pump') {
    setSeg('side', e.side); setSeg('contents', e.contents);
    let a = Number(e.amount) || 0; if (state().settings.units.volume === 'oz') a = Math.round((a / 29.5735) * 10) / 10;
    const famt = $('#f-amt'); if (famt) { famt.dataset.value = a; famt.textContent = a; }
  } else if (type === 'diaper') { setSeg('kind', e.kind); setSeg('size', e.size); }
  else if (type === 'medicine') { if ($('#f-med')) $('#f-med').value = e.medId; }
}

export function saveLog(type, id) {
  const e = gather(type);
  if (id) {
    updateEntry(id, e);
    sheet.close(); toast(TYPES[type].label + ' updated'); router.refresh();
    return;
  }
  const split = maybeInterruptSleep(type, e.start);
  const added = addEntry(e);
  sheet.close();
  if (state().settings.sound !== false) { chime(); buzz(15); }
  confetti();
  toast(TYPES[type].label + ' logged', () => { removeEntry(added.id); undoInterruptSleep(split); router.refresh(); });
  router.refresh();
}

export function openTypeChooser() {
  const types = ['sleep', 'feed', 'bottle', 'diaper', 'medicine', 'pump', 'note', 'play', 'bath'];
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

// ---------- card config ----------
export function editCard(which) {
  const s = state().settings;
  if (which === 'bottle') {
    sheet.open(`
      ${stepperField('Remind every (hours)', 'c-int', 1, 8, 0.5, s.bottleIntervalH)}
      <p class="empty-note">Next bottle is predicted from your last feed plus this interval.</p>
      <button class="btn-primary" data-action="card:save-bottle"><svg class="icon"><use href="#check"></use></svg> Save</button>
      <button class="btn-ghost" data-action="card:hide" data-card="bottle">Hide this card</button>`,
      { title: 'Bottle reminder' });
  } else if (which === 'medicine') {
    sheet.open(medForm(), { title: 'Medicines', size: 'sheet-form' });
  } else if (which === 'sweetspot') {
    sheet.open(`
      <p class="empty-note">SweetSpot predicts the next ideal nap from ${state().baby.name || 'your baby'}'s age (${ageLabel()}) and current awake time.</p>
      <button class="btn-ghost" data-action="card:hide" data-card="sweetspot">Hide this card</button>`,
      { title: 'SweetSpot' });
  } else {
    const c = TYPES[which] || { label: which };
    const cur = (s.cards.intervals || {})[which] ?? 3;
    sheet.open(`
      ${stepperField('Remind every (hours)', 'c-int', 1, 24, 0.5, cur)}
      <p class="empty-note">Next ${esc(c.label.toLowerCase())} is predicted from the last entry plus this interval.</p>
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
  // Re-adding a hidden default just unhides it; generic types need an interval.
  if (type === 'bottle' || type === 'medicine') { showCard(type); return; }
  const c = TYPES[type] || { label: type };
  sheet.open(`
    ${stepperField('Remind every (hours)', 'c-int', 1, 24, 0.5, 3)}
    <p class="empty-note">Next ${esc(c.label.toLowerCase())} is predicted from the last entry plus this interval.</p>
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

export function saveBottle() {
  state().settings.bottleIntervalH = Number($('#c-int').dataset.value) || 3;
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
