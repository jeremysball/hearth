// reminders.js — local notification engine using Web Notifications + setTimeout scheduling.
import { state, derive } from './store.js';
import { toast } from './ui.js';
import { router } from './app.js';

let _granted = false;
let _scheduled = {};

export function notify(title, body) {
  if (!_granted || !('serviceWorker' in navigator)) return Promise.resolve(false);
  // Chrome for Android never implements `new Notification()` (throws "Illegal
  // constructor" by design) — showNotification() via the SW registration is
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
  if (_granted) { toast('Reminders enabled ✓'); scheduleReminders(); router.refresh(); }
  else toast('Permission denied — enable in browser settings');
}

export function notifsGranted() { return _granted; }

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
  reminders.forEach((rem) => {
    const delay = rem.at - now;
    if (delay < 0 || delay > 12 * 3600000) return; // only schedule within 12h
    if (isQuiet(rem.at, quietStart, quietEnd)) return;
    _scheduled[rem.key] = setTimeout(() => {
      notify(rem.title, rem.body);
      delete _scheduled[rem.key];
    }, delay);
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
document.addEventListener('DOMContentLoaded', () => {
  if ('Notification' in window && Notification.permission === 'granted') {
    _granted = true;
    scheduleReminders();
  }
});
