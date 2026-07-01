# PWA Invite Install Implementation Plan

> **Status:** COMPLETE — merged to `main`. `POST /api/launch-tokens`, `GET /api/launch/{token}`, `installGuideView`, and `launch_tokens_test.go` live.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a caregiver joins via invite link in Safari, show them a step-by-step PWA install guide and embed a short-lived launch token in the URL so the installed PWA can authenticate without relying on cookie sharing between Safari and the PWA context.

**Architecture:** A new `launch_tokens` DB table and two Go handlers (`POST /api/launch-tokens` to create, `GET /api/launch/{token}` to redeem) back the feature. On the client, `joinFinish` detects browser mode and redirects to `/?launch=<token>` before showing the install guide. `init()` checks for `?launch=` on every boot — redeeming the token on first open, silently skipping it on repeat opens when the user is already set up.

**Tech Stack:** Go 1.21 + `modernc.org/sqlite` (server), Vanilla JS ES modules (client), `httptest` for server tests.

## Global Constraints

- Version bump required on every commit: update `<meta name="version">` in `index.html` and `VERSION` in `sw.js` to `$(date -u +%Y-%m-%dT%H:%M)`. Both strings must match (sw.js prefixes with `hearth-`).
- No frameworks. Vanilla JS only.
- Lucide icons only, referenced via `<svg class="icon"><use href="#icon-name"></use></svg>`.
- CSS classes follow existing patterns: `.onboard`, `.onb-top`, `.onb-mark`, `.onb-title`, `.onb-sub`, `.onb-card`.
- All Go files in `package main` under `server/`.
- Token format: `newID()` (16 random bytes as hex).
- Commit messages follow Conventional Commits: `feat(scope): description`.

---

### Task 1: Schema + `POST /api/launch-tokens`

**Files:**
- Modify: `server/schema.sql` — add `launch_tokens` table
- Create: `server/launch_tokens.go` — `handleCreateLaunchToken` handler
- Create: `server/launch_tokens_test.go` — tests for create handler
- Modify: `server/router.go:49` — register `POST /api/launch-tokens` route

**Interfaces:**
- Produces: `handleCreateLaunchToken(db *sql.DB) http.HandlerFunc` — used in Task 2's router line and tested here
- Produces: `createLaunchTokenResponse` struct with `Token string` field — used in Task 3 client code
- Produces: `launch_tokens` table — used in Task 2's handler

- [ ] **Step 1: Write failing tests**

Create `server/launch_tokens_test.go`:

```go
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleCreateLaunchTokenRequiresAuth(t *testing.T) {
	db := newTestDB(t)
	req := httptest.NewRequest("POST", "/api/launch-tokens", nil)
	rec := httptest.NewRecorder()

	requireAuth(db, handleCreateLaunchToken(db))(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestHandleCreateLaunchTokenReturnsToken(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	sessToken, _ := createSession(db, "cg1", "fam1")

	req := httptest.NewRequest("POST", "/api/launch-tokens", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sessToken})
	rec := httptest.NewRecorder()

	requireAuth(db, handleCreateLaunchToken(db))(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp createLaunchTokenResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if resp.Token == "" {
		t.Fatal("expected non-empty token")
	}
	var caregiverID string
	if err := db.QueryRow(`SELECT caregiver_id FROM launch_tokens WHERE token = ?`, resp.Token).Scan(&caregiverID); err != nil {
		t.Fatalf("querying launch_token: %v", err)
	}
	if caregiverID != "cg1" {
		t.Errorf("caregiver_id = %q, want cg1", caregiverID)
	}
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && go test ./... -run TestHandleCreateLaunchToken -v
```

Expected: compile error — `handleCreateLaunchToken` undefined, `createLaunchTokenResponse` undefined.

- [ ] **Step 3: Add `launch_tokens` table to schema**

Append to `server/schema.sql`:

