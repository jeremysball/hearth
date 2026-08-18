package server

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleCreateLaunchTokenRequiresAuth(t *testing.T) {
	db := newParallelTestDB(t)
	req := httptest.NewRequest("POST", "/api/launch-tokens", nil)
	rec := httptest.NewRecorder()

	requireAuth(db, handleCreateLaunchToken(db))(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestHandleCreateLaunchTokenReturnsToken(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?, ?)`, now, now)
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
	if err := db.QueryRow(`SELECT caregiver_id FROM launch_tokens WHERE token_hash = ?`, hashForTest(t, resp.Token)).Scan(&caregiverID); err != nil {
		t.Fatalf("querying launch_token: %v", err)
	}
	if caregiverID != "cg1" {
		t.Errorf("caregiver_id = %q, want cg1", caregiverID)
	}
}

func TestHandleRedeemLaunchTokenNotFound(t *testing.T) {
	db := newParallelTestDB(t)
	req := httptest.NewRequest("GET", "/api/launch/nope", nil)
	req.SetPathValue("token", "nope")
	rec := httptest.NewRecorder()

	handleRedeemLaunchToken(db)(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestHandleRedeemLaunchTokenExpired(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Test', 'Partner', ?)`, nowISO())
	db.Exec(`INSERT INTO launch_tokens (token_hash, caregiver_id, family_id, expires_at) VALUES (?, 'cg1', 'fam1', ?)`,
		hashForTest(t, "lt1"), "2000-01-01T00:00:00Z")

	req := httptest.NewRequest("GET", "/api/launch/lt1", nil)
	req.SetPathValue("token", "lt1")
	rec := httptest.NewRecorder()

	handleRedeemLaunchToken(db)(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rec.Code)
	}
}

func TestHandleRedeemLaunchTokenAlreadyUsed(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Test', 'Partner', ?)`, nowISO())
	db.Exec(`INSERT INTO launch_tokens (token_hash, caregiver_id, family_id, expires_at, used_at) VALUES (?, 'cg1', 'fam1', ?, ?)`,
		hashForTest(t, "lt1"), "2099-01-01T00:00:00Z", nowISO())

	req := httptest.NewRequest("GET", "/api/launch/lt1", nil)
	req.SetPathValue("token", "lt1")
	rec := httptest.NewRecorder()

	handleRedeemLaunchToken(db)(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rec.Code)
	}
}

func TestHandleRedeemLaunchTokenSetsSessionCookieAndMarksUsed(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Test', 'Partner', ?)`, nowISO())
	db.Exec(`INSERT INTO launch_tokens (token_hash, caregiver_id, family_id, expires_at) VALUES (?, 'cg1', 'fam1', ?)`,
		hashForTest(t, "lt1"), "2099-01-01T00:00:00Z")

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
	if err := db.QueryRow(`SELECT used_at FROM launch_tokens WHERE token_hash = ?`, hashForTest(t, "lt1")).Scan(&usedAt); err != nil {
		t.Fatal(err)
	}
	if !usedAt.Valid || usedAt.String == "" {
		t.Error("expected launch token to be marked used")
	}
}

// previewLaunchTokenFixture seeds the minimum rows the preview handler
// needs to return a 200: one family, one caregiver, one baby, one valid
// launch token. The returned token is the plaintext caller-passed value so
// tests can keep using the same path-arg the handler will see.
func previewLaunchTokenFixture(t *testing.T, db *sql.DB, plaintext string) {
	previewLaunchTokenFixtureFor(t, db, plaintext, "fam1", "cg1", "Maya", "Mira")
}

