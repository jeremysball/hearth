# Accounts & OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in, OAuth-backed accounts (Google + Apple) that anchor an existing anonymous caregiver to a durable identity for multi-device restore, with data-safe reconciliation and never any silent data loss.

**Architecture:** Identity is layered on top of the existing anonymous-session model, not a replacement. A new `identities` table maps `(provider, provider_user_id) → caregiver_id`. The Go server drives the OAuth flow with `markbates/goth` providers used directly (no gorilla/gothic — this codebase uses the stdlib `net/http.ServeMux`), carrying the goth session across the redirect in a short-lived signed cookie. The provider callback runs reconciliation and either links/restores/signs-up (set session cookie, redirect to `/?auth=ok`) or — on a genuine data conflict — defers to the user via a frontend sheet (redirect to `/?auth=conflict&pending=<token>`), committing nothing until they choose. Sessions remain the long-lived `hearth_session` cookie; revocation is still row deletion.

**Tech Stack:** Go 1.26 + `modernc.org/sqlite`, `markbates/goth` (Google + Apple providers), stdlib `net/http` mux with method+path patterns, vanilla-JS PWA frontend. Go tests via `newTestDB` (`server/testutil_test.go`); frontend via Playwright (`tests/helpers.js`).

## Global Constraints

- No framework, **no managed third-party auth service** — identities live in our own SQLite.
- Integrity and availability of user data above all else: **never silently discard local data.** Local data is retained as recoverable until the user explicitly chooses.
- Local-first: accounts are opt-in; anonymous usage stays fully supported and the app works unchanged without an account.
- Providers for v1: **Google and Apple only.** Out of scope: email magic-link, GitHub, account deletion/export.
- New authenticated endpoints reuse `requireAuth`; the auth begin/callback routes are public.
- **Bump the version** in `index.html` (`<meta name="version">`) and `sw.js` (`VERSION`) to `date -u +%Y-%m-%dT%H:%MZ` (matching except the `hearth-` prefix in `sw.js`) on any change to a cached user-facing asset. Go-only changes do NOT bump.
- Conventional Commits; imperative mood. Use `fd`/`rg`, never `find`/`grep`.
- Schema is applied with `CREATE TABLE IF NOT EXISTS` on every startup (`server/db.go` `openDB`) and in tests (`newTestDB`) — additive schema changes need no separate migration runner.

---

### Task 1: Prerequisite — provider registration + config plumbing

**Goal:** Document the manual developer-console registration and teach `server/config.go` to read provider credentials and the public base URL from the environment. This is the external blocker; the begin/callback flow is inert until credentials are present.

**Files:**
- Create: `docs/oauth-setup.md`
- Modify: `server/config.go` (extend `Config` + `loadConfig`)
- Modify: `.env.example` (create if absent)
- Test: `server/config_test.go` (new)

**Interfaces:**
- Produces: `Config` gains `PublicBaseURL, GoogleClientID, GoogleClientSecret, AppleClientID, AppleClientSecret, AppleTeamID, AppleKeyID string`. `loadConfig()` reads them from env via the existing `getenv`/`os.Getenv` helpers. `OAuthConfigured(provider string) bool` reports whether a given provider has the credentials it needs.

- [ ] **Step 1: Write `docs/oauth-setup.md`**

Document, for the project owner (not code):
- Google: create an OAuth 2.0 Client (Web application) in Google Cloud Console; authorized redirect URI = `<PublicBaseURL>/api/auth/google/callback`; copy client ID + secret.
- Apple: create a Services ID and a Sign in with Apple key in the Apple Developer console; record the Services ID (client ID), Team ID, Key ID, and the `.p8` private key; return URL = `<PublicBaseURL>/api/auth/apple/callback`.
- The env vars to set (see Step 3) and that the server runs with anonymous accounts only until they are present.

- [ ] **Step 2: Write the failing config test**

`server/config_test.go` already exists — append `TestLoadConfigReadsOAuthEnv` after the closing `}` of `TestLoadConfigDefaults` (the last function in the file). Do NOT add a `package` declaration or new imports — they are already present:

