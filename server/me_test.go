package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMeReportsIdentity(t *testing.T) {
	db := newParallelTestDB(t)
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
	db := newParallelTestDB(t)
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
	db := newParallelTestDB(t)
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
	db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE token_hash = ?`, hashForTest(t, token)).Scan(&n)
	if n != 0 {
		t.Fatalf("session not deleted, count=%d", n)
	}
}
