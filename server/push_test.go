package server

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
	for _, want := range []string{"VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "go run ./cmd/vapidgen"} {
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

func TestParseReminderSettingsAcceptsLeadAsNumericString(t *testing.T) {
	// Real Profile UI used to send settings.reminders.lead as a DOM string
	// ("30"), which json.Unmarshal silently dropped into the zero value
	// because the field is float64. parseReminderSettings now coerces valid
	// numeric strings to their float equivalent; this test pins that path
	// so a regression in the regex/extraction step is caught before it
	// reaches scheduling. Unparseable values must still fall back to 0
	// (the safe "no lead" default), never zero out other fields.
	if r := parseReminderSettings(`{"lead":"30"}`); r.Lead != 30 {
		t.Fatalf("numeric-string lead = %v, want 30", r.Lead)
	}
	if r := parseReminderSettings(`{"lead":"0"}`); r.Lead != 0 {
		t.Fatalf("numeric-string zero lead = %v, want 0", r.Lead)
	}
	if r := parseReminderSettings(`{"lead":"12.5"}`); r.Lead != 12.5 {
		t.Fatalf("numeric-string fractional lead = %v, want 12.5", r.Lead)
	}
	if r := parseReminderSettings(`{"lead":"abc"}`); r.Lead != 0 {
		t.Fatalf("unparseable lead = %v, want 0 (safe default)", r.Lead)
	}
	// A non-string lead (number, null) must keep working unchanged.
	if r := parseReminderSettings(`{"lead":30}`); r.Lead != 30 {
		t.Fatalf("numeric lead = %v, want 30", r.Lead)
	}
	if r := parseReminderSettings(`{"lead":null}`); r.Lead != 0 {
		t.Fatalf("null lead = %v, want 0", r.Lead)
	}
	// A non-lead garbage string must not poison the rest of the struct.
	r := parseReminderSettings(`{"lead":"abc","bottle":false}`)
	if r.Bottle {
		t.Fatalf("other fields should survive a non-numeric lead: %+v", r)
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

func TestFamilyRemindersSkipsAsNeededMedicine(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	// everyH omitted entirely, matching what a client sends for an as-needed
	// medicine (no recurring interval), not just zeroed out.
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, ?, '{}', ?, '{}', ?)`,
		"fam1",
		`[{"id":"m1","name":"Ibuprofen","dose":"5","unit":"ml"}]`,
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
	for _, r := range reminders {
		if strings.HasPrefix(r.Key, "med-") {
			t.Fatalf("as-needed medicine should not schedule a reminder, got %+v", r)
		}
	}
}

func TestFamilyRemindersIncludesHygieneOutsideQuietHours(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, hygiene_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', ?, '{}', ?, '{}', ?)`,
		"fam1",
		`[{"id":"h1","name":"Nail trim","everyH":1}]`,
		`{"bottle":false,"meds":false,"hygiene":true,"quietStart":"00:00","quietEnd":"00:00"}`,
		now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('hyg1', 'fam1', 'hygiene', ?, '{"itemId":"h1"}', 'cg1', ?)`,
		time.Now().UTC().Add(-2*time.Hour).Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	var found bool
	for _, r := range reminders {
		if r.Key == "hyg-h1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a hygiene reminder, got %+v", reminders)
	}
}

func TestFamilyRemindersSkipsHygieneDuringQuietHours(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, hygiene_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', ?, '{}', ?, '{}', ?)`,
		"fam1",
		`[{"id":"h1","name":"Nail trim","everyH":1}]`,
		`{"bottle":false,"meds":false,"hygiene":true,"quietStart":"00:00","quietEnd":"23:59"}`,
		now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('hyg1', 'fam1', 'hygiene', ?, '{"itemId":"h1"}', 'cg1', ?)`,
		time.Now().UTC().Add(-2*time.Hour).Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	for _, r := range reminders {
		if r.Key == "hyg-h1" {
			t.Fatalf("hygiene reminder should be suppressed during quiet hours (00:00-23:59 is always quiet), got %+v", r)
		}
	}
}

func TestFamilyRemindersIncludesGenericConfiguredType(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, ?, ?)`,
		"fam1",
		`{"bottle":false,"meds":false,"quietStart":"00:00","quietEnd":"00:00"}`,
		`{"bottle":true,"medicine":true,"order":["bottle","medicine"],"intervals":{"play":2}}`,
		now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('p1', 'fam1', 'play', ?, '{}', 'cg1', ?)`,
		time.Now().UTC().Add(-3*time.Hour).Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	var found bool
	for _, r := range reminders {
		if r.Key == "play" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a generic 'play' reminder, got %+v", reminders)
	}
}

func TestFamilyRemindersSkipsGenericTypeDuringQuietHours(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, ?, ?)`,
		"fam1",
		`{"bottle":false,"meds":false,"quietStart":"00:00","quietEnd":"23:59"}`,
		`{"bottle":true,"medicine":true,"order":["bottle","medicine"],"intervals":{"play":2}}`,
		now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('p1', 'fam1', 'play', ?, '{}', 'cg1', ?)`,
		time.Now().UTC().Add(-3*time.Hour).Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	for _, r := range reminders {
		if r.Key == "play" {
			t.Fatalf("generic 'play' reminder should be suppressed during quiet hours (00:00-23:59 is always quiet), got %+v", r)
		}
	}
}

func TestFamilyRemindersNeverDuplicatesBottleMedicineHygieneFromIntervals(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	// Defensive case: intervals somehow contains 'medicine' (shouldn't happen via the
	// UI, but the server must not double-schedule if it ever does).
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, ?, '{}', ?, ?, ?)`,
		"fam1",
		`[{"id":"m1","name":"Vitamin D","dose":"1","unit":"drop","everyH":24}]`,
		`{"bottle":false,"meds":true,"quietStart":"00:00","quietEnd":"00:00"}`,
		`{"bottle":true,"medicine":true,"order":["bottle","medicine"],"intervals":{"medicine":6}}`,
		now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('med1', 'fam1', 'medicine', ?, '{"medId":"m1"}', 'cg1', ?)`,
		time.Now().UTC().Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	var medCount int
	for _, r := range reminders {
		if r.Key == "med-m1" || r.Key == "medicine" {
			medCount++
		}
	}
	if medCount != 1 {
		t.Fatalf("expected exactly one medicine-derived reminder (from meds_json, not duplicated via intervals), got %d: %+v", medCount, reminders)
	}
}

func TestFamilyRemindersSkipsHiddenGenericCard(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, ?, ?)`,
		"fam1",
		`{"bottle":false,"meds":false,"quietStart":"00:00","quietEnd":"00:00"}`,
		`{"bottle":true,"medicine":true,"order":["bottle","medicine"],"intervals":{"play":2},"play":false}`,
		now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('p1', 'fam1', 'play', ?, '{}', 'cg1', ?)`,
		time.Now().UTC().Add(-3*time.Hour).Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	for _, r := range reminders {
		if r.Key == "play" {
			t.Fatalf("hidden card 'play' should not produce a reminder, got %+v", r)
		}
	}
}

func TestFamilyRemindersIgnoresEmptyStringIntervalKeyWithoutPanicking(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, ?, ?)`,
		"fam1",
		`{"bottle":false,"meds":false,"quietStart":"00:00","quietEnd":"00:00"}`,
		`{"bottle":true,"medicine":true,"order":["bottle","medicine"],"intervals":{"":2}}`,
		now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('e1', 'fam1', '', ?, '{}', 'cg1', ?)`,
		time.Now().UTC().Add(-3*time.Hour).Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	if _, err := s.familyReminders("fam1"); err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
}

func TestFamilyRemindersSkippedDuringOngoingAway(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, '{}', ?)`,
		"fam1",
		`{"bottle":true,"meds":true,"quietStart":"00:00","quietEnd":"00:00"}`,
		now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	// a bottle logged 3h ago is due now under the 3h interval
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b1', 'fam1', 'bottle', ?, '{}', 'cg1', ?)`,
		time.Now().Add(-3*time.Hour).UTC().Format(time.RFC3339Nano), now)
	// an away block started an hour ago, still ongoing (no end in the payload)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('a1', 'fam1', 'away', ?, '{}', 'cg1', ?)`,
		time.Now().Add(-1*time.Hour).UTC().Format(time.RFC3339Nano), now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	if len(reminders) != 0 {
		t.Fatalf("expected no reminders during an ongoing away block, got %+v", reminders)
	}
}

func TestFamilyRemindersResumeAfterAwayEnds(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, '{}', ?)`,
		"fam1",
		`{"bottle":true,"meds":true,"quietStart":"00:00","quietEnd":"00:00"}`,
		now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b1', 'fam1', 'bottle', ?, '{}', 'cg1', ?)`,
		time.Now().Add(-3*time.Hour).UTC().Format(time.RFC3339Nano), now)
	// a past away block that already ended
	awayEnd := time.Now().Add(-4 * time.Hour).UTC().Format(time.RFC3339Nano)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('a1', 'fam1', 'away', ?, ?, 'cg1', ?)`,
		time.Now().Add(-5*time.Hour).UTC().Format(time.RFC3339Nano),
		`{"end":"`+awayEnd+`"}`,
		now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	var foundBottle bool
	for _, r := range reminders {
		if r.Key == "bottle" {
			foundBottle = true
		}
	}
	if !foundBottle {
		t.Fatalf("expected a bottle reminder once the away block has ended, got %+v", reminders)
	}
}

func TestFamilyRemindersAppliesLeadTime(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, '{}', ?)`,
		"fam1",
		`{"bottle":true,"meds":false,"hygiene":false,"lead":30,"quietStart":"00:00","quietEnd":"00:00"}`,
		now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b1', 'fam1', 'bottle', ?, '{}', 'cg1', ?)`,
		time.Now().Add(-3*time.Hour).UTC().Format(time.RFC3339Nano), now)

	s := newPushScheduler(db)
	raw, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	var bottle pushReminder
	for _, r := range raw {
		if r.Key == "bottle" {
			bottle = r
		}
	}
	if bottle.LeadTitle == "" {
		t.Fatalf("expected a lead-phrased title on the raw bottle reminder, got %+v", bottle)
	}

	resolved := s.resolveScheduled("fam1", raw)
	var fireAt time.Time
	var found bool
	for _, r := range resolved {
		if r.Key == "bottle" {
			fireAt, found = r.At, true
		}
	}
	if !found {
		t.Fatalf("expected a scheduled bottle reminder, got %+v", resolved)
	}
	wantFireAt := bottle.At.Add(-30 * time.Minute)
	if !fireAt.Equal(wantFireAt) {
		t.Fatalf("expected fireAt %v (due minus 30min lead), got %v", wantFireAt, fireAt)
	}
}

