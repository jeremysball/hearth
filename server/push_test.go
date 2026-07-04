package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestValidateVAPIDEnvRequiresAllKeys(t *testing.T) {
	t.Setenv("VAPID_PUBLIC_KEY", "")
	t.Setenv("VAPID_PRIVATE_KEY", "")
	t.Setenv("VAPID_SUBJECT", "")

	err := validateVAPIDEnv()

	if err == nil {
		t.Fatal("validateVAPIDEnv() error = nil, want setup instructions")
	}
	msg := err.Error()
	for _, want := range []string{"VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "cd server && go run ./cmd/vapidgen"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("error %q missing %q", msg, want)
		}
	}
}

func TestValidateVAPIDEnvPassesWithAllKeys(t *testing.T) {
	t.Setenv("VAPID_PUBLIC_KEY", "public")
	t.Setenv("VAPID_PRIVATE_KEY", "private")
	t.Setenv("VAPID_SUBJECT", "mailto:test@example.com")

	if err := validateVAPIDEnv(); err != nil {
		t.Fatalf("validateVAPIDEnv() = %v, want nil", err)
	}
}

func TestVapidSubscriberStripsMailtoPrefixExactlyOnce(t *testing.T) {
	// webpush-go's own JWT builder re-adds "mailto:" to any subscriber that
	// doesn't start with "https:", so a pre-prefixed VAPID_SUBJECT (the
	// documented example format) must come out bare here or Apple's push
	// service 403s every send on a malformed "mailto:mailto:..." sub claim.
	cases := map[string]string{
		"mailto:you@example.com": "you@example.com",
		"you@example.com":        "you@example.com",
		"https://example.com":    "https://example.com",
	}
	for in, want := range cases {
		if got := vapidSubscriber(in); got != want {
			t.Errorf("vapidSubscriber(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHandlePushPublicKeyRequiresEnv(t *testing.T) {
	t.Setenv("VAPID_PUBLIC_KEY", "")
	req := httptest.NewRequest("GET", "/api/push/public-key", nil)
	rec := httptest.NewRecorder()

	handlePushPublicKey()(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

func TestHandlePushSubscribeStoresSubscriptionForSessionCaregiver(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	body := `{"endpoint":"https://push.example/sub1","keys":{"p256dh":"p256dh-key","auth":"auth-key"}}`
	req := httptest.NewRequest("POST", "/api/push/subscribe", bytes.NewBufferString(body))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handlePushSubscribe(db)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var caregiverID, endpoint, p256dh, auth string
	db.QueryRow(`SELECT caregiver_id, endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = 'https://push.example/sub1'`).Scan(&caregiverID, &endpoint, &p256dh, &auth)
	if caregiverID != "cg1" || endpoint == "" || p256dh != "p256dh-key" || auth != "auth-key" {
		t.Fatalf("subscription = caregiver=%q endpoint=%q p256dh=%q auth=%q", caregiverID, endpoint, p256dh, auth)
	}
}

func TestDeletePushSubscriptionRemovesEndpoint(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	db.Exec(`INSERT INTO push_subscriptions (id, caregiver_id, endpoint, p256dh, auth, created_at) VALUES ('sub1', 'cg1', 'https://push.example/dead', 'p', 'a', ?)`, now)

	if err := deletePushSubscription(db, "https://push.example/dead"); err != nil {
		t.Fatalf("delete subscription: %v", err)
	}
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM push_subscriptions WHERE endpoint = 'https://push.example/dead'`).Scan(&count)
	if count != 0 {
		t.Fatalf("subscription count = %d, want 0", count)
	}
}

func TestParseReminderSettingsDefaults(t *testing.T) {
	r := parseReminderSettings("")
	if !r.Bottle || !r.Meds || r.QuietStart != "20:00" || r.QuietEnd != "07:00" {
		t.Fatalf("defaults wrong: %+v", r)
	}
	r = parseReminderSettings(`{"bottle":false,"meds":true,"quietStart":"22:00","quietEnd":"06:00"}`)
	if r.Bottle || !r.Meds || r.QuietStart != "22:00" || r.QuietEnd != "06:00" {
		t.Fatalf("parsed wrong: %+v", r)
	}
	r = parseReminderSettings(`{"bottle":true}`)
	if r.QuietStart != "20:00" || r.QuietEnd != "07:00" {
		t.Fatalf("missing quiet fields should fall back to defaults: %+v", r)
	}
}

func TestIsQuietAt(t *testing.T) {
	cases := []struct {
		at         string
		start, end string
		want       bool
	}{
		{"2026-07-02T22:30:00Z", "20:00", "07:00", true},  // overnight, in window
		{"2026-07-02T12:00:00Z", "20:00", "07:00", false}, // midday
		{"2026-07-02T06:00:00Z", "20:00", "07:00", true},  // overnight, still in
		{"2026-07-02T07:00:00Z", "20:00", "07:00", false}, // edge: end exclusive
		{"2026-07-02T13:30:00Z", "13:00", "14:00", true},  // same-day window
		{"2026-07-02T14:00:00Z", "13:00", "14:00", false}, // edge: end exclusive
		{"2026-07-02T22:30:00Z", "00:00", "00:00", false}, // empty window
	}
	for _, c := range cases {
		at, _ := time.Parse(time.RFC3339Nano, c.at)
		if got := isQuietAt(at, c.start, c.end); got != c.want {
			t.Errorf("isQuietAt(%s, %s, %s) = %v, want %v", c.at, c.start, c.end, got, c.want)
		}
	}
}

func TestFamilyRemindersHonorsBottleDisabledAndQuietHours(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, '{}', ?)`,
		"fam1",
		`{"bottle":false,"meds":true,"quietStart":"00:00","quietEnd":"23:59"}`,
		now)
	// log a bottle whose due time falls inside the (wide) quiet window
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b1', 'fam1', 'bottle', ?, '{}', 'cg1', ?)`,
		time.Now().UTC().Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	for _, r := range reminders {
		if r.Key == "bottle" {
			t.Fatalf("bottle reminder should be skipped when bottle=false, got %+v", r)
		}
	}
}

func TestFamilyRemindersIncludesMedDuringQuietHours(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, ?, '{}', ?, '{}', ?)`,
		"fam1",
		`[{"id":"m1","name":"Vitamin D","dose":"1","unit":"drop","everyH":24}]`,
		`{"bottle":false,"meds":true,"quietStart":"00:00","quietEnd":"23:59"}`,
		now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('med1', 'fam1', 'medicine', ?, '{"medId":"m1"}', 'cg1', ?)`,
		time.Now().UTC().Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	var foundMed bool
	for _, r := range reminders {
		if strings.HasPrefix(r.Key, "med-") {
			foundMed = true
		}
		if r.Key == "bottle" {
			t.Errorf("bottle reminder should be skipped when bottle=false")
		}
	}
	if !foundMed {
		t.Fatalf("expected a medicine reminder despite quiet hours, got %+v", reminders)
	}
}

func TestScheduleAllEnumeratesAllFamilies(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	for _, fam := range []string{"famA", "famB"} {
		db.Exec(`INSERT INTO families (id, created_at) VALUES (?, ?)`, fam, now)
		db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', '{"bottle":true,"meds":false,"quietStart":"00:00","quietEnd":"00:00"}', '{}', ?)`, fam, now)
		db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES (?, ?, 'Maya', 'Parent', ?)`, "cg_"+fam, fam, now)
		db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES (?, ?, 'bottle', ?, '{}', ?, ?)`,
			"b_"+fam, fam, time.Now().UTC().Format(time.RFC3339Nano), "cg_"+fam, now)
	}
	s := newPushScheduler(db)
	s.ScheduleAll()
	s.mu.Lock()
	gotA := len(s.byFamily["famA"]) > 0
	gotB := len(s.byFamily["famB"]) > 0
	for _, sp := range s.pending {
		sp.timer.Stop()
	}
	s.mu.Unlock()
	if !gotA || !gotB {
		t.Fatalf("ScheduleAll should arm both families, got famA=%v famB=%v", gotA, gotB)
	}
}

func TestScheduleFamilyReplacesStaleTimers(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', '{"bottle":true,"meds":false,"quietStart":"00:00","quietEnd":"00:00"}', '{}', ?)`, "fam1", now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b1', 'fam1', 'bottle', ?, '{}', 'cg1', ?)`,
		time.Now().UTC().Add(-2*time.Hour).Format(time.RFC3339Nano), now)

	s := newPushScheduler(db)
	s.ScheduleFamily("fam1")
	s.mu.Lock()
	firstCount := len(s.byFamily["fam1"])
	s.mu.Unlock()
	if firstCount == 0 {
		t.Fatalf("expected at least one scheduled push after first call")
	}
	// re-schedule: a new bottle entry changes the due time
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b2', 'fam1', 'bottle', ?, '{}', 'cg1', ?)`,
		time.Now().UTC().Format(time.RFC3339Nano), now)
	s.ScheduleFamily("fam1")
	// stop timers without firing so they don't outlive the test
	s.mu.Lock()
	for _, sp := range s.pending {
		sp.timer.Stop()
	}
	s.pending = map[string]scheduledPush{}
	s.byFamily = map[string]map[string]bool{}
	s.mu.Unlock()
}
