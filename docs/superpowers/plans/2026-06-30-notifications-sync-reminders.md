# Notifications Sync and Reminder Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bottle and medicine reminders reliable on mobile, recover sync promptly on foreground, and keep overdue reminder labels live.

**Architecture:** Add Web Push alongside the existing foreground timer path, using direct environment variable reads for VAPID keys. Keep local catch-up scheduling for foreground use, add a visibility sync hook for missed SSE events, and update overdue Home card labels without a full render.

**Tech Stack:** Vanilla ES modules, service worker Push API, Go `net/http`, SQLite, `github.com/SherClockHolmes/webpush-go`, Playwright, Node test runner.

## Global Constraints

- No framework. Vanilla JS PWA plus Go backend plus SQLite.
- Do not add server configuration fields for push settings; read `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` directly from environment variables.
- Do not hand-roll Web Push crypto; use `github.com/SherClockHolmes/webpush-go`.
- Retain foreground `scheduleReminders()` as catch-up behavior.
- Medicine reminders ignore quiet hours.
- Run `scripts/bump-version.sh` before each frontend commit.

---

## File Structure

- Modify `go.mod` and `go.sum`: add `github.com/SherClockHolmes/webpush-go v1.4.0`.
- Modify `server/schema.sql`: add `push_subscriptions` table.
- Create `server/push.go`: push subscription endpoint, environment key reads, reminder scheduling, stale subscription cleanup.
- Create `server/push_test.go`: cover subscription persistence, missing VAPID behavior, and HTTP 410 cleanup helper.
- Modify `server/router.go`: register push routes and pass scheduler to entry handler if needed.
- Modify `server/entries.go`: schedule push reminders after successful entry upserts.
- Modify `js/reminders.js`: subscribe with Push API and keep medicine reminders out of quiet-hour drops.
- Modify `sw.js`: handle `push` and `notificationclick` events.
- Modify `js/app.js`: add `visibilitychange` sync and shorter poll interval; add overdue label tick.
- Modify `js/home.js`: render overdue labels and export `refreshOverdueLabels()`.
- Modify `js/reminders.test.js`, `js/home.test.js`, and Playwright tests for changed behavior.
- Modify `index.html` and `sw.js`: version bump through `scripts/bump-version.sh`.

---

### Task 1: Web Push Subscription and Server Reminder Scheduler

**Files:**
- Modify: `go.mod`, `go.sum`
- Modify: `server/schema.sql:104`
- Create: `server/push.go`
- Create: `server/push_test.go`
- Modify: `server/router.go:51-82`
- Modify: `server/entries.go:10-45`
- Modify: `js/reminders.js:21-67`
- Modify: `sw.js:1-90`
- Modify: `index.html`, `sw.js` by version script

**Interfaces:**
- Consumes: env vars `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` read with `os.Getenv` inside `server/push.go`.
- Produces: `GET /api/push/public-key`, `POST /api/push/subscribe`, SQLite table `push_subscriptions`, `pushScheduler.ScheduleFamily(familyID string)`, service worker `push` and `notificationclick` handlers.

- [ ] **Step 1: Add the Web Push dependency**

Run: `cd server && go get github.com/SherClockHolmes/webpush-go@v1.4.0`

Expected: `go.mod` includes `github.com/SherClockHolmes/webpush-go v1.4.0` and `go.sum` updates.

- [ ] **Step 2: Add failing server tests**

Create `server/push_test.go`:

```go
package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlePushPublicKeyRequiresEnv(t *testing.T) {
	t.Setenv("VAPID_PUBLIC_KEY", "")
	req := httptest.NewRequest("GET", "/api/push/public-key", nil)
	rec := httptest.NewRecorder()

	handlePushPublicKey()(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

func TestHandlePushSubscribeStoresSubscriptionForSessionCaregiver(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	body := `{"endpoint":"https://push.example/sub1","keys":{"p256dh":"p256dh-key","auth":"auth-key"}}`
	req := httptest.NewRequest("POST", "/api/push/subscribe", bytes.NewBufferString(body))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handlePushSubscribe(db)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var caregiverID, endpoint, p256dh, auth string
	db.QueryRow(`SELECT caregiver_id, endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = 'https://push.example/sub1'`).Scan(&caregiverID, &endpoint, &p256dh, &auth)
	if caregiverID != "cg1" || endpoint == "" || p256dh != "p256dh-key" || auth != "auth-key" {
		t.Fatalf("subscription = caregiver=%q endpoint=%q p256dh=%q auth=%q", caregiverID, endpoint, p256dh, auth)
	}
}

func TestDeletePushSubscriptionRemovesEndpoint(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	db.Exec(`INSERT INTO push_subscriptions (id, caregiver_id, endpoint, p256dh, auth, created_at) VALUES ('sub1', 'cg1', 'https://push.example/dead', 'p', 'a', ?)`, now)

	if err := deletePushSubscription(db, "https://push.example/dead"); err != nil {
		t.Fatalf("delete subscription: %v", err)
	}
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM push_subscriptions WHERE endpoint = 'https://push.example/dead'`).Scan(&count)
	if count != 0 {
		t.Fatalf("subscription count = %d, want 0", count)
	}
}
```

- [ ] **Step 3: Run tests and verify they fail**

Run: `cd server && go test ./...`

Expected: FAIL because `push_subscriptions`, `handlePushPublicKey`, `handlePushSubscribe`, and `deletePushSubscription` do not exist.

- [ ] **Step 4: Add push subscription schema**

Append to `server/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL REFERENCES caregivers(id),
  endpoint     TEXT NOT NULL,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_caregiver ON push_subscriptions(caregiver_id);
```

- [ ] **Step 5: Create push server helpers and handlers**

Create `server/push.go`:

```go
package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type pushSubscriptionRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256DH string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

func handlePushPublicKey() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		publicKey := os.Getenv("VAPID_PUBLIC_KEY")
		if publicKey == "" {
			http.Error(w, "push is not configured", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"publicKey": publicKey})
	}
}

