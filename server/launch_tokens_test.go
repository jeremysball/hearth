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