func TestFamilyRemindersAppliesLeadTimeFromNumericString(t *testing.T) {
	// Regression for the "lead silently dropped when sent as a JSON string"
	// bug: the Profile "Remind me before" segmented control historically
	// serialized settings.reminders.lead as a string ("30"), reminderSettings
	// is float64, and the main json.Unmarshal discarded the type-mismatch
	// error, leaving Lead at 0. parseReminderSettings now coerces a valid
	// numeric string to its float equivalent; this test exercises the
	// end-to-end fire time, not just the field value, so a client that
	// hasn't picked up the JS-side Number() coercion still gets the lead.
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, '{}', ?)`,
		"fam1",
		`{"bottle":true,"meds":false,"hygiene":false,"lead":"30","quietStart":"00:00","quietEnd":"00:00"}`,
		now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b1', 'fam1', 'bottle', ?, '{}', 'cg1', ?)`,
		time.Now().Add(-3*time.Hour).UTC().Format(time.RFC3339Nano), now)

	s := newPushScheduler(db)
	raw, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	var bottle pushReminder
	for _, r := range raw {
		if r.Key == "bottle" {
			bottle = r
		}
	}
	if bottle.LeadTitle == "" {
		t.Fatalf("expected a lead-phrased title even when lead was sent as a numeric string, got %+v", bottle)
	}

	resolved := s.resolveScheduled("fam1", raw)
	var fireAt time.Time
	var found bool
	for _, r := range resolved {
		if r.Key == "bottle" {
			fireAt, found = r.At, true
		}
	}
	if !found {
		t.Fatalf("expected a scheduled bottle reminder, got %+v", resolved)
	}
	wantFireAt := bottle.At.Add(-30 * time.Minute)
	if !fireAt.Equal(wantFireAt) {
		t.Fatalf("expected fireAt %v (due minus 30min lead from a numeric-string lead), got %v", wantFireAt, fireAt)
	}
}