```go
func TestLoadConfigReadsOAuthEnv(t *testing.T) {
	os.Setenv("PUBLIC_BASE_URL", "https://hearth.example")
	os.Setenv("GOOGLE_CLIENT_ID", "gid")
	os.Setenv("GOOGLE_CLIENT_SECRET", "gsec")
	defer func() {
		os.Unsetenv("PUBLIC_BASE_URL")
		os.Unsetenv("GOOGLE_CLIENT_ID")
		os.Unsetenv("GOOGLE_CLIENT_SECRET")
	}()
	c := loadConfig()
	if c.PublicBaseURL != "https://hearth.example" {
		t.Errorf("PublicBaseURL = %q", c.PublicBaseURL)
	}
	if !c.OAuthConfigured("google") {
		t.Error("expected google to be configured")
	}
	if c.OAuthConfigured("apple") {
		t.Error("apple should be unconfigured without its env")
	}
}
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd server && go test -run TestLoadConfigReadsOAuthEnv ./...`
Expected: FAIL — `c.PublicBaseURL` / `OAuthConfigured` undefined (won't compile).

- [ ] **Step 4: Extend `Config` and `loadConfig`**

In `server/config.go`, add fields to `Config` and read them in `loadConfig`:

```go
type Config struct {
	Host      string
	Port      string
	CertFile  string
	KeyFile   string
	DBPath    string
	StaticDir string

	PublicBaseURL      string
	GoogleClientID     string
	GoogleClientSecret string
	AppleClientID      string
	AppleClientSecret  string
	AppleTeamID        string
	AppleKeyID         string
}
```

In `loadConfig()`'s returned struct, add:

```go
		PublicBaseURL:      os.Getenv("PUBLIC_BASE_URL"),
		GoogleClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		AppleClientID:      os.Getenv("APPLE_CLIENT_ID"),
		AppleClientSecret:  os.Getenv("APPLE_CLIENT_SECRET"),
		AppleTeamID:        os.Getenv("APPLE_TEAM_ID"),
		AppleKeyID:         os.Getenv("APPLE_KEY_ID"),
```

Add the helper:

```go
func (c Config) OAuthConfigured(provider string) bool {
	switch provider {
	case "google":
		return c.PublicBaseURL != "" && c.GoogleClientID != "" && c.GoogleClientSecret != ""
	case "apple":
		return c.PublicBaseURL != "" && c.AppleClientID != "" && c.AppleClientSecret != "" && c.AppleTeamID != "" && c.AppleKeyID != ""
	}
	return false
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `cd server && go test -run TestLoadConfigReadsOAuthEnv ./...`
Expected: PASS.

- [ ] **Step 6: Add the env vars to `.env.example`**

Append (create the file if it does not exist):

```
# OAuth (optional — anonymous accounts work without these)
PUBLIC_BASE_URL=https://your-host
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=
APPLE_TEAM_ID=
APPLE_KEY_ID=
```

- [ ] **Step 7: Commit (Go/docs only — no version bump)**

```bash
git add docs/oauth-setup.md server/config.go server/config_test.go .env.example
git commit -m "feat(config): read OAuth provider credentials from env"
```

---

### Task 2: Schema — `identities` and `pending_auth` tables

**Goal:** Add the identity link table from the spec, plus a short-lived `pending_auth` table to hold deferred conflict decisions across the callback→sheet→resolve round trip.

**Files:**
- Modify: `server/schema.sql`
- Test: `server/identities_test.go` (new)

**Interfaces:**
- Produces tables:
  - `identities(provider, provider_user_id, caregiver_id, email, created_at)`, PK `(provider, provider_user_id)`, index on `caregiver_id`.
  - `pending_auth(token PK, provider, provider_user_id, email, target_family_id, current_family_id, current_caregiver_id, created_at)` — captures a conflict awaiting user choice. `target_family_id` is the identity's existing family (B); `current_*` is the device's anonymous session (A).

- [ ] **Step 1: Write the failing schema test**

Create `server/identities_test.go`:

```go
package main

import "testing"

func TestIdentitiesAndPendingTablesExist(t *testing.T) {
	db := newTestDB(t)
	if _, err := db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub1','cg1','a@b.c','t')`); err != nil {
		t.Fatalf("insert identity: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO pending_auth (token, provider, provider_user_id, email, target_family_id, current_family_id, current_caregiver_id, created_at) VALUES ('tok','google','sub2','x@y.z','famB','famA','cgA','t')`); err != nil {
		t.Fatalf("insert pending_auth: %v", err)
	}
	var cg string
	if err := db.QueryRow(`SELECT caregiver_id FROM identities WHERE provider='google' AND provider_user_id='sub1'`).Scan(&cg); err != nil {
		t.Fatalf("select identity: %v", err)
	}
	if cg != "cg1" {
		t.Errorf("caregiver_id = %q, want cg1", cg)
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd server && go test -run TestIdentitiesAndPendingTablesExist ./...`
Expected: FAIL — `no such table: identities`.

- [ ] **Step 3: Add the tables to `server/schema.sql`**

Append:

```sql
CREATE TABLE IF NOT EXISTS identities (
  provider          TEXT NOT NULL,
  provider_user_id  TEXT NOT NULL,
  caregiver_id      TEXT NOT NULL REFERENCES caregivers(id),
  email             TEXT,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_identities_caregiver ON identities(caregiver_id);

CREATE TABLE IF NOT EXISTS pending_auth (
  token                TEXT PRIMARY KEY,
  provider             TEXT NOT NULL,
  provider_user_id     TEXT NOT NULL,
  email                TEXT,
  target_family_id     TEXT NOT NULL,
  current_family_id    TEXT NOT NULL,
  current_caregiver_id TEXT NOT NULL,
  created_at           TEXT NOT NULL
);
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd server && go test -run TestIdentitiesAndPendingTablesExist ./...`
Expected: PASS.

- [ ] **Step 5: Commit (Go only — no version bump)**

```bash
git add server/schema.sql server/identities_test.go
git commit -m "feat(schema): add identities and pending_auth tables"
```

---

### Task 3: goth provider init + begin route

**Goal:** Initialize Google + Apple goth providers from config, and add the public `GET /api/auth/{provider}` route that redirects to the provider, stashing the goth session in a short-lived signed cookie.

**Files:**
- Create: `server/oauth.go`
- Modify: `go.mod` / `go.sum` (add `markbates/goth`)
- Modify: `server/router.go` (register the begin route; pass `Config` into the router)
- Modify: `server/main.go` (wire providers at startup)
- Test: `server/oauth_test.go` (new)

**Interfaces:**
- Produces:
  - `initProviders(cfg Config)` — registers configured goth providers via `goth.UseProviders(...)`; skips unconfigured ones; safe to call with no credentials (registers nothing).
  - `handleAuthBegin(cfg Config) http.HandlerFunc` — reads `{provider}` path value; 404s if not configured; builds the goth session, sets cookie `hearth_oauth` (HttpOnly, Secure, SameSite=Lax, ~10 min), redirects to the provider auth URL.
  - cookie name const `oauthStateCookie = "hearth_oauth"`.
- Consumes: `Config` (Task 1).
- Note for Task 4: the callback reads `hearth_oauth`, unmarshals the goth session, authorizes with the callback query, and fetches the user.

- [ ] **Step 1: Add the goth dependency**

Run: `cd server && go get github.com/markbates/goth@latest`
Then verify it resolves: `cd server && go mod tidy`.

- [ ] **Step 2: Write `server/oauth.go` (provider init + begin handler)**

```go
package main

import (
	"net/http"
	"time"

	"github.com/markbates/goth"
	"github.com/markbates/goth/providers/apple"
	"github.com/markbates/goth/providers/google"
)

const oauthStateCookie = "hearth_oauth"

// initProviders registers goth providers for whichever ones are configured.
// Unconfigured providers are skipped so the app runs anonymously without creds.
func initProviders(cfg Config) {
	var ps []goth.Provider
	if cfg.OAuthConfigured("google") {
		ps = append(ps, google.New(cfg.GoogleClientID, cfg.GoogleClientSecret,
			cfg.PublicBaseURL+"/api/auth/google/callback", "email", "profile"))
	}
	if cfg.OAuthConfigured("apple") {
		ps = append(ps, apple.New(cfg.AppleClientID, cfg.AppleClientSecret,
			cfg.PublicBaseURL+"/api/auth/apple/callback", nil, apple.ScopeName, apple.ScopeEmail))
	}
	// KNOWN LIMITATION (parked, see handoff brief): Apple's "client secret" is not a
	// static string — it is a short-lived JWT (≤6 months) signed with the .p8 key,
	// derivable via apple.MakeSecret(SecretParams{...}) from AppleTeamID, AppleKeyID,
	// the client ID, and the private key. Passing a static AppleClientSecret compiles
	// and lets the app boot, but Apple sign-in will NOT succeed live until MakeSecret
	// wiring is added. Google is fully functional as written. This is a human decision
	// for v1 (Google-only live, or add MakeSecret), out of scope for the unattended run.
	if len(ps) > 0 {
		goth.UseProviders(ps...)
	}
}

func handleAuthBegin(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("provider")
		if !cfg.OAuthConfigured(name) {
			http.Error(w, "provider not configured", http.StatusNotFound)
			return
		}
		provider, err := goth.GetProvider(name)
		if err != nil {
			http.Error(w, "unknown provider", http.StatusNotFound)
			return
		}
		state := newID()
		sess, err := provider.BeginAuth(state)
		if err != nil {
			http.Error(w, "auth begin failed", http.StatusInternalServerError)
			return
		}
		url, err := sess.GetAuthURL()
		if err != nil {
			http.Error(w, "auth url failed", http.StatusInternalServerError)
			return
		}
		http.SetCookie(w, &http.Cookie{
			Name:     oauthStateCookie,
			Value:    name + "|" + sess.Marshal(),
			Path:     "/",
			HttpOnly: true,
			Secure:   true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   int(10 * time.Minute / time.Second),
		})
		http.Redirect(w, r, url, http.StatusFound)
	}
}
```

- [ ] **Step 3: Write the failing begin-route test**

Create `server/oauth_test.go`:

```go
package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthBeginUnconfiguredProvider404(t *testing.T) {
	cfg := Config{} // nothing configured
	req := httptest.NewRequest("GET", "/api/auth/google", nil)
	req.SetPathValue("provider", "google")
	rec := httptest.NewRecorder()
	handleAuthBegin(cfg)(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestAuthBeginConfiguredRedirects(t *testing.T) {
	cfg := Config{PublicBaseURL: "https://h.example", GoogleClientID: "id", GoogleClientSecret: "sec"}
	initProviders(cfg)
	req := httptest.NewRequest("GET", "/api/auth/google", nil)
	req.SetPathValue("provider", "google")
	rec := httptest.NewRecorder()
	handleAuthBegin(cfg)(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc == "" {
		t.Fatal("expected a Location redirect to the provider")
	}
	foundCookie := false
	for _, c := range rec.Result().Cookies() {
		if c.Name == oauthStateCookie {
			foundCookie = true
		}
	}
	if !foundCookie {
		t.Fatal("expected the oauth state cookie to be set")
	}
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && go test -run 'TestAuthBegin' ./...`
Expected: PASS (both). If the apple provider import path differs in the installed goth version, adjust the import per `go doc github.com/markbates/goth/providers/apple`.

- [ ] **Step 5: Wire providers at startup and register the begin route**

In `server/main.go`, after `loadConfig()`, call `initProviders(cfg)` and pass `cfg` into `newRouter`. Update `newRouter`'s signature in `server/router.go` to accept `cfg Config`:

```go
func newRouter(db *sql.DB, hub *Hub, staticDir string, cfg Config) http.Handler {
```

and register (public, no `requireAuth`):

```go
	mux.HandleFunc("GET /api/auth/{provider}", handleAuthBegin(cfg))
```

Update the `newRouter(...)` call site in `main.go` to pass `cfg`. Exact edits to existing call sites (verified present):
- `server/main.go:27` — `newRouter(db, hub, cfg.StaticDir)` → `newRouter(db, hub, cfg.StaticDir, cfg)`
- `server/router_test.go:13` — `newRouter(db, newHub(), "")` → `newRouter(db, newHub(), "", Config{})`
- `server/router_test.go:34` — `newRouter(db, newHub(), dir)` → `newRouter(db, newHub(), dir, Config{})`

(Re-confirm with `rg "newRouter\(" server` in case line numbers drifted.)

- [ ] **Step 6: Build and run the full Go suite**

Run: `cd server && go build ./... && go test ./...`
Expected: builds; all tests pass.

- [ ] **Step 7: Commit (Go only — no version bump)**

```bash
git add server/oauth.go server/oauth_test.go server/router.go server/main.go go.mod go.sum
git commit -m "feat(auth): add goth providers and OAuth begin route"
```

---

### Task 4: Callback + reconciliation logic

**Goal:** Complete the OAuth flow and resolve `(provider, provider_user_id)` into one of: link (anonymous device gets an identity), restore (clean device gets the family back), sign-up (no identity + no session), or conflict (defer to the user). Reconciliation is a pure DB function under test.

**Files:**
- Create: `server/reconcile.go`
- Modify: `server/oauth.go` (add `handleAuthCallback`)
- Modify: `server/router.go` (register the callback route)
- Test: `server/reconcile_test.go` (new)

**Interfaces:**
- Produces: `reconcile(db *sql.DB, provider, providerUserID, email string, cur *SessionInfo) (ReconcileResult, error)` where

```go
type ReconcileResult struct {
	Kind        string // "linked" | "restored" | "signedup" | "conflict"
	CaregiverID string // set for linked/restored/signedup — the caregiver to session
	FamilyID    string // set for linked/restored/signedup
	TargetFamily   string // conflict: identity's existing family (B)
	CurrentFamily  string // conflict: device's anonymous family (A)
	CurrentCaregiver string // conflict: device's caregiver (A)
}
```

  Decision rules:
  1. **No identity row, `cur != nil`** → `linked`: insert `identities` row pointing at `cur.CaregiverID`; return that caregiver/family.
  2. **No identity row, `cur == nil`** → `signedup`: create family+caregiver+default settings (mirror `handleCreateFamily`), insert identity, return new caregiver/family.
  3. **Identity exists → caregiver C in family B; `cur == nil` or `cur.FamilyID == B`** → `restored`: return C/B.
  4. **Identity exists → family B; `cur != nil`, `cur.FamilyID != B`, and family A has no log data** → `restored` to B (nothing to lose).
  5. **Identity exists → family B; `cur != nil`, `cur.FamilyID != B`, and family A has log data** → `conflict` (commit nothing).
- Produces helper: `familyHasData(db, familyID) (bool, error)` — true if any non-deleted `log_entries` row exists for the family.
- Consumes: `SessionInfo`, `createSession`, `setSessionCookie`, `newID`, `nowISO`, `Config`, `oauthStateCookie`.

- [ ] **Step 1: Write the failing reconcile tests**

Create `server/reconcile_test.go`:

```go
package main

import "testing"

func seedFamily(t *testing.T, db interface {
	Exec(string, ...any) (interface{ RowsAffected() (int64, error) }, error)
}) {
	t.Helper()
}

func TestReconcileLinksAnonymousDevice(t *testing.T) {
	db := newTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famA', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','famA','A','Parent',?)`, now)
	cur := &SessionInfo{CaregiverID: "cgA", FamilyID: "famA"}
	res, err := reconcile(db, "google", "sub-new", "a@b.c", cur)
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "linked" || res.FamilyID != "famA" || res.CaregiverID != "cgA" {
		t.Fatalf("got %+v", res)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM identities WHERE provider='google' AND provider_user_id='sub-new'`).Scan(&n)
	if n != 1 {
		t.Fatalf("expected identity row, got %d", n)
	}
}

func TestReconcileRestoresOnCleanDevice(t *testing.T) {
	db := newTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famB', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgB','famB','B','Parent',?)`, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub-b','cgB','b@b.c',?)`, now)
	res, err := reconcile(db, "google", "sub-b", "b@b.c", nil) // clean device, no session
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "restored" || res.FamilyID != "famB" || res.CaregiverID != "cgB" {
		t.Fatalf("got %+v", res)
	}
}

func TestReconcileConflictWhenBothHaveData(t *testing.T) {
	db := newTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famA', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','famA','A','Parent',?)`, now)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famB', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgB','famB','B','Parent',?)`, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub-b','cgB','b@b.c',?)`, now)
	// Family A has data on this device.
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('e1','famA','diaper','t','{}','cgA',?)`, now)
	cur := &SessionInfo{CaregiverID: "cgA", FamilyID: "famA"}
	res, err := reconcile(db, "google", "sub-b", "b@b.c", cur)
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "conflict" || res.TargetFamily != "famB" || res.CurrentFamily != "famA" {
		t.Fatalf("got %+v", res)
	}
}

func TestReconcileRestoresWhenDeviceHasNoData(t *testing.T) {
	db := newTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famA', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','famA','A','Parent',?)`, now)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famB', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgB','famB','B','Parent',?)`, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub-b','cgB','b@b.c',?)`, now)
	cur := &SessionInfo{CaregiverID: "cgA", FamilyID: "famA"} // A empty
	res, err := reconcile(db, "google", "sub-b", "b@b.c", cur)
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "restored" || res.FamilyID != "famB" {
		t.Fatalf("got %+v", res)
	}
}
```

(Delete the unused `seedFamily` stub before finishing — it is illustrative; the inline `db.Exec` calls are the real setup.)

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && go test -run TestReconcile ./...`
Expected: FAIL — `reconcile`/`ReconcileResult` undefined (won't compile).

- [ ] **Step 3: Implement `server/reconcile.go`**

```go
package main

import "database/sql"

type ReconcileResult struct {
	Kind             string
	CaregiverID      string
	FamilyID         string
	TargetFamily     string
	CurrentFamily    string
	CurrentCaregiver string
}

func familyHasData(db *sql.DB, familyID string) (bool, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM log_entries WHERE family_id = ? AND deleted_at IS NULL`, familyID).Scan(&n)
	return n > 0, err
}

