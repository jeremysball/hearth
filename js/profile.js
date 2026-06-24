// profile.js — baby details, reminders, units, caregivers, reset.
import { state } from './store.js';
import { esc } from './ui.js';
import { notifsGranted } from './reminders.js';

function sw(path, on) {
  return `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-action="toggle" data-path="${path}"><span class="knob"></span></button>`;
}
function segBind(path, opts, val) {
  return `<div class="segctl sm" data-bind-seg="${path}">` +
    opts.map((o) => `<button type="button" class="seg-opt ${o.v === val ? 'on' : ''}" data-val="${o.v}">${esc(o.l)}</button>`).join('') + `</div>`;
}

export function profile() {
  const b = state().baby, s = state().settings;
  return `
    <div class="page-hd"><h1 class="page-title">Profile</h1></div>

    <div class="card prof-baby">
      <button class="prof-photo" data-action="profile:photo">
        ${b.photo ? `<span class="avatar lg" style="background-image:url('${b.photo}')"></span>` : `<span class="avatar lg">${esc((b.name || 'B')[0].toUpperCase())}</span>`}
        <span class="photo-edit"><i class="ph ph-camera"></i></span>
      </button>
      <div class="prof-fields">
        <label class="fld"><span class="fld-l">Name</span><input data-bind="baby.name" value="${esc(b.name)}" /></label>
        <label class="fld"><span class="fld-l">Birthdate</span><input type="date" data-bind="baby.birthdate" value="${esc(b.birthdate)}" /></label>
      </div>
    </div>

    <div class="sec-label">Theme</div>
    <div class="card row-card">
      <div class="set-row"><span>App theme</span>${segBind('baby.theme', [{ v: 'girl', l: 'Girl' }, { v: 'boy', l: 'Boy' }], b.theme)}</div>
    </div>

    <div class="sec-label">Appearance</div>
    <div class="card row-card">
      <div class="set-row"><span>Dark mode</span>${segBind('settings.darkMode', [{ v: 'light', l: 'Light' }, { v: 'auto', l: 'Auto' }, { v: 'dark', l: 'Dark' }], s.darkMode || 'auto')}</div>
    </div>

    <div class="sec-label">Reminders & notifications</div>
    <div class="card row-card">
      ${!notifsGranted() ? `<div class="set-row notif-row"><span class="notif-txt"><b>Enable notifications</b><span class="fld-l">Required for reminders</span></span><button class="btn-sm" data-action="notif:enable">Enable</button></div>` : `<div class="set-row notif-row"><span class="notif-txt"><b>Notifications on</b><span class="fld-l">Reminders active</span></span><button class="btn-sm" data-action="notif:test">Test</button></div>`}
      <div class="set-row"><span>Nap reminders</span>${sw('settings.reminders.naps', s.reminders.naps)}</div>
      <div class="set-row"><span>Bottle reminders</span>${sw('settings.reminders.bottle', s.reminders.bottle)}</div>
      <div class="set-row"><span>Medicine reminders</span>${sw('settings.reminders.meds', s.reminders.meds)}</div>
      <div class="set-row"><span>Quiet hours</span><span class="quiet"><input type="time" data-bind="settings.reminders.quietStart" value="${s.reminders.quietStart}" /> – <input type="time" data-bind="settings.reminders.quietEnd" value="${s.reminders.quietEnd}" /></span></div>
    </div>

    <div class="sec-label">Units & preferences</div>
    <div class="card row-card">
      <div class="set-row"><span>Volume</span>${segBind('settings.units.volume', [{ v: 'ml', l: 'ml' }, { v: 'oz', l: 'oz' }], s.units.volume)}</div>
      <div class="set-row"><span>Temperature</span>${segBind('settings.units.temp', [{ v: 'C', l: '°C' }, { v: 'F', l: '°F' }], s.units.temp)}</div>
      <div class="set-row"><span>Weight</span>${segBind('settings.units.weight', [{ v: 'kg', l: 'kg' }, { v: 'lb', l: 'lb' }], s.units.weight)}</div>
      <div class="set-row"><span>Length</span>${segBind('settings.units.length', [{ v: 'cm', l: 'cm' }, { v: 'in', l: 'in' }], s.units.length)}</div>
    </div>

    <div class="sec-label">Caregivers & sharing</div>
    <div class="card row-card" id="cg-list">
      ${caregiversSnapshot().length ? caregiversSnapshot().map(caregiverRow).join('') : `<p class="empty-note">Just you so far.</p>`}
      <button class="add-row" data-action="cg:invite"><i class="ph ph-plus"></i> Invite a caregiver</button>
    </div>

    <button class="btn-ghost danger" data-action="app:reset"><i class="ph ph-arrow-counter-clockwise"></i> Reset app & start over</button>
    <div class="foot-note">Hearth · prototype · data stored on this device · ${document.querySelector('meta[name="version"]')?.content || ''}</div>`;
}

let cachedCaregivers = [];

export async function loadCaregivers() {
  try {
    const res = await fetch('/api/caregivers', { credentials: 'include' });
    if (!res.ok) return;
    cachedCaregivers = await res.json();
  } catch (e) {
    // offline; keep showing whatever was cached from the last successful load
  }
}

export function caregiversSnapshot() { return cachedCaregivers; }

function caregiverRow(c) {
  return `<div class="cg-row">
    <i class="ph ph-user-circle"></i>
    <span class="cg-display"><b>${esc(c.displayName)}</b><span class="fld-l">${esc(c.role)}</span></span>
  </div>`;
}
