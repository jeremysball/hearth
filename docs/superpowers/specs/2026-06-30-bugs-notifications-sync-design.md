# Hearth — Notifications, Sync, and Reminder Polish

**Date:** 2026-06-30
**Status:** Approved

---

## Bug 1: Bottle and medicine notifications not firing on mobile

### Problem

On iOS PWAs, nap (sweet spot) notifications fire but bottle and medicine notifications do not. Permission is granted and the app is installed to the home screen.

### Root Cause

Three factors combine:

1. **iOS kills page timers in the background.** `scheduleReminders` (`js/reminders.js:42`) arms each reminder with `setTimeout` and re-arms every 5 minutes. iOS suspends these when the PWA is backgrounded. Sweet spot windows are short and usually come due while the user has the app open. Bottle and medicine intervals are 3h to 24h — they almost always come due while the app is backgrounded or the screen is locked.

2. **Medicine reminders get silently dropped by quiet hours.** `isQuiet` (`js/reminders.js:74`) drops any reminder whose `at` falls inside the 20:00–07:00 window. A 24h medicine with a 9pm dose time never fires because the due moment is always quiet. Medicine must ignore quiet hours.

3. **`showNotification` from page context is unreliable on iOS.** iOS WebKit only reliably displays notifications triggered from a `push` event inside the service worker. `notify()` (`js/reminders.js:21`) calls `reg.showNotification()` from page context, which iOS drops when the PWA is not in the foreground.

### Fix

Replace page-timer scheduling with Web Push so the server triggers notifications at due time.

**Crypto and transport:** Use `github.com/SherClockHolmes/webpush-go` in the Go server. It handles ECDH key agreement (P-256), HKDF payload key derivation, AES-128-GCM encryption, and VAPID JWT signing. No hand-rolled crypto. Generate a VAPID keypair once; bundle the public key in `sw.js`, keep the private key in server config.

**Client changes:**

1. In `enableNotifs` (`js/reminders.js:32`), after permission is granted, call `reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`. POST the resulting subscription (`endpoint`, `p256dh`, `auth`) to `POST /api/push/subscribe`.
2. Add to `sw.js`:
   - `push` event: `e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon, badge, data: { key: data.key } }))`.
   - `notificationclick` event: focus an existing client or `clients.openWindow`, then `notification.close()`.
3. Retain `scheduleReminders` for foreground catch-up. Remove the quiet hours check for medicine entries specifically (medicine always fires).
4. Add a `visibilitychange` listener: on becoming visible, call `scheduleReminders()` and immediately fire any reminder whose `at` is past and not in `notified`.

**Server changes:**

1. New SQLite table in `server/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL REFERENCES caregivers(id),
  endpoint     TEXT NOT NULL,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
```

2. `POST /api/push/subscribe` — upsert a subscription row scoped to `sessionFrom(r).CaregiverID`. One caregiver may have multiple subscriptions (phone + tablet).
3. When an entry is upserted (`server/entries.go`), read `settings.bottleIntervalH` and `settings.meds` for the family, compute due times mirroring `derive.nextBottle` and `derive.nextMeds`, and schedule a goroutine with `time.AfterFunc` per reminder. Coalesce by `(caregiver_id, key, due_at)` — a reschedule cancels the prior pending goroutine.
4. At due time, call `webpush.SendNotification` for each subscription in the family. Drop subscriptions that return HTTP 410 (unsubscribed).

### Verification

- On an iOS PWA: grant permission, log no feeds for the full bottle interval, lock the phone. Confirm a bottle notification appears at the due moment.
- A 24h medicine with a 9pm last dose fires at 9pm the next day regardless of quiet hours.
- Foreground path still works: with the app open, a reminder fires without a push.
- `rg '410' server/` — confirm stale subscriptions are removed on 410 response.
- Bump `index.html` and `sw.js` version.

---

## Bug 2: Entry logged on one device not visible on partner's device without restart

### Problem

One caregiver logs a bottle. The partner's app does not show it until they restart.

### Root Cause

The server broadcasts on every entry upsert via SSE (`server/sse.go`, `entries.go:44`). The client subscribes in `connectEvents` (`js/app.js:656`) and calls `syncOnce` on message. But:

1. **No `visibilitychange` sync.** `js/app.js` attaches an `online` listener and a 30s `setInterval` to `syncOnce` but no `visibilitychange` listener. When the partner foregrounds the app, nothing triggers a pull until the next 30s tick.
2. **SSE dies in the background and reconnects only on foreground.** iOS drops `EventSource` sockets when backgrounded. The missed broadcast is never replayed — the server sends only a level trigger, not a payload. The `since` cursor means the next pull recovers all missed entries, but that pull never happens until a restart forces re-init.

### Fix

Add to `js/app.js` beside the `online` listener (`js/app.js:665`):

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  syncOnce();
  if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
    eventSource?.close();
    eventSource = null;
    connectEvents();
  }
});
```

Also shorten the passive poll interval from 30s to 15s. No server change required.

### Verification

- Two devices on the same family: log a bottle on A, background B for 2 minutes, foreground B. The entry appears within 2 seconds without restart.
- Force-close the SSE connection (toggle network); re-enable, confirm `connectEvents` reconnects and a subsequent log on A surfaces on B.

---

## Feature: Elapsed time on overdue reminders

### Problem

Reminder cards on Home show a future clock time and a relative "in Xh" span. Once the due moment passes, the label still reads "Next bottle" and the relative text updates only on the 60s view tick — up to a minute stale with no visual shift.

### Design

When `due <= now`, render the card label as `"${label} · ${fmt.elapsed(due)}"` and tick it live every 15s.

1. **`fmt.elapsed(date)`** — new helper in `js/ui.js` near `untilOrAgo` (line 36). Returns `"X min ago"` under 60 minutes, `"Xh Xm ago"` over. Distinct from `fmt.dur` which omits "ago".
2. **Card label update** — in `bottleCard` (`js/home.js:221`), `medicineCard` (line 233), and `genericCard` (line 258): when overdue, set `ic-lbl` to `"${label} · ${fmt.elapsed(nb.due)}"`. Keep `"Next bottle · every 3h"` form when not overdue.
3. **Live tick** — add a 15s interval in `js/app.js` beside `tick` (line 551). When `current === 'home'` and no sheet is open, call a new `refreshOverdueLabels()` exported from `js/home.js`. It updates only `.ic-lbl` and `.ic-rel` text nodes of overdue cards by re-reading derive values — no full re-render.

### Touched Code

- `js/ui.js`: `fmt.elapsed` near `untilOrAgo`.
- `js/home.js`: `bottleCard`, `medicineCard`, `genericCard` overdue branch; new `refreshOverdueLabels`.
- `js/app.js`: 15s interval calling `refreshOverdueLabels`.

### Verification

- Log a bottle, advance past the interval. Card reads "Bottle due · 12 min ago" and the count advances within 15s without a manual refresh.
- Non-overdue state still reads "Next bottle · every 3h" with a future relative span.
- Playwright test: log a bottle, mock time past due, assert the label text and that it updates after a tick.
- Bump `index.html` and `sw.js` version.
