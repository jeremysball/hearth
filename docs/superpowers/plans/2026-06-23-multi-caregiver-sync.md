# Multi-Caregiver Backend & Sync Implementation Plan

> **Status:** COMPLETE — merged to `main`. Caregivers, invites, SSE (`/api/events`), `currentCaregiverId`, and reconcile are live.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a self-hosted Go+SQLite backend that lets multiple caregivers share one baby's data via invite links, with offline-first sync over REST+SSE, replacing the current single-device `localStorage`-only app.

**Architecture:** A single Go binary (`server/`) serves the existing static PWA, a REST API, and an SSE channel on one port, backed by one SQLite file. The client keeps writing to `localStorage` instantly (unchanged UX) and additionally queues each write in an `outbox`; a sync loop drains the outbox to the server and pulls `/api/sync` deltas, merging by id. This plan implements ADR 0001 sections 1-7. **Web Push (ADR §8) is deliberately out of scope for this plan** — it's independent follow-on work (its own plan) per the ADR's own framing.

**Tech Stack:** Go (stdlib `net/http` only — no router/web framework), `modernc.org/sqlite` (pure-Go SQLite driver, no cgo), vanilla ES modules on the client (no build step, no new frontend dependencies), Node's built-in `node:test` for client-side unit tests.

## Global Constraints

- No new frontend build tooling — client code stays plain ES modules loaded via `<script type="module">`, matching the existing codebase.
- Go code uses only the standard library plus `modernc.org/sqlite` — no web framework, no ORM.
- Every server response that mutates state must update `updated_at`; every delete is a soft-delete (`deleted_at` set), never a SQL `DELETE`, so sync can propagate it as a tombstone.
- Session auth is cookie-based (httpOnly, Secure), no passwords — per ADR 0001 §6.
- All timestamps are UTC RFC3339 strings (`time.Now().UTC().Format(time.RFC3339Nano)` server-side, `new Date().toISOString()` client-side) so string comparison for `since=` filtering is reliable.
- Reuse the existing `.env` file mechanism (already established for `serve.js`) for server config — add `DB_PATH`, keep `HOST`/`PORT`/`CERT_FILE`/`KEY_FILE`.
- Go >= 1.22 is required (for `http.ServeMux`'s method+wildcard routing patterns, e.g. `"POST /api/join/{token}"` + `r.PathValue("token")`, used starting in Task 5). Run `go version` before Task 1 and install a newer toolchain first if it reports less than 1.22.

---

## Task 1: Go module scaffold + static file server

Stand up the Go module and get it serving the existing PWA — this is the direct replacement for `serve.js`, proven first so every later task builds on a server that's already known to work.

**Files:**
- Create: `server/go.mod`
- Create: `server/main.go`
- Create: `server/config.go`
- Test: `server/config_test.go`

**Interfaces:**
- Produces: `type Config struct { Host, Port, CertFile, KeyFile, DBPath, StaticDir string }`, `func loadConfig() Config`, `func getenv(key, fallback string) string`, `func loadEnvFile(path string)` — every later task's `main.go` changes reuse `loadConfig()`.

- [ ] **Step 1: Initialize the Go module**

Run:
```bash
cd /workspace/huckleberry-clone
mkdir -p server
cd server
go mod init hearth/server
```
Expected: creates `server/go.mod` with `module hearth/server` and a `go` version line.

- [ ] **Step 2: Write the failing test for config loading**

Create `server/config_test.go`:
```go
package main

import (
	"os"
	"testing"
)

func TestLoadEnvFileSetsUnsetVars(t *testing.T) {
	dir := t.TempDir()
	envPath := dir + "/.env"
	if err := os.WriteFile(envPath, []byte("FOO_TEST_KEY=bar\n# a comment\n\nBAZ_TEST_KEY=\"quoted\"\n"), 0644); err != nil {
		t.Fatal(err)
	}
	os.Unsetenv("FOO_TEST_KEY")
	os.Unsetenv("BAZ_TEST_KEY")

	loadEnvFile(envPath)

	if got := os.Getenv("FOO_TEST_KEY"); got != "bar" {
		t.Fatalf("expected FOO_TEST_KEY=bar, got %q", got)
	}
	if got := os.Getenv("BAZ_TEST_KEY"); got != "quoted" {
		t.Fatalf("expected BAZ_TEST_KEY=quoted, got %q", got)
	}
	os.Unsetenv("FOO_TEST_KEY")
	os.Unsetenv("BAZ_TEST_KEY")
}

func TestLoadEnvFileDoesNotOverrideExistingVars(t *testing.T) {
	dir := t.TempDir()
	envPath := dir + "/.env"
	os.WriteFile(envPath, []byte("OVERRIDE_TEST_KEY=fromfile\n"), 0644)
	os.Setenv("OVERRIDE_TEST_KEY", "fromenv")
	defer os.Unsetenv("OVERRIDE_TEST_KEY")

	loadEnvFile(envPath)

	if got := os.Getenv("OVERRIDE_TEST_KEY"); got != "fromenv" {
		t.Fatalf("expected real env var to win, got %q", got)
	}
}

func TestGetenvFallback(t *testing.T) {
	os.Unsetenv("MISSING_TEST_KEY")
	if got := getenv("MISSING_TEST_KEY", "default"); got != "default" {
		t.Fatalf("expected default, got %q", got)
	}
}

func TestLoadConfigDefaults(t *testing.T) {
	for _, k := range []string{"HOST", "PORT", "DB_PATH", "STATIC_DIR"} {
		os.Unsetenv(k)
	}
	cfg := loadConfig()
	if cfg.Host != "0.0.0.0" {
		t.Errorf("Host = %q, want 0.0.0.0", cfg.Host)
	}
	if cfg.Port != "8443" {
		t.Errorf("Port = %q, want 8443", cfg.Port)
	}
	if cfg.DBPath != "hearth.db" {
		t.Errorf("DBPath = %q, want hearth.db", cfg.DBPath)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && go test ./... -run TestLoadEnvFile -v`
Expected: FAIL — `undefined: loadEnvFile` (compile error, since `config.go` doesn't exist yet).

- [ ] **Step 3: Implement config.go**

Create `server/config.go`:
```go
package main

import (
	"bufio"
	"os"
	"strings"
)

type Config struct {
	Host      string
	Port      string
	CertFile  string
	KeyFile   string
	DBPath    string
	StaticDir string
}

func loadConfig() Config {
	loadEnvFile(".env")
	return Config{
		Host:      getenv("HOST", "0.0.0.0"),
		Port:      getenv("PORT", "8443"),
		CertFile:  os.Getenv("CERT_FILE"),
		KeyFile:   os.Getenv("KEY_FILE"),
		DBPath:    getenv("DB_PATH", "hearth.db"),
		StaticDir: getenv("STATIC_DIR", "."),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// loadEnvFile reads KEY=VALUE lines from path into the process environment,
// skipping blank lines and lines starting with '#'. It never overwrites a
// variable that's already set in the real environment.
func loadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.Trim(strings.TrimSpace(parts[1]), `"'`)
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, val)
		}
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && go test ./... -v`
Expected: all four tests PASS.

- [ ] **Step 5: Implement main.go serving static files**

Create `server/main.go`:
```go
package main

import (
	"log"
	"net/http"
)

func main() {
	cfg := loadConfig()
	mux := newRouter(nil)
	addr := cfg.Host + ":" + cfg.Port

	log.Printf("Hearth server listening on %s (static: %s)", addr, cfg.StaticDir)
	if cfg.CertFile != "" && cfg.KeyFile != "" {
		log.Fatal(http.ListenAndServeTLS(addr, cfg.CertFile, cfg.KeyFile, mux))
	} else {
		log.Fatal(http.ListenAndServe(addr, mux))
	}
}
```

Create `server/router.go` (this function's body grows in later tasks — each task that adds routes shows the new full version):
```go
package main

import (
	"database/sql"
	"net/http"
)

func newRouter(db *sql.DB) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.Dir(".")))
	return mux
}
```

- [ ] **Step 6: Manually verify static serving works**

Run:
```bash
cd /workspace/huckleberry-clone/server
go run . &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8443/index.html
kill %1
```
Expected: `200` (or, if `CERT_FILE`/`KEY_FILE` are already set in `.env` from the earlier `serve.js` setup, use `curl -sk` against `https://localhost:8443/index.html` instead — same expected `200`).

- [ ] **Step 7: Commit**

```bash
cd /workspace/huckleberry-clone
git add server/go.mod server/main.go server/config.go server/config_test.go server/router.go
git commit -m "Add Go server scaffold serving the static PWA"
```

---

## Task 2: SQLite schema + database layer

**Files:**
- Create: `server/schema.sql`
- Create: `server/db.go`
- Test: `server/db_test.go`
- Modify: `server/main.go`

**Interfaces:**
- Consumes: nothing new.
- Produces: `func openDB(path string) (*sql.DB, error)`, `func nowISO() string`, `func newID() string` — every later task that touches the database uses these three.

- [ ] **Step 1: Add the SQLite driver dependency**

Run:
```bash
cd /workspace/huckleberry-clone/server
go get modernc.org/sqlite@latest
```
Expected: `go.mod`/`go.sum` updated with `modernc.org/sqlite` and its transitive deps.

- [ ] **Step 2: Write the schema**

Create `server/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS babies (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL DEFAULT '',
  birthdate TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'girl',
  photo TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_babies_family ON babies(family_id);

CREATE TABLE IF NOT EXISTS caregivers (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Parent',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_caregivers_family ON caregivers(family_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL REFERENCES caregivers(id),
  family_id TEXT NOT NULL REFERENCES families(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  family_id TEXT PRIMARY KEY REFERENCES families(id),
  bottle_interval_h REAL NOT NULL DEFAULT 3,
  meds_json TEXT NOT NULL DEFAULT '[]',
  units_json TEXT NOT NULL DEFAULT '{}',
  reminders_json TEXT NOT NULL DEFAULT '{}',
  cards_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS log_entries (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  type TEXT NOT NULL,
  start TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_log_entries_family_updated ON log_entries(family_id, updated_at);

CREATE TABLE IF NOT EXISTS growth_entries (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  date TEXT NOT NULL,
  weight_kg REAL,
  height_cm REAL,
  head_cm REAL,
  note TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_growth_entries_family_updated ON growth_entries(family_id, updated_at);
```

- [ ] **Step 3: Write the failing test**