```sql

CREATE TABLE IF NOT EXISTS launch_tokens (
  token        TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL,
  family_id    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT
);
```

- [ ] **Step 4: Create `server/launch_tokens.go` with create handler**

```go
package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

const launchTokenTTL = 10 * time.Minute

type createLaunchTokenResponse struct {
	Token string `json:"token"`
}

func handleCreateLaunchToken(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		token := newID()
		expiresAt := time.Now().UTC().Add(launchTokenTTL).Format(time.RFC3339Nano)

		_, err := db.Exec(
			`INSERT INTO launch_tokens (token, caregiver_id, family_id, expires_at) VALUES (?, ?, ?, ?)`,
			token, session.CaregiverID, session.FamilyID, expiresAt)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		log.Printf("launch token created: caregiver=%s family=%s", session.CaregiverID, session.FamilyID)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(createLaunchTokenResponse{Token: token})
	}
}
```

- [ ] **Step 5: Register route in `server/router.go`**

After the existing `POST /api/invites` line (line 49), add:

```go
mux.HandleFunc("POST /api/launch-tokens", requireAuth(db, handleCreateLaunchToken(db)))
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd server && go test ./... -run TestHandleCreateLaunchToken -v
```

Expected: both tests PASS.

- [ ] **Step 7: Run full test suite to check for regressions**

```bash
cd server && go test ./...
```

Expected: all tests pass.

- [ ] **Step 8: Bump version and commit**

```bash
V=$(date -u +%Y-%m-%dT%H:%M)
sed -i "s|<meta name=\"version\" content=\"[^\"]*\"|<meta name=\"version\" content=\"$V\"|" index.html
sed -i "s|const VERSION = 'hearth-[^']*'|const VERSION = 'hearth-$V'|" sw.js
git add server/schema.sql server/launch_tokens.go server/launch_tokens_test.go server/router.go index.html sw.js
git commit -m "feat(server): add launch token create endpoint"
```

---

### Task 2: `GET /api/launch/{token}` — redeem handler

**Files:**
- Modify: `server/launch_tokens.go` — add `handleRedeemLaunchToken`
- Modify: `server/launch_tokens_test.go` — add redeem tests
- Modify: `server/router.go` — register `GET /api/launch/{token}` route

**Interfaces:**
- Consumes: `launch_tokens` table (from Task 1), `createSession`, `setSessionCookie`, `nowISO`, `sessionCookieName` (all pre-existing)
- Produces: `handleRedeemLaunchToken(db *sql.DB) http.HandlerFunc` — used by Task 4 client via `GET /api/launch/<token>`

- [ ] **Step 1: Write failing tests**

First, update the import block at the top of `server/launch_tokens_test.go` to add `"database/sql"`:

```go
import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)
```

Then append the following test functions to `server/launch_tokens_test.go`:

```go
func TestHandleRedeemLaunchTokenNotFound(t *testing.T) {
	db := newTestDB(t)
	req := httptest.NewRequest("GET", "/api/launch/nope", nil)
	req.SetPathValue("token", "nope")
	rec := httptest.NewRecorder()

	handleRedeemLaunchToken(db)(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestHandleRedeemLaunchTokenExpired(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Test', 'Partner', ?)`, nowISO())
	db.Exec(`INSERT INTO launch_tokens (token, caregiver_id, family_id, expires_at) VALUES ('lt1', 'cg1', 'fam1', ?)`,
		"2000-01-01T00:00:00Z")

	req := httptest.NewRequest("GET", "/api/launch/lt1", nil)
	req.SetPathValue("token", "lt1")
	rec := httptest.NewRecorder()

	handleRedeemLaunchToken(db)(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rec.Code)
	}
}

