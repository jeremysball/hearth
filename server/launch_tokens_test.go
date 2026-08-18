package server

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestHandlePreviewLaunchTokenNotFound(t *testing.T) {
	db := newParallelTestDB(t)
	req := httptest.NewRequest("GET", "/api/launch/nope/preview", nil)
	req.SetPathValue("token", "nope")
	rec := httptest.NewRecorder()

	handlePreviewLaunchToken(db)(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestHandlePreviewLaunchTokenExpired(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Test', 'Partner', ?)`, nowISO())
	db.Exec(`INSERT INTO launch_tokens (token_hash, caregiver_id, family_id, expires_at) VALUES (?, 'cg1', 'fam1', ?)`,
		hashForTest(t, "lt1"), "2000-01-01T00:00:00Z")

	req := httptest.NewRequest("GET", "/api/launch/lt1/preview", nil)
	req.SetPathValue("token", "lt1")
	rec := httptest.NewRecorder()

	handlePreviewLaunchToken(db)(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rec.Code)
	}
}

func TestHandlePreviewLaunchTokenAlreadyUsed(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Test', 'Partner', ?)`, nowISO())
	db.Exec(`INSERT INTO launch_tokens (token_hash, caregiver_id, family_id, expires_at, used_at) VALUES (?, 'cg1', 'fam1', ?, ?)`,
		hashForTest(t, "lt1"), "2099-01-01T00:00:00Z", nowISO())

	req := httptest.NewRequest("GET", "/api/launch/lt1/preview", nil)
	req.SetPathValue("token", "lt1")
	rec := httptest.NewRecorder()

	handlePreviewLaunchToken(db)(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rec.Code)
	}
}

func TestHandlePreviewLaunchTokenDoesNotConsumeToken(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, nowISO())
	db.Exec(`INSERT INTO launch_tokens (token_hash, caregiver_id, family_id, expires_at) VALUES (?, 'cg1', 'fam1', ?)`,
		hashForTest(t, "lt1"), "2099-01-01T00:00:00Z")

	req := httptest.NewRequest("GET", "/api/launch/lt1/preview", nil)
	req.SetPathValue("token", "lt1")
	rec := httptest.NewRecorder()
	handlePreviewLaunchToken(db)(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp launchPreviewResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if resp.CaregiverName != "Maya" {
		t.Errorf("caregiverName = %q, want Maya", resp.CaregiverName)
	}
	if resp.FamilyID != "fam1" {
		t.Errorf("familyId = %q, want fam1", resp.FamilyID)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 0 {
		t.Errorf("preview should not set any cookie, got %v", cookies)
	}
	var usedAt sql.NullString
	if err := db.QueryRow(`SELECT used_at FROM launch_tokens WHERE token_hash = ?`, hashForTest(t, "lt1")).Scan(&usedAt); err != nil {
		t.Fatal(err)
	}
	if usedAt.Valid && usedAt.String != "" {
		t.Errorf("preview should not mark the token used, got used_at=%q", usedAt.String)
	}
}

func TestHandleRedeemLaunchTokenNotFound(t *testing.T) {
	db := newParallelTestDB(t)
	req := httptest.NewRequest("POST", "/api/launch/nope", nil)
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

	req := httptest.NewRequest("POST", "/api/launch/lt1", nil)
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

	req := httptest.NewRequest("POST", "/api/launch/lt1", nil)
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

	req := httptest.NewRequest("POST", "/api/launch/lt1", nil)
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

// TestLaunchRouteDoesNotRedeemOnGet pins the CSRF fix: a GET to the bare
// /api/launch/{token} URL — exactly what an <meta refresh> or a hidden
// <img src=...> from an attacker-controlled page would issue — must not
// consume the token or set a session cookie. Before this fix, the redeem
// handler was a side-effecting GET, and the frontend fired it
// automatically on any /?launch=... navigation (see js/app.js init()).
func TestLaunchRouteDoesNotRedeemOnGet(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Test', 'Partner', ?)`, nowISO())
	db.Exec(`INSERT INTO launch_tokens (token_hash, caregiver_id, family_id, expires_at) VALUES (?, 'cg1', 'fam1', ?)`,
		hashForTest(t, "lt1"), "2099-01-01T00:00:00Z")

	mux := newRouter(db, nil, "", Config{DevMode: false}, nil)

	req := httptest.NewRequest("GET", "/api/launch/lt1", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	// 404 from the catchall is fine — the point is that no session cookie
	// was set and the token is still unused.
	if rec.Code == http.StatusOK {
		t.Fatalf("GET on /api/launch/{token} should not return 200; got body=%s", rec.Body.String())
	}
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookieName {
			t.Fatalf("GET on /api/launch/{token} must not set a session cookie, got %v", c)
		}
	}
	var usedAt sql.NullString
	if err := db.QueryRow(`SELECT used_at FROM launch_tokens WHERE token_hash = ?`, hashForTest(t, "lt1")).Scan(&usedAt); err != nil {
		t.Fatal(err)
	}
	if usedAt.Valid && usedAt.String != "" {
		t.Fatalf("GET on /api/launch/{token} must not consume the token, got used_at=%q", usedAt.String)
	}
}