func reconcile(db *sql.DB, provider, providerUserID, email string, cur *SessionInfo) (ReconcileResult, error) {
	var caregiverID, familyID string
	err := db.QueryRow(`
		SELECT i.caregiver_id, c.family_id
		FROM identities i JOIN caregivers c ON c.id = i.caregiver_id
		WHERE i.provider = ? AND i.provider_user_id = ?`, provider, providerUserID).
		Scan(&caregiverID, &familyID)

	if err == sql.ErrNoRows {
		// No identity yet.
		if cur != nil {
			// Link to the existing anonymous caregiver.
			if _, e := db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES (?, ?, ?, ?, ?)`,
				provider, providerUserID, cur.CaregiverID, email, nowISO()); e != nil {
				return ReconcileResult{}, e
			}
			return ReconcileResult{Kind: "linked", CaregiverID: cur.CaregiverID, FamilyID: cur.FamilyID}, nil
		}
		// Sign up: fresh family + caregiver + default settings, then identity.
		newFamily, newBaby, newCare := newID(), newID(), newID()
		now := nowISO()
		tx, e := db.Begin()
		if e != nil {
			return ReconcileResult{}, e
		}
		defer tx.Rollback()
		if _, e = tx.Exec(`INSERT INTO families (id, created_at) VALUES (?, ?)`, newFamily, now); e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`INSERT INTO babies (id, family_id, name, birthdate, theme, updated_at) VALUES (?, ?, '', '', 'girl', ?)`, newBaby, newFamily, now); e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES (?, ?, 'Parent', 'Parent', ?)`, newCare, newFamily, now); e != nil {
			return ReconcileResult{}, e
		}
		defaultUnits := `{"volume":"ml","temp":"C","weight":"kg","length":"cm"}`
		defaultReminders := `{"naps":true,"bottle":true,"meds":true,"quietStart":"20:00","quietEnd":"07:00"}`
		defaultCards := `{"sweetspot":true,"bottle":true,"medicine":true,"order":["sweetspot","bottle","medicine"]}`
		if _, e = tx.Exec(`INSERT INTO settings (family_id, units_json, reminders_json, cards_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
			newFamily, defaultUnits, defaultReminders, defaultCards, now); e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES (?, ?, ?, ?, ?)`,
			provider, providerUserID, newCare, email, now); e != nil {
			return ReconcileResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return ReconcileResult{}, e
		}
		return ReconcileResult{Kind: "signedup", CaregiverID: newCare, FamilyID: newFamily}, nil
	}
	if err != nil {
		return ReconcileResult{}, err
	}

	// Identity exists → family B (familyID).
	if cur == nil || cur.FamilyID == familyID {
		return ReconcileResult{Kind: "restored", CaregiverID: caregiverID, FamilyID: familyID}, nil
	}
	// Different families. Conflict only if the device's family A actually holds data.
	hasData, e := familyHasData(db, cur.FamilyID)
	if e != nil {
		return ReconcileResult{}, e
	}
	if !hasData {
		return ReconcileResult{Kind: "restored", CaregiverID: caregiverID, FamilyID: familyID}, nil
	}
	return ReconcileResult{
		Kind:             "conflict",
		TargetFamily:     familyID,
		CurrentFamily:    cur.FamilyID,
		CurrentCaregiver: cur.CaregiverID,
	}, nil
}
```

- [ ] **Step 4: Run the reconcile tests and confirm they pass**

Run: `cd server && go test -run TestReconcile ./...`
Expected: PASS (4 tests).

- [ ] **Step 5: Add `handleAuthCallback` to `server/oauth.go`**

```go
func handleAuthCallback(db *sql.DB, cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("provider")
		if !cfg.OAuthConfigured(name) {
			http.Error(w, "provider not configured", http.StatusNotFound)
			return
		}
		provider, err := goth.GetProvider(name)
		if err != nil {
			http.Error(w, "unknown provider", http.StatusNotFound)
			return
		}
		cookie, err := r.Cookie(oauthStateCookie)
		if err != nil {
			http.Redirect(w, r, "/?auth=error", http.StatusFound)
			return
		}
		// cookie value is "name|marshaledSession"
		marshaled := cookie.Value
		if i := indexByte(marshaled, '|'); i >= 0 {
			marshaled = marshaled[i+1:]
		}
		sess, err := provider.UnmarshalSession(marshaled)
		if err != nil {
			http.Redirect(w, r, "/?auth=error", http.StatusFound)
			return
		}
		if _, err = sess.Authorize(provider, r.URL.Query()); err != nil {
			http.Redirect(w, r, "/?auth=error", http.StatusFound)
			return
		}
		gu, err := provider.FetchUser(sess)
		if err != nil {
			http.Redirect(w, r, "/?auth=error", http.StatusFound)
			return
		}
		// clear the state cookie
		http.SetCookie(w, &http.Cookie{Name: oauthStateCookie, Path: "/", MaxAge: -1})

		var cur *SessionInfo
		if sc, err := r.Cookie(sessionCookieName); err == nil {
			var fam, cg string
			if e := db.QueryRow(`SELECT family_id, caregiver_id FROM sessions WHERE token = ?`, sc.Value).Scan(&fam, &cg); e == nil {
				cur = &SessionInfo{FamilyID: fam, CaregiverID: cg}
			}
		}

		res, err := reconcile(db, name, gu.UserID, gu.Email, cur)
		if err != nil {
			http.Redirect(w, r, "/?auth=error", http.StatusFound)
			return
		}
		switch res.Kind {
		case "linked", "restored", "signedup":
			token, e := createSession(db, res.CaregiverID, res.FamilyID)
			if e != nil {
				http.Redirect(w, r, "/?auth=error", http.StatusFound)
				return
			}
			setSessionCookie(w, token)
			http.Redirect(w, r, "/?auth=ok", http.StatusFound)
		case "conflict":
			pending := newID()
			if _, e := db.Exec(`INSERT INTO pending_auth (token, provider, provider_user_id, email, target_family_id, current_family_id, current_caregiver_id, created_at) VALUES (?,?,?,?,?,?,?,?)`,
				pending, name, gu.UserID, gu.Email, res.TargetFamily, res.CurrentFamily, res.CurrentCaregiver, nowISO()); e != nil {
				http.Redirect(w, r, "/?auth=error", http.StatusFound)
				return
			}
			http.Redirect(w, r, "/?auth=conflict&pending="+pending, http.StatusFound)
		}
	}
}