func TestHandleRedeemLaunchTokenAlreadyUsed(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Test', 'Partner', ?)`, nowISO())
	db.Exec(`INSERT INTO launch_tokens (token, caregiver_id, family_id, expires_at, used_at) VALUES ('lt1', 'cg1', 'fam1', ?, ?)`,
		"2099-01-01T00:00:00Z", nowISO())

	req := httptest.NewRequest("GET", "/api/launch/lt1", nil)
	req.SetPathValue("token", "lt1")
	rec := httptest.NewRecorder()

	handleRedeemLaunchToken(db)(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rec.Code)
	}
}

func TestHandleRedeemLaunchTokenSetsSessionCookieAndMarksUsed(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Test', 'Partner', ?)`, nowISO())
	db.Exec(`INSERT INTO launch_tokens (token, caregiver_id, family_id, expires_at) VALUES ('lt1', 'cg1', 'fam1', ?)`,
		"2099-01-01T00:00:00Z")

	req := httptest.NewRequest("GET", "/api/launch/lt1", nil)
	req.SetPathValue("token", "lt1")
	rec := httptest.NewRecorder()

	handleRedeemLaunchToken(db)(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != sessionCookieName {
		t.Fatalf("expected a %s cookie, got %v", sessionCookieName, cookies)
	}
	var usedAt sql.NullString
	if err := db.QueryRow(`SELECT used_at FROM launch_tokens WHERE token = 'lt1'`).Scan(&usedAt); err != nil {
		t.Fatal(err)
	}
	if !usedAt.Valid || usedAt.String == "" {
		t.Error("expected launch token to be marked used")
	}
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && go test ./... -run TestHandleRedeemLaunchToken -v
```

Expected: compile error — `handleRedeemLaunchToken` undefined.

- [ ] **Step 3: Add `handleRedeemLaunchToken` to `server/launch_tokens.go`**

Append to `server/launch_tokens.go`:

```go
func handleRedeemLaunchToken(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.PathValue("token")

		var caregiverID, familyID, expiresAt string
		var usedAt sql.NullString
		err := db.QueryRow(
			`SELECT caregiver_id, family_id, expires_at, used_at FROM launch_tokens WHERE token = ?`, token).
			Scan(&caregiverID, &familyID, &expiresAt, &usedAt)
		if err == sql.ErrNoRows {
			http.Error(w, "token not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if usedAt.Valid && usedAt.String != "" {
			http.Error(w, "token already used", http.StatusGone)
			return
		}
		expiry, err := time.Parse(time.RFC3339Nano, expiresAt)
		if err != nil || time.Now().UTC().After(expiry) {
			http.Error(w, "token expired", http.StatusGone)
			return
		}

		sessToken, err := createSession(db, caregiverID, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := db.Exec(`UPDATE launch_tokens SET used_at = ? WHERE token = ?`, nowISO(), token); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		setSessionCookie(w, sessToken)
		log.Printf("launch token redeemed: caregiver=%s family=%s", caregiverID, familyID)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}
```

- [ ] **Step 4: Register route in `server/router.go`**

After the `POST /api/launch-tokens` line added in Task 1, add:

```go
mux.HandleFunc("GET /api/launch/{token}", handleRedeemLaunchToken(db))
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd server && go test ./... -run TestHandleRedeemLaunchToken -v
```

Expected: all four tests PASS.

- [ ] **Step 6: Run full test suite**

```bash
cd server && go test ./...
```

Expected: all tests pass.

- [ ] **Step 7: Bump version and commit**

```bash
V=$(date -u +%Y-%m-%dT%H:%M)
sed -i "s|<meta name=\"version\" content=\"[^\"]*\"|<meta name=\"version\" content=\"$V\"|" index.html
sed -i "s|const VERSION = 'hearth-[^']*'|const VERSION = 'hearth-$V'|" sw.js
git add server/launch_tokens.go server/launch_tokens_test.go server/router.go index.html sw.js
git commit -m "feat(server): add launch token redeem endpoint"
```

---

### Task 3: Client — install guide and `joinFinish` changes

**Files:**
- Modify: `js/join.js` — add `installGuideView()`, update `joinFinish`

**Interfaces:**
- Consumes: `POST /api/launch-tokens` → `{ token: string }` (Task 1)
- Consumes: `$` from `./ui.js`, `state`, `save`, `applySyncResponse` from `./store.js`, `applyTheme`, `toast` from `./ui.js`, `router` from `./app.js`
- Produces: no new exports — `joinView` and `joinFinish` signatures unchanged

- [ ] **Step 1: Replace `js/join.js` with updated version**

```js
// join.js — accepting an invite link to join an existing family as a caregiver.
import { state, save, applySyncResponse } from './store.js';
import { $, applyTheme, toast } from './ui.js';
import { router } from './app.js';

export function joinView(token) {
  return `<div class="onboard">
    <div class="onb-top">
      <div class="onb-mark"><svg class="icon"><use href="#heart"></use></svg></div>
      <h1 class="onb-title">You've been invited</h1>
      <p class="onb-sub">Join as a caregiver to see and log alongside the rest of the family.</p>
    </div>
    <div class="onb-card">
      <label class="fld"><span class="fld-l">Your name</span>
        <input id="join-name" placeholder="e.g. Dad" autocomplete="off" /></label>
    </div>
    <button class="btn-primary onb-go" data-action="join:finish" data-token="${token}"><svg class="icon"><use href="#heart"></use></svg> Join family</button>
  </div>`;
}

function installGuideView() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const steps = isIOS
    ? `<ol class="install-steps">
        <li>Tap the <svg class="icon icon-sm"><use href="#share-2"></use></svg> Share button in Safari</li>
        <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
        <li>Tap <strong>Add</strong></li>
      </ol>`
    : `<p class="onb-sub">Chrome will prompt you to install — tap <strong>Install</strong> when it appears, or use the browser menu → <strong>Add to Home Screen</strong>.</p>`;
  return `<div class="onboard">
    <div class="onb-top">
      <div class="onb-mark"><svg class="icon"><use href="#heart"></use></svg></div>
      <h1 class="onb-title">You're in! Now install Hearth</h1>
      <p class="onb-sub">Follow these steps to add Hearth to your Home Screen.</p>
    </div>
    <div class="onb-card">
      ${steps}
      <p class="install-note">This install link expires in 10 minutes.</p>
    </div>
  </div>`;
}

export async function joinFinish(token) {
  const nameInput = $('#join-name');
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus(); nameInput.classList.add('shake'); setTimeout(() => nameInput.classList.remove('shake'), 500);
    return;
  }

  try {
    const res = await fetch('/api/join/' + token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ caregiverName: name })
    });
    if (!res.ok) throw new Error('join failed: ' + res.status);
  } catch (e) {
    toast('Could not join — check the link or your connection');
    return;
  }

  if (!window.matchMedia('(display-mode: standalone)').matches) {
    try {
      const ltRes = await fetch('/api/launch-tokens', { method: 'POST', credentials: 'include' });
      if (!ltRes.ok) throw new Error('launch token failed');
      const { token: launchToken } = await ltRes.json();
      history.replaceState(null, '', '/?launch=' + launchToken);
    } catch (_) {
      // best-effort — cookie sharing works on iOS 16.4+ even without token
    }
    $('#app').innerHTML = installGuideView();
    return;
  }

  const syncRes = await fetch('/api/sync', { credentials: 'include' });
  const data = await syncRes.json();
  applySyncResponse(data);
  state().baby.caregiver = name;
  state().setup = true;
  save();
  applyTheme();
  history.replaceState(null, '', '/');
  router.boot();
  router.go('home');
  toast('Welcome to the family, ' + name + ' 🤍');
}
```

- [ ] **Step 2: Manual smoke test**

Start the server (`go run ./server`) and open `http://localhost:<port>/join/test-token` in a regular browser tab (non-standalone). Fill in a name and tap Join. Confirm:
- The install guide screen appears
- The URL in the address bar changes to `/?launch=<some-token>`
- No JS errors in the console

