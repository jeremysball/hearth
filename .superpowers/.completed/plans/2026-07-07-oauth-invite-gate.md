# OAuth Invite Gate + device_family Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the single-tenancy hole in `reconcile()`'s OAuth "signedup" path (a stranger signing in on an already-provisioned instance silently gets a second private family) by gating it behind the existing invite-token mechanism, and finish wiring the already-committed `device_family` mismatch protection client-side.

**Architecture:** `reconcile()` (`server/reconcile.go`) gains an `inviteToken` parameter threaded through the OAuth callback the same way `deviceFamily` already is. Two of its branches — "no identity, no session" and "identity's caregiver removed, no session" — now require a valid invite token once the instance already has a family, reusing a `consumeInvite` helper shared with the existing manual `/join/{token}` handler. Client-side, `js/account.js`'s `beginSignIn` starts sending the `device_family` hint it already has cached (via `getLastSyncFamilyId()` in `js/sync.js`) and a new `auth=mismatch` branch gets a real recovery sheet; `js/join.js` gets a "Continue with Google" button that carries the invite token through the same OAuth round trip.

**Tech Stack:** Go 1.x stdlib `net/http` + `database/sql` (SQLite), vanilla JS ES modules, Playwright for E2E, `node --test` for JS unit tests.

## Global Constraints

- Conventional Commits for every commit (`fix(server): ...`, `feat(server): ...`, etc.)
- Run `scripts/bump-version.sh` before any commit that touches `js/`, `index.html`, `styles.css`, `sw.js`, `assets/`, or `icons/` — skip it for Go-only commits.
- Add one-line, plain-parent-language changelog entries to `js/changelog.js`'s `2026-07-07` block for user-facing `feat`/`fix` commits only.
- Run `go test ./server` after every Go change; run `node --test js/sync.test.js js/store.test.js` after JS changes that touch sync/store; run the specific Playwright spec(s) touched, not the full suite, per CLAUDE.md's CI-is-the-gate guidance.
- Single-tenancy invariant: this SQLite instance holds exactly one `families` row once `handleCreateFamily` succeeds; `anyFamilyExists` in this plan is how OAuth learns that fact.
- No new abstractions beyond what's specified below — reuse `consumeInvite`, `validTokenParam`, `getLastSyncFamilyId` everywhere a duplicate would otherwise appear.

---

## Task 1: Widen `lookupByToken` to accept a transaction

**Files:**
- Modify: `server/tokens.go:80`
- Test: `server/tokens_test.go` (existing tests, no new ones — this task must not change behavior)

**Interfaces:**
- Produces: `type querier interface { QueryRow(query string, args ...any) *sql.Row }`; `lookupByToken(db querier, query string, plaintext string, dest ...any) (matchedHash string, err error)` — same signature except the first parameter's type widens from `*sql.DB` to `querier`. Every existing call site (`*sql.DB` values) still satisfies the interface unmodified.

- [ ] **Step 1: Change the parameter type**

In `server/tokens.go`, above `func lookupByToken`, add:

```go
// querier is satisfied by both *sql.DB and *sql.Tx, so lookupByToken can run
// inside a transaction (needed when a token lookup must be atomic with the
// write that follows it) or directly against the pool, unchanged either way.
type querier interface {
	QueryRow(query string, args ...any) *sql.Row
}
```

Change the function signature from:

```go
func lookupByToken(db *sql.DB, query string, plaintext string, dest ...any) (matchedHash string, err error) {
```

to:

```go
func lookupByToken(db querier, query string, plaintext string, dest ...any) (matchedHash string, err error) {
```

The function body is unchanged (it only calls `db.QueryRow`).

- [ ] **Step 2: Run the existing tests to confirm nothing broke**

Run: `go build ./... && go test ./server -run TestLookupByToken -v`
Expected: PASS, same as before (this is a pure widening — no behavior change).

- [ ] **Step 3: Run the full server suite**

Run: `go test ./server`
Expected: PASS (all packages compile; every existing caller passes `*sql.DB`, which still satisfies `querier`).

- [ ] **Step 4: Commit**

```bash
git add server/tokens.go
git commit -m "refactor(server): widen lookupByToken to accept a transaction"
```

---

## Task 2: Extract `consumeInvite` and refactor `handleJoinInvite`

**Files:**
- Modify: `server/invites.go`
- Modify: `server/router.go:78`
- Test: `server/invites_test.go` (existing, signature-only updates), `server/cli_test.go:27`, `server/desync_repro_test.go:74`

**Interfaces:**
- Consumes: `querier` from Task 1, `bumpRev(tx *sql.Tx, familyID string) (int64, error)` (`server/db.go`), `newID()`, `nowISO()`, `hashToken()`, `logAuthEvent()`, `Hub.Broadcast(familyID string)` (`server/sse.go`).
- Produces: `var errInviteInvalid = errors.New(...)`; `func consumeInvite(tx *sql.Tx, token string) (familyID, matchedHash string, err error)` — returns `sql.ErrNoRows` for an unknown token, `errInviteInvalid` for expired/already-used, or a real error. `func handleJoinInvite(db *sql.DB, hub *Hub) http.HandlerFunc` (signature gains `hub *Hub`).

- [ ] **Step 1: Add `consumeInvite` and the sentinel error**

In `server/invites.go`, add `"errors"` and `"time"` are already imported; add `"errors"`:

```go
import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"
)
```

Add above `handleJoinInvite`:

```go
// errInviteInvalid means the token matched a row that can no longer be
// used (expired or already consumed) — distinct from sql.ErrNoRows (the
// token never matched any invite at all), so callers can keep their
// existing 404-vs-410 distinction.
var errInviteInvalid = errors.New("invite expired or already used")

// consumeInvite validates an invite token inside tx and returns the family
// it grants access to. It does NOT mark the invite used — the caller does
// that (with matchedHash, not a fresh hash of token) once it has also
// committed whatever the invite was for, so a crash between validation and
// use can't leave an invite consumed with nothing to show for it.
func consumeInvite(tx *sql.Tx, token string) (familyID, matchedHash string, err error) {
	var expiresAt string
	var usedAt sql.NullString
	matchedHash, err = lookupByToken(tx, `SELECT token_hash, family_id, expires_at, used_at FROM invites WHERE token_hash IN (%s)`,
		token, &familyID, &expiresAt, &usedAt)
	if err != nil {
		return "", "", err
	}
	if usedAt.Valid && usedAt.String != "" {
		return "", "", errInviteInvalid
	}
	expiry, perr := time.Parse(time.RFC3339Nano, expiresAt)
	if perr != nil || time.Now().UTC().After(expiry) {
		return "", "", errInviteInvalid
	}
	return familyID, matchedHash, nil
}
```

- [ ] **Step 2: Refactor `handleJoinInvite` to use it, wrapped in a transaction, with rev-stamping and a broadcast**

Replace the whole `handleJoinInvite` function body with:

```go
func handleJoinInvite(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.PathValue("token")

		var req joinInviteRequest
		json.NewDecoder(r.Body).Decode(&req) // best-effort; empty name falls back below
		caregiverName := req.CaregiverName
		if caregiverName == "" {
			caregiverName = "Caregiver"
		}

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		familyID, matchedHash, err := consumeInvite(tx, token)
		if err == sql.ErrNoRows {
			http.Error(w, "invite not found", http.StatusNotFound)
			return
		}
		if err == errInviteInvalid {
			http.Error(w, "invite expired or already used", http.StatusGone)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		caregiverID := newID()
		now := nowISO()
		rev, err := bumpRev(tx, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at, rev) VALUES (?, ?, ?, 'Partner', ?, ?, ?)`,
			caregiverID, familyID, caregiverName, now, now, rev); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`UPDATE invites SET used_at = ? WHERE token_hash = ?`, now, matchedHash); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		sessToken, err := createSession(db, caregiverID, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		setSessionCookie(w, sessToken)
		hub.Broadcast(familyID)
		log.Printf("caregiver joined: name=%q family=%s", caregiverName, familyID)
		logAuthEvent(r, "invite_join", SessionInfo{CaregiverID: caregiverID, FamilyID: familyID})

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(joinInviteResponse{FamilyID: familyID, CaregiverID: caregiverID})
	}
}
```

- [ ] **Step 3: Update the router wiring**

In `server/router.go:78`, change:

```go
	mux.HandleFunc("POST /api/join/{token}", handleJoinInvite(db))
```

to:

```go
	mux.HandleFunc("POST /api/join/{token}", handleJoinInvite(db, hub))
```

- [ ] **Step 4: Update the three existing call sites to pass `hub`**

In `server/invites_test.go`, all four occurrences of `handleJoinInvite(db)` (lines 69, 97, 114, 127) become `handleJoinInvite(db, newHub())`.

In `server/cli_test.go:27`, `handleJoinInvite(db)` becomes `handleJoinInvite(db, newHub())`.

In `server/desync_repro_test.go:74`, `handleJoinInvite(db)` becomes `handleJoinInvite(db, newHub())`.

- [ ] **Step 5: Run the invite tests**

Run: `go test ./server -run TestHandleJoinInvite -v`
Expected: PASS — `TestHandleJoinInviteCreatesCaregiverAndSession`,
`TestHandleJoinInviteRejectsUsedToken`,
`TestHandleJoinInviteRejectsExpiredToken`,
`TestHandleJoinInviteRejectsUnknownToken` all still pass with their existing
404/410/200 assertions unchanged.

- [ ] **Step 6: Run the full server suite**

Run: `go build ./... && go test ./server`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/invites.go server/router.go server/invites_test.go server/cli_test.go server/desync_repro_test.go
git commit -m "refactor(server): extract consumeInvite, stamp rev on caregiver join, broadcast"
```

---

## Task 3: Gate `reconcile()`'s signedup path behind an invite

**Files:**
- Modify: `server/reconcile.go`
- Test: `server/reconcile_test.go` (signature updates on all 5 existing calls), `server/desync_repro_test.go` (signature updates on the 4 existing calls in this file, behavior-changing update to one assertion in Task 5)

**Interfaces:**
- Consumes: `consumeInvite`, `errInviteInvalid` (Task 2); `bumpRev`; `Hub.Broadcast` (`server/sse.go`).
- Produces: `func anyFamilyExists(db *sql.DB) (bool, error)`; `func reconcile(db *sql.DB, hub *Hub, provider, providerUserID, email string, cur *SessionInfo, deviceFamily, inviteToken string) (ReconcileResult, error)` — two new params (`hub`, `inviteToken`) inserted; `ReconcileResult.Kind` gains a new possible value `"denied"`.

- [ ] **Step 1: Add `anyFamilyExists`**

In `server/reconcile.go`, add below `caregiverRemoved`:

```go
// anyFamilyExists reports whether this instance has ever been provisioned.
// handleCreateFamily (server/family.go) already refuses to create a second
// family once one exists; the OAuth signedup path below must refuse the
// same way, or a stranger clicking "Continue with Google" on an
// already-provisioned instance silently gets their own private family in
// the same database.
func anyFamilyExists(db *sql.DB) (bool, error) {
	var exists bool
	err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM families)`).Scan(&exists)
	return exists, err
}
```

- [ ] **Step 2: Widen the `reconcile` signature**

Change:

```go
func reconcile(db *sql.DB, provider, providerUserID, email string, cur *SessionInfo, deviceFamily string) (ReconcileResult, error) {
```

to:

```go
func reconcile(db *sql.DB, hub *Hub, provider, providerUserID, email string, cur *SessionInfo, deviceFamily, inviteToken string) (ReconcileResult, error) {
```

- [ ] **Step 3: Gate the signedup branch**

Inside the `if err == sql.ErrNoRows {` block, after the existing `if cur != nil { ... return ReconcileResult{Kind: "linked", ...}, nil }` (unchanged), replace the unconditional signup block:

```go
		// Sign up: fresh family + caregiver + default settings, then identity.
		newFamily, newBaby, newCare := newID(), newID(), newID()
```

with a guard before it, keeping the existing signup code as the "instance is brand new" branch:

```go
		exists, e := anyFamilyExists(db)
		if e != nil {
			return ReconcileResult{}, e
		}
		if !exists {
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
			if _, e = tx.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES (?, ?, 'Parent', 'Parent', ?, ?)`, newCare, newFamily, now, now); e != nil {
				return ReconcileResult{}, e
			}
			if _, e = tx.Exec(`INSERT INTO settings (family_id, units_json, reminders_json, cards_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
				newFamily, defaultUnitsJSON, defaultRemindersJSON, defaultCardsJSON, now); e != nil {
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

		// The instance already has its one family. A stranger without a
		// valid invite must not be handed a caregiver seat in it.
		if inviteToken == "" {
			return ReconcileResult{Kind: "denied"}, nil
		}
		tx, e := db.Begin()
		if e != nil {
			return ReconcileResult{}, e
		}
		defer tx.Rollback()
		inviteFamily, matchedHash, e := consumeInvite(tx, inviteToken)
		if e == sql.ErrNoRows || e == errInviteInvalid {
			return ReconcileResult{Kind: "denied"}, nil
		}
		if e != nil {
			return ReconcileResult{}, e
		}
		newCare := newID()
		now := nowISO()
		rev, e := bumpRev(tx, inviteFamily)
		if e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at, rev) VALUES (?, ?, 'Caregiver', 'Partner', ?, ?, ?)`,
			newCare, inviteFamily, now, now, rev); e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`UPDATE invites SET used_at = ? WHERE token_hash = ?`, now, matchedHash); e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES (?, ?, ?, ?, ?)`,
			provider, providerUserID, newCare, email, now); e != nil {
			return ReconcileResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return ReconcileResult{}, e
		}
		hub.Broadcast(inviteFamily)
		return ReconcileResult{Kind: "linked", CaregiverID: newCare, FamilyID: inviteFamily}, nil
```

(Note: the inner `now := nowISO()` inside the `if !exists` block shadows cleanly since it's a nested scope; the outer `now`/`newCare` used after the block are freshly declared with `:=` and do not collide.)

- [ ] **Step 4: Update all existing `reconcile(...)` call sites to the new signature (no behavior change in this step)**

In `server/reconcile_test.go`, add `hub := newHub()` is not needed per-call if you pass `newHub()` inline. Update each call:

- Line 11: `reconcile(db, "google", "sub-new", "a@b.c", cur, "")` → `reconcile(db, newHub(), "google", "sub-new", "a@b.c", cur, "", "")`
- Line 31: `reconcile(db, "google", "sub-b", "b@b.c", nil, "")` → `reconcile(db, newHub(), "google", "sub-b", "b@b.c", nil, "", "")`
- Line 51: `reconcile(db, "google", "sub-b", "b@b.c", cur, "")` → `reconcile(db, newHub(), "google", "sub-b", "b@b.c", cur, "", "")`
- Line 69: `reconcile(db, "google", "sub-b", "b@b.c", cur, "")` → `reconcile(db, newHub(), "google", "sub-b", "b@b.c", cur, "", "")`
- Line 84: `reconcile(db, "google", "sub-c", "c@b.c", nil, "")` → `reconcile(db, newHub(), "google", "sub-c", "c@b.c", nil, "", "")`
- Line 99: `reconcile(db, "google", "sub-new-d", "d@b.c", cur, "")` → `reconcile(db, newHub(), "google", "sub-new-d", "d@b.c", cur, "", "")`

In `server/desync_repro_test.go`:

- Line 88: `reconcile(db, "google", "sub-her", "her@x.y", cur, "")` → `reconcile(db, newHub(), "google", "sub-her", "her@x.y", cur, "", "")`
- Line 150: `reconcile(db, "google", "sub-her", "her@x.y", nil, "")` → `reconcile(db, newHub(), "google", "sub-her", "her@x.y", nil, "", "")`
- Line 192: `reconcile(db, "google", "sub-her", "her@x.y", nil, "famA")` → `reconcile(db, newHub(), "google", "sub-her", "her@x.y", nil, "famA", "")`
- Line 107 (`res2`) gets a real behavior-changing update — deferred to Task 5, since this file's `seedFamilyA` means a family already exists when `res2` runs, and it must now assert `"denied"` instead of `"signedup"`.

- [ ] **Step 5: Compile-check**

Run: `go build ./...`
Expected: compiles (Task 5 will fix the one remaining assertion mismatch in `desync_repro_test.go`; this step just confirms every call site's arity/types are correct).

- [ ] **Step 6: Commit**

```bash
git add server/reconcile.go server/reconcile_test.go server/desync_repro_test.go
git commit -m "fix(server): gate reconcile's signedup path behind an invite once a family exists"
```

---

## Task 4: Gate the removed-caregiver rejoin behind an invite (reactivation)

**Files:**
- Modify: `server/reconcile.go`

**Interfaces:**
- Consumes: `consumeInvite`, `errInviteInvalid` (Task 2); `bumpRev`, `Hub.Broadcast`.
- Produces: the `removedAt != ""` branch of `reconcile()` gains invite-token handling; no new exported names.

- [ ] **Step 1: Add the invite-reactivation path**

Find the `if removedAt != "" {` block (the comment starting "This provider account was linked to a caregiver who has since been removed"). After the existing `if cur != nil { ... return ReconcileResult{Kind: "linked", ...}, nil }`, replace:

```go
			return ReconcileResult{Kind: "linked", CaregiverID: cur.CaregiverID, FamilyID: cur.FamilyID}, nil
		}
		return ReconcileResult{Kind: "removed"}, nil
	}
```

with:

```go
			return ReconcileResult{Kind: "linked", CaregiverID: cur.CaregiverID, FamilyID: cur.FamilyID}, nil
		}
		if inviteToken == "" {
			return ReconcileResult{Kind: "removed"}, nil
		}
		tx, e := db.Begin()
		if e != nil {
			return ReconcileResult{}, e
		}
		defer tx.Rollback()
		inviteFamily, matchedHash, e := consumeInvite(tx, inviteToken)
		if e == sql.ErrNoRows || e == errInviteInvalid || inviteFamily != familyID {
			return ReconcileResult{Kind: "removed"}, nil
		}
		if e != nil {
			return ReconcileResult{}, e
		}
		now := nowISO()
		rev, e := bumpRev(tx, familyID)
		if e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`UPDATE caregivers SET removed_at = '', updated_at = ?, rev = ? WHERE id = ? AND family_id = ?`,
			now, rev, caregiverID, familyID); e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`UPDATE invites SET used_at = ? WHERE token_hash = ?`, now, matchedHash); e != nil {
			return ReconcileResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return ReconcileResult{}, e
		}
		hub.Broadcast(familyID)
		return ReconcileResult{Kind: "restored", CaregiverID: caregiverID, FamilyID: familyID}, nil
	}