Create `server/db_test.go`:
```go
package main

import (
	"testing"
)

func TestOpenDBCreatesSchema(t *testing.T) {
	dir := t.TempDir()
	db, err := openDB(dir + "/test.db")
	if err != nil {
		t.Fatalf("openDB: %v", err)
	}
	defer db.Close()

	tables := []string{"families", "babies", "caregivers", "sessions", "invites", "settings", "log_entries", "growth_entries"}
	for _, tbl := range tables {
		var count int
		err := db.QueryRow("SELECT count(*) FROM " + tbl).Scan(&count)
		if err != nil {
			t.Errorf("table %s: query failed: %v", tbl, err)
		}
	}
}

func TestNewIDIsUniqueAndNonEmpty(t *testing.T) {
	a, b := newID(), newID()
	if a == "" || b == "" {
		t.Fatal("newID returned empty string")
	}
	if a == b {
		t.Fatal("newID returned the same value twice")
	}
}

func TestNowISOIsRFC3339(t *testing.T) {
	s := nowISO()
	if len(s) < 20 {
		t.Fatalf("nowISO() = %q, looks too short for RFC3339Nano", s)
	}
}
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd server && go test ./... -run "TestOpenDB|TestNewID|TestNowISO" -v`
Expected: FAIL — `undefined: openDB` (compile error, `db.go` doesn't exist yet).

- [ ] **Step 5: Implement db.go**

Create `server/db.go`:
```go
package main

import (
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/hex"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaFS embed.FS

func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	schema, err := schemaFS.ReadFile("schema.sql")
	if err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(string(schema)); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

// newID returns a random 16-byte hex string, used as the primary key for
// every row this server creates (families, babies, caregivers, entries...).
func newID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd server && go test ./... -v`
Expected: all tests PASS, including the four from Task 1.

- [ ] **Step 7: Wire openDB into main.go**

Modify `server/main.go` to the following full content:
```go
package main

import (
	"log"
	"net/http"
)

func main() {
	cfg := loadConfig()
	db, err := openDB(cfg.DBPath)
	if err != nil {
		log.Fatalf("opening database %s: %v", cfg.DBPath, err)
	}
	defer db.Close()

	mux := newRouter(db)
	addr := cfg.Host + ":" + cfg.Port

	log.Printf("Hearth server listening on %s (db: %s, static: %s)", addr, cfg.DBPath, cfg.StaticDir)
	if cfg.CertFile != "" && cfg.KeyFile != "" {
		log.Fatal(http.ListenAndServeTLS(addr, cfg.CertFile, cfg.KeyFile, mux))
	} else {
		log.Fatal(http.ListenAndServe(addr, mux))
	}
}
```

- [ ] **Step 8: Manually verify the server still starts and creates a db file**

Run:
```bash
cd /workspace/huckleberry-clone/server
rm -f /tmp/hearth-manual-test.db
DB_PATH=/tmp/hearth-manual-test.db PORT=8444 go run . &
sleep 1
ls -la /tmp/hearth-manual-test.db
kill %1
```
Expected: the db file exists and is non-empty (schema was applied).

- [ ] **Step 9: Commit**

```bash
cd /workspace/huckleberry-clone
git add server/schema.sql server/db.go server/db_test.go server/main.go server/go.mod server/go.sum
git commit -m "Add SQLite schema and database layer"
```

---

## Task 3: Session auth + family creation (admin bootstrap)

This is the "create a new family" endpoint — the server-side counterpart to today's solo onboarding flow (Task 13 wires the client to actually call it). It's also where session/cookie auth is introduced, since creating a family immediately logs you in as its first caregiver.

**Files:**
- Create: `server/testutil_test.go`
- Create: `server/auth.go`
- Test: `server/auth_test.go`
- Create: `server/family.go`
- Test: `server/family_test.go`
- Modify: `server/router.go`

**Interfaces:**
- Consumes: `openDB`, `nowISO`, `newID` (Task 2).
- Produces: `type SessionInfo struct { CaregiverID, FamilyID string }`, `func createSession(db *sql.DB, caregiverID, familyID string) (string, error)`, `func setSessionCookie(w http.ResponseWriter, token string)`, `func requireAuth(db *sql.DB, next http.HandlerFunc) http.HandlerFunc`, `func sessionFrom(r *http.Request) SessionInfo`, `const sessionCookieName = "hearth_session"` — every later task that needs "who is making this request" uses `requireAuth` + `sessionFrom`. Also `func newTestDB(t *testing.T) *sql.DB` — every later test file uses this instead of repeating `openDB(t.TempDir()+...)`.

- [ ] **Step 1: Add the shared test helper**

Create `server/testutil_test.go`:
```go
package main

import (
	"database/sql"
	"testing"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := openDB(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("openDB: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}
```

- [ ] **Step 2: Write the failing auth tests**

Create `server/auth_test.go`:
```go
package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreateSessionInsertsRow(t *testing.T) {
	db := newTestDB(t)
	token, err := createSession(db, "cg1", "fam1")
	if err != nil {
		t.Fatal(err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}
	var caregiverID string
	if err := db.QueryRow(`SELECT caregiver_id FROM sessions WHERE token = ?`, token).Scan(&caregiverID); err != nil {
		t.Fatalf("querying session: %v", err)
	}
	if caregiverID != "cg1" {
		t.Errorf("caregiver_id = %q, want cg1", caregiverID)
	}
}

func TestRequireAuthRejectsMissingCookie(t *testing.T) {
	db := newTestDB(t)
	req := httptest.NewRequest("GET", "/api/whatever", nil)
	rec := httptest.NewRecorder()
	called := false

	requireAuth(db, func(w http.ResponseWriter, r *http.Request) { called = true })(rec, req)

	if called {
		t.Fatal("handler should not have been called")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestRequireAuthRejectsUnknownToken(t *testing.T) {
	db := newTestDB(t)
	req := httptest.NewRequest("GET", "/api/whatever", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "not-a-real-token"})
	rec := httptest.NewRecorder()
	called := false

	requireAuth(db, func(w http.ResponseWriter, r *http.Request) { called = true })(rec, req)

	if called {
		t.Fatal("handler should not have been called")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestRequireAuthAcceptsValidSession(t *testing.T) {
	db := newTestDB(t)
	token, err := createSession(db, "cg1", "fam1")
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/whatever", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	rec := httptest.NewRecorder()
	var got SessionInfo

	requireAuth(db, func(w http.ResponseWriter, r *http.Request) { got = sessionFrom(r) })(rec, req)

	if got.CaregiverID != "cg1" || got.FamilyID != "fam1" {
		t.Fatalf("got %+v, want CaregiverID=cg1 FamilyID=fam1", got)
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && go test ./... -run "TestCreateSession|TestRequireAuth" -v`
Expected: FAIL — `undefined: createSession` (compile error, `auth.go` doesn't exist yet).

- [ ] **Step 4: Implement auth.go**

Create `server/auth.go`:
```go
package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"net/http"
)

type ctxKey string

const ctxSessionKey ctxKey = "session"
const sessionCookieName = "hearth_session"
const sessionCookieMaxAge = 10 * 365 * 24 * 60 * 60 // ~10 years; revocation is by deleting the row, not by expiry

type SessionInfo struct {
	CaregiverID string
	FamilyID    string
}

func newSessionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func createSession(db *sql.DB, caregiverID, familyID string) (string, error) {
	token, err := newSessionToken()
	if err != nil {
		return "", err
	}
	now := nowISO()
	_, err = db.Exec(`INSERT INTO sessions (token, caregiver_id, family_id, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`,
		token, caregiverID, familyID, now, now)
	if err != nil {
		return "", err
	}
	return token, nil
}

func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   sessionCookieMaxAge,
	})
}

// requireAuth wraps a handler so it only runs for requests carrying a valid
// session cookie, and attaches the resolved SessionInfo to the request context.
func requireAuth(db *sql.DB, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var familyID, caregiverID string
		err = db.QueryRow(`SELECT family_id, caregiver_id FROM sessions WHERE token = ?`, cookie.Value).
			Scan(&familyID, &caregiverID)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		db.Exec(`UPDATE sessions SET last_seen_at = ? WHERE token = ?`, nowISO(), cookie.Value)
		ctx := context.WithValue(r.Context(), ctxSessionKey, SessionInfo{CaregiverID: caregiverID, FamilyID: familyID})
		next(w, r.WithContext(ctx))
	}
}

func sessionFrom(r *http.Request) SessionInfo {
	v, _ := r.Context().Value(ctxSessionKey).(SessionInfo)
	return v
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && go test ./... -v`
Expected: all tests PASS (Task 1, 2, and 3's so far).

- [ ] **Step 6: Write the failing family-creation tests**

Create `server/family_test.go`:
```go
package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestHandleCreateFamily(t *testing.T) {
	db := newTestDB(t)
	body := bytes.NewBufferString(`{"babyName":"Mira","birthdate":"2026-01-01","theme":"girl","caregiverName":"Maya"}`)
	req := httptest.NewRequest("POST", "/api/family", body)
	rec := httptest.NewRecorder()

	handleCreateFamily(db)(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp createFamilyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if resp.FamilyID == "" || resp.BabyID == "" || resp.CaregiverID == "" {
		t.Fatalf("expected non-empty ids, got %+v", resp)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != sessionCookieName {
		t.Fatalf("expected a %s cookie, got %v", sessionCookieName, cookies)
	}
	var babyName string
	if err := db.QueryRow(`SELECT name FROM babies WHERE id = ?`, resp.BabyID).Scan(&babyName); err != nil {
		t.Fatalf("querying baby: %v", err)
	}
	if babyName != "Mira" {
		t.Errorf("babyName = %q, want Mira", babyName)
	}
}

func TestHandleCreateFamilyRejectsMissingBabyName(t *testing.T) {
	db := newTestDB(t)
	req := httptest.NewRequest("POST", "/api/family", bytes.NewBufferString(`{}`))
	rec := httptest.NewRecorder()

	handleCreateFamily(db)(rec, req)

	if rec.Code != 400 {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd server && go test ./... -run TestHandleCreateFamily -v`
Expected: FAIL — `undefined: handleCreateFamily` (compile error, `family.go` doesn't exist yet).

- [ ] **Step 8: Implement family.go**

Create `server/family.go`:
```go
package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type createFamilyRequest struct {
	BabyName      string `json:"babyName"`
	Birthdate     string `json:"birthdate"`
	Theme         string `json:"theme"`
	CaregiverName string `json:"caregiverName"`
}

type createFamilyResponse struct {
	FamilyID    string `json:"familyId"`
	BabyID      string `json:"babyId"`
	CaregiverID string `json:"caregiverId"`
}

func handleCreateFamily(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req createFamilyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if req.BabyName == "" {
			http.Error(w, "babyName is required", http.StatusBadRequest)
			return
		}
		theme := req.Theme
		if theme == "" {
			theme = "girl"
		}
		caregiverName := req.CaregiverName
		if caregiverName == "" {
			caregiverName = "Parent"
		}

		familyID, babyID, caregiverID := newID(), newID(), newID()
		now := nowISO()

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		if _, err := tx.Exec(`INSERT INTO families (id, created_at) VALUES (?, ?)`, familyID, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`INSERT INTO babies (id, family_id, name, birthdate, theme, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			babyID, familyID, req.BabyName, req.Birthdate, theme, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES (?, ?, ?, 'Parent', ?)`,
			caregiverID, familyID, caregiverName, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defaultUnits := `{"volume":"ml","temp":"C","weight":"kg","length":"cm"}`
		defaultReminders := `{"naps":true,"bottle":true,"meds":true,"quietStart":"20:00","quietEnd":"07:00"}`
		defaultCards := `{"sweetspot":true,"bottle":true,"medicine":true}`
		if _, err := tx.Exec(`INSERT INTO settings (family_id, units_json, reminders_json, cards_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
			familyID, defaultUnits, defaultReminders, defaultCards, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		token, err := createSession(db, caregiverID, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		setSessionCookie(w, token)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(createFamilyResponse{FamilyID: familyID, BabyID: babyID, CaregiverID: caregiverID})
	}
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd server && go test ./... -v`
Expected: all tests PASS.

- [ ] **Step 10: Wire the route into router.go**

Modify `server/router.go` to the following full content:
```go
package main

import (
	"database/sql"
	"net/http"
)

func newRouter(db *sql.DB) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/family", handleCreateFamily(db))
	mux.Handle("/", http.FileServer(http.Dir(".")))
	return mux
}
```

- [ ] **Step 11: Commit**

```bash
cd /workspace/huckleberry-clone
git add server/testutil_test.go server/auth.go server/auth_test.go server/family.go server/family_test.go server/router.go
git commit -m "Add session auth and family-creation endpoint"
```

---

## Task 4: SSE hub

Built before the write endpoints (entries, growth, settings) so each of them can take a `*Hub` parameter from the start, instead of having their signatures changed later.

**Files:**
- Create: `server/sse.go`
- Test: `server/sse_test.go`
- Modify: `server/router.go`
- Modify: `server/main.go`

**Interfaces:**
- Consumes: `SessionInfo`, `sessionFrom`, `ctxSessionKey` (Task 3).
- Produces: `type Hub struct{...}`, `func newHub() *Hub`, `func (h *Hub) Subscribe(familyID string) (chan string, func())`, `func (h *Hub) Broadcast(familyID string)`, `func handleEvents(hub *Hub) http.HandlerFunc` — every later write handler (entries, growth, family/settings PATCH) takes a `*Hub` and calls `hub.Broadcast(familyID)` after a successful write.

- [ ] **Step 1: Write the failing hub tests**

Create `server/sse_test.go`:
```go
package main

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHubBroadcastDeliversToSubscriber(t *testing.T) {
	h := newHub()
	ch, cancel := h.Subscribe("fam1")
	defer cancel()

	h.Broadcast("fam1")

	select {
	case msg := <-ch:
		if msg != "changed" {
			t.Errorf("msg = %q, want changed", msg)
		}
	default:
		t.Fatal("expected a message, got none")
	}
}

func TestHubBroadcastDoesNotCrossFamilies(t *testing.T) {
	h := newHub()
	chA, cancelA := h.Subscribe("famA")
	defer cancelA()
	chB, cancelB := h.Subscribe("famB")
	defer cancelB()

	h.Broadcast("famA")

	select {
	case <-chA:
	default:
		t.Fatal("famA subscriber should have received a message")
	}
	select {
	case <-chB:
		t.Fatal("famB subscriber should NOT have received a message")
	default:
	}
}

func TestHubCancelRemovesSubscriber(t *testing.T) {
	h := newHub()
	_, cancel := h.Subscribe("fam1")
	cancel()

	if len(h.subs["fam1"]) != 0 {
		t.Fatalf("expected 0 subscribers after cancel, got %d", len(h.subs["fam1"]))
	}
}

func TestHandleEventsStreamsBroadcast(t *testing.T) {
	hub := newHub()
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest("GET", "/api/events", nil)
	req = req.WithContext(context.WithValue(ctx, ctxSessionKey, SessionInfo{FamilyID: "fam1"}))
	rec := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		handleEvents(hub)(rec, req)
		close(done)
	}()

	time.Sleep(20 * time.Millisecond) // let the handler subscribe
	hub.Broadcast("fam1")
	time.Sleep(20 * time.Millisecond) // let the write land in rec.Body

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("handleEvents did not return after context cancellation")
	}

	if !strings.Contains(rec.Body.String(), "data: changed") {
		t.Fatalf("expected SSE body to contain 'data: changed', got %q", rec.Body.String())
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && go test ./... -run "TestHub|TestHandleEvents" -v`
Expected: FAIL — `undefined: newHub` (compile error, `sse.go` doesn't exist yet).

- [ ] **Step 3: Implement sse.go**

Create `server/sse.go`:
```go
package main

import (
	"fmt"
	"net/http"
	"sync"
)

type Hub struct {
	mu   sync.Mutex
	subs map[string]map[chan string]bool // familyID -> set of subscriber channels
}

func newHub() *Hub {
	return &Hub{subs: make(map[string]map[chan string]bool)}
}

func (h *Hub) Subscribe(familyID string) (chan string, func()) {
	ch := make(chan string, 4)
	h.mu.Lock()
	if h.subs[familyID] == nil {
		h.subs[familyID] = make(map[chan string]bool)
	}
	h.subs[familyID][ch] = true
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		delete(h.subs[familyID], ch)
		h.mu.Unlock()
		close(ch)
	}
	return ch, cancel
}

// Broadcast notifies every subscriber for familyID that something changed.
// It never blocks: a subscriber with a full buffer just misses this signal
// and catches up on its next periodic /api/sync poll.
func (h *Hub) Broadcast(familyID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[familyID] {
		select {
		case ch <- "changed":
		default:
		}
	}
}

func handleEvents(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		session := sessionFrom(r)
		ch, cancel := hub.Subscribe(session.FamilyID)
		defer cancel()

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		for {
			select {
			case <-r.Context().Done():
				return
			case msg, open := <-ch:
				if !open {
					return
				}
				fmt.Fprintf(w, "data: %s\n\n", msg)
				flusher.Flush()
			}
		}
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && go test ./... -v`
Expected: all tests PASS.

- [ ] **Step 5: Wire the hub into router.go and main.go**

Modify `server/router.go` to the following full content:
```go
package main

import (
	"database/sql"
	"net/http"
)

func newRouter(db *sql.DB, hub *Hub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/family", handleCreateFamily(db))
	mux.HandleFunc("/api/events", requireAuth(db, handleEvents(hub)))
	mux.Handle("/", http.FileServer(http.Dir(".")))
	return mux
}
```

Modify `server/main.go` to the following full content:
```go
package main

import (
	"log"
	"net/http"
)

func main() {
	cfg := loadConfig()
	db, err := openDB(cfg.DBPath)
	if err != nil {
		log.Fatalf("opening database %s: %v", cfg.DBPath, err)
	}
	defer db.Close()

	hub := newHub()
	mux := newRouter(db, hub)
	addr := cfg.Host + ":" + cfg.Port

	log.Printf("Hearth server listening on %s (db: %s, static: %s)", addr, cfg.DBPath, cfg.StaticDir)
	if cfg.CertFile != "" && cfg.KeyFile != "" {
		log.Fatal(http.ListenAndServeTLS(addr, cfg.CertFile, cfg.KeyFile, mux))
	} else {
		log.Fatal(http.ListenAndServe(addr, mux))
	}
}
```

- [ ] **Step 6: Commit**

```bash
cd /workspace/huckleberry-clone
git add server/sse.go server/sse_test.go server/router.go server/main.go
git commit -m "Add SSE hub for cross-device change notifications"
```

---

## Task 5: Invite links — create + join

**Files:**
- Create: `server/invites.go`
- Test: `server/invites_test.go`
- Modify: `server/router.go`

**Interfaces:**
- Consumes: `requireAuth`, `sessionFrom`, `createSession`, `setSessionCookie` (Task 3), `newID`, `nowISO` (Task 2).
- Produces: `func handleCreateInvite(db *sql.DB) http.HandlerFunc`, `func handleJoinInvite(db *sql.DB) http.HandlerFunc` — not consumed elsewhere, but `POST /api/join/{token}` is the route the client's join flow (Task 12) calls.

- [ ] **Step 1: Write the failing invite tests**

Create `server/invites_test.go`:
```go
package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleCreateInviteRequiresAuth(t *testing.T) {
	db := newTestDB(t)
	req := httptest.NewRequest("POST", "/api/invites", nil)
	rec := httptest.NewRecorder()

	requireAuth(db, handleCreateInvite(db))(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestHandleCreateInviteReturnsToken(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	token, err := createSession(db, "cg1", "fam1")
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/api/invites", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	rec := httptest.NewRecorder()

	requireAuth(db, handleCreateInvite(db))(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp createInviteResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if resp.Token == "" {
		t.Fatal("expected non-empty invite token")
	}
	var familyID string
	if err := db.QueryRow(`SELECT family_id FROM invites WHERE token = ?`, resp.Token).Scan(&familyID); err != nil {
		t.Fatalf("querying invite: %v", err)
	}
	if familyID != "fam1" {
		t.Errorf("invite family_id = %q, want fam1", familyID)
	}
}

func TestHandleJoinInviteCreatesCaregiverAndSession(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO invites (token, family_id, created_by, expires_at) VALUES ('inv1', 'fam1', 'cg1', ?)`,
		"2099-01-01T00:00:00Z")

	body := bytes.NewBufferString(`{"caregiverName":"Maya"}`)
	req := httptest.NewRequest("POST", "/api/join/inv1", body)
	req.SetPathValue("token", "inv1")
	rec := httptest.NewRecorder()

	handleJoinInvite(db)(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != sessionCookieName {
		t.Fatalf("expected a %s cookie, got %v", sessionCookieName, cookies)
	}
	var usedAt sql.NullString
	if err := db.QueryRow(`SELECT used_at FROM invites WHERE token = 'inv1'`).Scan(&usedAt); err != nil {
		t.Fatal(err)
	}
	if !usedAt.Valid || usedAt.String == "" {
		t.Error("expected invite to be marked used")
	}
}

func TestHandleJoinInviteRejectsUsedToken(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO invites (token, family_id, created_by, expires_at, used_at) VALUES ('inv1', 'fam1', 'cg1', ?, ?)`,
		"2099-01-01T00:00:00Z", nowISO())

	req := httptest.NewRequest("POST", "/api/join/inv1", bytes.NewBufferString(`{"caregiverName":"Maya"}`))
	req.SetPathValue("token", "inv1")
	rec := httptest.NewRecorder()

	handleJoinInvite(db)(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rec.Code)
	}
}

func TestHandleJoinInviteRejectsExpiredToken(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO invites (token, family_id, created_by, expires_at) VALUES ('inv1', 'fam1', 'cg1', ?)`,
		"2000-01-01T00:00:00Z")

	req := httptest.NewRequest("POST", "/api/join/inv1", bytes.NewBufferString(`{"caregiverName":"Maya"}`))
	req.SetPathValue("token", "inv1")
	rec := httptest.NewRecorder()

	handleJoinInvite(db)(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rec.Code)
	}
}

func TestHandleJoinInviteRejectsUnknownToken(t *testing.T) {
	db := newTestDB(t)
	req := httptest.NewRequest("POST", "/api/join/nope", bytes.NewBufferString(`{"caregiverName":"Maya"}`))
	req.SetPathValue("token", "nope")
	rec := httptest.NewRecorder()

	handleJoinInvite(db)(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && go test ./... -run "TestHandleCreateInvite|TestHandleJoinInvite" -v`
Expected: FAIL — `undefined: handleCreateInvite` (compile error, `invites.go` doesn't exist yet).

- [ ] **Step 3: Implement invites.go**

Create `server/invites.go`:
```go
package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"
)

const inviteTTL = 48 * time.Hour

type createInviteResponse struct {
	Token string `json:"token"`
}

func handleCreateInvite(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		token := newID()
		expiresAt := time.Now().UTC().Add(inviteTTL).Format(time.RFC3339Nano)

		_, err := db.Exec(`INSERT INTO invites (token, family_id, created_by, expires_at) VALUES (?, ?, ?, ?)`,
			token, session.FamilyID, session.CaregiverID, expiresAt)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(createInviteResponse{Token: token})
	}
}

type joinInviteRequest struct {
	CaregiverName string `json:"caregiverName"`
}

type joinInviteResponse struct {
	FamilyID    string `json:"familyId"`
	CaregiverID string `json:"caregiverId"`
}

func handleJoinInvite(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.PathValue("token")

		var familyID string
		var expiresAt string
		var usedAt sql.NullString
		err := db.QueryRow(`SELECT family_id, expires_at, used_at FROM invites WHERE token = ?`, token).
			Scan(&familyID, &expiresAt, &usedAt)
		if err == sql.ErrNoRows {
			http.Error(w, "invite not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if usedAt.Valid && usedAt.String != "" {
			http.Error(w, "invite already used", http.StatusGone)
			return
		}
		expiry, err := time.Parse(time.RFC3339Nano, expiresAt)
		if err != nil || time.Now().UTC().After(expiry) {
			http.Error(w, "invite expired", http.StatusGone)
			return
		}

		var req joinInviteRequest
		json.NewDecoder(r.Body).Decode(&req) // best-effort; empty name falls back below
		caregiverName := req.CaregiverName
		if caregiverName == "" {
			caregiverName = "Caregiver"
		}

		caregiverID := newID()
		now := nowISO()
		if _, err := db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES (?, ?, ?, 'Partner', ?)`,
			caregiverID, familyID, caregiverName, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := db.Exec(`UPDATE invites SET used_at = ? WHERE token = ?`, now, token); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		sessToken, err := createSession(db, caregiverID, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		setSessionCookie(w, sessToken)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(joinInviteResponse{FamilyID: familyID, CaregiverID: caregiverID})
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && go test ./... -v`
Expected: all tests PASS.

- [ ] **Step 5: Wire the routes into router.go**

Modify `server/router.go` to the following full content:
```go
package main

import (
	"database/sql"
	"net/http"
)

func newRouter(db *sql.DB, hub *Hub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/family", handleCreateFamily(db))
	mux.HandleFunc("/api/events", requireAuth(db, handleEvents(hub)))
	mux.HandleFunc("POST /api/invites", requireAuth(db, handleCreateInvite(db)))
	mux.HandleFunc("POST /api/join/{token}", handleJoinInvite(db))
	mux.Handle("/", http.FileServer(http.Dir(".")))
	return mux
}
```

- [ ] **Step 6: Manually verify the full invite-to-join round trip**

Run:
```bash
cd /workspace/huckleberry-clone/server
DB_PATH=/tmp/hearth-manual-test2.db PORT=8445 go run . &
sleep 1
COOKIE_JAR=/tmp/hearth-cookies.txt
curl -sk -c $COOKIE_JAR -X POST http://localhost:8445/api/family \
  -d '{"babyName":"Mira","caregiverName":"Maya"}'
echo
INVITE=$(curl -sk -b $COOKIE_JAR -X POST http://localhost:8445/api/invites | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
echo "invite token: $INVITE"
curl -sk -X POST http://localhost:8445/api/join/$INVITE -d '{"caregiverName":"Dad"}'
echo
kill %1
```
Expected: the first call returns `{"familyId":"...","babyId":"...","caregiverId":"..."}`, the invite call returns `{"token":"..."}`, and the join call returns `{"familyId":"...","caregiverId":"..."}` with the *same* `familyId` as the first call.

- [ ] **Step 7: Commit**

```bash
cd /workspace/huckleberry-clone
git add server/invites.go server/invites_test.go server/router.go
git commit -m "Add invite-link create and join endpoints"
```

---

## Task 6: Log entry sync endpoints (upsert + soft-delete)

Uses `PUT /api/entries/{id}` as an **idempotent upsert** (not separate POST-create/PATCH-update) — deliberately, because the client's offline outbox (Task 10) may retry the same write more than once if a response is lost; upsert-by-id makes retries safe with no special-casing.

**Files:**
- Modify: `server/testutil_test.go` (add a `withSession` helper)
- Create: `server/entries.go`
- Test: `server/entries_test.go`
- Modify: `server/router.go`

**Interfaces:**
- Consumes: `sessionFrom`, `ctxSessionKey`, `SessionInfo` (Task 3), `Hub.Broadcast` (Task 4), `newID`, `nowISO` (Task 2).
- Produces: `func handleUpsertEntry(db *sql.DB, hub *Hub) http.HandlerFunc`, `func handleDeleteEntry(db *sql.DB, hub *Hub) http.HandlerFunc`, `func withSession(r *http.Request, s SessionInfo) *http.Request` — Task 7 (growth) follows the identical pattern, and `withSession` is reused by every later handler test.

- [ ] **Step 1: Add the withSession test helper**

Modify `server/testutil_test.go` to the following full content:
```go
package main

import (
	"context"
	"database/sql"
	"net/http"
	"testing"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := openDB(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("openDB: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func withSession(r *http.Request, s SessionInfo) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), ctxSessionKey, s))
}
```

- [ ] **Step 2: Write the failing entries tests**

Create `server/entries_test.go`:
```go
package main

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleUpsertEntryCreates(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	hub := newHub()

	req := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	req.SetPathValue("id", "e1")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleUpsertEntry(db, hub)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var typ string
	if err := db.QueryRow(`SELECT type FROM log_entries WHERE id = 'e1'`).Scan(&typ); err != nil {
		t.Fatal(err)
	}
	if typ != "sleep" {
		t.Errorf("type = %q, want sleep", typ)
	}
}

func TestHandleUpsertEntryUpdatesExisting(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	hub := newHub()

	req1 := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	req1.SetPathValue("id", "e1")
	req1 = withSession(req1, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub)(httptest.NewRecorder(), req1)

	req2 := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"type":"sleep","start":"2026-06-23T10:00:00Z","end":"2026-06-23T11:00:00Z"}`))
	req2.SetPathValue("id", "e1")
	req2 = withSession(req2, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub)(httptest.NewRecorder(), req2)

	var payload string
	db.QueryRow(`SELECT payload_json FROM log_entries WHERE id = 'e1'`).Scan(&payload)
	if !strings.Contains(payload, "11:00:00") {
		t.Errorf("payload_json = %q, expected it to contain the updated end time", payload)
	}
	var count int
	db.QueryRow(`SELECT count(*) FROM log_entries WHERE id = 'e1'`).Scan(&count)
	if count != 1 {
		t.Fatalf("expected exactly 1 row for id e1, got %d", count)
	}
}

func TestHandleUpsertEntryIgnoresCrossFamilyCollision(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famA', ?), ('famB', ?)`, nowISO(), nowISO())
	hub := newHub()

	reqA := httptest.NewRequest("PUT", "/api/entries/shared", bytes.NewBufferString(`{"type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	reqA.SetPathValue("id", "shared")
	reqA = withSession(reqA, SessionInfo{CaregiverID: "cgA", FamilyID: "famA"})
	handleUpsertEntry(db, hub)(httptest.NewRecorder(), reqA)

	reqB := httptest.NewRequest("PUT", "/api/entries/shared", bytes.NewBufferString(`{"type":"feed","start":"2026-06-23T12:00:00Z"}`))
	reqB.SetPathValue("id", "shared")
	reqB = withSession(reqB, SessionInfo{CaregiverID: "cgB", FamilyID: "famB"})
	handleUpsertEntry(db, hub)(httptest.NewRecorder(), reqB)

	var familyID string
	db.QueryRow(`SELECT family_id FROM log_entries WHERE id = 'shared'`).Scan(&familyID)
	if familyID != "famA" {
		t.Errorf("family_id = %q, want famA (famB's write must be ignored, not overwrite famA's row)", familyID)
	}
}

func TestHandleUpsertEntryRejectsMissingType(t *testing.T) {
	db := newTestDB(t)
	hub := newHub()
	req := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"start":"2026-06-23T10:00:00Z"}`))
	req.SetPathValue("id", "e1")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleUpsertEntry(db, hub)(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestHandleDeleteEntrySoftDeletes(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	hub := newHub()
	now := nowISO()
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('e1', 'fam1', 'sleep', ?, '{}', 'cg1', ?)`, now, now)

	req := httptest.NewRequest("DELETE", "/api/entries/e1", nil)
	req.SetPathValue("id", "e1")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleDeleteEntry(db, hub)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var deletedAt sql.NullString
	db.QueryRow(`SELECT deleted_at FROM log_entries WHERE id = 'e1'`).Scan(&deletedAt)
	if !deletedAt.Valid || deletedAt.String == "" {
		t.Error("expected deleted_at to be set")
	}
}

func TestHandleDeleteEntryNotFound(t *testing.T) {
	db := newTestDB(t)
	hub := newHub()
	req := httptest.NewRequest("DELETE", "/api/entries/nope", nil)
	req.SetPathValue("id", "nope")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleDeleteEntry(db, hub)(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && go test ./... -run "TestHandleUpsertEntry|TestHandleDeleteEntry" -v`
Expected: FAIL — `undefined: handleUpsertEntry` (compile error, `entries.go` doesn't exist yet).

- [ ] **Step 4: Implement entries.go**

Create `server/entries.go`:
```go
package main

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
)

func handleUpsertEntry(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		id := r.PathValue("id")
		if id == "" {
			http.Error(w, "id is required", http.StatusBadRequest)
			return
		}
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		var meta struct {
			Type  string `json:"type"`
			Start string `json:"start"`
		}
		if err := json.Unmarshal(bodyBytes, &meta); err != nil || meta.Type == "" || meta.Start == "" {
			http.Error(w, "type and start are required", http.StatusBadRequest)
			return
		}
		now := nowISO()
		_, err = db.Exec(`
			INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				type = excluded.type, start = excluded.start, payload_json = excluded.payload_json,
				updated_at = excluded.updated_at, deleted_at = NULL
			WHERE log_entries.family_id = excluded.family_id`,
			id, session.FamilyID, meta.Type, meta.Start, string(bodyBytes), session.CaregiverID, now)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		hub.Broadcast(session.FamilyID)
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDeleteEntry(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		id := r.PathValue("id")
		now := nowISO()
		res, err := db.Exec(`UPDATE log_entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND family_id = ?`,
			now, now, id, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		hub.Broadcast(session.FamilyID)
		w.WriteHeader(http.StatusNoContent)
	}
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && go test ./... -v`
Expected: all tests PASS.

- [ ] **Step 6: Wire the routes into router.go**

Modify `server/router.go` to the following full content:
```go
package main

import (
	"database/sql"
	"net/http"
)

func newRouter(db *sql.DB, hub *Hub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/family", handleCreateFamily(db))
	mux.HandleFunc("/api/events", requireAuth(db, handleEvents(hub)))
	mux.HandleFunc("POST /api/invites", requireAuth(db, handleCreateInvite(db)))
	mux.HandleFunc("POST /api/join/{token}", handleJoinInvite(db))
	mux.HandleFunc("PUT /api/entries/{id}", requireAuth(db, handleUpsertEntry(db, hub)))
	mux.HandleFunc("DELETE /api/entries/{id}", requireAuth(db, handleDeleteEntry(db, hub)))
	mux.Handle("/", http.FileServer(http.Dir(".")))
	return mux
}
```

- [ ] **Step 7: Commit**

```bash
cd /workspace/huckleberry-clone
git add server/testutil_test.go server/entries.go server/entries_test.go server/router.go
git commit -m "Add log entry sync endpoints"
```

---

## Task 7: Growth entry sync endpoints

Same upsert/soft-delete shape as Task 6, for the separate `growth_entries` table.

**Files:**
- Create: `server/growth.go`
- Test: `server/growth_test.go`
- Modify: `server/router.go`

**Interfaces:**
- Consumes: `withSession`, `sessionFrom`, `Hub.Broadcast`, `nowISO` (earlier tasks).
- Produces: `func handleUpsertGrowth(db *sql.DB, hub *Hub) http.HandlerFunc`, `func handleDeleteGrowth(db *sql.DB, hub *Hub) http.HandlerFunc`.

- [ ] **Step 1: Write the failing growth tests**

Create `server/growth_test.go`:
```go
package main

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleUpsertGrowthCreates(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	hub := newHub()

	req := httptest.NewRequest("PUT", "/api/growth/g1", bytes.NewBufferString(`{"date":"2026-06-20","weightKg":7.3,"heightCm":67}`))
	req.SetPathValue("id", "g1")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleUpsertGrowth(db, hub)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var weight float64
	if err := db.QueryRow(`SELECT weight_kg FROM growth_entries WHERE id = 'g1'`).Scan(&weight); err != nil {
		t.Fatal(err)
	}
	if weight != 7.3 {
		t.Errorf("weight_kg = %v, want 7.3", weight)
	}
}

func TestHandleUpsertGrowthRejectsMissingDate(t *testing.T) {
	db := newTestDB(t)
	hub := newHub()
	req := httptest.NewRequest("PUT", "/api/growth/g1", bytes.NewBufferString(`{"weightKg":7.3}`))
	req.SetPathValue("id", "g1")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleUpsertGrowth(db, hub)(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestHandleDeleteGrowthSoftDeletes(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	hub := newHub()
	now := nowISO()
	db.Exec(`INSERT INTO growth_entries (id, family_id, date, weight_kg, updated_at) VALUES ('g1', 'fam1', '2026-06-20', 7.3, ?)`, now)

	req := httptest.NewRequest("DELETE", "/api/growth/g1", nil)
	req.SetPathValue("id", "g1")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleDeleteGrowth(db, hub)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var deletedAt sql.NullString
	db.QueryRow(`SELECT deleted_at FROM growth_entries WHERE id = 'g1'`).Scan(&deletedAt)
	if !deletedAt.Valid || deletedAt.String == "" {
		t.Error("expected deleted_at to be set")
	}
}

func TestHandleDeleteGrowthNotFound(t *testing.T) {
	db := newTestDB(t)
	hub := newHub()
	req := httptest.NewRequest("DELETE", "/api/growth/nope", nil)
	req.SetPathValue("id", "nope")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleDeleteGrowth(db, hub)(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && go test ./... -run "TestHandleUpsertGrowth|TestHandleDeleteGrowth" -v`
Expected: FAIL — `undefined: handleUpsertGrowth` (compile error, `growth.go` doesn't exist yet).

- [ ] **Step 3: Implement growth.go**

Create `server/growth.go`:
```go
package main

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
)

func handleUpsertGrowth(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		id := r.PathValue("id")
		if id == "" {
			http.Error(w, "id is required", http.StatusBadRequest)
			return
		}
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		var meta struct {
			Date     string   `json:"date"`
			WeightKg *float64 `json:"weightKg"`
			HeightCm *float64 `json:"heightCm"`
			HeadCm   *float64 `json:"headCm"`
			Note     string   `json:"note"`
		}
		if err := json.Unmarshal(bodyBytes, &meta); err != nil || meta.Date == "" {
			http.Error(w, "date is required", http.StatusBadRequest)
			return
		}
		now := nowISO()
		_, err = db.Exec(`
			INSERT INTO growth_entries (id, family_id, date, weight_kg, height_cm, head_cm, note, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				date = excluded.date, weight_kg = excluded.weight_kg, height_cm = excluded.height_cm,
				head_cm = excluded.head_cm, note = excluded.note, updated_at = excluded.updated_at, deleted_at = NULL
			WHERE growth_entries.family_id = excluded.family_id`,
			id, session.FamilyID, meta.Date, meta.WeightKg, meta.HeightCm, meta.HeadCm, meta.Note, now)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		hub.Broadcast(session.FamilyID)
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDeleteGrowth(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		id := r.PathValue("id")
		now := nowISO()
		res, err := db.Exec(`UPDATE growth_entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND family_id = ?`,
			now, now, id, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		hub.Broadcast(session.FamilyID)
		w.WriteHeader(http.StatusNoContent)
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && go test ./... -v`
Expected: all tests PASS.

- [ ] **Step 5: Wire the routes into router.go**

Modify `server/router.go` to the following full content:
```go
package main

import (
	"database/sql"
	"net/http"
)

func newRouter(db *sql.DB, hub *Hub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/family", handleCreateFamily(db))
	mux.HandleFunc("/api/events", requireAuth(db, handleEvents(hub)))
	mux.HandleFunc("POST /api/invites", requireAuth(db, handleCreateInvite(db)))
	mux.HandleFunc("POST /api/join/{token}", handleJoinInvite(db))
	mux.HandleFunc("PUT /api/entries/{id}", requireAuth(db, handleUpsertEntry(db, hub)))
	mux.HandleFunc("DELETE /api/entries/{id}", requireAuth(db, handleDeleteEntry(db, hub)))
	mux.HandleFunc("PUT /api/growth/{id}", requireAuth(db, handleUpsertGrowth(db, hub)))
	mux.HandleFunc("DELETE /api/growth/{id}", requireAuth(db, handleDeleteGrowth(db, hub)))
	mux.Handle("/", http.FileServer(http.Dir(".")))
	return mux
}
```

- [ ] **Step 6: Commit**

```bash
cd /workspace/huckleberry-clone
git add server/growth.go server/growth_test.go server/router.go
git commit -m "Add growth entry sync endpoints"
```

---

## Task 8: Baby + settings PATCH (shared singletons, last-write-wins)

Per ADR 0001 §5: the baby profile and settings are shared singleton resources — the client always sends the complete object, and the server always accepts the incoming write and stamps `updated_at` (last-write-wins). No merge logic needed here.

**Files:**
- Modify: `server/family.go` (add the two new handlers)
- Create: `server/settings_test.go`
- Modify: `server/router.go`

**Interfaces:**
- Consumes: `sessionFrom`, `Hub.Broadcast`, `nowISO` (earlier tasks).
- Produces: `func handlePatchBaby(db *sql.DB, hub *Hub) http.HandlerFunc`, `func handlePatchSettings(db *sql.DB, hub *Hub) http.HandlerFunc`.

- [ ] **Step 1: Write the failing tests**

Create `server/settings_test.go`:
```go
package main

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
)

func seedFamilyAndBaby(t *testing.T, db *sql.DB, familyID string) {
	t.Helper()
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES (?, ?)`, familyID, now)
	db.Exec(`INSERT INTO babies (id, family_id, name, updated_at) VALUES (?, ?, 'Mira', ?)`, newID(), familyID, now)
	db.Exec(`INSERT INTO settings (family_id, units_json, reminders_json, cards_json, updated_at) VALUES (?, '{}', '{}', '{}', ?)`, familyID, now)
}

func TestHandlePatchBabyUpdatesFields(t *testing.T) {
	db := newTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()

	req := httptest.NewRequest("PATCH", "/api/baby", bytes.NewBufferString(`{"name":"Olive","birthdate":"2026-01-15","theme":"boy","photo":""}`))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handlePatchBaby(db, hub)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var name, theme string
	db.QueryRow(`SELECT name, theme FROM babies WHERE family_id = 'fam1'`).Scan(&name, &theme)
	if name != "Olive" || theme != "boy" {
		t.Errorf("name=%q theme=%q, want Olive/boy", name, theme)
	}
}

func TestHandlePatchBabyNotFoundForUnknownFamily(t *testing.T) {
	db := newTestDB(t)
	hub := newHub()
	req := httptest.NewRequest("PATCH", "/api/baby", bytes.NewBufferString(`{"name":"Olive"}`))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "no-such-family"})
	rec := httptest.NewRecorder()

	handlePatchBaby(db, hub)(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestHandlePatchSettingsUpdatesFields(t *testing.T) {
	db := newTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()

	body := `{"bottleIntervalH":4,"meds":[{"id":"m1","name":"Vitamin D"}],"units":{"volume":"oz"},"reminders":{"naps":true},"cards":{"bottle":true}}`
	req := httptest.NewRequest("PATCH", "/api/settings", bytes.NewBufferString(body))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handlePatchSettings(db, hub)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var interval float64
	var unitsJSON string
	db.QueryRow(`SELECT bottle_interval_h, units_json FROM settings WHERE family_id = 'fam1'`).Scan(&interval, &unitsJSON)
	if interval != 4 {
		t.Errorf("bottle_interval_h = %v, want 4", interval)
	}
	if unitsJSON != `{"volume":"oz"}` {
		t.Errorf("units_json = %q, want {\"volume\":\"oz\"}", unitsJSON)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && go test ./... -run "TestHandlePatchBaby|TestHandlePatchSettings" -v`
Expected: FAIL — `undefined: handlePatchBaby` (compile error).

- [ ] **Step 3: Add the handlers to family.go**

Modify `server/family.go` to the following full content:
```go
package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type createFamilyRequest struct {
	BabyName      string `json:"babyName"`
	Birthdate     string `json:"birthdate"`
	Theme         string `json:"theme"`
	CaregiverName string `json:"caregiverName"`
}

type createFamilyResponse struct {
	FamilyID    string `json:"familyId"`
	BabyID      string `json:"babyId"`
	CaregiverID string `json:"caregiverId"`
}

func handleCreateFamily(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req createFamilyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if req.BabyName == "" {
			http.Error(w, "babyName is required", http.StatusBadRequest)
			return
		}
		theme := req.Theme
		if theme == "" {
			theme = "girl"
		}
		caregiverName := req.CaregiverName
		if caregiverName == "" {
			caregiverName = "Parent"
		}

		familyID, babyID, caregiverID := newID(), newID(), newID()
		now := nowISO()

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		if _, err := tx.Exec(`INSERT INTO families (id, created_at) VALUES (?, ?)`, familyID, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`INSERT INTO babies (id, family_id, name, birthdate, theme, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			babyID, familyID, req.BabyName, req.Birthdate, theme, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES (?, ?, ?, 'Parent', ?)`,
			caregiverID, familyID, caregiverName, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defaultUnits := `{"volume":"ml","temp":"C","weight":"kg","length":"cm"}`
		defaultReminders := `{"naps":true,"bottle":true,"meds":true,"quietStart":"20:00","quietEnd":"07:00"}`
		defaultCards := `{"sweetspot":true,"bottle":true,"medicine":true}`
		if _, err := tx.Exec(`INSERT INTO settings (family_id, units_json, reminders_json, cards_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
			familyID, defaultUnits, defaultReminders, defaultCards, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		token, err := createSession(db, caregiverID, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		setSessionCookie(w, token)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(createFamilyResponse{FamilyID: familyID, BabyID: babyID, CaregiverID: caregiverID})
	}
}

type patchBabyRequest struct {
	Name      string `json:"name"`
	Birthdate string `json:"birthdate"`
	Theme     string `json:"theme"`
	Photo     string `json:"photo"`
}

func handlePatchBaby(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		var req patchBabyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		now := nowISO()
		res, err := db.Exec(`UPDATE babies SET name = ?, birthdate = ?, theme = ?, photo = ?, updated_at = ? WHERE family_id = ?`,
			req.Name, req.Birthdate, req.Theme, req.Photo, now, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "baby not found", http.StatusNotFound)
			return
		}
		hub.Broadcast(session.FamilyID)
		w.WriteHeader(http.StatusNoContent)
	}
}

type patchSettingsRequest struct {
	BottleIntervalH float64         `json:"bottleIntervalH"`
	Meds            json.RawMessage `json:"meds"`
	Units           json.RawMessage `json:"units"`
	Reminders       json.RawMessage `json:"reminders"`
	Cards           json.RawMessage `json:"cards"`
}

func rawOrNull(r json.RawMessage) string {
	if len(r) == 0 {
		return "null"
	}
	return string(r)
}

func handlePatchSettings(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		var req patchSettingsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		now := nowISO()
		res, err := db.Exec(`UPDATE settings SET bottle_interval_h = ?, meds_json = ?, units_json = ?, reminders_json = ?, cards_json = ?, updated_at = ? WHERE family_id = ?`,
			req.BottleIntervalH, rawOrNull(req.Meds), rawOrNull(req.Units), rawOrNull(req.Reminders), rawOrNull(req.Cards), now, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "settings not found", http.StatusNotFound)
			return
		}
		hub.Broadcast(session.FamilyID)
		w.WriteHeader(http.StatusNoContent)
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && go test ./... -v`
Expected: all tests PASS.

- [ ] **Step 5: Wire the routes into router.go**

Modify `server/router.go` to the following full content:
```go
package main

import (
	"database/sql"
	"net/http"
)

func newRouter(db *sql.DB, hub *Hub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/family", handleCreateFamily(db))
	mux.HandleFunc("/api/events", requireAuth(db, handleEvents(hub)))
	mux.HandleFunc("POST /api/invites", requireAuth(db, handleCreateInvite(db)))
	mux.HandleFunc("POST /api/join/{token}", handleJoinInvite(db))
	mux.HandleFunc("PUT /api/entries/{id}", requireAuth(db, handleUpsertEntry(db, hub)))
	mux.HandleFunc("DELETE /api/entries/{id}", requireAuth(db, handleDeleteEntry(db, hub)))
	mux.HandleFunc("PUT /api/growth/{id}", requireAuth(db, handleUpsertGrowth(db, hub)))
	mux.HandleFunc("DELETE /api/growth/{id}", requireAuth(db, handleDeleteGrowth(db, hub)))
	mux.HandleFunc("PATCH /api/baby", requireAuth(db, handlePatchBaby(db, hub)))
	mux.HandleFunc("PATCH /api/settings", requireAuth(db, handlePatchSettings(db, hub)))
	mux.Handle("/", http.FileServer(http.Dir(".")))
	return mux
}
```

- [ ] **Step 6: Commit**

```bash
cd /workspace/huckleberry-clone
git add server/family.go server/settings_test.go server/router.go
git commit -m "Add baby and settings PATCH endpoints"
```

---

## Task 9: Sync pull endpoint (GET /api/sync)

Ties together every table written by Tasks 6-8 into the one read the client polls. Pure read — no broadcast.

**Files:**
- Create: `server/sync.go`
- Test: `server/sync_test.go`
- Modify: `server/router.go`

**Interfaces:**
- Consumes: `sessionFrom`, `nowISO` (earlier tasks); reads the tables Tasks 6-8 write.
- Produces: `func handleSync(db *sql.DB) http.HandlerFunc`, `type syncResponse struct{...}` — Task 11 (client sync engine) consumes this exact JSON shape: `{serverTime, baby, settings, entries: [...], growth: [...]}`, where each entry/growth element is either the full object or a `{id, deletedAt}` tombstone.

- [ ] **Step 1: Write the failing sync tests**

Create `server/sync_test.go`:
```go
package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestHandleSyncReturnsEntriesChangedSinceTimestamp(t *testing.T) {
	db := newTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()

	reqUp := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"id":"e1","type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	reqUp.SetPathValue("id", "e1")
	reqUp = withSession(reqUp, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub)(httptest.NewRecorder(), reqUp)

	req := httptest.NewRequest("GET", "/api/sync?since=2020-01-01T00:00:00Z", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleSync(db)(rec, req)

	var resp syncResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v, body=%s", err, rec.Body.String())
	}
	if len(resp.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d: %s", len(resp.Entries), rec.Body.String())
	}
}

func TestHandleSyncOmitsEntriesOlderThanSince(t *testing.T) {
	db := newTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()
	reqUp := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"id":"e1","type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	reqUp.SetPathValue("id", "e1")
	reqUp = withSession(reqUp, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub)(httptest.NewRecorder(), reqUp)

	req := httptest.NewRequest("GET", "/api/sync?since=2099-01-01T00:00:00Z", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleSync(db)(rec, req)

	var resp syncResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Entries) != 0 {
		t.Fatalf("expected 0 entries, got %d", len(resp.Entries))
	}
}

func TestHandleSyncIncludesDeletedAsTombstone(t *testing.T) {
	db := newTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()
	reqUp := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"id":"e1","type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	reqUp.SetPathValue("id", "e1")
	reqUp = withSession(reqUp, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub)(httptest.NewRecorder(), reqUp)

	reqDel := httptest.NewRequest("DELETE", "/api/entries/e1", nil)
	reqDel.SetPathValue("id", "e1")
	reqDel = withSession(reqDel, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleDeleteEntry(db, hub)(httptest.NewRecorder(), reqDel)

	req := httptest.NewRequest("GET", "/api/sync?since=2020-01-01T00:00:00Z", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleSync(db)(rec, req)

	var resp syncResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Entries) != 1 {
		t.Fatalf("expected 1 (tombstoned) entry, got %d", len(resp.Entries))
	}
	var tomb struct {
		ID        string `json:"id"`
		DeletedAt string `json:"deletedAt"`
	}
	json.Unmarshal(resp.Entries[0], &tomb)
	if tomb.ID != "e1" || tomb.DeletedAt == "" {
		t.Errorf("expected tombstone with id=e1 and non-empty deletedAt, got %+v", tomb)
	}
}

func TestHandleSyncIncludesBabyWhenChanged(t *testing.T) {
	db := newTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()
	reqPatch := httptest.NewRequest("PATCH", "/api/baby", bytes.NewBufferString(`{"name":"Olive","theme":"boy"}`))
	reqPatch = withSession(reqPatch, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handlePatchBaby(db, hub)(httptest.NewRecorder(), reqPatch)

	req := httptest.NewRequest("GET", "/api/sync?since=2020-01-01T00:00:00Z", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleSync(db)(rec, req)

	var resp syncResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Baby == nil {
		t.Fatal("expected baby to be included")
	}
	var baby struct {
		Name string `json:"name"`
	}
	json.Unmarshal(resp.Baby, &baby)
	if baby.Name != "Olive" {
		t.Errorf("baby.name = %q, want Olive", baby.Name)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && go test ./... -run TestHandleSync -v`
Expected: FAIL — `undefined: handleSync` (compile error, `sync.go` doesn't exist yet).

- [ ] **Step 3: Implement sync.go**

Create `server/sync.go`:
```go
package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type syncResponse struct {
	ServerTime string            `json:"serverTime"`
	Baby       json.RawMessage   `json:"baby,omitempty"`
	Settings   json.RawMessage   `json:"settings,omitempty"`
	Entries    []json.RawMessage `json:"entries"`
	Growth     []json.RawMessage `json:"growth"`
}

func handleSync(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		since := r.URL.Query().Get("since")

		resp := syncResponse{ServerTime: nowISO(), Entries: []json.RawMessage{}, Growth: []json.RawMessage{}}

		var name, birthdate, theme string
		var photo sql.NullString
		var babyUpdatedAt string
		err := db.QueryRow(`SELECT name, birthdate, theme, photo, updated_at FROM babies WHERE family_id = ?`, session.FamilyID).
			Scan(&name, &birthdate, &theme, &photo, &babyUpdatedAt)
		if err == nil && babyUpdatedAt > since {
			b, _ := json.Marshal(map[string]any{"name": name, "birthdate": birthdate, "theme": theme, "photo": photo.String})
			resp.Baby = b
		}

		var bottleIntervalH float64
		var medsJSON, unitsJSON, remindersJSON, cardsJSON, settingsUpdatedAt string
		err = db.QueryRow(`SELECT bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at FROM settings WHERE family_id = ?`, session.FamilyID).
			Scan(&bottleIntervalH, &medsJSON, &unitsJSON, &remindersJSON, &cardsJSON, &settingsUpdatedAt)
		if err == nil && settingsUpdatedAt > since {
			s, _ := json.Marshal(map[string]any{
				"bottleIntervalH": bottleIntervalH,
				"meds":            json.RawMessage(medsJSON),
				"units":           json.RawMessage(unitsJSON),
				"reminders":       json.RawMessage(remindersJSON),
				"cards":           json.RawMessage(cardsJSON),
			})
			resp.Settings = s
		}

		rows, err := db.Query(`SELECT payload_json, deleted_at FROM log_entries WHERE family_id = ? AND updated_at > ?`, session.FamilyID, since)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var payload string
				var deletedAt sql.NullString
				if err := rows.Scan(&payload, &deletedAt); err != nil {
					continue
				}
				resp.Entries = append(resp.Entries, tombstoneOrPayload(payload, deletedAt))
			}
		}

		grows, err := db.Query(`SELECT id, date, weight_kg, height_cm, head_cm, note, deleted_at FROM growth_entries WHERE family_id = ? AND updated_at > ?`, session.FamilyID, since)
		if err == nil {
			defer grows.Close()
			for grows.Next() {
				var id, date string
				var weightKg, heightCm, headCm sql.NullFloat64
				var note, deletedAt sql.NullString
				if err := grows.Scan(&id, &date, &weightKg, &heightCm, &headCm, &note, &deletedAt); err != nil {
					continue
				}
				if deletedAt.Valid && deletedAt.String != "" {
					b, _ := json.Marshal(map[string]any{"id": id, "deletedAt": deletedAt.String})
					resp.Growth = append(resp.Growth, b)
					continue
				}
				b, _ := json.Marshal(map[string]any{
					"id": id, "date": date,
					"weightKg": nullFloatOrNil(weightKg), "heightCm": nullFloatOrNil(heightCm), "headCm": nullFloatOrNil(headCm),
					"note": note.String,
				})
				resp.Growth = append(resp.Growth, b)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

func tombstoneOrPayload(payload string, deletedAt sql.NullString) json.RawMessage {
	if deletedAt.Valid && deletedAt.String != "" {
		var withID struct {
			ID string `json:"id"`
		}
		json.Unmarshal([]byte(payload), &withID)
		b, _ := json.Marshal(map[string]string{"id": withID.ID, "deletedAt": deletedAt.String})
		return b
	}
	return json.RawMessage(payload)
}

func nullFloatOrNil(f sql.NullFloat64) any {
	if !f.Valid {
		return nil
	}
	return f.Float64
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && go test ./... -v`
Expected: all tests PASS.

- [ ] **Step 5: Wire the route into router.go**

Modify `server/router.go` to the following full content:
```go
package main

import (
	"database/sql"
	"net/http"
)

func newRouter(db *sql.DB, hub *Hub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/family", handleCreateFamily(db))
	mux.HandleFunc("/api/events", requireAuth(db, handleEvents(hub)))
	mux.HandleFunc("GET /api/sync", requireAuth(db, handleSync(db)))
	mux.HandleFunc("POST /api/invites", requireAuth(db, handleCreateInvite(db)))
	mux.HandleFunc("POST /api/join/{token}", handleJoinInvite(db))
	mux.HandleFunc("PUT /api/entries/{id}", requireAuth(db, handleUpsertEntry(db, hub)))
	mux.HandleFunc("DELETE /api/entries/{id}", requireAuth(db, handleDeleteEntry(db, hub)))
	mux.HandleFunc("PUT /api/growth/{id}", requireAuth(db, handleUpsertGrowth(db, hub)))
	mux.HandleFunc("DELETE /api/growth/{id}", requireAuth(db, handleDeleteGrowth(db, hub)))
	mux.HandleFunc("PATCH /api/baby", requireAuth(db, handlePatchBaby(db, hub)))
	mux.HandleFunc("PATCH /api/settings", requireAuth(db, handlePatchSettings(db, hub)))
	mux.Handle("/", http.FileServer(http.Dir(".")))
	return mux
}
```

This completes the server's API surface. The remaining tasks are client-side.

- [ ] **Step 6: Commit**

```bash
cd /workspace/huckleberry-clone
git add server/sync.go server/sync_test.go server/router.go
git commit -m "Add sync pull endpoint"
```

---

## Task 10: Client outbox + sync engine (pure logic)

The server API surface is done. This task adds the client-side counterpart: a small module with no DOM dependency, so it's testable with Node's built-in test runner (the project has no test framework today — this introduces the lightest possible one, zero new dependencies).

**Files:**
- Create: `js/sync.js`
- Test: `js/sync.test.js`

**Interfaces:**
- Consumes: nothing from the existing codebase (deliberately dependency-free pure logic).
- Produces: `loadOutbox()`, `saveOutbox(ops)`, `enqueue(op)`, `drainOutbox(fetchImpl)`, `mergeById(localList, incoming)`, `getLastSync()`, `setLastSync(ts)` — Task 11 imports all of these into `store.js`/`app.js`.

- [ ] **Step 1: Write the failing tests**

Create `js/sync.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.store = {}; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  setItem(k, v) { this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
}
globalThis.localStorage = new MemoryStorage();

const { loadOutbox, saveOutbox, enqueue, mergeById, drainOutbox, getLastSync, setLastSync } = await import('./sync.js');

test('enqueue appends an op and loadOutbox reads it back', () => {
  saveOutbox([]);
  enqueue({ url: '/api/entries/e1', method: 'PUT', body: { id: 'e1' } });
  const ops = loadOutbox();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].url, '/api/entries/e1');
});

test('loadOutbox returns an empty array when nothing is stored', () => {
  localStorage.removeItem('hearth.outbox.v1');
  assert.deepEqual(loadOutbox(), []);
});

test('mergeById applies an upsert', () => {
  const result = mergeById([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }]);
  assert.deepEqual(result, [{ id: 'a', v: 2 }]);
});

test('mergeById applies a tombstone delete', () => {
  const result = mergeById([{ id: 'a', v: 1 }, { id: 'b', v: 1 }], [{ id: 'a', deletedAt: '2026-01-01' }]);
  assert.deepEqual(result, [{ id: 'b', v: 1 }]);
});

test('mergeById adds a brand-new row not previously known locally', () => {
  const result = mergeById([{ id: 'a', v: 1 }], [{ id: 'b', v: 1 }]);
  assert.deepEqual(result.map((r) => r.id).sort(), ['a', 'b']);
});

test('drainOutbox stops and keeps the queue on network failure', async () => {
  saveOutbox([{ url: '/api/entries/x', method: 'PUT', body: { id: 'x' } }]);
  const fakeFetch = async () => { throw new Error('offline'); };
  const ok = await drainOutbox(fakeFetch);
  assert.equal(ok, false);
  assert.equal(loadOutbox().length, 1);
});

test('drainOutbox empties the queue on success, in order', async () => {
  saveOutbox([
    { url: '/api/entries/x', method: 'PUT', body: { id: 'x' } },
    { url: '/api/entries/y', method: 'PUT', body: { id: 'y' } },
  ]);
  const calledUrls = [];
  const fakeFetch = async (url) => { calledUrls.push(url); return { ok: true, status: 204 }; };
  const ok = await drainOutbox(fakeFetch);
  assert.equal(ok, true);
  assert.equal(loadOutbox().length, 0);
  assert.deepEqual(calledUrls, ['/api/entries/x', '/api/entries/y']);
});

test('drainOutbox stops at the first failure and leaves remaining ops queued', async () => {
  saveOutbox([
    { url: '/api/entries/x', method: 'PUT', body: { id: 'x' } },
    { url: '/api/entries/y', method: 'PUT', body: { id: 'y' } },
  ]);
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    if (calls === 1) return { ok: true, status: 204 };
    throw new Error('offline mid-drain');
  };
  const ok = await drainOutbox(fakeFetch);
  assert.equal(ok, false);
  assert.equal(loadOutbox().length, 1);
  assert.equal(loadOutbox()[0].url, '/api/entries/y');
});

test('getLastSync defaults to empty string, setLastSync round-trips', () => {
  localStorage.removeItem('hearth.lastsync.v1');
  assert.equal(getLastSync(), '');
  setLastSync('2026-06-23T00:00:00Z');
  assert.equal(getLastSync(), '2026-06-23T00:00:00Z');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test js/sync.test.js`
Expected: FAIL — the dynamic `import('./sync.js')` rejects because `js/sync.js` doesn't exist yet.

- [ ] **Step 3: Implement sync.js**

Create `js/sync.js`:
```js
// sync.js — offline outbox queue + server sync merge logic (no DOM dependency, unit-testable).
const OUTBOX_KEY = 'hearth.outbox.v1';
const LAST_SYNC_KEY = 'hearth.lastsync.v1';

export function loadOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch (e) { return []; }
}
export function saveOutbox(ops) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops));
}
export function enqueue(op) {
  const ops = loadOutbox();
  ops.push(op);
  saveOutbox(ops);
}

export function getLastSync() { return localStorage.getItem(LAST_SYNC_KEY) || ''; }
export function setLastSync(ts) { localStorage.setItem(LAST_SYNC_KEY, ts); }

// Drains the outbox to the server in order, stopping at the first failure so
// nothing is lost or reordered. Safe to call repeatedly (e.g. on a timer) —
// it's a no-op once the queue is empty.
export async function drainOutbox(fetchImpl) {
  let ops = loadOutbox();
  while (ops.length) {
    const op = ops[0];
    try {
      const res = await fetchImpl(op.url, {
        method: op.method,
        headers: { 'Content-Type': 'application/json' },
        body: op.body ? JSON.stringify(op.body) : undefined,
        credentials: 'include'
      });
      if (!res.ok) throw new Error('sync request failed: ' + res.status);
    } catch (e) {
      return false; // leave remaining ops queued; caller retries later
    }
    ops = ops.slice(1);
    saveOutbox(ops);
  }
  return true;
}

// Merges a list of changed/tombstoned rows from the server into a local
// array, keyed by id. A row with `deletedAt` removes its local counterpart;
// any other row is an upsert (new or replacing the existing one).
export function mergeById(localList, incoming) {
  const byId = new Map(localList.map((x) => [x.id, x]));
  for (const row of incoming) {
    if (row.deletedAt) byId.delete(row.id);
    else byId.set(row.id, row);
  }
  return [...byId.values()];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test js/sync.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /workspace/huckleberry-clone
git add js/sync.js js/sync.test.js
git commit -m "Add client outbox and sync-merge logic"
```

---

## Task 11: Wire store.js, sheets.js, and app.js to the outbox + sync loop

Every existing local mutator keeps writing to `localStorage` first (unchanged UX) and now also enqueues the matching server write. This task specifies **exact full-function replacements** — locate each function by name in the named file and replace its entire body with the version shown; these files are too large at this point to usefully reprint in full.

**Files:**
- Modify: `js/store.js` (functions: `addEntry`, `removeEntry`, `updateEntry`, `addMeasure`, `removeMeasure`; add: `applySyncResponse`, `enqueueBabySync`, `enqueueSettingsSync`)
- Test: `js/store.test.js`
- Modify: `js/sheets.js` (functions: `saveBottle`, `saveMeds`, `hideCard`, `showCard`)
- Modify: `js/app.js` (functions: `setPath`, `profilePhoto`; add the sync loop near `init()`)

**Interfaces:**
- Consumes: `enqueue`, `mergeById`, `drainOutbox`, `getLastSync`, `setLastSync` (Task 10).
- Produces: `function applySyncResponse(resp)`, `function enqueueBabySync()`, `function enqueueSettingsSync()` exported from `store.js` — Task 12's join/create-family flow calls `applySyncResponse` directly after its first sync.

- [ ] **Step 1: Write the failing store.js sync tests**

Create `js/store.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.store = {}; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  setItem(k, v) { this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
}
globalThis.localStorage = new MemoryStorage();

const { state, addEntry, removeEntry, addMeasure, applySyncResponse } = await import('./store.js');

function outboxOps() {
  return JSON.parse(localStorage.getItem('hearth.outbox.v1') || '[]');
}

test('addEntry enqueues a PUT to /api/entries/:id', () => {
  const before = outboxOps().length;
  const e = addEntry({ type: 'diaper', start: '2026-01-01T00:00:00Z' });
  const ops = outboxOps();
  assert.equal(ops.length, before + 1);
  const last = ops[ops.length - 1];
  assert.equal(last.url, '/api/entries/' + e.id);
  assert.equal(last.method, 'PUT');
  assert.equal(last.body.id, e.id);
});

test('removeEntry enqueues a DELETE to /api/entries/:id', () => {
  const e = addEntry({ type: 'diaper', start: '2026-01-01T00:00:00Z' });
  removeEntry(e.id);
  const last = outboxOps().at(-1);
  assert.equal(last.method, 'DELETE');
  assert.equal(last.url, '/api/entries/' + e.id);
});

test('addMeasure enqueues a PUT to /api/growth/:id', () => {
  const m = addMeasure({ date: '2026-06-20', weightKg: 7.3 });
  const last = outboxOps().at(-1);
  assert.equal(last.method, 'PUT');
  assert.equal(last.url, '/api/growth/' + m.id);
});

test('applySyncResponse merges baby and settings fields', () => {
  applySyncResponse({ baby: { name: 'Olive', theme: 'boy' }, settings: { bottleIntervalH: 4 }, entries: [], growth: [] });
  assert.equal(state().baby.name, 'Olive');
  assert.equal(state().baby.theme, 'boy');
  assert.equal(state().settings.bottleIntervalH, 4);
});

test('applySyncResponse upserts and tombstones log entries by id', () => {
  applySyncResponse({ baby: null, settings: null, entries: [{ id: 'sync-e1', type: 'sleep', start: '2026-01-01T00:00:00Z' }], growth: [] });
  assert.ok(state().log.find((e) => e.id === 'sync-e1'));

  applySyncResponse({ baby: null, settings: null, entries: [{ id: 'sync-e1', deletedAt: '2026-01-02T00:00:00Z' }], growth: [] });
  assert.equal(state().log.find((e) => e.id === 'sync-e1'), undefined);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test js/store.test.js`
Expected: FAIL — `addEntry` exists but doesn't enqueue yet, so the outbox-related assertions fail; `applySyncResponse` is undefined.

- [ ] **Step 3: Modify store.js**

In `js/store.js`, add this import line at the top, alongside the existing (there are no existing imports in `store.js` today — this is its first):
```js
import { enqueue, mergeById } from './sync.js';
```

Replace the body of `addEntry`:
```js
export function addEntry(e) {
  e.id = e.id || uid();
  _state.log.push(e);
  _state.log.sort((a, b) => new Date(b.start) - new Date(a.start));
  save();
  enqueue({ url: '/api/entries/' + e.id, method: 'PUT', body: e });
  return e;
}
```

Replace the body of `removeEntry`:
```js
export function removeEntry(id) {
  _state.log = _state.log.filter((e) => e.id !== id);
  save();
  enqueue({ url: '/api/entries/' + id, method: 'DELETE' });
}
```

Replace the body of `updateEntry`:
```js
export function updateEntry(id, patch) {
  const e = _state.log.find((x) => x.id === id);
  if (e) {
    Object.assign(e, patch);
    _state.log.sort((a, b) => new Date(b.start) - new Date(a.start));
    save();
    enqueue({ url: '/api/entries/' + id, method: 'PUT', body: e });
  }
  return e;
}
```

Replace the body of `addMeasure`:
```js
export function addMeasure(m) {
  m.id = m.id || uid();
  const existing = _state.growth.find((x) => x.id === m.id);
  if (existing) Object.assign(existing, m); else _state.growth.push(m);
  _state.growth.sort((a, b) => new Date(a.date) - new Date(b.date));
  save();
  enqueue({ url: '/api/growth/' + m.id, method: 'PUT', body: m });
  return m;
}
```

Replace the body of `removeMeasure`:
```js
export function removeMeasure(id) {
  _state.growth = _state.growth.filter((m) => m.id !== id);
  save();
  enqueue({ url: '/api/growth/' + id, method: 'DELETE' });
}
```

Add these three new exported functions at the end of `store.js`:
```js
export function applySyncResponse(resp) {
  if (resp.baby) Object.assign(_state.baby, resp.baby);
  if (resp.settings) Object.assign(_state.settings, resp.settings);
  _state.log = mergeById(_state.log, resp.entries || []);
  _state.growth = mergeById(_state.growth, resp.growth || []);
  save();
}

export function enqueueBabySync() {
  enqueue({ url: '/api/baby', method: 'PATCH', body: _state.baby });
}

export function enqueueSettingsSync() {
  const s = _state.settings;
  enqueue({
    url: '/api/settings', method: 'PATCH',
    body: { bottleIntervalH: s.bottleIntervalH, meds: s.meds, units: s.units, reminders: s.reminders, cards: s.cards }
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test js/store.test.js js/sync.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Wire settings-mutating functions in sheets.js**

In `js/sheets.js`, add `enqueueSettingsSync` to the existing `./store.js` import line — it currently reads:
```js
import { state, save, ageLabel, addEntry, removeEntry, updateEntry, addMeasure } from './store.js';
```
change it to:
```js
import { state, save, ageLabel, addEntry, removeEntry, updateEntry, addMeasure, enqueueSettingsSync } from './store.js';
```

Replace the body of `saveBottle`:
```js
export function saveBottle() {
  state().settings.bottleIntervalH = Number($('#c-int').value) || 3;
  save(); enqueueSettingsSync(); sheet.close(); toast('Bottle reminder updated'); router.refresh();
}
```

Replace the body of `saveMeds`:
```js
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
```

Replace the body of `hideCard`:
```js
export function hideCard(card) {
  state().settings.cards[card] = false;
  save(); enqueueSettingsSync(); sheet.close(); toast('Card hidden'); router.refresh();
}
```

Replace the body of `showCard`:
```js
export function showCard(card) { state().settings.cards[card] = true; save(); enqueueSettingsSync(); router.refresh(); }
```

- [ ] **Step 6: Wire setPath and profilePhoto in app.js**

In `js/app.js`, add `enqueueBabySync` and `enqueueSettingsSync` to the existing `./store.js` import line — it currently reads:
```js
import { state, save, reset, addEntry, removeEntry, removeMeasure } from './store.js';
```
change it to:
```js
import { state, save, reset, addEntry, removeEntry, removeMeasure, enqueueBabySync, enqueueSettingsSync, applySyncResponse } from './store.js';
import { drainOutbox, getLastSync, setLastSync } from './sync.js';
```

Replace the body of `setPath`:
```js
function setPath(path, val) {
  const parts = path.split('.'); let o = state();
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = val;
  save();
  if (path.startsWith('baby.')) enqueueBabySync();
  else if (path.startsWith('settings.') && path !== 'settings.darkMode') enqueueSettingsSync();
}
```

In `profilePhoto`, find this line inside the `img.onload` callback:
```js
state().baby.photo = cv.toDataURL('image/jpeg', 0.82); save(); router.refresh();
```
and replace it with:
```js
state().baby.photo = cv.toDataURL('image/jpeg', 0.82); save(); enqueueBabySync(); router.refresh();
```

- [ ] **Step 7: Add the sync loop**

In `js/app.js`, add the following new code directly above the existing `document.addEventListener('DOMContentLoaded', init);` line at the end of the file:
```js
// ---------- server sync loop ----------
async function syncOnce() {
  const drained = await drainOutbox(fetch);
  if (!drained) return;
  try {
    const res = await fetch('/api/sync?since=' + encodeURIComponent(getLastSync()), { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    applySyncResponse(data);
    setLastSync(data.serverTime);
    if (current !== 'home' || $('#view')) router.refresh();
  } catch (e) {
    // offline or server unreachable; the next trigger (timer/online/SSE) retries
  }
}

let eventSource = null;
function connectEvents() {
  if (eventSource || !('EventSource' in window)) return;
  eventSource = new EventSource('/api/events');
  eventSource.onmessage = () => syncOnce();
  eventSource.onerror = () => { eventSource.close(); eventSource = null; setTimeout(connectEvents, 5000); };
}

window.addEventListener('online', syncOnce);
setInterval(syncOnce, 30000);
```

Then find the `else` branch inside `init()`:
```js
  } else {
    router.boot();
    router.go('home');
  }
```
and replace it with:
```js
  } else {
    router.boot();
    router.go('home');
    syncOnce();
    connectEvents();
  }
```

Note: until Task 12 lands, no code path actually sets a session cookie, so `syncOnce()`/`connectEvents()` will just get a 401/connection failure and silently no-op (caught above) — this step only wires the mechanism; it has no visible effect yet.

- [ ] **Step 8: Run the full client test suite to verify nothing broke**

Run: `node --test js/`
Expected: all tests in `js/sync.test.js` and `js/store.test.js` PASS.

- [ ] **Step 9: Commit**

```bash
cd /workspace/huckleberry-clone
git add js/store.js js/store.test.js js/sheets.js js/app.js
git commit -m "Wire local mutators to the outbox and add the sync loop"
```

---

## Task 12: Onboarding creates the family on the server; new join-via-invite-link flow

Two client-side entry points now need to talk to the server: the existing solo onboarding (becomes the family *admin*) and a brand-new join flow (for everyone invited after that). This task is DOM/network integration code, like the existing `onboarding.js` — consistent with the rest of this codebase, it's verified manually (curl + browser), not unit-tested; only the dependency-free logic modules (Tasks 10-11) have automated tests here.

**Known limitation accepted for v1** (note this rather than solve it — flag for a future task): if `POST /api/family` fails during onboarding (e.g. offline at setup time), the app falls back to today's fully local-only behavior with no automatic retry, since `state().setup` is already `true` from the local seed and onboarding won't show again. A "connect to server" affordance in Profile would close this gap — not built here.

**Files:**
- Modify: `js/onboarding.js` (function: `onboardFinish`)
- Create: `js/join.js`
- Modify: `js/app.js` (function: `init`; add import, add click-map entry)
- Modify: `server/router.go` (serve `index.html` for the client-side `/join/{token}` route)

**Interfaces:**
- Consumes: `applySyncResponse` (Task 11), `router` (`app.js`), `$`, `applyTheme`, `toast` (`ui.js`).
- Produces: `function joinView(token)`, `function joinFinish(token)` — consumed by `app.js`'s router/click-map.

- [ ] **Step 1: Modify onboardFinish in onboarding.js**

Replace the body of `onboardFinish` in `js/onboarding.js`:
```js
export async function onboardFinish() {
  const name = $('#onb-name').value.trim();
  if (!name) { $('#onb-name').focus(); $('#onb-name').classList.add('shake'); setTimeout(() => $('#onb-name').classList.remove('shake'), 500); return; }
  const st = state();
  st.baby.name = name;
  st.baby.birthdate = $('#onb-bd').value || '';
  st.baby.theme = document.body.dataset.theme || 'girl';
  st.baby.caregiver = $('#onb-cg').value.trim();
  st.baby.photo = _onbPhoto;
  st.settings.caregivers[0] = { name: st.baby.caregiver, role: 'Parent' };
  st.setup = true;
  seed();
  save();
  applyTheme();
  router.boot();
  router.go('home');
  toast('Welcome, ' + name + ' 🤍');

  try {
    await fetch('/api/family', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        babyName: name, birthdate: st.baby.birthdate, theme: st.baby.theme,
        caregiverName: st.baby.caregiver || 'Parent'
      })
    });
  } catch (e) {
    // Offline at setup time: app stays fully local-only (today's behavior).
    // See Task 12's "known limitation" note in the plan.
  }
}
```

- [ ] **Step 2: Create join.js**

Create `js/join.js`:
```js
// join.js — accepting an invite link to join an existing family as a caregiver.
import { state, save, applySyncResponse } from './store.js';
import { $, applyTheme, toast } from './ui.js';
import { router } from './app.js';

export function joinView(token) {
  return `<div class="onboard">
    <div class="onb-top">
      <div class="onb-mark"><i class="ph ph-heart-straight"></i></div>
      <h1 class="onb-title">You've been invited</h1>
      <p class="onb-sub">Join as a caregiver to see and log alongside the rest of the family.</p>
    </div>
    <div class="onb-card">
      <label class="fld"><span class="fld-l">Your name</span>
        <input id="join-name" placeholder="e.g. Dad" autocomplete="off" /></label>
    </div>
    <button class="btn-primary onb-go" data-action="join:finish" data-token="${token}"><i class="ph ph-heart-straight"></i> Join family</button>
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

- [ ] **Step 3: Wire the join route into app.js**

In `js/app.js`, add this import alongside the existing `onboarding.js` import:
```js
import { joinView, joinFinish } from './join.js';
```

Replace the body of `init`:
```js
function init() {
  applyTheme();
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

Add this entry to the click-map object inside the `document.addEventListener('click', ...)` handler, alongside the existing `'onboard:finish'` entry:
```js
    'join:finish': () => joinFinish(d.token),
```

- [ ] **Step 4: Serve index.html for the /join/{token} path server-side**

A browser opening `https://.../join/abc123` directly needs the server to return the SPA shell, not a 404 — `/join/{token}` isn't a real file on disk.

Modify `server/router.go` to the following full content:
```go
package main

import (
	"database/sql"
	"net/http"
)

func newRouter(db *sql.DB, hub *Hub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/family", handleCreateFamily(db))
	mux.HandleFunc("/api/events", requireAuth(db, handleEvents(hub)))
	mux.HandleFunc("GET /api/sync", requireAuth(db, handleSync(db)))
	mux.HandleFunc("POST /api/invites", requireAuth(db, handleCreateInvite(db)))
	mux.HandleFunc("POST /api/join/{token}", handleJoinInvite(db))
	mux.HandleFunc("GET /join/{token}", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "index.html")
	})
	mux.HandleFunc("PUT /api/entries/{id}", requireAuth(db, handleUpsertEntry(db, hub)))
	mux.HandleFunc("DELETE /api/entries/{id}", requireAuth(db, handleDeleteEntry(db, hub)))
	mux.HandleFunc("PUT /api/growth/{id}", requireAuth(db, handleUpsertGrowth(db, hub)))
	mux.HandleFunc("DELETE /api/growth/{id}", requireAuth(db, handleDeleteGrowth(db, hub)))
	mux.HandleFunc("PATCH /api/baby", requireAuth(db, handlePatchBaby(db, hub)))
	mux.HandleFunc("PATCH /api/settings", requireAuth(db, handlePatchSettings(db, hub)))
	mux.Handle("/", http.FileServer(http.Dir(".")))
	return mux
}
```

- [ ] **Step 5: Manually verify the end-to-end flow in a browser**

Run:
```bash
cd /workspace/huckleberry-clone/server
rm -f /tmp/hearth-e2e.db
DB_PATH=/tmp/hearth-e2e.db PORT=8446 STATIC_DIR=.. go run . &
sleep 1
```
Then, with a browser pointed at `https://localhost:8446` (or `http://` if no cert configured locally):
1. Complete onboarding (create "Mira"). Confirm in a second terminal: `sqlite3 /tmp/hearth-e2e.db "select count(*) from families;"` returns `1`.
2. In the running app, go to Profile and note there's no invite-generation UI yet — that's fine, it's added in Task 13. For this manual check, generate an invite directly:
   ```bash
   curl -sk -b /tmp/hearth-cookies.txt -X POST https://localhost:8446/api/invites
   ```
   (reuse a cookie jar saved from the onboarding browser session, or repeat the curl-based flow from Task 5's Step 6).
3. Open `https://localhost:8446/join/<token>` in a *different* browser profile/incognito window, enter a name, tap "Join family". Confirm it lands on Home showing the same baby's name "Mira" — proof the sync pull worked.

Stop the server: `kill %1`

- [ ] **Step 6: Commit**

```bash
cd /workspace/huckleberry-clone
git add js/onboarding.js js/join.js js/app.js server/router.go
git commit -m "Wire onboarding to create the family server-side; add join-via-invite-link flow"
```

---

## Task 13: Replace the local fake caregiver list with the real invite/caregiver list

Profile's "Caregivers & sharing" section currently lets you type free-text caregiver names into a local-only array — that UI predates real accounts. Now that caregivers are created via invite/join (Tasks 5, 12), replace it with the real list plus an "Invite a caregiver" action that generates and shares a link.

**Files:**
- Create: `server/caregivers.go`
- Test: `server/caregivers_test.go`
- Modify: `server/router.go`
- Modify: `js/profile.js` (replace the caregivers section and `cgRow`)
- Modify: `js/app.js` (remove the old `cg:add`/`cg:remove`/`cg:confirm`/`cg:discard` editing code; add `cg:invite`/`cg:invite-copy`)
- Modify: `js/onboarding.js` (drop the now-dead local caregivers-array write)
- Modify: `js/store.js` (drop `caregivers` from `DEFAULT().settings` — it's no longer read anywhere)
- Modify: `styles.css` (small additions for the new caregiver row and invite-link display)

**Interfaces:**
- Produces (server): `func handleListCaregivers(db *sql.DB) http.HandlerFunc`.
- Produces (client): `function loadCaregivers()`, `function caregiversSnapshot()` exported from `profile.js`, consumed by `app.js`'s `nav:profile` handler.

- [ ] **Step 1: Write the failing server test**

Create `server/caregivers_test.go`:
```go
package main

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestHandleListCaregiversReturnsFamilyMembers(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg2', 'fam1', 'Dad', 'Partner', ?)`, nowISO())

	req := httptest.NewRequest("GET", "/api/caregivers", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleListCaregivers(db)(rec, req)

	var list []caregiverInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decoding response: %v, body=%s", err, rec.Body.String())
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 caregivers, got %d", len(list))
	}
}

func TestHandleListCaregiversOnlyReturnsOwnFamily(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famA', ?), ('famB', ?)`, nowISO(), nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA', 'famA', 'Maya', 'Parent', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgB', 'famB', 'Someone Else', 'Parent', ?)`, nowISO())

	req := httptest.NewRequest("GET", "/api/caregivers", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cgA", FamilyID: "famA"})
	rec := httptest.NewRecorder()

	handleListCaregivers(db)(rec, req)

	var list []caregiverInfo
	json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list) != 1 || list[0].DisplayName != "Maya" {
		t.Fatalf("expected only famA's caregiver, got %+v", list)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && go test ./... -run TestHandleListCaregivers -v`
Expected: FAIL — `undefined: handleListCaregivers` (compile error, `caregivers.go` doesn't exist yet).

- [ ] **Step 3: Implement caregivers.go**

Create `server/caregivers.go`:
```go
package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type caregiverInfo struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
}

func handleListCaregivers(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		rows, err := db.Query(`SELECT id, display_name, role FROM caregivers WHERE family_id = ? ORDER BY created_at`, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		list := []caregiverInfo{}
		for rows.Next() {
			var c caregiverInfo
			if err := rows.Scan(&c.ID, &c.DisplayName, &c.Role); err != nil {
				continue
			}
			list = append(list, c)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && go test ./... -v`
Expected: all tests PASS.

- [ ] **Step 5: Wire the route into router.go**

Modify `server/router.go`, adding this one line (placement doesn't matter relative to the others — `http.ServeMux` matches by pattern specificity, not registration order):
```go
	mux.HandleFunc("GET /api/caregivers", requireAuth(db, handleListCaregivers(db)))
```

- [ ] **Step 6: Replace the caregivers section in profile.js**

In `js/profile.js`, replace this block:
```js
    <div class="sec-label">Caregivers & sharing</div>
    <div class="card row-card" id="cg-list">
      ${s.caregivers.map((c, i) => cgRow(c, i)).join('')}
      <button class="add-row" data-action="cg:add"><i class="ph ph-plus"></i> Add caregiver</button>
    </div>
```
with:
```js
    <div class="sec-label">Caregivers & sharing</div>
    <div class="card row-card" id="cg-list">
      ${caregiversSnapshot().length ? caregiversSnapshot().map(caregiverRow).join('') : `<p class="empty-note">Just you so far.</p>`}
      <button class="add-row" data-action="cg:invite"><i class="ph ph-plus"></i> Invite a caregiver</button>
    </div>
```

Replace the `cgRow` function (and its export) at the bottom of the file:
```js
export function cgRow(c, i) {
  return `<div class="cg-row" data-cgi="${i}" ${pending ? 'data-pending="true"' : ''}>
    <i class="ph ph-user-circle"></i>
    <input class="cg-name" data-cg="${i}" placeholder="Name" value="${esc(c.name)}" />
    <select class="cg-role" data-cgrole="${i}">
      ${['Parent', 'Partner', 'Grandparent', 'Nanny', 'Sitter'].map((r) => `<option ${r === c.role ? 'selected' : ''}>${r}</option>`).join('')}
    </select>
    ${pending ? `<button class="med-del cg-confirm" data-action="cg:confirm" data-cgi="${i}" aria-label="Confirm"><i class="ph ph-check"></i></button>` : ''}
    ${i > 0 ? `<button class="med-del" data-action="${pending ? 'cg:discard' : 'cg:remove'}" data-cgi="${i}" aria-label="Remove"><i class="ph ph-x"></i></button>` : ''}
  </div>`;
}
```
with:
```js
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
```

- [ ] **Step 7: Remove the old caregiver-editing code from app.js, add the invite flow**

In `js/app.js`, change the `nav:profile` entry in the click-map from:
```js
    'nav:profile': () => router.go('profile'),
```
to:
```js
    'nav:profile': () => { router.go('profile'); loadCaregivers().then(() => { if (current === 'profile') router.refresh(); }); },
```

Remove these four entries from the same click-map object entirely:
```js
    'cg:add': () => cgAdd(),
    'cg:remove': () => cgRemove(d.cgi),
    'cg:confirm': () => cgConfirm(d.cgi),
    'cg:discard': () => cgDiscard(d.cgi),
```
replacing them with:
```js
    'cg:invite': () => inviteCaregiver(),
    'cg:invite-copy': () => { navigator.clipboard.writeText(d.url).then(() => toast('Link copied')); },
```

Replace the body of the `change` event listener:
```js
document.addEventListener('change', (ev) => {
  const b = ev.target.closest('[data-bind]');
  if (b) { setPath(b.dataset.bind, ev.target.value); if (b.dataset.bind === 'baby.theme') applyTheme(); }
  const row = ev.target.closest('.cg-row');
  if (row && row.dataset.pending === 'true') return; // wait for explicit confirm
  if (ev.target.classList.contains('cg-name')) saveCg();
  if (ev.target.classList.contains('cg-role')) saveCg();
});
```
with:
```js
document.addEventListener('change', (ev) => {
  const b = ev.target.closest('[data-bind]');
  if (b) { setPath(b.dataset.bind, ev.target.value); if (b.dataset.bind === 'baby.theme') applyTheme(); }
});
```

Delete these four functions entirely (no longer called from anywhere): `saveCg`, `cgAdd`, `cgConfirm`, `cgDiscard`. Keep `cgRemove`'s replacement — actually `cgRemove` is also deleted; there is no replacement, caregivers are no longer removable from this client (that's a server-side admin action, not built in this plan). Find and delete:
```js
function saveCg() {
  const rows = $$('#cg-list .cg-row');
  state().settings.caregivers = rows.map((r) => ({
    name: $('.cg-name', r).value.trim(),
    role: $('.cg-role', r).value
  }));
  save();
}
function cgAdd() {
  const list = $('#cg-list');
  const existingPending = $('.cg-row[data-pending="true"]', list);
  if (existingPending) { $('.cg-name', existingPending).focus(); return; }
  const i = $$('.cg-row', list).length;
  $('.add-row', list).insertAdjacentHTML('beforebegin', cgRow({ name: '', role: 'Parent' }, i, true));
  $(`.cg-row[data-cgi="${i}"] .cg-name`, list).focus();
}
function cgConfirm(i) {
  const row = $(`#cg-list .cg-row[data-cgi="${i}"]`); if (!row) return;
  const nameInput = $('.cg-name', row);
  if (!nameInput.value.trim()) {
    nameInput.focus(); nameInput.classList.add('shake'); setTimeout(() => nameInput.classList.remove('shake'), 500);
    toast('Enter a name'); return;
  }
  saveCg();
  router.refresh();
}
function cgDiscard(i) {
  const row = $(`#cg-list .cg-row[data-cgi="${i}"]`); if (row) row.remove();
}
function cgRemove(i) {
  state().settings.caregivers.splice(Number(i), 1); save(); router.refresh();
}
```
and replace that whole block with:
```js
async function inviteCaregiver() {
  try {
    const res = await fetch('/api/invites', { method: 'POST', credentials: 'include' });
    if (!res.ok) throw new Error('invite failed: ' + res.status);
    const { token } = await res.json();
    const url = location.origin + '/join/' + token;
    sheet.open(`
      <p class="empty-note">Share this link with the person you want to invite. It works once and expires in 48 hours.</p>
      <div class="invite-link">${esc(url)}</div>
      <button class="btn-primary" data-action="cg:invite-copy" data-url="${esc(url)}"><i class="ph ph-copy"></i> Copy link</button>`,
      { title: 'Invite a caregiver' });
  } catch (e) {
    toast('Could not create an invite — check your connection');
  }
}
```

Update the existing `./profile.js` import line in `app.js` — it currently reads:
```js
import { profile, cgRow } from './profile.js';
```
change it to:
```js
import { profile, loadCaregivers, caregiversSnapshot } from './profile.js';
```

- [ ] **Step 8: Drop the now-dead local caregivers-array write in onboarding.js**

In `js/onboarding.js`'s `onboardFinish`, remove this line (the local `settings.caregivers` array is no longer read anywhere — `caregiverRow` reads from the server-backed `caregiversSnapshot()` instead):
```js
  st.settings.caregivers[0] = { name: st.baby.caregiver, role: 'Parent' };
```

- [ ] **Step 9: Drop `caregivers` from store.js's DEFAULT()**

In `js/store.js`, remove this line from inside `DEFAULT()`'s `settings` object:
```js
    caregivers: [{ name: '', role: 'Parent' }],
```

- [ ] **Step 10: Add CSS for the new caregiver row and invite link**

Add to `styles.css`, near the existing `.cg-row` rules:
```css
.cg-display { display: flex; flex-direction: column; gap: 1px; }
.invite-link { background: var(--surface); border-radius: 14px; padding: 13px; font-size: 13px; font-weight: 600; color: var(--soft); word-break: break-all; }
```

- [ ] **Step 11: Run the full test suite**

Run:
```bash
cd /workspace/huckleberry-clone/server && go test ./... -v
cd /workspace/huckleberry-clone && node --test js/
```
Expected: all PASS.

- [ ] **Step 12: Manually verify in a browser**

With the server running (as in Task 12's Step 5), open Profile, confirm "Caregivers & sharing" shows the admin caregiver and an "Invite a caregiver" row. Tap it, confirm a sheet opens with a `/join/...` link and a working "Copy link" button (check the clipboard or watch for the "Link copied" toast).

- [ ] **Step 13: Commit**

```bash
cd /workspace/huckleberry-clone
git add server/caregivers.go server/caregivers_test.go server/router.go js/profile.js js/app.js js/onboarding.js js/store.js styles.css
git commit -m "Replace local caregiver editing with real invite-based caregiver list"
```

---

## Task 14: Cutover — Go binary replaces serve.js; systemd unit for the home server

The Go binary has served static files since Task 1 and now has the full API. This task makes it the one real server, precaches the two new client modules, and gives it a persistent systemd service for the home server it runs on.

**Files:**
- Modify: `sw.js` (precache list + version bump)
- Create: `hearth.service` (systemd unit, at the repo root for reference)
- Delete: `serve.js`

**Interfaces:** None — this task wires deployment, it doesn't change any function signature.

- [ ] **Step 1: Add the two new client modules to the service worker's precache list, and bump the cache version**

Modify `sw.js` to the following full content for the top section (everything from `self.addEventListener('install'...` onward is unchanged):
```js
// Hearth PWA service worker
const VERSION = 'hearth-v4';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/store.js',
  './js/ui.js',
  './js/sheets.js',
  './js/home.js',
  './js/trends.js',
  './js/sleep.js',
  './js/growth.js',
  './js/profile.js',
  './js/reminders.js',
  './js/onboarding.js',
  './js/sync.js',
  './js/join.js'
];
```

- [ ] **Step 2: Build the production binary**

Run:
```bash
cd /workspace/huckleberry-clone/server
go build -o hearth-server .
ls -la hearth-server
```
Expected: a `hearth-server` executable is produced.

- [ ] **Step 3: Stop serve.js if it's running, start the Go binary in its place**

Run:
```bash
pkill -f "node serve.js" || true
cd /workspace/huckleberry-clone
./server/hearth-server &
sleep 1
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost:8443/index.html
```
Expected: `200`, same as `serve.js` used to return — the Go binary is now serving on the same `HOST`/`PORT`/`CERT_FILE`/`KEY_FILE` from `.env`, since it reads the identical `.env` file (Task 1, `loadConfig`). `WorkingDirectory` matters here: `STATIC_DIR` defaults to `.`, so run the binary from the repo root (where `index.html` lives), not from `server/`.

- [ ] **Step 4: Delete serve.js**

```bash
cd /workspace/huckleberry-clone
rm serve.js
```

- [ ] **Step 5: Add a systemd unit for persistent operation on the home server**

Create `hearth.service` at the repo root (adjust `WorkingDirectory`/`ExecStart` to wherever this is actually deployed on the home server — the paths below match this development checkout):
```ini
[Unit]
Description=Hearth baby tracker server
After=network.target

[Service]
Type=simple
WorkingDirectory=/workspace/huckleberry-clone
ExecStart=/workspace/huckleberry-clone/server/hearth-server
EnvironmentFile=/workspace/huckleberry-clone/.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

To install it (run manually on the home server, not part of this repo's automated steps — requires root):
```bash
sudo cp hearth.service /etc/systemd/system/hearth.service
sudo systemctl daemon-reload
sudo systemctl enable --now hearth.service
sudo systemctl status hearth.service
```
Expected: `active (running)`.

- [ ] **Step 6: Final full-suite verification**

Run:
```bash
cd /workspace/huckleberry-clone/server && go test ./... -v
cd /workspace/huckleberry-clone && node --test js/
curl -sk -o /dev/null -w "index.html: %{http_code}\n" https://localhost:8443/index.html
curl -sk -o /dev/null -w "js/sync.js: %{http_code}\n" https://localhost:8443/js/sync.js
```
Expected: all Go tests PASS, all Node tests PASS, both curl checks return `200`.

- [ ] **Step 7: Commit**

```bash
cd /workspace/huckleberry-clone
git add sw.js hearth.service
git rm serve.js
git commit -m "Cut over to the Go server; retire serve.js"
```