func handlePushSubscribe(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		var body pushSubscriptionRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Endpoint == "" || body.Keys.P256DH == "" || body.Keys.Auth == "" {
			http.Error(w, "invalid subscription", http.StatusBadRequest)
			return
		}
		id := pushSubscriptionID(body.Endpoint)
		_, err := db.Exec(`
			INSERT INTO push_subscriptions (id, caregiver_id, endpoint, p256dh, auth, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(endpoint) DO UPDATE SET caregiver_id = excluded.caregiver_id, p256dh = excluded.p256dh, auth = excluded.auth`,
			id, session.CaregiverID, body.Endpoint, body.Keys.P256DH, body.Keys.Auth, nowISO())
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func pushSubscriptionID(endpoint string) string {
	sum := sha256.Sum256([]byte(endpoint))
	return hex.EncodeToString(sum[:])
}

func deletePushSubscription(db *sql.DB, endpoint string) error {
	_, err := db.Exec(`DELETE FROM push_subscriptions WHERE endpoint = ?`, endpoint)
	return err
}

type scheduledPush struct {
	timer *time.Timer
}

type pushScheduler struct {
	db      *sql.DB
	mu      sync.Mutex
	pending map[string]scheduledPush
}

func newPushScheduler(db *sql.DB) *pushScheduler {
	return &pushScheduler{db: db, pending: map[string]scheduledPush{}}
}

func (s *pushScheduler) ScheduleFamily(familyID string) {
	reminders, err := s.familyReminders(familyID)
	if err != nil {
		return
	}
	for _, rem := range reminders {
		key := familyID + ":" + rem.Key + ":" + rem.At.UTC().Format(time.RFC3339Nano)
		delay := time.Until(rem.At)
		if delay < 0 {
			delay = 0
		}
		s.mu.Lock()
		if old, ok := s.pending[key]; ok {
			old.timer.Stop()
		}
		s.pending[key] = scheduledPush{timer: time.AfterFunc(delay, func() {
			s.sendFamily(familyID, rem)
			s.mu.Lock()
			delete(s.pending, key)
			s.mu.Unlock()
		})}
		s.mu.Unlock()
	}
}

type pushReminder struct {
	Key   string
	Title string
	Body  string
	At    time.Time
}

func (s *pushScheduler) familyReminders(familyID string) ([]pushReminder, error) {
	var bottleInterval float64
	var medsJSON string
	if err := s.db.QueryRow(`SELECT bottle_interval_h, meds_json FROM settings WHERE family_id = ?`, familyID).Scan(&bottleInterval, &medsJSON); err != nil {
		return nil, err
	}
	reminders := []pushReminder{}
	var lastBottle string
	if err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = 'bottle' AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID).Scan(&lastBottle); err == nil {
		if t, err := time.Parse(time.RFC3339Nano, lastBottle); err == nil {
			reminders = append(reminders, pushReminder{Key: "bottle", Title: "Bottle due", Body: "Time for the next feed.", At: t.Add(time.Duration(bottleInterval * float64(time.Hour)))})
		}
	}
	var meds []struct {
		ID     string  `json:"id"`
		Name   string  `json:"name"`
		Dose   string  `json:"dose"`
		Unit   string  `json:"unit"`
		EveryH float64 `json:"everyH"`
	}
	json.Unmarshal([]byte(medsJSON), &meds)
	for _, med := range meds {
		var lastMed string
		err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = 'medicine' AND json_extract(payload_json, '$.medId') = ? AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID, med.ID).Scan(&lastMed)
		if err != nil {
			continue
		}
		if t, err := time.Parse(time.RFC3339Nano, lastMed); err == nil {
			reminders = append(reminders, pushReminder{Key: "med-" + med.ID, Title: med.Name + " due", Body: med.Dose + med.Unit + " scheduled now.", At: t.Add(time.Duration(med.EveryH * float64(time.Hour)))})
		}
	}
	return reminders, nil
}

func (s *pushScheduler) sendFamily(familyID string, rem pushReminder) {
	privateKey := os.Getenv("VAPID_PRIVATE_KEY")
	publicKey := os.Getenv("VAPID_PUBLIC_KEY")
	subject := os.Getenv("VAPID_SUBJECT")
	if privateKey == "" || publicKey == "" || subject == "" {
		return
	}
	rows, err := s.db.Query(`SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps JOIN caregivers c ON c.id = ps.caregiver_id WHERE c.family_id = ?`, familyID)
	if err != nil {
		return
	}
	defer rows.Close()
	payload, _ := json.Marshal(map[string]string{"title": rem.Title, "body": rem.Body, "key": rem.Key})
	for rows.Next() {
		var endpoint, p256dh, auth string
		if err := rows.Scan(&endpoint, &p256dh, &auth); err != nil {
			continue
		}
		resp, err := webpush.SendNotification(payload, &webpush.Subscription{Endpoint: endpoint, Keys: webpush.Keys{P256dh: p256dh, Auth: auth}}, &webpush.Options{Subscriber: subject, VAPIDPublicKey: publicKey, VAPIDPrivateKey: privateKey, TTL: 60})
		if resp != nil {
			if resp.StatusCode == http.StatusGone {
				deletePushSubscription(s.db, endpoint)
			}
			resp.Body.Close()
		}
		if err != nil {
			continue
		}
	}
}
```

- [ ] **Step 6: Wire scheduler and routes**

In `server/router.go`, inside `newRouter`, create the scheduler after `mux := http.NewServeMux()`:

```go
	pushes := newPushScheduler(db)
```

Add routes near other API routes:

```go
	mux.HandleFunc("GET /api/push/public-key", requireAuth(db, handlePushPublicKey()))
	mux.HandleFunc("POST /api/push/subscribe", requireAuth(db, handlePushSubscribe(db)))