```

The `inviteFamily != familyID` guard is defensive: single-tenancy guarantees they're always equal today, but reactivation fails closed (falls back to `"removed"`) rather than resurrecting a caregiver in the wrong family if that invariant is ever violated.

- [ ] **Step 2: Build**

Run: `go build ./...`
Expected: compiles clean.

- [ ] **Step 3: Commit**

```bash
git add server/reconcile.go
git commit -m "fix(server): let a removed caregiver rejoin with a valid invite instead of a dead end"
```

---

## Task 5: New and flipped reconcile tests

**Files:**
- Modify: `server/reconcile_test.go`
- Modify: `server/desync_repro_test.go`

**Interfaces:**
- Consumes: `reconcile`, `newHub()`, `hashToken()`, `nowISO()` — all already defined.

- [ ] **Step 1: Flip `res2`'s assertion in `desync_repro_test.go`**

In `TestInviteRejoinIdentityAfterRemoveAndReinvite` (`server/desync_repro_test.go`), the block:

```go
	res2, err := reconcile(db, "google", "sub-her2", "her2@x.y", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if res2.Kind != "signedup" {
		// unrelated identity sanity check only
		t.Fatalf("fresh identity should sign up, got %+v", res2)
	}
```

becomes:

```go
	res2, err := reconcile(db, newHub(), "google", "sub-her2", "her2@x.y", nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if res2.Kind != "denied" {
		// famA already exists on this instance; a fresh identity with no
		// invite must be refused, not handed a brand-new private family.
		t.Fatalf("expected denied for a stranger with no invite once a family exists, got %+v", res2)
	}
```

- [ ] **Step 2: Add `TestReconcileSignupDeniedWithoutInviteOnProvisionedInstance`**

Add to `server/reconcile_test.go`:

```go
func TestReconcileSignupDeniedWithoutInviteOnProvisionedInstance(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famExisting', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgExisting','famExisting','X','Parent',?)`, now)

	res, err := reconcile(db, newHub(), "google", "sub-stranger", "stranger@b.c", nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "denied" {
		t.Fatalf("got %+v, want denied", res)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM families`).Scan(&n)
	if n != 1 {
		t.Fatalf("expected no second family to be created, got %d families", n)
	}
}
```

- [ ] **Step 3: Add `TestReconcileSignupWithValidInviteJoinsThatFamily`**

Add to `server/reconcile_test.go`:

```go
func TestReconcileSignupWithValidInviteJoinsThatFamily(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famExisting', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgExisting','famExisting','X','Parent',?)`, now)
	db.Exec(`INSERT INTO invites (token_hash, family_id, created_by, expires_at) VALUES (?, 'famExisting', 'cgExisting', ?)`,
		hashToken("inv-tok"), time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano))

	res, err := reconcile(db, newHub(), "google", "sub-newcomer", "newcomer@b.c", nil, "", "inv-tok")
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "linked" || res.FamilyID != "famExisting" {
		t.Fatalf("got %+v, want linked into famExisting", res)
	}
	var usedAt sql.NullString
	db.QueryRow(`SELECT used_at FROM invites WHERE token_hash = ?`, hashToken("inv-tok")).Scan(&usedAt)
	if !usedAt.Valid || usedAt.String == "" {
		t.Fatal("expected the invite to be marked used")
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM families`).Scan(&n)
	if n != 1 {
		t.Fatalf("expected no second family, got %d families", n)
	}
}
```

Add `"database/sql"` and `"time"` to `server/reconcile_test.go`'s imports (currently just `"testing"`):

```go
import (
	"database/sql"
	"testing"
	"time"
)
```

- [ ] **Step 4: Add `TestReconcileRemovedCaregiverReactivatesWithValidInvite`**

Add to `server/reconcile_test.go`:

```go
func TestReconcileRemovedCaregiverReactivatesWithValidInvite(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famE', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at, removed_at) VALUES ('cgE','famE','E','Partner',?,?)`, now, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub-e','cgE','e@b.c',?)`, now)
	db.Exec(`INSERT INTO invites (token_hash, family_id, created_by, expires_at) VALUES (?, 'famE', 'cgE', ?)`,
		hashToken("inv-e"), time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano))

	res, err := reconcile(db, newHub(), "google", "sub-e", "e@b.c", nil, "", "inv-e")
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "restored" || res.CaregiverID != "cgE" || res.FamilyID != "famE" {
		t.Fatalf("got %+v, want restored on the same caregiver id", res)
	}
	var removedAt string
	db.QueryRow(`SELECT removed_at FROM caregivers WHERE id = 'cgE'`).Scan(&removedAt)
	if removedAt != "" {
		t.Fatalf("expected removed_at cleared, got %q", removedAt)
	}
	var usedAt sql.NullString
	db.QueryRow(`SELECT used_at FROM invites WHERE token_hash = ?`, hashToken("inv-e")).Scan(&usedAt)
	if !usedAt.Valid || usedAt.String == "" {
		t.Fatal("expected the invite to be marked used")
	}
}

func TestReconcileRemovedCaregiverStaysRemovedWithoutInvite(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famF', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at, removed_at) VALUES ('cgF','famF','F','Partner',?,?)`, now, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub-f','cgF','f@b.c',?)`, now)

	res, err := reconcile(db, newHub(), "google", "sub-f", "f@b.c", nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "removed" {
		t.Fatalf("got %+v, want removed", res)
	}
	var removedAt string
	db.QueryRow(`SELECT removed_at FROM caregivers WHERE id = 'cgF'`).Scan(&removedAt)
	if removedAt == "" {
		t.Fatal("expected removed_at to stay set without an invite")
	}
}
```

- [ ] **Step 5: Run the new and existing reconcile tests**

Run: `go test ./server -run TestReconcile -v`
Expected: PASS for all — the 6 pre-existing tests (unchanged behavior) plus the 4 new ones added in this task.

- [ ] **Step 6: Run the desync repro suite**

Run: `go test ./server -run TestInviteRejoinIdentityAfterRemoveAndReinvite -v`
Expected: PASS, including the flipped `res2` assertion.

- [ ] **Step 7: Run the full server suite**

Run: `go test ./server`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/reconcile_test.go server/desync_repro_test.go
git commit -m "test(server): cover the invite-gated signup and removed-caregiver reactivation paths"
```

