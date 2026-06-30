package main

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(prev) })
	return &buf
}

func TestRequestLogIncludesOriginAuthContextAndGeo(t *testing.T) {
	logs := captureLogs(t)
	db := newTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg','fam','A','Parent',?)`, now)
	token, _ := createSession(db, "cg", "fam")
	mux := newRouter(db, newHub(), "", Config{})

	req := httptest.NewRequest("GET", "/api/me", nil)
	req.Host = "hearth.example"
	req.RemoteAddr = "198.51.100.10:12345"
	req.Header.Set("User-Agent", "HearthTest/1.0")
	req.Header.Set("X-Forwarded-For", "203.0.113.7, 198.51.100.10")
	req.Header.Set("X-Real-IP", "203.0.113.8")
	req.Header.Set("CF-IPCountry", "US")
	req.Header.Set("X-Vercel-IP-City", "Portland")
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	line := logs.String()
	for _, want := range []string{
		"method=GET", "path=/api/me", "status=200", "host=hearth.example",
		"ip=203.0.113.7", "remote=198.51.100.10", "xff=203.0.113.7,198.51.100.10", "xreal=203.0.113.8",
		"ua=HearthTest/1.0", "caregiver=cg", "family=fam", "geo_country=US", "geo_city=Portland",
	} {
		if !strings.Contains(line, want) {
			t.Fatalf("log missing %q in %q", want, line)
		}
	}
	if strings.Contains(line, token) {
		t.Fatalf("log leaked session token: %q", line)
	}
}

func TestSignoutLogsAuthEventWithOrigin(t *testing.T) {
	logs := captureLogs(t)
	db := newTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg','fam','A','Parent',?)`, now)
	token, _ := createSession(db, "cg", "fam")
	req := httptest.NewRequest("POST", "/api/auth/signout", nil)
	req.RemoteAddr = "198.51.100.10:12345"
	req.Header.Set("X-Forwarded-For", "203.0.113.7")
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	req = withSession(req, SessionInfo{CaregiverID: "cg", FamilyID: "fam"})
	rec := httptest.NewRecorder()

	handleSignout(db)(rec, req)

	line := logs.String()
	for _, want := range []string{"auth event=signout", "caregiver=cg", "family=fam", "ip=203.0.113.7", "remote=198.51.100.10"} {
		if !strings.Contains(line, want) {
			t.Fatalf("log missing %q in %q", want, line)
		}
	}
	if strings.Contains(line, token) {
		t.Fatalf("log leaked session token: %q", line)
	}
}
