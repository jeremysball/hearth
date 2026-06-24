// sheets.js — logging bottom sheet (detailed) + card config sheets.
import { state, save, ageLabel, addEntry, removeEntry, updateEntry, addMeasure, enqueueSettingsSync } from './store.js';
import { $, $$, esc, icon, TYPES, fmt, sheet, toast, nowTime, timeToISO } from './ui.js';
import { router } from './app.js';

// segmented control
function seg(group, opts, sel) {
  return `<div class="segctl" data-seg="${group}">` +
    opts.map((o) => `<button type="button" class="seg-opt ${o === sel ? 'on' : ''}" data-val="${esc(o)}">${esc(o)}</button>`).join('') +
    `</div>`;
}
function field(label, inner) { return `<label class="fld"><span class="fld-l">${label}</span>${inner}</label>`; }
function stepperField(label, id, min, max, step, val) {
  return field(label, `<div class="stepper">
    <button type="button" class="stepper-btn" data-action="stepper:down" data-target="${id}" aria-label="Decrease"><i class="ph ph-minus"></i></button>
    <div class="stepper-val" id="${id}" tabindex="0" role="spinbutton" aria-valuenow="${val}" aria-valuemin="${min != null ? min : ''}" aria-valuemax="${max != null ? max : ''}" data-step="${step}" data-min="${min != null ? min : ''}" data-max="${max != null ? max : ''}" data-value="${val}" data-action="stepper:open">${val}</div>
    <button type="button" class="stepper-btn" data-action="stepper:up" data-target="${id}" aria-label="Increase"><i class="ph ph-plus"></i></button>
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
  const OFF = 5;
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
    }
    items.style.transform = `translateY(calc(-50% + ${offset % ITEM_H}px))`;
    items.style.transition = 'none';
    return center;
  }

  function close() {
    overlay._closed = true;
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  let dragging = false, pid = null;
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
    dragging = true; pid = e.pointerId;
    dragY = e.clientY;
    offsetY = 0; velSamples = [];
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

    velSamples.push({ dy, t: performance.now() });
    if (velSamples.length > 5) velSamples.shift();

    offsetY = clampOffset(offsetY);
    render(offsetY);
  }

  function onUp(e) {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false; pid = null;

    // velocity from recent samples — px/ms, scaled to momentum
    let vel = 0;
    if (velSamples.length > 1) {
      const dt = velSamples[velSamples.length - 1].t - velSamples[0].t;
      const dd = velSamples.reduce((s, v) => s + v.dy, 0);
      if (dt > 0) vel = (dd / dt) * 100;
    }
    let momentum = offsetY + vel;
    let steps = Math.round(momentum / ITEM_H);
    let target = val - steps * step;
    if (target < min) target = min;
    if (target > max) target = max;

    commit(target);

    // visual snap animation only if there's a fractional offset to animate
    const visOffset = offsetY % ITEM_H;
    if (visOffset !== 0) {
      items.style.transition = 'transform .25s cubic-bezier(0.22, 0.61, 0.36, 1)';
      items.style.transform = `translateY(calc(-50% + 0px))`;
      setTimeout(() => {
        if (overlay._closed) return;
        items.style.transition = 'none';
        items.innerHTML = trackHTML(target);
        offsetY = 0;
      }, 280);
    } else {
      items.style.transition = 'none';
      items.innerHTML = trackHTML(target);
      offsetY = 0;
    }
  }

  items.addEventListener('pointerdown', onDown);
  items.addEventListener('pointermove', onMove);
  items.addEventListener('pointerup', onUp);
  items.addEventListener('pointercancel', onUp);

  document.body.appendChild(overlay);
  items.style.transform = `translateY(calc(-50% + 0px))`;
  requestAnimationFrame(() => overlay.classList.add('show'));
  el._closeSpinner = close;
}
const timeRow = () => field('Time', `<input type="time" id="f-time" value="${nowTime()}" />`);
const noteRow = () => field('Note', `<textarea id="f-note" rows="2" placeholder="Optional…"></textarea>`);
const segVal = (group) => { const el = $(`[data-seg="${group}"] .seg-opt.on`); return el ? el.dataset.val : null; };

const FORMS = {
  sleep: () => `
    ${field('Fell asleep', `<input type="time" id="f-time" value="${nowTime()}" />`)}
    ${field('Woke (leave blank if still asleep)', `<input type="time" id="f-end" />`)}
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
  note: () => `${timeRow()} ${field('Note', `<textarea id="f-note" rows="3" placeholder="What happened?"></textarea>`)}`
};

function gather(type) {
  const time = $('#f-time') ? timeToISO($('#f-time').value || nowTime()) : new Date().toISOString();
  const note = $('#f-note') ? $('#f-note').value.trim() : '';
  const base = { type, start: time };
  if (note) base.note = note;
  if (type === 'sleep') {
    base.quality = segVal('quality');
    const end = $('#f-end').value;
    if (end) base.end = timeToISO(end);
  } else if (type === 'feed') {
    base.side = segVal('side'); base.duration = Number($('#f-dur').dataset.value) || 0;
  } else if (type === 'bottle' || type === 'pump') {
    base.side = segVal('side'); base.contents = segVal('contents');
    let amt = Number($('#f-amt').dataset.value) || 0;
    if (state().settings.units.volume === 'oz') amt = amt * 29.5735; // store ml
    base.amount = Math.round(amt); base.unit = 'ml';
  } else if (type === 'diaper') {
    base.kind = segVal('kind');
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
    FORMS[type]() + `<button class="btn-primary" data-action="log:save" data-type="${type}" data-id="${editing ? entry.id : ''}"><i class="ph ph-check"></i> ${editing ? 'Save changes' : 'Log ' + cfg.label.toLowerCase()}</button>` +
      (editing ? `<button class="btn-ghost danger" data-action="entry:delete" data-id="${entry.id}"><i class="ph ph-trash"></i> Delete</button>` : ''),
    { title: (editing ? 'Edit ' : 'Log ') + cfg.label.toLowerCase(), size: 'sheet-form' }
  );
  if (editing) prefill(type, entry);
}

function localTime(iso) { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function setSeg(group, val) {
  const g = $(`[data-seg="${group}"]`); if (!g || val == null) return;
  $$('.seg-opt', g).forEach((b) => b.classList.toggle('on', b.dataset.val === val));
}
function prefill(type, e) {
  if ($('#f-time')) $('#f-time').value = localTime(e.start);
  if ($('#f-note')) $('#f-note').value = e.note || '';
  if (type === 'sleep') { setSeg('quality', e.quality); if (e.end) $('#f-end').value = localTime(e.end); }
  else if (type === 'feed') { setSeg('side', e.side); const fdur = $('#f-dur'); if (fdur) { fdur.dataset.value = e.duration || 0; fdur.textContent = e.duration || 0; } }
  else if (type === 'bottle' || type === 'pump') {
    setSeg('side', e.side); setSeg('contents', e.contents);
    let a = Number(e.amount) || 0; if (state().settings.units.volume === 'oz') a = Math.round((a / 29.5735) * 10) / 10;
    const famt = $('#f-amt'); if (famt) { famt.dataset.value = a; famt.textContent = a; }
  } else if (type === 'diaper') { setSeg('kind', e.kind); }
  else if (type === 'medicine') { if ($('#f-med')) $('#f-med').value = e.medId; }
}

export function saveLog(type, id) {
  const e = gather(type);
  if (id) {
    updateEntry(id, e);
    sheet.close(); toast(TYPES[type].label + ' updated'); router.refresh();
    return;
  }
  const added = addEntry(e);
  sheet.close();
  toast(TYPES[type].label + ' logged', () => { removeEntry(added.id); router.refresh(); });
  router.refresh();
}

export function openTypeChooser() {
  const types = ['sleep', 'feed', 'bottle', 'diaper', 'medicine', 'pump', 'note'];
  sheet.open(
    `<div class="chooser">` + types.map((t) => {
      const c = TYPES[t];
      return `<button class="chooser-item" data-action="log:open" data-type="${t}">
        <span class="chooser-ic tone-${c.tone}"><i class="ph ph-${icon(c.icon)}"></i></span>
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
      <button class="btn-primary" data-action="card:save-bottle"><i class="ph ph-check"></i> Save</button>
      <button class="btn-ghost" data-action="card:hide" data-card="bottle">Hide this card</button>`,
      { title: 'Bottle reminder' });
  } else if (which === 'medicine') {
    sheet.open(medForm(), { title: 'Medicines', size: 'sheet-form' });
  } else if (which === 'sweetspot') {
    sheet.open(`
      <p class="empty-note">SweetSpot predicts the next ideal nap from ${state().baby.name || 'your baby'}'s age (${ageLabel()}) and current awake time.</p>
      <button class="btn-ghost" data-action="card:hide" data-card="sweetspot">Hide this card</button>`,
      { title: 'SweetSpot' });
  }
}

function medForm() {
  const meds = state().settings.meds;
  return `<div id="med-list" class="med-list">` +
    (meds.length ? meds.map(medRow).join('') : `<p class="empty-note">No medicines yet.</p>`) +
    `</div>
    <button class="btn-ghost" data-action="med:add"><i class="ph ph-plus"></i> Add medicine</button>
    <button class="btn-primary" data-action="card:save-meds"><i class="ph ph-check"></i> Save</button>
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
      <button class="med-del" data-action="med:remove" data-mid="${m.id}" aria-label="Remove"><i class="ph ph-trash"></i></button>
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
    <button class="btn-primary" data-action="measure:save" data-id="${id || ''}"><i class="ph ph-check"></i> ${id ? 'Save changes' : 'Add measurement'}</button>
    ${id ? `<button class="btn-ghost danger" data-action="measure:delete" data-id="${id}"><i class="ph ph-trash"></i> Delete</button>` : ''}`,
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