---

## Task 6: Carry the invite token through the OAuth redirect

**Files:**
- Modify: `server/oauth.go`
- Modify: `server/router.go:101`

**Interfaces:**
- Consumes: `reconcile` (new signature from Tasks 3-4).
- Produces: `func validTokenParam(s string) bool` (renamed from `validDeviceFamily`); `const oauthInviteCookie = "hearth_oauth_invite"`; `func handleAuthCallback(db *sql.DB, hub *Hub, cfg Config) http.HandlerFunc` (signature gains `hub *Hub`); new `mismatch` and `denied` cases in the callback's `switch`.

- [ ] **Step 1: Rename `validDeviceFamily` to `validTokenParam` and add the invite cookie constant**

In `server/oauth.go`, change:

```go
const oauthDeviceFamilyCookie = "hearth_oauth_device_family"
```

to:

```go
const oauthDeviceFamilyCookie = "hearth_oauth_device_family"

// oauthInviteCookie carries an invite token across the provider redirect,
// the same way oauthDeviceFamilyCookie carries the device_family hint. It
// lets a sign-in that would otherwise be denied (no known identity, or a
// removed one) name the invite that grants it access.
const oauthInviteCookie = "hearth_oauth_invite"
```

Change:

```go
// validDeviceFamily accepts only newID-shaped values (hex, bounded length) so
// an arbitrary client string never lands in a cookie or a log line.
func validDeviceFamily(s string) bool {
```

to:

```go
// validTokenParam accepts only newID-shaped values (hex, bounded length) so
// an arbitrary client string never lands in a cookie or a log line. Used for
// both the device_family hint and the invite token carried through the
// OAuth redirect — both are newID() output.
func validTokenParam(s string) bool {
```

(function body is unchanged)

Update the two existing call sites:
- `if df := r.URL.Query().Get("device_family"); validDeviceFamily(df) {` → `if df := r.URL.Query().Get("device_family"); validTokenParam(df) {`
- `if dc, err := r.Cookie(oauthDeviceFamilyCookie); err == nil && validDeviceFamily(dc.Value) {` → `if dc, err := r.Cookie(oauthDeviceFamilyCookie); err == nil && validTokenParam(dc.Value) {`

- [ ] **Step 2: `handleAuthBegin` also sets the invite cookie**

In `handleAuthBegin`, after the existing `device_family` cookie block:

```go
		if df := r.URL.Query().Get("device_family"); validTokenParam(df) {
			http.SetCookie(w, &http.Cookie{
				Name:     oauthDeviceFamilyCookie,
				Value:    df,
				Path:     "/",
				HttpOnly: true,
				Secure:   true,
				SameSite: http.SameSiteLaxMode,
				MaxAge:   int(10 * time.Minute / time.Second),
			})
		}
```

add:

```go
		if inv := r.URL.Query().Get("invite"); validTokenParam(inv) {
			http.SetCookie(w, &http.Cookie{
				Name:     oauthInviteCookie,
				Value:    inv,
				Path:     "/",
				HttpOnly: true,
				Secure:   true,
				SameSite: http.SameSiteLaxMode,
				MaxAge:   int(10 * time.Minute / time.Second),
			})
		}
```

