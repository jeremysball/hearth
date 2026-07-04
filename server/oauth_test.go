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