// indexByte avoids importing strings just for one lookup.
func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}
```

- [ ] **Step 6: Register the callback route**

In `server/router.go`:

```go
	mux.HandleFunc("GET /api/auth/{provider}/callback", handleAuthCallback(db, cfg))
```

- [ ] **Step 7: Build and run the full Go suite**

Run: `cd server && go build ./... && go test ./...`
Expected: builds; all tests pass. (The callback itself is exercised end-to-end by the live verification in Task 7; its logic core, `reconcile`, is unit-tested here.)

- [ ] **Step 8: Commit (Go only — no version bump)**

```bash
git add server/reconcile.go server/reconcile_test.go server/oauth.go server/router.go
git commit -m "feat(auth): add OAuth callback and reconciliation logic"
```

---

### Task 5: Sign-out and `/api/me` endpoints

**Goal:** `POST /api/auth/signout` deletes the current session row (existing revocation model). `GET /api/me` reports the signed-in identity (provider, email) for Profile display, or an anonymous marker.

**Files:**
- Create: `server/me.go`
- Modify: `server/router.go` (register both routes)
- Test: `server/me_test.go` (new)

**Interfaces:**
- Produces:
  - `handleSignout(db) http.HandlerFunc` (behind `requireAuth`) — `DELETE FROM sessions WHERE token = <cookie>`, clears the cookie, 204.
  - `handleMe(db) http.HandlerFunc` (behind `requireAuth`) — returns `{"identity": {"provider": "...", "email": "..."} }` if the session's caregiver has an identity, else `{"identity": null}`.

- [ ] **Step 1: Write the failing tests**

Create `server/me_test.go`:

```go
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMeReportsIdentity(t *testing.T) {
	db := newTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg','fam','A','Parent',?)`, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub','cg','a@b.c',?)`, now)
	req := withSession(httptest.NewRequest("GET", "/api/me", nil), SessionInfo{CaregiverID: "cg", FamilyID: "fam"})
	rec := httptest.NewRecorder()
	handleMe(db)(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var out struct {
		Identity *struct {
			Provider string `json:"provider"`
			Email    string `json:"email"`
		} `json:"identity"`
	}
	json.NewDecoder(rec.Body).Decode(&out)
	if out.Identity == nil || out.Identity.Provider != "google" || out.Identity.Email != "a@b.c" {
		t.Fatalf("got %+v", out.Identity)
	}
}

func TestMeAnonymousHasNilIdentity(t *testing.T) {
	db := newTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg','fam','A','Parent',?)`, now)
	req := withSession(httptest.NewRequest("GET", "/api/me", nil), SessionInfo{CaregiverID: "cg", FamilyID: "fam"})
	rec := httptest.NewRecorder()
	handleMe(db)(rec, req)
	var out struct {
		Identity *json.RawMessage `json:"identity"`
	}
	json.NewDecoder(rec.Body).Decode(&out)
	if out.Identity != nil {
		t.Fatalf("expected nil identity, got %s", *out.Identity)
	}
}