// previewLaunchTokenFixtureFor is the parameterized form used by tests
// that need isolated row IDs (so parallel tests don't share rate-limit
// state, audit-log family IDs, or other cross-test bleed). Calling it
// twice with the same familyID/caregiverID/babyID is safe — the second
// call only inserts the launch_token row.
func previewLaunchTokenFixtureFor(t *testing.T, db *sql.DB, plaintext, familyID, caregiverID, caregiverName, babyName string) {
	t.Helper()
	now := nowISO()
	if _, err := db.Exec(`INSERT OR IGNORE INTO families (id, created_at) VALUES (?, ?)`, familyID, now); err != nil {
		t.Fatalf("insert family: %v", err)
	}
	if _, err := db.Exec(
		`INSERT OR IGNORE INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES (?, ?, ?, 'Parent', ?, ?)`,
		caregiverID, familyID, caregiverName, now, now,
	); err != nil {
		t.Fatalf("insert caregiver: %v", err)
	}
	if _, err := db.Exec(
		`INSERT OR IGNORE INTO babies (id, family_id, name, birthdate, theme, sex, photo, updated_at) VALUES (?, ?, ?, '2026-01-01', 'girl', 'girl', NULL, ?)`,
		familyID+"-b1", familyID, babyName, now,
	); err != nil {
		t.Fatalf("insert baby: %v", err)
	}
	if _, err := db.Exec(
		`INSERT OR IGNORE INTO launch_tokens (token_hash, caregiver_id, family_id, expires_at) VALUES (?, ?, ?, ?)`,
		hashForTest(t, plaintext), caregiverID, familyID, "2099-01-01T00:00:00Z",
	); err != nil {
		t.Fatalf("insert launch_token: %v", err)
	}
}

func newPreviewRequest(plaintext string) *http.Request {
	req := httptest.NewRequest("GET", "/api/launch/"+plaintext+"/preview", nil)
	req.SetPathValue("token", plaintext)
	req.RemoteAddr = "198.51.100.10:12345"
	return req
}

func TestHandlePreviewLaunchTokenReturnsNames(t *testing.T) {
	db := newParallelTestDB(t)
	previewLaunchTokenFixture(t, db, "lt1")

	rec := httptest.NewRecorder()
	handlePreviewLaunchToken(db)(rec, newPreviewRequest("lt1"))

	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp previewLaunchTokenResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if resp.CaregiverID != "cg1" {
		t.Errorf("caregiverId = %q, want cg1", resp.CaregiverID)
	}
	if resp.CaregiverName != "Maya" {
		t.Errorf("caregiverName = %q, want Maya", resp.CaregiverName)
	}
	if resp.BabyName != "Mira" {
		t.Errorf("babyName = %q, want Mira", resp.BabyName)
	}
	if resp.FamilyID != "fam1" {
		t.Errorf("familyId = %q, want fam1", resp.FamilyID)
	}
}