- [ ] **Step 3: `handleAuthCallback` gains `hub`, reads the invite cookie, and passes both through**

Change the function signature:

```go
func handleAuthCallback(db *sql.DB, cfg Config) http.HandlerFunc {
```

to:

```go
func handleAuthCallback(db *sql.DB, hub *Hub, cfg Config) http.HandlerFunc {
```

After the existing device_family cookie read-and-clear block:

```go
		deviceFamily := ""
		if dc, err := r.Cookie(oauthDeviceFamilyCookie); err == nil && validTokenParam(dc.Value) {
			deviceFamily = dc.Value
		}
		http.SetCookie(w, &http.Cookie{Name: oauthDeviceFamilyCookie, Path: "/", MaxAge: -1})
```

add:

```go
		inviteToken := ""
		if ic, err := r.Cookie(oauthInviteCookie); err == nil && validTokenParam(ic.Value) {
			inviteToken = ic.Value
		}
		http.SetCookie(w, &http.Cookie{Name: oauthInviteCookie, Path: "/", MaxAge: -1})
```

Change the `reconcile` call:

```go
		res, err := reconcile(db, name, gu.UserID, gu.Email, cur, deviceFamily)
```

to:

```go
		res, err := reconcile(db, hub, name, gu.UserID, gu.Email, cur, deviceFamily, inviteToken)
```

- [ ] **Step 4: Add `mismatch` and `denied` cases to the switch**

Change:

```go
		switch res.Kind {
		case "linked", "restored", "signedup":
			...
		case "removed":
			logAuthEvent(r, "oauth_removed", SessionInfo{})
			http.Redirect(w, r, "/?auth=removed", http.StatusFound)
		case "conflict":
			...
		}
```

by adding two new cases (after `"removed"`, before `"conflict"`):

```go
		case "mismatch":
			logAuthEvent(r, "oauth_mismatch", SessionInfo{})
			http.Redirect(w, r, "/?auth=mismatch&provider="+name, http.StatusFound)
		case "denied":
			logAuthEvent(r, "oauth_denied", SessionInfo{})
			http.Redirect(w, r, "/?auth=denied", http.StatusFound)
```