```

Change the entry route to pass the scheduler:

```go
	mux.HandleFunc("PUT /api/entries/{id}", requireAuth(db, handleUpsertEntry(db, hub, pushes)))
```

In `server/entries.go`, change the function signature:

```go
func handleUpsertEntry(db *sql.DB, hub *Hub, pushes *pushScheduler) http.HandlerFunc {
```

After `hub.Broadcast(session.FamilyID)`, add:

```go
		if pushes != nil {
			pushes.ScheduleFamily(session.FamilyID)
		}
```

Update tests that call `handleUpsertEntry(db, hub)` to `handleUpsertEntry(db, hub, nil)`.

- [ ] **Step 7: Subscribe from the client**

In `js/reminders.js`, add this helper above `notify()`:

```js
function urlBase64ToUint8Array(base64) {
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const data = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...data].map((ch) => ch.charCodeAt(0)));
}

async function subscribePush(reg) {
  const keyRes = await fetch('/api/push/public-key', { credentials: 'include' });
  if (!keyRes.ok) return false;
  const { publicKey } = await keyRes.json();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(sub) });
  return res.ok;
}
```

In `enableNotifs()`, replace the granted branch with:

```js
  if (_granted) {
    const reg = await navigator.serviceWorker.ready;
    await subscribePush(reg).catch(() => false);
    toast('Reminders enabled ✓');
    scheduleReminders();
    router.refresh();
  }
```

In `scheduleReminders()`, change the quiet-hours line to:

```js
    if (!rem.key.startsWith('med-') && isQuiet(rem.at, quietStart, quietEnd)) return;