func TestResolveScheduledSkipsLeadForGenericCardsWithoutLeadCopy(t *testing.T) {
	// Regression: resolveScheduled historically applied a single shared
	// `lead` duration to every reminder in raw, including the generic
	// per-card "X due" reminders that familyReminders() never pairs with
	// LeadTitle/LeadBody (diaper, play, pump, etc. — anything not bottle/
	// meds/hygiene). With a nonzero lead setting that meant a generic
	// card fired early (at due - lead) while still advertising its normal
	// "X due" copy, i.e. a premature, mislabeled notification for reminder
	// types the plan never scoped lead-time to. Per-reminder lead must be
	// 0 when LeadTitle is empty, regardless of settings.Lead.
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, ?, ?)`,
		"fam1",
		`{"bottle":true,"meds":true,"hygiene":true,"lead":30,"quietStart":"00:00","quietEnd":"00:00"}`,
		// "play" is the simplest non-excluded card type that familyReminders
		// produces a generic "Play due" reminder for (no LeadTitle).
		`{"bottle":true,"medicine":true,"order":["bottle","medicine"],"intervals":{"play":2}}`,
		now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	// a play entry 3h ago on a 2h interval → due in 1h from the log time
	// (so the reminder is unambiguously future — easy to compare against).
	playStart := time.Now().Add(-3 * time.Hour).UTC().Format(time.RFC3339Nano)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('p1', 'fam1', 'play', ?, '{}', 'cg1', ?)`,
		playStart, now)

	s := newPushScheduler(db)
	raw, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	var play pushReminder
	for _, r := range raw {
		if r.Key == "play" {
			play = r
		}
	}
	if play.Key == "" {
		t.Fatalf("expected a generic 'play' reminder in raw, got %+v", raw)
	}
	if play.LeadTitle != "" {
		t.Fatalf("generic play reminder must not carry LeadTitle (that's the whole point of the fix), got %+v", play)
	}

	resolved := s.resolveScheduled("fam1", raw)
	var fireAt time.Time
	var found bool
	for _, r := range resolved {
		if r.Key == "play" {
			fireAt, found = r.At, true
		}
	}
	if !found {
		t.Fatalf("expected a scheduled play reminder, got %+v", resolved)
	}
	if !fireAt.Equal(play.At) {
		t.Fatalf("generic 'play' reminder should fire at its exact due time (no lead applied), got fireAt=%v want=%v", fireAt, play.At)
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

func TestBackoffFireAtSchedule(t *testing.T) {
	due := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	cases := []struct {
		stage int
		lead  time.Duration
		want  time.Time
		ok    bool
	}{
		{0, 0, due, true},
		{0, 30 * time.Minute, due.Add(-30 * time.Minute), true},
		{1, 30 * time.Minute, due.Add(15 * time.Minute), true}, // backoff retries ignore lead
		{1, 0, due.Add(15 * time.Minute), true},
		{2, 0, due.Add(75 * time.Minute), true},
		{3, 0, time.Time{}, false},
		{4, 0, time.Time{}, false},
	}
	for _, c := range cases {
		got, ok := backoffFireAt(due, c.stage, c.lead)
		if ok != c.ok || (ok && !got.Equal(c.want)) {
			t.Errorf("backoffFireAt(due, %d, %v) = (%v, %v), want (%v, %v)", c.stage, c.lead, got, ok, c.want, c.ok)
		}
	}
}

func TestResolveScheduledFirstSeenFiresAtDue(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO settings (family_id, reminders_json, updated_at) VALUES ('fam1', '{"quietStart":"00:00","quietEnd":"00:00"}', ?)`, nowISO())
	s := newPushScheduler(db)
	due := time.Now().UTC().Add(-time.Hour)
	raw := []pushReminder{{Key: "bottle", Title: "Bottle due", Body: "b", At: due}}

	out := s.resolveScheduled("fam1", raw)

	if len(out) != 1 || !out[0].At.Equal(due) || !out[0].DueAt.Equal(due) {
		t.Fatalf("resolveScheduled first-seen = %+v, want At=DueAt=%v", out, due)
	}
	var stage int
	var storedDue string
	db.QueryRow(`SELECT stage, due_at FROM push_reminder_state WHERE family_id = 'fam1' AND reminder_key = 'bottle'`).Scan(&stage, &storedDue)
	if stage != 0 || storedDue != due.UTC().Format(time.RFC3339Nano) {
		t.Fatalf("persisted state = stage=%d due=%s, want stage=0 due=%s", stage, storedDue, due.UTC().Format(time.RFC3339Nano))
	}
}

func TestResolveScheduledAfterSendMovesToPlus15(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO settings (family_id, reminders_json, updated_at) VALUES ('fam1', '{"quietStart":"00:00","quietEnd":"00:00"}', ?)`, nowISO())
	s := newPushScheduler(db)
	due := time.Now().UTC().Add(-time.Hour)
	raw := []pushReminder{{Key: "bottle", Title: "Bottle due", Body: "b", At: due}}

	first := s.resolveScheduled("fam1", raw)
	s.advanceStage("fam1", first[0])

	second := s.resolveScheduled("fam1", raw)

	if len(second) != 1 || !second[0].At.Equal(due.Add(15*time.Minute)) {
		t.Fatalf("resolveScheduled after one send = %+v, want At=%v", second, due.Add(15*time.Minute))
	}
}