(Previously there was no case for `"mismatch"` at all — the switch fell through silently and the callback returned an empty 200. This was a live gap: `Kind: "mismatch"` has existed in `reconcile()` since PR #108 but the callback never redirected on it.)

- [ ] **Step 5: Update the router**

In `server/router.go:101`, change:

```go
	mux.HandleFunc("GET /api/auth/{provider}/callback", handleAuthCallback(db, cfg))
```

to:

```go
	mux.HandleFunc("GET /api/auth/{provider}/callback", handleAuthCallback(db, hub, cfg))
```

- [ ] **Step 6: Build and test**

Run: `go build ./... && go test ./server`
Expected: PASS (no test calls `handleAuthCallback` directly today, per the repo search done during planning — only `handleAuthBegin` has direct test call sites, and its signature is unchanged).

- [ ] **Step 7: Commit**

```bash
git add server/oauth.go server/router.go
git commit -m "fix(server): carry the invite token through OAuth, wire up the mismatch redirect"
```

---

## Task 7: Client — send device_family and invite through beginSignIn

**Files:**
- Modify: `js/account.js`
- Test: `js/sync.test.js` (no changes needed — `getLastSyncFamilyId` already exists and is already tested)

**Interfaces:**
- Consumes: `getLastSyncFamilyId()` (`js/sync.js`, already implemented and tested from PR #109); `reset()` (`js/store.js:92`); `sheet`, `toast`, `esc` (`js/ui.js`).
- Produces: `beginSignIn(provider, inviteToken)` (signature gains an optional second param); `mismatchSwitch(provider)` (new export, used by `js/app.js`'s dispatch map in Task 9).

- [ ] **Step 1: Import `getLastSyncFamilyId` and `reset`**

In `js/account.js`, change:

```js
import { state, save } from './store.js';
import { esc, sheet, toast } from './ui.js';
```

to:

```js
import { state, save, reset } from './store.js';
import { esc, sheet, toast } from './ui.js';
import { getLastSyncFamilyId } from './sync.js';
```

- [ ] **Step 2: Update `beginSignIn` to send both hints**

Change:

```js
export function beginSignIn(provider) {
  // Full-page navigation so the provider redirect lands back on our callback.
  window.location.href = '/api/auth/' + provider;
}
```

to:

```js
export function beginSignIn(provider, inviteToken) {
  const params = new URLSearchParams();
  const familyId = getLastSyncFamilyId();
  if (familyId) params.set('device_family', familyId);
  if (inviteToken) params.set('invite', inviteToken);
  const qs = params.toString();
  // Full-page navigation so the provider redirect lands back on our callback.
  window.location.href = '/api/auth/' + provider + (qs ? '?' + qs : '');
}
```

- [ ] **Step 3: Handle `auth=mismatch` and `auth=denied` in `handleAuthRedirect`**

Change:

```js
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
  else if (auth === 'error') { toast('Sign-in failed, please try again'); }
  else if (auth === 'removed') { toast('You were removed from that family. Ask an admin for a new invite link.'); }
  else if (auth === 'conflict' && pending) {
    try {
      const res = await fetch('/api/conflict/' + encodeURIComponent(pending), { credentials: 'include' });
      if (res.ok) openConflictSheet(await res.json(), pending);
    } catch (e) { toast('Could not load account details'); }
  }
}
```

to:

```js
export async function handleAuthRedirect(refresh, onSignup) {
  const params = new URLSearchParams(location.search);
  const auth = params.get('auth');
  if (!auth) return;
  const pending = params.get('pending');
  const provider = params.get('provider');
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
  else if (auth === 'error') { toast('Sign-in failed, please try again'); }
  else if (auth === 'removed') { toast('You were removed from that family. Ask an admin for a new invite link.'); }
  else if (auth === 'denied') { toast('This Hearth needs an invite link to sign in.'); }
  else if (auth === 'mismatch') { openMismatchSheet(provider); }
  else if (auth === 'conflict' && pending) {
    try {
      const res = await fetch('/api/conflict/' + encodeURIComponent(pending), { credentials: 'include' });
      if (res.ok) openConflictSheet(await res.json(), pending);
    } catch (e) { toast('Could not load account details'); }
  }
}
```

- [ ] **Step 4: Add `openMismatchSheet` and `mismatchSwitch`**

Add below `openConflictSheet`:

```js
function openMismatchSheet(provider) {
  sheet.open(`
    <p class="empty-note">This device's local data and your account's family don't match. Nothing was changed or deleted yet.</p>
    <button class="btn-primary" data-action="auth:mismatch-switch" data-provider="${esc(provider)}"><svg class="icon"><use href="#check"></use></svg> Switch to my account (wipes this device)</button>
    <button class="btn-ghost" data-action="auth:mismatch-dismiss">Get a new invite instead</button>`,
    { title: "Accounts don't match" });
}

// Wipes this device's local data (so it no longer claims a conflicting
// family) and immediately retries the same sign-in with no device_family
// hint, landing cleanly in the account's real family.
export function mismatchSwitch(provider) {
  sheet.close();
  reset();
  document.body.dataset.theme = 'girl';
  beginSignIn(provider);
}
```

- [ ] **Step 5: Run the JS unit suite (unaffected, regression check)**

Run: `node --test js/sync.test.js js/store.test.js`
Expected: PASS — this task doesn't touch sync.js or store.js's tested behavior, just consumes their existing exports.

- [ ] **Step 6: Bump the version**

Run: `scripts/bump-version.sh`
Expected: prints the updated `index.html` meta tag and `sw.js` VERSION lines.

- [ ] **Step 7: Add the changelog entries**

In `js/changelog.js`, add to the `2026-07-07` block's `fixes` array (append after the existing two entries from PR1/PR2):

```js
      'Fixed a sign-in that landed in the wrong family after losing a session; the app now catches the mismatch and offers to switch cleanly instead of silently splitting your data.',
      'Signing in with Google on a Hearth that already has a family now requires an invite link, instead of silently creating a second, private family.'
```

- [ ] **Step 8: Commit**

```bash
git add js/account.js index.html sw.js js/changelog.js
git commit -m "fix(client): send the device_family hint through sign-in, add a real mismatch recovery sheet"
```

---

## Task 8: Client — invite-token entry point on the join page

**Files:**
- Modify: `js/join.js`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `beginSignIn(provider, inviteToken)` (Task 7).
- Produces: no new exports — `joinView(token)`'s markup gains a button; `js/app.js`'s action dispatch map gains one new entry.

- [ ] **Step 1: Add the Google button to `joinView`**

In `js/join.js`, add the import:

```js
import { beginSignIn } from './account.js';
```

Change:

```js
    <button class="btn-primary onb-go" data-action="join:finish" data-token="${token}"><svg class="icon"><use href="#heart"></use></svg> Join family</button>
  </div>`;
}
```

to:

```js
    <button class="btn-primary onb-go" data-action="join:finish" data-token="${token}"><svg class="icon"><use href="#heart"></use></svg> Join family</button>
    <div class="onb-or">or</div>
    <button class="signin-pill google" data-action="join:google" data-token="${token}"><svg class="icon"><use href="#circle-user"></use></svg> Continue with Google</button>
  </div>`;
}
```

- [ ] **Step 2: Wire the `join:google` action in `js/app.js`**

Find the action dispatch map entry `'join:finish': () => joinFinish(d.token),` (line 303) and add immediately after it:

```js
    'join:google': () => beginSignIn('google', d.token),
```

`beginSignIn` is already imported into `js/app.js` (used by the existing `'auth:signin'` entry), so no new import is needed there.

- [ ] **Step 3: Wire the mismatch sheet's two new actions in `js/app.js`**

Find the existing `'auth:resolve': () => resolveConflict(...)` entry and add after it:

```js
    'auth:mismatch-switch': () => mismatchSwitch(d.provider),
    'auth:mismatch-dismiss': () => { sheet.close(); toast('Ask an admin for a new invite link'); },
```

Add `mismatchSwitch` to the existing import line from `js/account.js` (find the line starting `import { beginSignIn, signOut, resolveConflict, handleAuthRedirect, loadMe }`):

```js
import { beginSignIn, signOut, resolveConflict, handleAuthRedirect, loadMe, mismatchSwitch } from './account.js';
```

`sheet` and `toast` are already imported into `js/app.js` from `js/ui.js` (used elsewhere in the file) — confirm this with `grep -n "from './ui.js'" js/app.js` and add them to that import list only if not already present.

- [ ] **Step 4: Bump the version**

Run: `scripts/bump-version.sh`

- [ ] **Step 5: Commit**

```bash
git add js/join.js js/app.js index.html sw.js
git commit -m "feat(client): let a re-invited caregiver join with Google instead of retyping their name"
```

(This is a `feat`, not a `fix` — it's a new entry point, not a repair of existing behavior. Add one changelog line for it in the same `2026-07-07` `features` array: `'Added a "Continue with Google" option to invite links, so a re-invited caregiver can rejoin without retyping their name.'` — include this in the commit.)

---

## Task 9: Playwright coverage

**Files:**
- Modify: `tests/account.test.js`
- Create: `tests/join-invite-google.test.js`

**Interfaces:**
- Consumes: `startServer`, `launchBrowser`, `onboard`, `check`, `tally` (`tests/helpers.js`).

- [ ] **Step 1: Extend `tests/account.test.js` with mismatch and denied checks**

Replace the file's body between the existing `auth=error` check and the `finally` block:

```js
    // auth=error redirect is handled with a toast, not a crash.
    await page.goto(srv.base + '/?auth=error');
    await page.waitForTimeout(400);
    const urlClean = !page.url().includes('auth=');
    check('auth query param is cleared from the URL', urlClean, page.url());

    // auth=denied shows a toast and does not crash.
    await page.goto(srv.base + '/?auth=denied');
    await page.waitForTimeout(400);
    const deniedToast = await page.locator('#toast').innerText().catch(() => '');
    check('auth=denied shows an invite-link toast', deniedToast.includes('invite link'), deniedToast);

    // auth=mismatch opens a real recovery sheet with two concrete actions.
    await page.goto(srv.base + '/?auth=mismatch&provider=google');
    await page.waitForSelector('[data-action="auth:mismatch-switch"]');
    const switchBtn = await page.$('[data-action="auth:mismatch-switch"]');
    const dismissBtn = await page.$('[data-action="auth:mismatch-dismiss"]');
    check('auth=mismatch shows a switch action', !!switchBtn, 'missing');
    check('auth=mismatch shows a dismiss action', !!dismissBtn, 'missing');
```

- [ ] **Step 2: Create `tests/join-invite-google.test.js`**

```js
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18796);
  const browser = await launchBrowser();
  try {
    // Onboard the one family this instance will ever have, then mint a
    // real invite token the same way the admin UI does.
    const setupPage = await browser.newPage();
    await setupPage.goto(srv.base + '/');
    await onboard(setupPage);
    const token = await setupPage.evaluate(async () => {
      const res = await fetch('/api/invites', { method: 'POST', credentials: 'include' });
      const body = await res.json();
      return body.token;
    });
    await setupPage.close();

    // A second, unauthenticated browser context opens the invite link.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(srv.base + '/join/' + token);
    await page.waitForSelector('[data-action="join:google"]');
    const googleBtn = await page.$('[data-action="join:google"]');
    check('join page shows a Continue with Google button', !!googleBtn, 'missing');

    const navPromise = page.waitForURL(/\/api\/auth\/google/, { timeout: 5000 }).catch(() => null);
    await page.click('[data-action="join:google"]');
    const navigated = await navPromise;
    check('Continue with Google navigates to /api/auth/google with the invite token', !!navigated && page.url().includes('invite=' + token), page.url());

    await context.close();
  } catch (e) {
    check('join-invite-google test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run both suites**

Run: `CHROMIUM=/usr/bin/chromium node tests/account.test.js`
Expected: all `check(...)` lines report PASS.

Run: `CHROMIUM=/usr/bin/chromium node tests/join-invite-google.test.js`
Expected: all `check(...)` lines report PASS. Note the Google OAuth round trip itself 404s in this test environment (no `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` configured in `tests/helpers.js`'s server env) — this test only verifies the client builds the right URL and starts the navigation, not that OAuth completes end to end.

- [ ] **Step 4: Commit**

```bash
git add tests/account.test.js tests/join-invite-google.test.js
git commit -m "test(e2e): cover the mismatch sheet, denied toast, and join-via-Google button"
```

---

## Task 10: Final full-suite pass and PR

**Files:** none (verification only)

- [ ] **Step 1: Full Go suite**

Run: `go build ./... && go vet ./... && go test ./server`
Expected: PASS, no vet warnings.

- [ ] **Step 2: Full JS unit suite**

Run: `node --test js/sync.test.js js/store.test.js`
Expected: PASS.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin fix/desync-oauth-family-split
gh pr create --base fix/desync-merge-rerev --title "fix(server): gate OAuth sign-in behind invites, finish the device_family hint" --body "$(cat <<'EOF'
## Summary
- Closes a real single-tenancy hole: reconcile()'s OAuth signedup path had no guard against creating a second family on an already-provisioned instance (handleCreateFamily already refuses this for the manual onboarding form).
- A previously-removed caregiver can now rejoin with a valid invite instead of hitting a permanent "removed" dead end.
- Finishes wiring the device_family hint (Cause 1): the client now sends it, and auth=mismatch gets a real recovery sheet instead of silently splitting the family or (previously) not redirecting at all.

## Test plan
- [ ] go test ./server
- [ ] node --test js/sync.test.js js/store.test.js
- [ ] tests/account.test.js
- [ ] tests/join-invite-google.test.js
- [ ] CI e2e matrix green
EOF
)"
```

Report the PR URL. Do not merge without the user's go-ahead, per the standing stack-execution instructions.

- [ ] **Step 4: Kick off a glm-5.2 review in the background**

```bash
opencode run -m opencode-go/glm-5.2 --dangerously-skip-permissions -- "Review GitHub PR #<N> (jeremysball/hearth, branch fix/desync-oauth-family-split onto fix/desync-merge-rerev). Use 'gh pr diff <N>' to get the diff. Focus on: reconcile()'s new invite-gated signedup and removed-caregiver-reactivation branches in server/reconcile.go, the consumeInvite/lookupByToken transaction plumbing in server/invites.go and server/tokens.go, the new oauth.go mismatch/denied redirect cases, and the client-side mismatchSwitch reset-and-retry flow in js/account.js. Report concrete findings with file:line." &
```

(timeout at least 20 minutes per CLAUDE.md; run in background and report findings once it completes)