func TestSignoutDeletesSession(t *testing.T) {
	db := newTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg','fam','A','Parent',?)`, now)
	token, _ := createSession(db, "cg", "fam")
	req := httptest.NewRequest("POST", "/api/auth/signout", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	req = withSession(req, SessionInfo{CaregiverID: "cg", FamilyID: "fam"})
	rec := httptest.NewRecorder()
	handleSignout(db)(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE token = ?`, token).Scan(&n)
	if n != 0 {
		t.Fatalf("session not deleted, count=%d", n)
	}
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && go test -run 'TestMe|TestSignout' ./...`
Expected: FAIL — `handleMe`/`handleSignout` undefined.

- [ ] **Step 3: Implement `server/me.go`**

```go
package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

func handleMe(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		var provider, email string
		err := db.QueryRow(`SELECT provider, COALESCE(email,'') FROM identities WHERE caregiver_id = ? LIMIT 1`, session.CaregiverID).
			Scan(&provider, &email)
		w.Header().Set("Content-Type", "application/json")
		if err == sql.ErrNoRows {
			w.Write([]byte(`{"identity":null}`))
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"identity": map[string]string{"provider": provider, "email": email},
		})
	}
}

func handleSignout(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie(sessionCookieName); err == nil {
			db.Exec(`DELETE FROM sessions WHERE token = ?`, c.Value)
		}
		http.SetCookie(w, &http.Cookie{Name: sessionCookieName, Path: "/", MaxAge: -1})
		w.WriteHeader(http.StatusNoContent)
	}
}
```

- [ ] **Step 4: Register the routes**

In `server/router.go`:

```go
	mux.HandleFunc("GET /api/me", requireAuth(db, handleMe(db)))
	mux.HandleFunc("POST /api/auth/signout", requireAuth(db, handleSignout(db)))
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd server && go test -run 'TestMe|TestSignout' ./...`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit (Go only — no version bump)**

```bash
git add server/me.go server/me_test.go server/router.go
git commit -m "feat(auth): add /api/me and signout endpoints"
```

---

### Task 6: Conflict details + resolve (keep / switch / merge)

**Goal:** Back the conflict sheet. `GET /api/auth/conflict/{pending}` returns enough to describe families A and B; `POST /api/auth/resolve` applies the user's choice. Merge folds family A's entries/growth into B with id-keyed dedupe. Nothing is destroyed: "keep" leaves A as-is; "switch" issues a session for B but leaves A intact; "merge" copies into B and leaves A intact.

**Files:**
- Create: `server/resolve.go`
- Modify: `server/router.go` (register both routes — these are public because the device may currently hold family A's session, which is exactly the one we may switch away from; the `pending` token is the capability)
- Test: `server/resolve_test.go` (new)

**Interfaces:**
- Produces:
  - `handleConflictInfo(db) http.HandlerFunc` — `GET /api/auth/conflict/{pending}`; returns `{"current": {familyId, entryCount, babyName}, "target": {familyId, entryCount, babyName}, "provider": ..., "email": ...}`.
  - `handleResolve(db) http.HandlerFunc` — `POST /api/auth/resolve` with body `{"pending": "...", "choice": "keep"|"switch"|"merge"}`:
    - `keep` → delete the pending row; return 204 (device stays on family A; identity stays on B, recoverable later).
    - `switch` → issue+set a session for the target family's caregiver; delete pending; 204.
    - `merge` → `mergeFamilies(db, from=current_family_id, to=target_family_id)`, then issue+set a session for the target caregiver; delete pending; 204.
  - `mergeFamilies(db, from, to string) error` — copies `log_entries` and `growth_entries` from `from` into `to`, keeping ids; on id collision the existing `to` row wins (skip). Uses `INSERT ... ON CONFLICT(id) DO NOTHING` adjusted for family ownership.
- Consumes: `createSession`, `setSessionCookie`, `nowISO`.

- [ ] **Step 1: Write the failing resolve/merge tests**

Create `server/resolve_test.go`:

```go
package main

import (
	"strings"
	"net/http"
	"net/http/httptest"
	"testing"
)

func seedConflict(t *testing.T, db interface{}) {}

func TestMergeFamiliesCopiesEntriesAndDedupes(t *testing.T) {
	db := newTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('A', ?), ('B', ?)`, now, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','A','A','Parent',?),('cgB','B','B','Parent',?)`, now, now)
	// A has e1, e2; B has e2 (collision) and e3.
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('e1','A','feed','t','{}','cgA',?),('e2','A','diaper','t','{}','cgA',?)`, now, now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('e2','B','sleep','t','{}','cgB',?),('e3','B','bath','t','{}','cgB',?)`, now, now)
	if err := mergeFamilies(db, "A", "B"); err != nil {
		t.Fatal(err)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM log_entries WHERE family_id='B'`).Scan(&n)
	if n != 3 { // e2 (kept), e3, plus e1 copied from A
		t.Fatalf("family B entry count = %d, want 3", n)
	}
	var typ string
	db.QueryRow(`SELECT type FROM log_entries WHERE family_id='B' AND id='e2'`).Scan(&typ)
	if typ != "sleep" {
		t.Fatalf("e2 in B was overwritten (type=%q), want kept 'sleep'", typ)
	}
}

func TestResolveSwitchIssuesSessionForTarget(t *testing.T) {
	db := newTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('A', ?), ('B', ?)`, now, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','A','A','Parent',?),('cgB','B','B','Parent',?)`, now, now)
	db.Exec(`INSERT INTO pending_auth (token, provider, provider_user_id, email, target_family_id, current_family_id, current_caregiver_id, created_at) VALUES ('p','google','sub','e','B','A','cgA',?)`, now)
	req := httptest.NewRequest("POST", "/api/auth/resolve", strings.NewReader(`{"pending":"p","choice":"switch"}`))
	rec := httptest.NewRecorder()
	handleResolve(db)(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	// A session for family B must now exist, and the pending row gone.
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE family_id='B'`).Scan(&n)
	if n != 1 {
		t.Fatalf("expected 1 session for B, got %d", n)
	}
	db.QueryRow(`SELECT COUNT(*) FROM pending_auth WHERE token='p'`).Scan(&n)
	if n != 0 {
		t.Fatalf("pending row not cleared")
	}
}
```

(Remove the unused `seedConflict` stub before finishing.)

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && go test -run 'TestMerge|TestResolve' ./...`
Expected: FAIL — `mergeFamilies`/`handleResolve` undefined.

- [ ] **Step 3: Implement `server/resolve.go`**

```go
package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

func mergeFamilies(db *sql.DB, from, to string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Copy entries that don't already exist (by id) in the target family.
	if _, err := tx.Exec(`
		INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at, deleted_at)
		SELECT id, ?, type, start, payload_json, created_by, updated_at, deleted_at
		FROM log_entries WHERE family_id = ?
		ON CONFLICT(id) DO NOTHING`, to, from); err != nil {
		return err
	}
	if _, err := tx.Exec(`
		INSERT INTO growth_entries (id, family_id, date, weight_kg, height_cm, head_cm, note, updated_at, deleted_at)
		SELECT id, ?, date, weight_kg, height_cm, head_cm, note, updated_at, deleted_at
		FROM growth_entries WHERE family_id = ?
		ON CONFLICT(id) DO NOTHING`, to, from); err != nil {
		return err
	}
	return tx.Commit()
}

type resolveRequest struct {
	Pending string `json:"pending"`
	Choice  string `json:"choice"`
}

func handleConflictInfo(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.PathValue("pending")
		var provider, email, target, current string
		err := db.QueryRow(`SELECT provider, COALESCE(email,''), target_family_id, current_family_id FROM pending_auth WHERE token = ?`, token).
			Scan(&provider, &email, &target, &current)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"provider": provider, "email": email,
			"current": familySummary(db, current),
			"target":  familySummary(db, target),
		})
	}
}

func familySummary(db *sql.DB, familyID string) map[string]any {
	var name string
	db.QueryRow(`SELECT name FROM babies WHERE family_id = ?`, familyID).Scan(&name)
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM log_entries WHERE family_id = ? AND deleted_at IS NULL`, familyID).Scan(&count)
	return map[string]any{"familyId": familyID, "babyName": name, "entryCount": count}
}

func handleResolve(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req resolveRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		var provider, providerUserID, email, target, current, currentCare string
		err := db.QueryRow(`SELECT provider, provider_user_id, COALESCE(email,''), target_family_id, current_family_id, current_caregiver_id FROM pending_auth WHERE token = ?`, req.Pending).
			Scan(&provider, &providerUserID, &email, &target, &current, &currentCare)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		finish := func() { db.Exec(`DELETE FROM pending_auth WHERE token = ?`, req.Pending) }

		switch req.Choice {
		case "keep":
			finish()
			w.WriteHeader(http.StatusNoContent)
		case "merge":
			if err := mergeFamilies(db, current, target); err != nil {
				http.Error(w, "merge failed", http.StatusInternalServerError)
				return
			}
			fallthrough
		case "switch":
			var careB string
			if err := db.QueryRow(`SELECT caregiver_id FROM identities WHERE provider=? AND provider_user_id=?`, provider, providerUserID).Scan(&careB); err != nil {
				http.Error(w, "identity vanished", http.StatusInternalServerError)
				return
			}
			tok, err := createSession(db, careB, target)
			if err != nil {
				http.Error(w, "session failed", http.StatusInternalServerError)
				return
			}
			setSessionCookie(w, tok)
			finish()
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "unknown choice", http.StatusBadRequest)
		}
	}
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && go test -run 'TestMerge|TestResolve' ./...`
Expected: PASS (2 tests).

- [ ] **Step 5: Register the routes (public — the pending token is the capability)**

In `server/router.go`:

```go
	mux.HandleFunc("GET /api/auth/conflict/{pending}", handleConflictInfo(db))
	mux.HandleFunc("POST /api/auth/resolve", handleResolve(db))
```

- [ ] **Step 6: Build and run the full Go suite**

Run: `cd server && go build ./... && go test ./...`
Expected: builds; all tests pass.

- [ ] **Step 7: Commit (Go only — no version bump)**

```bash
git add server/resolve.go server/resolve_test.go server/router.go
git commit -m "feat(auth): add conflict-info and resolve (keep/switch/merge) endpoints"
```

---

### Task 7: Frontend — sign-in buttons, signed-in state, conflict sheet

**Goal:** Add on-theme Google/Apple sign-in pills to onboarding and Profile; show signed-in state (email/provider) + Sign out in Profile; handle the `?auth=` redirect on load, surfacing the conflict-resolution sheet. Anonymous users are never forced to sign in.

**Files:**
- Create: `js/account.js` (fetch `/api/me`, render buttons + signed-in block, conflict sheet, handle `?auth=`)
- Modify: `js/profile.js` (account section + render signed-in state)
- Modify: `js/onboarding.js` (sign-in pills under the create button)
- Modify: `js/app.js` (route `auth:signin`, `auth:signout`, `auth:resolve`; call the `?auth=` handler on init)
- Modify: `styles.css` (provider pill buttons, conflict sheet layout)
- Modify: `index.html` + `sw.js` (version bump — cached assets change)

**Interfaces:**
- Consumes: `GET /api/me`, `GET /api/auth/conflict/{pending}`, `POST /api/auth/resolve`, `POST /api/auth/signout`, `GET /api/auth/{provider}` (full-page nav).
- Produces:
  - `signInButtons()` → HTML for the two provider pills (`data-action="auth:signin" data-provider="google|apple"`).
  - `loadMe()` / `meSnapshot()` — mirror the `loadCaregivers`/`caregiversSnapshot` pattern in `js/profile.js`; cache the `/api/me` result.
  - `accountSection()` → Profile block: signed-in summary + Sign out when `meSnapshot().identity`, else the sign-in pills.
  - `handleAuthRedirect()` — on init, read `?auth=` from the URL; `ok` → toast + refresh; `error` → toast; `conflict` → fetch conflict info and open the conflict sheet; then `history.replaceState` to clear the query.
  - `openConflictSheet(info, pending)` and resolve actions.

- [ ] **Step 1: Create `js/account.js`**

```js
// account.js — OAuth sign-in UI, signed-in state, and conflict resolution.
import { state, save } from './store.js';
import { esc, sheet, toast } from './ui.js';

let cachedMe = { identity: null };
export function meSnapshot() { return cachedMe; }
export async function loadMe() {
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (res.ok) cachedMe = await res.json();
  } catch (e) { /* offline; keep last snapshot */ }
}

export function signInButtons() {
  return `<div class="signin-pills">
    <button class="signin-pill google" data-action="auth:signin" data-provider="google"><svg class="icon"><use href="#circle-user"></use></svg> Continue with Google</button>
    <button class="signin-pill apple" data-action="auth:signin" data-provider="apple"><svg class="icon"><use href="#circle-user"></use></svg> Continue with Apple</button>
  </div>`;
}

export function accountSection() {
  const id = cachedMe.identity;
  if (id) {
    return `<div class="set-row account-row">
        <span class="notif-txt"><b>Signed in</b><span class="fld-l">${esc(id.email || id.provider)}</span></span>
        <button class="btn-sm" data-action="auth:signout">Sign out</button>
      </div>`;
  }
  return `<p class="empty-note">Sign in to back up and sync across devices. Optional — Hearth works without an account.</p>${signInButtons()}`;
}

export function beginSignIn(provider) {
  // Full-page navigation so the provider redirect lands back on our callback.
  window.location.href = '/api/auth/' + provider;
}

export async function signOut(refresh) {
  try { await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' }); } catch (e) { /* ignore */ }
  cachedMe = { identity: null };
  toast('Signed out');
  if (refresh) refresh();
}

// onSignup is called when auth=ok and the app is still in first-run state (signedup
// on a fresh device). app.js provides the full boot sequence as the callback so that
// syncOnce/connectEvents, which are private to app.js, are not re-exported.
export async function handleAuthRedirect(refresh, onSignup) {
  const params = new URLSearchParams(location.search);
  const auth = params.get('auth');
  if (!auth) return;
  const pending = params.get('pending');
  history.replaceState(null, '', location.pathname);
  if (auth === 'ok') {
    await loadMe();
    if (onSignup) {
      await onSignup();
    } else {
      toast('Signed in');
      if (refresh) refresh();
    }
  }
  else if (auth === 'error') { toast('Sign-in failed — please try again'); }
  else if (auth === 'conflict' && pending) {
    try {
      const res = await fetch('/api/auth/conflict/' + encodeURIComponent(pending), { credentials: 'include' });
      if (res.ok) openConflictSheet(await res.json(), pending);
    } catch (e) { toast('Could not load account details'); }
  }
}

function openConflictSheet(info, pending) {
  const fam = (f, label) => `<div class="conflict-fam"><b>${label}</b><span class="fld-l">${esc(f.babyName || 'Baby')} · ${f.entryCount} entr${f.entryCount === 1 ? 'y' : 'ies'}</span></div>`;
  sheet.open(`
    <p class="empty-note">This device has data, and your account already has a family. Nothing is deleted — choose what to do.</p>
    ${fam(info.current, 'This device')}
    ${fam(info.target, 'Your account')}
    <button class="btn-primary" data-action="auth:resolve" data-choice="merge" data-pending="${esc(pending)}"><svg class="icon"><use href="#check"></use></svg> Merge into my account</button>
    <button class="btn-ghost" data-action="auth:resolve" data-choice="switch" data-pending="${esc(pending)}">Switch to my account</button>
    <button class="btn-ghost" data-action="auth:resolve" data-choice="keep" data-pending="${esc(pending)}">Keep this device's data</button>`,
    { title: 'Choose your data' });
}

export async function resolveConflict(choice, pending, onDone) {
  try {
    const res = await fetch('/api/auth/resolve', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pending, choice }),
    });
    if (!res.ok) { toast('Could not apply that choice'); return; }
  } catch (e) { toast('Could not reach the server'); return; }
  sheet.close();
  if (choice === 'switch' || choice === 'merge') {
    // The session now points at the account's family; pull it down on next load.
    state().setup = true; save();
    toast(choice === 'merge' ? 'Merged into your account' : 'Switched to your account');
  } else {
    toast('Kept this device’s data');
  }
  if (onDone) onDone();
}
```

- [ ] **Step 2: Add the account section to Profile**

In `js/profile.js`, import the helpers at the top:

```js
import { accountSection } from './account.js';
```

Add a section to the `profile()` template, right above "Caregivers & sharing":

```js
    <div class="sec-label">Account</div>
    <div class="card row-card" id="account-sec">
      ${accountSection()}
    </div>
