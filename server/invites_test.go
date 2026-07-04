package server

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleCreateInviteRequiresAuth(t *testing.T) {
	db := newParallelTestDB(t)
	req := httptest.NewRequest("POST", "/api/invites", nil)
	rec := httptest.NewRecorder()

	requireAuth(db, handleCreateInvite(db))(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestHandleCreateInviteReturnsToken(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?, ?)`, now, now)
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
	if err := db.QueryRow(`SELECT family_id FROM invites WHERE token_hash = ?`, hashForTest(t, resp.Token)).Scan(&familyID); err != nil {
		t.Fatalf("querying invite: %v", err)
	}
	if familyID != "fam1" {
		t.Errorf("invite family_id = %q, want fam1", familyID)
	}
}

func TestHandleJoinInviteCreatesCaregiverAndSession(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO invites (token_hash, family_id, created_by, expires_at) VALUES (?, 'fam1', 'cg1', ?)`,
		hashForTest(t, "inv1"), "2099-01-01T00:00:00Z")

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
	if err := db.QueryRow(`SELECT used_at FROM invites WHERE token_hash = ?`, hashForTest(t, "inv1")).Scan(&usedAt); err != nil {
		t.Fatal(err)
	}
	if !usedAt.Valid || usedAt.String == "" {
		t.Error("expected invite to be marked used")
	}
}

func TestHandleJoinInviteRejectsUsedToken(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO invites (token_hash, family_id, created_by, expires_at, used_at) VALUES (?, 'fam1', 'cg1', ?, ?)`,
		hashForTest(t, "inv1"), "2099-01-01T00:00:00Z", nowISO())

	req := httptest.NewRequest("POST", "/api/join/inv1", bytes.NewBufferString(`{"caregiverName":"Maya"}`))
	req.SetPathValue("token", "inv1")
	rec := httptest.NewRecorder()

	handleJoinInvite(db)(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rec.Code)
	}
}

func TestHandleJoinInviteRejectsExpiredToken(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO invites (token_hash, family_id, created_by, expires_at) VALUES (?, 'fam1', 'cg1', ?)`,
		hashForTest(t, "inv1"), "2000-01-01T00:00:00Z")

	req := httptest.NewRequest("POST", "/api/join/inv1", bytes.NewBufferString(`{"caregiverName":"Maya"}`))
	req.SetPathValue("token", "inv1")
	rec := httptest.NewRecorder()

	handleJoinInvite(db)(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410", rec.Code)
	}
}

func TestHandleJoinInviteRejectsUnknownToken(t *testing.T) {
	db := newParallelTestDB(t)
	req := httptest.NewRequest("POST", "/api/join/nope", bytes.NewBufferString(`{"caregiverName":"Maya"}`))
	req.SetPathValue("token", "nope")
	rec := httptest.NewRecorder()

	handleJoinInvite(db)(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