func TestResolveScheduledStopsAfterThirdSend(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO settings (family_id, reminders_json, updated_at) VALUES ('fam1', '{"quietStart":"00:00","quietEnd":"00:00"}', ?)`, nowISO())
	s := newPushScheduler(db)
	due := time.Now().UTC().Add(-time.Hour)
	raw := []pushReminder{{Key: "bottle", Title: "Bottle due", Body: "b", At: due}}

	out := s.resolveScheduled("fam1", raw)
	s.advanceStage("fam1", out[0])
	out = s.resolveScheduled("fam1", raw)
	s.advanceStage("fam1", out[0])
	out = s.resolveScheduled("fam1", raw)
	s.advanceStage("fam1", out[0])

	final := s.resolveScheduled("fam1", raw)
	if len(final) != 0 {
		t.Fatalf("expected no more reminders after 3 sends, got %+v", final)
	}
}

func TestResolveScheduledResetsWhenDueTimeChanges(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO settings (family_id, reminders_json, updated_at) VALUES ('fam1', '{"quietStart":"00:00","quietEnd":"00:00"}', ?)`, nowISO())
	s := newPushScheduler(db)
	due := time.Now().UTC().Add(-time.Hour)
	raw := []pushReminder{{Key: "bottle", Title: "Bottle due", Body: "b", At: due}}

	out := s.resolveScheduled("fam1", raw)
	s.advanceStage("fam1", out[0])
	out = s.resolveScheduled("fam1", raw)
	s.advanceStage("fam1", out[0])

	newDue := time.Now().UTC().Add(2 * time.Hour)
	rawUpdated := []pushReminder{{Key: "bottle", Title: "Bottle due", Body: "b", At: newDue}}
	reset := s.resolveScheduled("fam1", rawUpdated)

	if len(reset) != 1 || !reset[0].At.Equal(newDue) {
		t.Fatalf("resolveScheduled after due-time change = %+v, want a fresh stage-0 reminder at %v", reset, newDue)
	}
	var stage int
	db.QueryRow(`SELECT stage FROM push_reminder_state WHERE family_id = 'fam1' AND reminder_key = 'bottle'`).Scan(&stage)
	if stage != 0 {
		t.Fatalf("stage after due-time change = %d, want 0 (reset)", stage)
	}
}