```

- [ ] **Step 3: Load `/api/me` when Profile opens**

In `js/app.js`, the `nav:profile` handler already calls `loadCaregivers().then(...)`. Extend it to also load `/api/me`. Add `loadMe` to an import from `./account.js` and update the handler:

```js
    'nav:profile': () => {
      router.go('profile');
      Promise.all([loadCaregivers(), loadMe()]).then(() => { if (current === 'profile') router.refresh(); });
    },
```

- [ ] **Step 4: Add sign-in pills to onboarding**

In `js/onboarding.js`, import `signInButtons` and render it below the "Create Hearth" button:

```js
import { signInButtons } from './account.js';
```

After the `onb-go` button in the `onboarding()` template:

```js
    <div class="onb-or">or</div>
    ${signInButtons()}
```

- [ ] **Step 5: Route the account actions in `js/app.js` and run the redirect handler on init**

Add `beginSignIn, signOut, resolveConflict, handleAuthRedirect, loadMe` to the import from `./account.js` at the top of `js/app.js`. Add to the click `map` (inside the existing `const map = { ... }` block, after the last entry before the closing `}`):

```js
    'auth:signin': () => beginSignIn(d.provider),
    'auth:signout': () => signOut(() => router.refresh()),
    'auth:resolve': () => resolveConflict(d.choice, d.pending, () => { syncOnce(); router.go('home'); }),
