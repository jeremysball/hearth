# Hearth — Notifications, Sync, and Reminder Polish

**Date:** 2026-06-30
**Status:** Approved — partially landed (see per-section notes)

---

## Bug 1: Bottle and medicine notifications not firing on mobile

### Problem

On iOS PWAs, nap (sweet spot) notifications fire but bottle and medicine notifications do not. Permission is granted and the app is installed to the home screen.

### Root Cause

Three factors combine:

1. **iOS kills page timers in the background.** `scheduleReminders` (`js/reminders.js:42`) arms each reminder with `setTimeout` and re-arms every 5 minutes. iOS suspends these when the PWA is backgrounded. Sweet spot windows are short and usually come due while the user has the app open. Bottle and medicine intervals are 3h to 24h — they almost always come due while the app is backgrounded or the screen is locked.

2. **Medicine reminders get silently dropped by quiet hours.** `isQuiet` (`js/reminders.js:74`) drops any reminder whose `at` falls inside the 20:00–07:00 window. A 24h medicine with a 9pm dose time never fires because the due moment is always quiet. Medicine must ignore quiet hours.

3. **`showNotification` from page context is unreliable on iOS.** iOS WebKit only reliably displays notifications triggered from a `push` event inside the service worker. `notify()` (`js/reminders.js:21`) calls `reg.showNotification()` from page context, which iOS drops when the PWA is not in the foreground.

### Landed

**`7f89098` fix(reminders): fire past-due bottle and medicine reminders**

- Removed the `delay < 0` guard that silently dropped past-due reminders.
- Clamps `setTimeout` delay to `Math.max(0, delay)` so past-due reminders fire immediately on the next `scheduleReminders` call.
- Added a `notified` set (backed by `localStorage` under `hearth.notified.v1`) keyed by `rem.key + ':' + rem.at`. A reminder that already fired is skipped on re-arm; entries older than 12h are pruned on every save.
- Covers root causes: any reminder that comes due while the app is foregrounded (or comes due while backgrounded and is caught on next foreground) now fires once and only once.

Root cause 1 (iOS background timer kill) and root cause 3 (`showNotification` from page context) are **not yet addressed** — those require Web Push.

### Remaining Fix

Replace page-timer scheduling with Web Push so the server triggers notifications at due time.

**Crypto and transport:** Use `github.com/SherClockHolmes/webpush-go` in the Go server. It handles ECDH key agreement (P-256), HKDF payload key derivation, AES-128-GCM encryption, and VAPID JWT signing. No hand-rolled crypto. Generate a VAPID keypair once; bundle the public key in `sw.js`, keep the private key in server config.

**Client changes:**

1. In `enableNotifs` (`js/reminders.js:32`), after permission is granted, call `reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`. POST the resulting subscription (`endpoint`, `p256dh`, `auth`) to `POST /api/push/subscribe`.
2. Add to `sw.js`:
   - `push` event: `e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon, badge, data: { key: data.key } }))`.
   - `notificationclick` event: focus an existing client or `clients.openWindow`, then `notification.close()`.
3. Retain `scheduleReminders` for foreground catch-up. Remove the quiet hours check for medicine entries specifically (medicine always fires).

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
3. **Server `since` comparison was lexical, not temporal.** An entry with `updated_at = "...05.1234Z"` compared lexically against `since = "...05.123Z"` sorted _before_ it and was omitted from the sync response, silently dropping the entry.

### Landed

**`83df1d0` feat(sync): drain outbox immediately on log entry**

- Wires a `_syncTrigger` callback (set by `app.js` via `setSyncTrigger`) into `addEntry`, `removeEntry`, and `updateEntry` in `store.js`.
- On every mutation, `drainOutbox()` + `syncOnce()` fires immediately rather than waiting up to 30s.
- Covers the send side: the logging device pushes its entry to the server right away.

**`299b1ed` fix(sync): compare sync timestamps as times**

- `changedAfter(updatedAt, since)` in `server/sync.go` parses both values as `time.Time` and uses `.After()` for comparison, falling back to lexical only if parsing fails.
- `syncLowerBound(since)` truncates `since` to second precision for the SQL `WHERE updated_at > ?` clause, ensuring same-second entries are fetched and then filtered correctly in Go.
- `nowISO()` in `server/db.go` now formats with a fixed nanosecond layout (`"2006-01-02T15:04:05.000000000Z"`) rather than `time.RFC3339Nano`, ensuring consistent formatting across all server-written timestamps.
- Covers root cause 3: no more silently dropped entries from fractional-second timestamp ordering.

Root causes 1 and 2 (no `visibilitychange` listener, SSE not reconnecting on foreground) are **not yet addressed**.

### Remaining Fix

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

### Landed

**`1d0d099` fix(home): show elapsed time on overdue reminders**

- Removed the `overdue ? 'due now' : fmt.untilOrAgo(nb.due)` ternary from `bottleCard`, `medicineCard`, and `genericCard`. The `ic-rel` span now always renders `fmt.untilOrAgo(due)`.
- `fmt.untilOrAgo` already returns `"X min ago"` / `"Xh Xm ago"` for past dates, so the elapsed time is now visible in the `ic-rel` span.
- The `ic-lbl` ("Next bottle · every 3h") does not yet change when overdue, and there is no dedicated 15s refresh tick.

### Remaining Fix

1. **Card label update** — in `bottleCard` (`js/home.js`), `medicineCard`, and `genericCard`: when `due <= now`, set `ic-lbl` to `"${label} · ${fmt.untilOrAgo(due)}"`. Keep the `"Next bottle · every 3h"` form when not overdue. No new `fmt.elapsed` helper needed — `fmt.untilOrAgo` already produces the right string.
2. **Live tick** — add a 15s interval in `js/app.js` beside `tick`. When `current === 'home'` and no sheet is open, call a new `refreshOverdueLabels()` exported from `js/home.js`. It updates only `.ic-lbl` and `.ic-rel` text nodes of overdue cards by re-reading derive values — no full re-render.

### Touched Code

- `js/home.js`: `bottleCard`, `medicineCard`, `genericCard` overdue branch; new `refreshOverdueLabels`.
- `js/app.js`: 15s interval calling `refreshOverdueLabels`.

### Verification

- Log a bottle, advance past the interval. Card reads "Bottle due · 12 min ago" and the count advances within 15s without a manual refresh.
- Non-overdue state still reads "Next bottle · every 3h" with a future relative span.
- Playwright test: log a bottle, mock time past due, assert the label text and that it updates after a tick.
- Bump `index.html` and `sw.js` version.
