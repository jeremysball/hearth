package main

import (
	"database/sql"
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