```

Replace the `if (!state().setup) { ... } else { ... }` block at the bottom of `init()` (currently lines 540–547):

```js
  if (!state().setup) {
    $('#app').innerHTML = onboarding();
    handleAuthRedirect(null, async () => {
      // signedup on a fresh device: pull the new family down and boot.
      try {
        const syncRes = await fetch('/api/sync', { credentials: 'include' });
        if (syncRes.ok) applySyncResponse(await syncRes.json());
        state().setup = true; save();
      } catch (e) { /* offline — proceed with empty state */ }
      router.boot(); router.go('home');
      syncOnce(); connectEvents();
      toast('Signed in');
    });
  } else {
    router.boot();
    router.go('home');
    handleAuthRedirect(() => router.refresh());
    syncOnce();
    connectEvents();
  }
```

Verify the replacement is exact with: `rg -n "state\(\)\.setup" js/app.js`

- [ ] **Step 6: Style the provider pills and conflict sheet**

Append to `styles.css`:

```css
/* ---- account / sign-in ---- */
.signin-pills { display: flex; flex-direction: column; gap: 10px; }
.signin-pill { all: unset; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px 18px; border-radius: 999px; font-weight: 700; font-size: 15px; background: var(--surface); color: var(--accent-ink); box-shadow: 0 1px 3px var(--mat-cast); }
.signin-pill .icon { width: 18px; height: 18px; }
.onb-or { text-align: center; color: var(--soft); font-size: 13px; margin: 14px 0 10px; }
.account-row { display: flex; align-items: center; justify-content: space-between; }
.conflict-fam { display: flex; flex-direction: column; padding: 10px 12px; border-radius: 14px; background: color-mix(in oklch, var(--accent-tint) 50%, transparent); }
```

(Verify the tokens exist via `rg "--surface|--accent-ink|--accent-tint|--mat-cast|--soft" styles.css`; substitute the nearest existing token if any is missing.)

- [ ] **Step 7: Lint/parse check**

Run: `npm run check`
Expected: passes.

- [ ] **Step 8: Write a Playwright test for the sign-in UI (no live provider round-trip)**

Create `tests/account.test.js`. Without real provider credentials the server returns 404 on `/api/auth/google`, and `/api/me` returns `{"identity":null}`, so the test asserts the UI surfaces correctly and `auth=error` is handled gracefully:

```js
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18795);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.click('[data-action="nav:profile"]');
    await page.waitForSelector('#account-sec');
    const pills = await page.$$('.signin-pill');
    check('profile shows two sign-in pills when anonymous', pills.length === 2, 'pills=' + pills.length);
    // auth=error redirect is handled with a toast, not a crash.
    await page.goto(srv.base + '/?auth=error');
    await page.waitForTimeout(400);
    const urlClean = !page.url().includes('auth=');
    check('auth query param is cleared from the URL', urlClean, page.url());
  } catch (e) {
    check('account test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})();
```

- [ ] **Step 9: Run the Playwright test and confirm it passes**

Run: `node tests/account.test.js`
Expected: `2 pass, 0 fail`.

- [ ] **Step 10: Live end-to-end verification (requires configured credentials)**

With real Google/Apple credentials in `.env` and `PUBLIC_BASE_URL` set, verify against the spec's acceptance list:
- Case 1 (link): fresh anonymous user signs in → existing local data is preserved and now anchored (`/api/me` shows the identity; an `identities` row points at the original caregiver).
- Case 2 (restore): same identity on a clean second device restores the family (data syncs down).
- Case 3 (conflict): a device with its own data signing into an account that has another family surfaces the conflict sheet; each of keep/switch/merge behaves as specified with **no data loss** (verify family A rows still exist after switch; verify merge dedupes by id).
- Anonymous-only users are never forced to sign in; the app works unchanged with the buttons ignored.
- Sign out revokes the session (subsequent authed calls 401).

- [ ] **Step 11: Run the full suites, bump version, and commit**

```bash
node tests/run.js && npm run check && (cd server && go test ./...)
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Update index.html <meta name="version"> to $TS and sw.js VERSION to hearth-$TS (frontend assets changed)
git add index.html sw.js js/account.js js/profile.js js/onboarding.js js/app.js styles.css tests/account.test.js
git commit -m "feat(account): add OAuth sign-in UI, signed-in state, and conflict sheet"
```

---

## Self-review notes (coverage map)

- Prerequisite (developer-console registration) + config env → Task 1 (`docs/oauth-setup.md`, `config.go`).
- Data model `identities` table → Task 2 (plus `pending_auth` for the deferred conflict round-trip).
- Endpoints: `GET /api/auth/{provider}` → Task 3; `GET /api/auth/{provider}/callback` → Task 4; `POST /api/auth/signout` + `GET /api/me` → Task 5; conflict info + resolve → Task 6.
- Reconciliation cases 1–3 (link / restore / conflict) + sign-up edge → Task 4 `reconcile`, with case-3 choices (keep/switch/merge, no silent discard, id-keyed dedupe) → Task 6.
- Frontend (sign-in buttons in onboarding + Profile, signed-in state + Sign out, conflict sheet) → Task 7.
- Verification list (cases 1–3, never-forced, sign-out revokes) → Task 7 Step 10.
- Out of scope (email/GitHub providers, real-time merge beyond id dedupe, account deletion/export) → not implemented.
- Reuses existing `requireAuth`, `createSession`, `setSessionCookie`, session-cookie revocation model; sessions remain unchanged.

## Sequencing note

Tasks 1–6 are Go-only (no version bump). Task 7 is the only frontend change and carries the single version bump. Tasks 3→4 and 4→6 have ordering dependencies (begin before callback; reconcile/pending before resolve); Task 5 is independent of 4/6 and can be done in any order after Task 2. Live OAuth verification (Task 7 Step 10) is blocked on the Task 1 prerequisite being completed by the project owner.