To get a real token for testing: first create a family via onboarding on another tab, then use `POST /api/invites` to get a real invite token.

- [ ] **Step 3: Bump version and commit**

```bash
V=$(date -u +%Y-%m-%dT%H:%M)
sed -i "s|<meta name=\"version\" content=\"[^\"]*\"|<meta name=\"version\" content=\"$V\"|" index.html
sed -i "s|const VERSION = 'hearth-[^']*'|const VERSION = 'hearth-$V'|" sw.js
git add js/join.js index.html sw.js
git commit -m "feat(ui): show PWA install guide after join in browser mode"
```

---

### Task 4: Client — `init()` launch-token redemption

**Files:**
- Modify: `js/app.js:466` — make `init` async, add launch-token check before existing join-path check

**Interfaces:**
- Consumes: `GET /api/launch/{token}` (Task 2)
- Consumes: `state`, `save`, `applySyncResponse` (already imported from `./store.js` at top of `app.js`)
- Consumes: `$` (already imported from `./ui.js`)

- [ ] **Step 1: Update `init()` in `js/app.js`**

Find the `init` function (currently at line 466). Replace it in its entirety:

```js
async function init() {
  applyTheme();

  const launch = new URLSearchParams(location.search).get('launch');
  if (launch) {
    history.replaceState(null, '', '/');
    if (!state().setup) {
      const res = await fetch('/api/launch/' + launch, { credentials: 'include' });
      if (!res.ok) {
        $('#app').innerHTML = `<div class="onboard"><div class="onb-top"><div class="onb-mark"><svg class="icon"><use href="#heart"></use></svg></div><h1 class="onb-title">Install link expired</h1><p class="onb-sub">This install link has expired — ask to be invited again.</p></div></div>`;
        return;
      }
      const syncRes = await fetch('/api/sync', { credentials: 'include' });
      const data = await syncRes.json();
      applySyncResponse(data);
      state().setup = true;
      save();
    }
  }

  const joinMatch = location.pathname.match(/^\/join\/([^/]+)$/);
  if (joinMatch && !state().setup) {
    $('#app').innerHTML = joinView(joinMatch[1]);
    return;
  }
  if (!state().setup) {
    $('#app').innerHTML = onboarding();
  } else {
    router.boot();
    router.go('home');
    syncOnce();
    connectEvents();
  }
}
```

