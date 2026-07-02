package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
	for _, want := range []string{"VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "go run github.com/SherClockHolmes/webpush-go"} {
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
