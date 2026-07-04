// reminders.js: local notification engine using Web Notifications + setTimeout scheduling.
import { state, derive } from './store.js';
import { toast } from './ui.js';
import { router } from './app.js';

let _granted = false;
let _hasLocalSub = false;
let _scheduled = {};

const NOTIFIED_KEY = 'hearth.notified.v1';

function urlBase64ToUint8Array(base64) {
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const data = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...data].map((ch) => ch.charCodeAt(0)));
}

async function subscribePush(reg) {
  if (!reg?.pushManager) {
    throw new Error('Push is not supported in this browser');
  }
  const keyRes = await fetch('/api/push/public-key', { credentials: 'include' });
  if (!keyRes.ok) {
    throw new Error(keyRes.status === 503
      ? 'Server VAPID keys not configured'
      : `public-key endpoint returned ${keyRes.status}`);
  }
  const { publicKey } = await keyRes.json();
  if (!publicKey) {
    throw new Error('Server returned an empty VAPID public key');
  }
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  const res = await postSubscription(sub);
  if (!res.ok) {
    throw new Error(`subscribe endpoint returned ${res.status}`);
  }
  return true;
}

function postSubscription(sub) {
  return fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(sub),
  });
}

// POST an existing local PushSubscription back to the server and report
// whether the server actually confirmed it. The server upserts by endpoint
// (push.go: ON CONFLICT(endpoint) DO UPDATE), so calling this when the row
// already exists just refreshes caregiver_id/p256dh/auth. This is what
// re-attaches a sub to the current caregiver after their server row was
// deleted but their browser still holds the local subscription -- and the
// boolean it returns is the only trustworthy signal that push actually
// works, since a local PushSubscription can outlive its server-side row.
async function reRegisterLocalSub(sub) {
  if (!sub) return false;
  try {
    const res = await postSubscription(sub);
    return res.ok;
  } catch {
    return false;
  }
}

// Reads the browser's current PushSubscription, or null if there is none
// (unsupported, never subscribed, or the browser dropped it).
async function getLocalSub() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return (reg?.pushManager && await reg.pushManager.getSubscription()) || null;
  } catch {
    return null;
  }
}

export async function sendTestPush() {
  const res = await fetch('/api/push/test', { method: 'POST', credentials: 'include' });
  if (!res.ok) {
    throw new Error(`test push endpoint returned ${res.status}`);
  }
}

function loadNotified() {
  try { return new Map(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]')); }
  catch { return new Map(); }
}
function saveNotified(m) {
  const cutoff = Date.now() - 12 * 3600000;
  const entries = [...m.entries()].filter(([, at]) => at > cutoff);
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(entries));
}

export function notify(title, body) {
  if (!_granted || !('serviceWorker' in navigator)) return Promise.resolve(false);
  // Chrome for Android never implements `new Notification()` (throws "Illegal
  // constructor" by design). showNotification() via the SW registration is
  // the only path that works everywhere, including there.
  return navigator.serviceWorker.ready
    .then((reg) => reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }))
    .then(() => true)
    .catch(() => false);
}

export async function enableNotifs() {
  if (!('Notification' in window)) { toast('Notifications not supported in this browser'); return; }
  const perm = await Notification.requestPermission();
  _granted = perm === 'granted';
  if (_granted) {
    const reg = await navigator.serviceWorker.ready;
    try {
      await subscribePush(reg);
      _hasLocalSub = true; // subscribePush's own POST already confirmed the server row
    } catch (err) {
      toast('Reminders enabled, but push failed: ' + (err?.message || err));
      // subscribe() may have already created a local subscription even
      // though the follow-up POST failed -- give it one more chance to sync.
      await refreshSubState();
      scheduleReminders();
      router.refresh();
      return;
    }
    toast('Reminders enabled ✓');
    scheduleReminders();
    router.refresh();
  }
  else toast('Permission denied, enable in browser settings');
}

// Re-confirms with the server that the browser's current local
// PushSubscription (if any) has a matching row, and updates the flag
// notifsGranted() reads. A local subscription alone is not proof push
// works: the server-side row backing it can be deleted independently (DB
// cleanup, migration, expiry), so this always re-POSTs to verify rather
// than trusting mere local presence -- otherwise a failed re-attach would
// silently leave the profile showing "Notifications on" with no working
// push, the exact bug this flag exists to catch.
export async function refreshSubState() {
  const sub = await getLocalSub();
  _hasLocalSub = sub ? await reRegisterLocalSub(sub) : false;
  return _hasLocalSub;
}

export async function initNotifState() {
  // _granted reflects browser-side permission only — it's what the local
  // setTimeout reminder path needs. _hasLocalSub (via refreshSubState) is
  // the separate, server-confirmed signal for the profile's Enable/Test
  // button (see notifsGranted()).
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  _granted = true;
  await refreshSubState();
  scheduleReminders();
  router.refresh();
}

export function notifsGranted() { return _granted && _hasLocalSub; }

export function scheduleReminders() {
  // clear old
  Object.values(_scheduled).forEach((id) => clearTimeout(id));
  _scheduled = {};
  if (!_granted) return;
  const reminders = derive.reminders();
  const r = state().settings.reminders;
  const now = Date.now();
  const quietStart = timeToMs(r.quietStart || '20:00');
  const quietEnd = timeToMs(r.quietEnd || '07:00');
  const notified = loadNotified();
  reminders.forEach((rem) => {
    const notifiedKey = rem.key + ':' + rem.at;
    if (notified.has(notifiedKey)) return;
    const delay = rem.at - now;
    if (delay > 12 * 3600000) return;  // keep the 12h future cap
    if (!rem.key.startsWith('med-') && isQuiet(rem.at, quietStart, quietEnd)) return;
    _scheduled[rem.key] = setTimeout(() => {
      notify(rem.title, rem.body);
      delete _scheduled[rem.key];
      const n = loadNotified();
      n.set(notifiedKey, rem.at);
      saveNotified(n);
    }, Math.max(0, delay));  // clamp: fires immediately if past-due
  });
}

function timeToMs(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  return d.getTime();
}
function isQuiet(at, qStart, qEnd) {
  const atMs = at % 86400000; // ms into day
  const s = qStart % 86400000, e = qEnd % 86400000;
  if (s > e) return atMs >= s || atMs < e; // overnight window
  return atMs >= s && atMs < e;
}

// reschedule every 5 min to keep fresh
setInterval(() => { if (_granted) scheduleReminders(); }, 5 * 60000);

// check existing permission on load
document.addEventListener('DOMContentLoaded', () => { initNotifState(); });