```

- [ ] **Step 8: Add service worker push handlers**

In `sw.js`, add after the `fetch` listener:

```js
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = {}; }
  const title = data.title || 'Hearth';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { key: data.key || '' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) {
      if ('focus' in client) return client.focus();
    }
    return clients.openWindow('/');
  }));
});
```

- [ ] **Step 9: Run push verification**

Run: `cd server && go test ./...`

Expected: PASS.

Run: `node --test js/reminders.test.js`

Expected: PASS. If the test stubs lack `navigator.serviceWorker.ready`, add the minimal stub used by `enableNotifs()`.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 10: Bump version and commit**

Run: `scripts/bump-version.sh`

Expected: matching `index.html` and `sw.js` version lines.

```bash
git add go.mod go.sum server/schema.sql server/push.go server/push_test.go server/router.go server/entries.go server/*_test.go js/reminders.js sw.js index.html
git commit -m "feat(reminders): add web push scheduling"
```

---

### Task 2: Foreground Sync Recovery

**Files:**
- Modify: `js/app.js:635-667`
- Create: `tests/sync-foreground.test.js`
- Modify: `index.html`, `sw.js` by version script

**Interfaces:**
- Consumes: private `syncOnce()` and `connectEvents()` in `js/app.js`.
- Produces: `visibilitychange` listener that syncs on foreground, reconnects closed SSE, and passive poll interval of 15 seconds.

- [ ] **Step 1: Write failing Playwright test**

Create `tests/sync-foreground.test.js`:

```js
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18799);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.evaluate(() => {
      window.__syncFetches = 0;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (...args) => {
        if (String(args[0]).includes('/api/sync')) window.__syncFetches += 1;
        return originalFetch(...args);
      };
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => window.__syncFetches > 0);
    check('foreground visibility change triggers sync', true);
  } catch (e) {
    check('sync foreground test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test and verify it fails**

Run: `CHROMIUM=/usr/bin/chromium node tests/sync-foreground.test.js`

Expected: FAIL because no `visibilitychange` listener calls `/api/sync`.

- [ ] **Step 3: Add foreground sync listener**

In `js/app.js`, add after the `online` listener:

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

Change the passive poll interval from:

```js
setInterval(syncOnce, 30000);
```

to:

```js
setInterval(syncOnce, 15000);
```

- [ ] **Step 4: Run sync verification**

Run: `CHROMIUM=/usr/bin/chromium node tests/sync-foreground.test.js`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 5: Bump version and commit**

Run: `scripts/bump-version.sh`

Expected: matching `index.html` and `sw.js` version lines.

```bash
git add js/app.js tests/sync-foreground.test.js index.html sw.js
git commit -m "fix(sync): pull when app returns foreground"
```

---

### Task 3: Live Overdue Reminder Labels

**Files:**
- Modify: `js/home.js:221-269`
- Modify: `js/app.js:1-16,550-555`
- Modify: `js/home.test.js`
- Create: `tests/overdue-labels.test.js`
- Modify: `index.html`, `sw.js` by version script

**Interfaces:**
- Consumes: `derive.nextBottle()`, `derive.nextMeds()`, `derive.nextForType(type)`, `fmt.untilOrAgo(due)`, and `TYPES`.
- Produces: overdue card labels like `Bottle due · 12 min ago`, future labels like `Next bottle · every 3h`, and exported `refreshOverdueLabels(): void`.

- [ ] **Step 1: Write failing unit tests for overdue labels**

Append to `js/home.test.js`:

```js
test('home cards put elapsed time in overdue bottle labels', async () => {
  const { state, save } = await import('./store.js');
  const { home } = await import('./home.js');
  state().setup = true;
  state().settings.bottleIntervalH = 3;
  state().log = [{ id: 'b1', type: 'bottle', start: new Date(Date.now() - 4 * 3600000).toISOString(), amount: 120 }];
  save();

  const html = home();

  assert.match(html, /Bottle due · .*ago/);
});
```

- [ ] **Step 2: Run unit test and verify it fails**

Run: `node --test js/home.test.js`

Expected: FAIL because the bottle label remains `Next bottle · every 3h`.

- [ ] **Step 3: Update Home card overdue labels**

In `js/home.js`, replace the bottle label inside `bottleCard()` with:

```js
  const label = overdue ? `Bottle due · ${fmt.untilOrAgo(nb.due)}` : `Next bottle · every ${state().settings.bottleIntervalH}h`;
```

Then use it in HTML:

```js
      <div class="ic-lbl">${esc(label)}</div>
```

In `medicineCard()`, after `else {`, set overdue label values:

```js
    const overdue = next.due <= new Date();
    lbl = next.med.name + ' · ' + next.med.dose + next.med.unit;
    val = `${fmt.clock(next.due)} <span class="ic-rel">${fmt.untilOrAgo(next.due)}</span>`;
    if (overdue) lbl = `${next.med.name} due · ${fmt.untilOrAgo(next.due)}`;
```

Change the visible label from static `Next medicine` to:

```js
<div class="ic-lbl">${esc(next.due && next.due <= new Date() ? lbl : 'Next medicine')}</div>
```

In `genericCard(type)`, add:

```js
  const label = overdue ? `${c.label} due · ${fmt.untilOrAgo(n.due)}` : `Next ${c.label.toLowerCase()} · every ${n.intervalH}h`;
```

Then use:

```js
      <div class="ic-lbl">${esc(label)}</div>
```

- [ ] **Step 4: Export `refreshOverdueLabels()`**

Add to `js/home.js` after `genericCard(type)`:

```js
export function refreshOverdueLabels() {
  const bottle = document.querySelector('[data-card="bottle"]');
  if (bottle) {
    const nb = derive.nextBottle();
    const overdue = nb.due <= new Date();
    const lbl = bottle.querySelector('.ic-lbl');
    const rel = bottle.querySelector('.ic-rel');
    if (lbl && overdue) lbl.textContent = `Bottle due · ${fmt.untilOrAgo(nb.due)}`;
    if (rel) rel.textContent = fmt.untilOrAgo(nb.due);
  }

  const medCard = document.querySelector('[data-card="medicine"]');
  if (medCard) {
    const next = derive.nextMeds().find((m) => m.due);
    if (next?.due) {
      const overdue = next.due <= new Date();
      const lbl = medCard.querySelector('.ic-lbl');
      const rel = medCard.querySelector('.ic-rel');
      if (lbl && overdue) lbl.textContent = `${next.med.name} due · ${fmt.untilOrAgo(next.due)}`;
      if (rel) rel.textContent = fmt.untilOrAgo(next.due);
    }
  }

  document.querySelectorAll('.info-card[data-type][data-card]').forEach((card) => {
    const type = card.dataset.type;
    if (!type || type === 'bottle') return;
    const c = TYPES[type];
    if (!c) return;
    const next = derive.nextForType(type);
    const lbl = card.querySelector('.ic-lbl');
    const rel = card.querySelector('.ic-rel');
    if (lbl && next.due <= new Date()) lbl.textContent = `${c.label} due · ${fmt.untilOrAgo(next.due)}`;
    if (rel) rel.textContent = fmt.untilOrAgo(next.due);
  });
}
```

- [ ] **Step 5: Add 15 second overdue label tick**

In `js/app.js`, change the home import to include `refreshOverdueLabels`:

```js
import { home, summary, enterTodayEditMode, exitTodayEditMode, enterCardEditMode, exitCardEditMode, refreshOverdueLabels } from './home.js';
```

Add this after `setInterval(tick, 60000);`:

```js
setInterval(() => {
  if (current === 'home' && $('#view') && !$('#scrim.show')) refreshOverdueLabels();
}, 15000);
```

- [ ] **Step 6: Write Playwright test for live labels**

Create `tests/overdue-labels.test.js`:

```js
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18800);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.evaluate(() => {
      const raw = localStorage.getItem('hearth.state.v1');
      const st = JSON.parse(raw);
      st.settings.bottleIntervalH = 3;
      st.log.unshift({ id: 'old-bottle', type: 'bottle', start: new Date(Date.now() - 4 * 3600000).toISOString(), amount: 120 });
      localStorage.setItem('hearth.state.v1', JSON.stringify(st));
    });
    await page.reload();
    await page.waitForSelector('[data-card="bottle"] .ic-lbl');
    const label = await page.$eval('[data-card="bottle"] .ic-lbl', (el) => el.textContent.trim());
    check('overdue bottle label includes elapsed time', /Bottle due · .*ago/.test(label), label);
  } catch (e) {
    check('overdue label test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 7: Run overdue verification**

Run: `node --test js/home.test.js`

Expected: PASS.

Run: `CHROMIUM=/usr/bin/chromium node tests/overdue-labels.test.js`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 8: Bump version and commit**

Run: `scripts/bump-version.sh`

Expected: matching `index.html` and `sw.js` version lines.

```bash
git add js/home.js js/app.js js/home.test.js tests/overdue-labels.test.js index.html sw.js
git commit -m "fix(home): refresh overdue reminder labels"
```

---

## Final Verification

- [ ] Run: `cd server && go test ./...`
- [ ] Run: `node --test js/reminders.test.js`
- [ ] Run: `node --test js/home.test.js`
- [ ] Run: `CHROMIUM=/usr/bin/chromium node tests/sync-foreground.test.js`
- [ ] Run: `CHROMIUM=/usr/bin/chromium node tests/overdue-labels.test.js`
- [ ] Run: `npm run check`
- [ ] On an iOS installed PWA with `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` set in the server environment, grant notifications, log a bottle, lock the phone, and confirm a bottle notification arrives at the due time.
- [ ] Confirm a 24 hour medicine logged at 9pm fires at 9pm the next day even though quiet hours include 20:00 to 07:00.

## Self-Review Notes

- Spec coverage: Web Push addresses mobile background timers and service worker notification delivery; medicine quiet-hour bypass, visibility sync, shorter polling, and overdue labels all have tasks.
- Placeholder scan: handlers, schema, client subscription, service worker events, sync listener, and label refresh code are concrete.
- Type consistency: `pushScheduler.ScheduleFamily(familyID string)`, `pushReminder`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and `refreshOverdueLabels()` are used consistently.
