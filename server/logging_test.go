package main

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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
	req.Header.Set("CF-IPCountry", "US")
	req.Header.Set("X-Vercel-IP-Country-Region", "OR")
	req.Header.Set("X-Vercel-IP-City", "Portland")
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	req = withSession(req, SessionInfo{CaregiverID: "cg", FamilyID: "fam"})
	rec := httptest.NewRecorder()

	handleSignout(db)(rec, req)

	line := logs.String()
	for _, want := range []string{"auth event=signout", "caregiver=cg", "family=fam", "ip=203.0.113.7", "remote=198.51.100.10", "geo_country=US", "geo_region=OR", "geo_city=Portland"} {
		if !strings.Contains(line, want) {
			t.Fatalf("log missing %q in %q", want, line)
		}
	}
	if strings.Contains(line, token) {
		t.Fatalf("log leaked session token: %q", line)
	}
}

func TestSanitizeLogValueQuotesWhitespaceAndEscapesQuotes(t *testing.T) {
	cases := map[string]string{
		"simple":                 "simple",
		"Mozilla/5.0 (X11)":      `"Mozilla/5.0 (X11)"`,
		"hello\tworld":           `"hello world"`,
		"hello\nworld":           `"hello world"`,
		`quoted "value"`:         `"quoted \"value\""`,
		`backslash \ value`:      `"backslash \\ value"`,
		"  surrounding spaces  ": `"surrounding spaces"`,
	}
	for input, want := range cases {
		if got := sanitizeLogValue(input); got != want {
			t.Fatalf("sanitizeLogValue(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestRequestOriginPrecedence(t *testing.T) {
	cases := []struct {
		name       string
		remoteAddr string
		xff        string
		xreal      string
		wantIP     string
		wantRemote string
	}{
		{name: "xff wins", remoteAddr: "198.51.100.10:12345", xff: "203.0.113.7, 198.51.100.10", xreal: "203.0.113.8", wantIP: "203.0.113.7", wantRemote: "198.51.100.10"},
		{name: "xreal fallback", remoteAddr: "198.51.100.10:12345", xreal: "203.0.113.8", wantIP: "203.0.113.8", wantRemote: "198.51.100.10"},
		{name: "remote fallback", remoteAddr: "198.51.100.10:12345", wantIP: "198.51.100.10", wantRemote: "198.51.100.10"},
	}
	for _, tc := range cases {
		req := httptest.NewRequest("GET", "/api/me", nil)
		req.RemoteAddr = tc.remoteAddr
		if tc.xff != "" {
			req.Header.Set("X-Forwarded-For", tc.xff)
		}
		if tc.xreal != "" {
			req.Header.Set("X-Real-IP", tc.xreal)
		}
		got := requestOrigin(req)
		if got.IP != tc.wantIP || got.Remote != tc.wantRemote {
			t.Fatalf("%s: origin = %+v, want ip=%s remote=%s", tc.name, got, tc.wantIP, tc.wantRemote)
		}
	}
}

func TestRequestLogOmitsGeoFieldsWhenUnavailable(t *testing.T) {
	logs := captureLogs(t)
	db := newTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg','fam','A','Parent',?)`, now)
	token, _ := createSession(db, "cg", "fam")
	mux := newRouter(db, newHub(), "", Config{})

	req := httptest.NewRequest("GET", "/api/me", nil)
	req.RemoteAddr = "198.51.100.10:12345"
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	mux.ServeHTTP(httptest.NewRecorder(), req)

	line := logs.String()
	for _, unexpected := range []string{"geo_country=", "geo_region=", "geo_city="} {
		if strings.Contains(line, unexpected) {
			t.Fatalf("log contained unexpected %q in %q", unexpected, line)
		}
	}
}

func TestLogRequestOrdersFieldsForScanning(t *testing.T) {
	logs := captureLogs(t)
	prev := currentLogStyle
	currentLogStyle = logStyle{}
	t.Cleanup(func() { currentLogStyle = prev })

	logRequest(requestLogInfo{
		Method:   "GET",
		Path:     "/api/me",
		Status:   http.StatusOK,
		Duration: 82 * time.Millisecond,
		Host:     "hearth.example",
		IP:       "203.0.113.7",
		Remote:   "198.51.100.10",
		Geo:      geoInfo{City: "New York"},
	})

	line := logs.String()
	wantOrder := []string{"request", "method=GET", "status=200", "duration=82ms", "path=/api/me", "ip=203.0.113.7", "remote=198.51.100.10", "host=hearth.example", `geo_city="New York"`}
	last := -1
	for _, want := range wantOrder {
		idx := strings.Index(line, want)
		if idx < 0 {
			t.Fatalf("log missing %q in %q", want, line)
		}
		if idx <= last {
			t.Fatalf("%q appeared out of order in %q", want, line)
		}
		last = idx
	}
	if strings.Contains(line, `geo_city="\"New York\""`) {
		t.Fatalf("geo city was double-sanitized in %q", line)
	}
}

func TestLogStyleColorsOnlyWhenEnabled(t *testing.T) {
	plain := logStyle{}
	if got := plain.status(http.StatusInternalServerError); got != "status=500" {
		t.Fatalf("plain status = %q", got)
	}
	if got := plain.event("auth"); got != "auth" {
		t.Fatalf("plain event = %q", got)
	}

	colored := logStyle{enabled: true}
	if got := colored.status(http.StatusOK); got != "\x1b[32mstatus=200\x1b[0m" {
		t.Fatalf("colored 200 = %q", got)
	}
	if got := colored.status(http.StatusNotFound); got != "\x1b[33mstatus=404\x1b[0m" {
		t.Fatalf("colored 404 = %q", got)
	}
	if got := colored.status(http.StatusInternalServerError); got != "\x1b[31mstatus=500\x1b[0m" {
		t.Fatalf("colored 500 = %q", got)
	}
	if got := colored.event("auth"); got != "\x1b[35mauth\x1b[0m" {
		t.Fatalf("colored auth = %q", got)
	}
}