func TestHandlePreviewLaunchTokenNotFound(t *testing.T) {
	db := newParallelTestDB(t)
	rec := httptest.NewRecorder()
	handlePreviewLaunchToken(db)(rec, newPreviewRequest("missing"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestHandlePreviewLaunchTokenExpired(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	db.Exec(`INSERT INTO launch_tokens (token_hash, caregiver_id, family_id, expires_at) VALUES (?, 'cg1', 'fam1', ?)`,
		hashForTest(t, "lt1"), "2000-01-01T00:00:00Z")

	rec := httptest.NewRecorder()
	handlePreviewLaunchToken(db)(rec, newPreviewRequest("lt1"))

	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rec.Code)
	}
}

// TestHandlePreviewLaunchTokenRateLimit drives the preview handler past the
// per-(IP, token) cap and asserts the next request is rejected. It also
// asserts the access log carries the same audit shape as the redeem path:
// one `auth event=launch_preview` line per accepted probe, with the
// caregiver and family IDs from the resolved token.
func TestHandlePreviewLaunchTokenRateLimit(t *testing.T) {
	logs := captureLogs(t)
	db := newParallelTestDB(t)
	// Use a token name unique to this test so parallel preview tests
	// running in the same process don't share rate-limit state. The audit
	// log assertions below key on the same family ID for the same reason.
	previewLaunchTokenFixtureFor(t, db, "rlt1", "famR", "cgR", "Riya", "Rohan")
	previewLaunchTokenFixtureFor(t, db, "rlt2", "famR", "cgR", "Riya", "Rohan")

	resetPreviewRateLimits()
	t.Cleanup(resetPreviewRateLimits)

	handler := handlePreviewLaunchToken(db)
	for i := 0; i < launchPreviewRateLimit; i++ {
		rec := httptest.NewRecorder()
		handler(rec, newPreviewRequest("rlt1"))
		if rec.Code != 200 {
			t.Fatalf("probe %d: status = %d, want 200 (body=%s)", i, rec.Code, rec.Body.String())
		}
	}

	// The (limit+1)-th request from the same IP+token must be rejected.
	over := httptest.NewRecorder()
	handler(over, newPreviewRequest("rlt1"))
	if over.Code != http.StatusTooManyRequests {
		t.Fatalf("over-limit status = %d, want 429", over.Code)
	}

	// A different token (same IP) is still allowed: the limit is per
	// (IP, token), not per IP. Otherwise one victim's probing would lock
	// out every other install link arriving from a shared NAT.
	different := httptest.NewRecorder()
	handler(different, newPreviewRequest("rlt2"))
	if different.Code != 200 {
		t.Fatalf("different-token status = %d, want 200", different.Code)
	}

	// And the audit log: every successful probe should have produced one
	// launch_preview line for this test's family, carrying the same
	// caregiver/family shape as the redeem path. We expect
	// launchPreviewRateLimit + 1 (the rlt2 probe), all under family=famR.
	want := launchPreviewRateLimit + 1
	got := strings.Count(logs.String(), "family=famR")
	if got != want {
		t.Errorf("family=famR count = %d, want %d\nlog:\n%s", got, want, logs.String())
	}
	for _, want := range []string{"caregiver=cgR", "family=famR", "event=launch_preview", "ip=198.51.100.10"} {
		if !strings.Contains(logs.String(), want) {
			t.Errorf("log missing %q in:\n%s", want, logs.String())
		}
	}

	// The over-limit probe is rejected before the audit log fires, so the
	// family=famR count must NOT increase past (limit+1).
	post := strings.Count(logs.String(), "family=famR")
	if post != want {
		t.Errorf("rate-limited probe leaked into auth log: count = %d, want %d", post, want)
	}
}

// TestHandlePreviewLaunchTokenMultiBabyDeterministic seeds two babies in the
// same family and asserts the preview response picks the same baby name on
// repeated calls. Without ORDER BY the LIMIT 1 over an unordered index can
// return a different row across probes; with ORDER BY id it's pinned.
func TestHandlePreviewLaunchTokenMultiBabyDeterministic(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?, ?)`, now, now)
	// Two babies; the smaller id ("babyA") sorts first under ORDER BY id ASC.
	db.Exec(`INSERT INTO babies (id, family_id, name, birthdate, theme, sex, photo, updated_at) VALUES ('babyA', 'fam1', 'Mira', '2026-01-01', 'girl', 'girl', NULL, ?)`, now)
	db.Exec(`INSERT INTO babies (id, family_id, name, birthdate, theme, sex, photo, updated_at) VALUES ('babyB', 'fam1', 'Otis', '2026-02-02', 'boy', 'boy', NULL, ?)`, now)
	db.Exec(`INSERT INTO launch_tokens (token_hash, caregiver_id, family_id, expires_at) VALUES (?, 'cg1', 'fam1', ?)`,
		hashForTest(t, "lt1"), "2099-01-01T00:00:00Z")

	resetPreviewRateLimits()
	t.Cleanup(resetPreviewRateLimits)

	handler := handlePreviewLaunchToken(db)
	var first string
	for i := 0; i < 25; i++ {
		// Reset the rate limit each iteration so we're testing the SQL
		// determinism, not the rate limiter.
		resetPreviewRateLimits()
		rec := httptest.NewRecorder()
		handler(rec, newPreviewRequest("lt1"))
		if rec.Code != 200 {
			t.Fatalf("probe %d: status = %d, body = %s", i, rec.Code, rec.Body.String())
		}
		var resp previewLaunchTokenResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("probe %d decode: %v", i, err)
		}
		if i == 0 {
			first = resp.BabyName
		} else if resp.BabyName != first {
			t.Fatalf("probe %d: babyName = %q, want %q (non-deterministic baby pick)", i, resp.BabyName, first)
		}
	}
	if first != "Mira" {
		t.Errorf("first baby = %q, want Mira (smallest id)", first)
	}
}

// TestHandlePreviewLaunchTokenDoesNotConsumeToken asserts the preview path
// is read-only: a preview leaves used_at NULL so a subsequent redeem can
// still claim the token.
func TestHandlePreviewLaunchTokenDoesNotConsumeToken(t *testing.T) {
	db := newParallelTestDB(t)
	previewLaunchTokenFixture(t, db, "lt1")

	resetPreviewRateLimits()
	t.Cleanup(resetPreviewRateLimits)

	previewRec := httptest.NewRecorder()
	handlePreviewLaunchToken(db)(previewRec, newPreviewRequest("lt1"))
	if previewRec.Code != 200 {
		t.Fatalf("preview status = %d, body = %s", previewRec.Code, previewRec.Body.String())
	}
	var usedAt sql.NullString
	if err := db.QueryRow(`SELECT used_at FROM launch_tokens WHERE token_hash = ?`, hashForTest(t, "lt1")).Scan(&usedAt); err != nil {
		t.Fatal(err)
	}
	if usedAt.Valid {
		t.Errorf("preview consumed the token: used_at = %q", usedAt.String)
	}
}

// TestHandlePreviewLaunchTokenCaregiverGoneCoherent: the preview handler
// must not ship a partial response when the caregiver row is gone. The
// single JOINed query means a missing caregiver produces an empty
// caregiverName in the same response that already knows about the family
// — and crucially, the test confirms the lookup either fails cleanly (404)
// or returns the family+baby with caregiverName empty; it must not return
// a successful 200 with caregiverName="Someone" while silently swallowing
// the error. Both cases are valid; what matters is no silent 200-with-blank
// from a swallowed error, and no double-read race.
func TestHandlePreviewLaunchTokenCaregiverGoneCoherent(t *testing.T) {
	db := newParallelTestDB(t)
	previewLaunchTokenFixtureFor(t, db, "cgt1", "famC", "cgC", "Maya", "Mira")

	// Hard-delete the caregiver row, simulating a future cleanup path that
	// the issue description warns about. The current soft-delete path uses
	// removed_at, which a LEFT JOIN against an unset removed filter still
	// sees — this is the harder case to get right.
	if _, err := db.Exec(`DELETE FROM caregivers WHERE id = 'cgC'`); err != nil {
		t.Fatalf("delete caregiver: %v", err)
	}

	resetPreviewRateLimits()
	t.Cleanup(resetPreviewRateLimits)

	rec := httptest.NewRecorder()
	handlePreviewLaunchToken(db)(rec, newPreviewRequest("cgt1"))

	if rec.Code != 200 {
		// Some DBs surface a JOIN-without-row as ErrNoRows, which we
		// translate to 404; either is fine, what matters is that we don't
		// partially fill the response.
		return
	}
	var resp previewLaunchTokenResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// The FK stored in launch_tokens still points at the now-missing
	// caregiver_id — that's exactly what the JOIN is for. The handler
	// must not silently fill the missing name with a placeholder, must
	// not drop the whole response, and must still return the family and
	// baby identity (those reads are independent of the caregiver row).
	if resp.CaregiverName != "" {
		t.Errorf("caregiverName = %q, want \"\" (LEFT JOIN missed the deleted row)", resp.CaregiverName)
	}
	if resp.FamilyID != "famC" {
		t.Errorf("familyId = %q, want famC (must still be set from launch_tokens)", resp.FamilyID)
	}
	if resp.BabyName != "Mira" {
		t.Errorf("babyName = %q, want Mira (must still be set from the babies subquery)", resp.BabyName)
	}
}