func TestResolveScheduledDropsBackoffRetryDuringQuietHours(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	// Quiet 20:00-07:00. due is 19:50, so stage 0 fires fine, but the
	// +15m backoff retry at 20:05 lands inside quiet hours and must be
	// dropped rather than buzzing the parent's phone overnight.
	due := time.Date(2026, 7, 4, 19, 50, 0, 0, time.UTC)
	db.Exec(`INSERT INTO settings (family_id, reminders_json, updated_at) VALUES ('fam1', '{"quietStart":"20:00","quietEnd":"07:00"}', ?)`, nowISO())
	s := newPushScheduler(db)
	raw := []pushReminder{{Key: "bottle", Title: "Bottle due", Body: "b", At: due}}

	first := s.resolveScheduled("fam1", raw)
	if len(first) != 1 {
		t.Fatalf("stage-0 fire at 19:50 should not be quiet-filtered, got %+v", first)
	}
	s.advanceStage("fam1", first[0])

	retry := s.resolveScheduled("fam1", raw)
	if len(retry) != 0 {
		t.Fatalf("expected the 20:05 backoff retry to be dropped for quiet hours, got %+v", retry)
	}
}

func TestScheduleFamilyStableKeyAcrossRepeatedTicksBeforeFire(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', '{"bottle":true,"meds":false,"quietStart":"00:00","quietEnd":"00:00"}', '{}', ?)`, "fam1", now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	// Bottle interval is 3h; logged 1h ago, so it's due 2h from now — the
	// timer never fires during this test, so there's no race with
	// advanceStage() running inside the timer callback (see the
	// TestResolveScheduled* suite above for the actual backoff-stage
	// transitions, which exercise resolveScheduled/advanceStage directly).
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b1', 'fam1', 'bottle', ?, '{}', 'cg1', ?)`,
		time.Now().UTC().Add(-1*time.Hour).Format(time.RFC3339Nano), now)

	s := newPushScheduler(db)
	var keys []string
	for i := 0; i < 3; i++ {
		s.ScheduleFamily("fam1")
		s.mu.Lock()
		var key string
		for k := range s.byFamily["fam1"] {
			key = k
		}
		count := len(s.byFamily["fam1"])
		s.mu.Unlock()
		if count != 1 {
			t.Fatalf("tick %d: expected exactly one pending bottle reminder, got %d", i, count)
		}
		keys = append(keys, key)
	}
	s.mu.Lock()
	for _, sp := range s.pending {
		sp.timer.Stop()
	}
	s.pending = map[string]scheduledPush{}
	s.byFamily = map[string]map[string]bool{}
	s.mu.Unlock()

	for i := 1; i < len(keys); i++ {
		if keys[i] != keys[0] {
			t.Fatalf("tick %d key %q differs from tick 0 key %q; repeated ScheduleFamily calls before the reminder fires must keep scheduling the same fire time", i, keys[i], keys[0])
		}
	}
}
