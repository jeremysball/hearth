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
