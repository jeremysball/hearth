package server

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

func TestLookupExistingSessionMatchesRawToken(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?, ?)`, now, now)
	token, err := createSession(db, "cg1", "fam1")
	if err != nil {
		t.Fatal(err)
	}

	got := lookupExistingSession(db, token)
	if got == nil {
		t.Fatal("expected a matching session, got nil")
	}
	if got.CaregiverID != "cg1" || got.FamilyID != "fam1" {
		t.Fatalf("got %+v, want CaregiverID=cg1 FamilyID=fam1", *got)
	}
}

func TestLookupExistingSessionReturnsNilForUnknownToken(t *testing.T) {
	db := newParallelTestDB(t)
	if got := lookupExistingSession(db, "not-a-real-token"); got != nil {
		t.Fatalf("expected nil for unknown token, got %+v", *got)
	}
}