Note: `document.addEventListener('DOMContentLoaded', init)` at the bottom of the file does not need to change — passing an async function as an event listener is valid and the returned Promise is safely ignored here.

- [ ] **Step 2: Manual end-to-end test**

Full flow test (requires a real running server with a real invite):

1. Open invite link in a non-standalone browser tab
2. Enter name → Join family → install guide appears, URL becomes `/?launch=<token>`
3. Copy that full URL
4. Open a new private/incognito tab and navigate to `/?launch=<token>`
5. Confirm: app boots directly to home view, user is authenticated (no onboarding screen)
6. Reload the private tab (token is now used)
7. Confirm: app boots normally from localStorage state (no "expired" error — `state().setup` is true)
8. Open a third private tab at `/?launch=<token>` but first clear localStorage in DevTools to simulate storage wipe
9. Confirm: "Install link expired" message appears (token already used)

- [ ] **Step 3: Bump version and commit**

```bash
V=$(date -u +%Y-%m-%dT%H:%M)
sed -i "s|<meta name=\"version\" content=\"[^\"]*\"|<meta name=\"version\" content=\"$V\"|" index.html
sed -i "s|const VERSION = 'hearth-[^']*'|const VERSION = 'hearth-$V'|" sw.js
git add js/app.js index.html sw.js
git commit -m "feat(ui): redeem PWA launch token on init to establish session"
```
