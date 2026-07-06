package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type pushSubscriptionRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256DH string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

func validateVAPIDEnv() error {
	missing := []string{}
	for _, key := range []string{"VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"} {
		if os.Getenv(key) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	return fmt.Errorf("web push is not configured: missing %s. Generate VAPID keys with: cd server && go run ./cmd/vapidgen. Then set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT (for example, mailto:you@example.com) before starting Hearth", strings.Join(missing, ", "))
}

// vapidSubscriber strips a leading "mailto:" so webpush-go doesn't double it:
// the library prepends "mailto:" to any Subscriber that isn't already an
// "https:" URL, so passing it a pre-prefixed "mailto:x@y.com" produces the
// JWT sub claim "mailto:mailto:x@y.com", which Apple's push service rejects
// with 403 BadJwtToken (Google's FCM tolerates it, so this only broke iOS).
func vapidSubscriber(subject string) string {
	return strings.TrimPrefix(subject, "mailto:")
}

type reminderSettings struct {
	Bottle     bool   `json:"bottle"`
	Meds       bool   `json:"meds"`
	QuietStart string `json:"quietStart"`
	QuietEnd   string `json:"quietEnd"`
}

func defaultReminderSettings() reminderSettings {
	return reminderSettings{Bottle: true, Meds: true, QuietStart: "20:00", QuietEnd: "07:00"}
}

func parseReminderSettings(raw string) reminderSettings {
	r := defaultReminderSettings()
	if raw == "" || raw == "null" {
		return r
	}
	json.Unmarshal([]byte(raw), &r)
	if r.QuietStart == "" {
		r.QuietStart = "20:00"
	}
	if r.QuietEnd == "" {
		r.QuietEnd = "07:00"
	}
	return r
}

func parseHHMM(hhmm string) (h, m int) {
	n, err := fmt.Sscanf(hhmm, "%d:%d", &h, &m)
	if err != nil || n < 2 {
		return
	}
	if h < 0 || h > 23 {
		h = 0
	}
	if m < 0 || m > 59 {
		m = 0
	}
	return
}

func isQuietAt(at time.Time, qStart, qEnd string) bool {
	sh, sm := parseHHMM(qStart)
	eh, em := parseHHMM(qEnd)
	s := sh*60 + sm
	e := eh*60 + em
	hour, min, _ := at.Clock()
	atMin := hour*60 + min
	if s > e {
		return atMin >= s || atMin < e
	}
	if s == e {
		return false
	}
	return atMin >= s && atMin < e
}

func handlePushPublicKey() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		publicKey := os.Getenv("VAPID_PUBLIC_KEY")
		if publicKey == "" {
			http.Error(w, "push is not configured", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"publicKey": publicKey})
	}
}

func handlePushSubscribe(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		var body pushSubscriptionRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Endpoint == "" || body.Keys.P256DH == "" || body.Keys.Auth == "" {
			http.Error(w, "invalid subscription", http.StatusBadRequest)
			return
		}
		_, err := db.Exec(`
			INSERT INTO push_subscriptions (id, caregiver_id, endpoint, p256dh, auth, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(endpoint) DO UPDATE SET caregiver_id = excluded.caregiver_id, p256dh = excluded.p256dh, auth = excluded.auth`,
			pushSubscriptionID(body.Endpoint), session.CaregiverID, body.Endpoint, body.Keys.P256DH, body.Keys.Auth, nowISO())
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handlePushTest(pushes *pushScheduler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		pushes.SendTestPush(session.FamilyID, 15*time.Second)
		w.WriteHeader(http.StatusNoContent)
	}
}

func pushSubscriptionID(endpoint string) string {
	sum := sha256.Sum256([]byte(endpoint))
	return hex.EncodeToString(sum[:])
}

func deletePushSubscription(db *sql.DB, endpoint string) error {
	_, err := db.Exec(`DELETE FROM push_subscriptions WHERE endpoint = ?`, endpoint)
	return err
}

type pushReminder struct {
	Key   string
	Title string
	Body  string
	At    time.Time
}

type scheduledPush struct {
	timer *time.Timer
}

type pushScheduler struct {
	db       *sql.DB
	mu       sync.Mutex
	pending  map[string]scheduledPush
	byFamily map[string]map[string]bool
}

func newPushScheduler(db *sql.DB) *pushScheduler {
	return &pushScheduler{db: db, pending: map[string]scheduledPush{}, byFamily: map[string]map[string]bool{}}
}

func (s *pushScheduler) ScheduleFamily(familyID string) {
	reminders, err := s.familyReminders(familyID)
	if err != nil {
		return
	}
	s.mu.Lock()
	for k := range s.byFamily[familyID] {
		if sp, ok := s.pending[k]; ok {
			sp.timer.Stop()
		}
		delete(s.pending, k)
	}
	if s.byFamily[familyID] == nil {
		s.byFamily[familyID] = map[string]bool{}
	}
	for _, rem := range reminders {
		key := familyID + ":" + rem.Key + ":" + rem.At.UTC().Format(time.RFC3339Nano)
		delay := time.Until(rem.At)
		if delay < 0 {
			delay = 0
		}
		s.byFamily[familyID][key] = true
		s.scheduleLocked(familyID, key, rem, delay)
	}
	if len(s.byFamily[familyID]) == 0 {
		delete(s.byFamily, familyID)
	}
	s.mu.Unlock()
}

func (s *pushScheduler) scheduleLocked(familyID, key string, rem pushReminder, delay time.Duration) {
	reminder := rem
	s.pending[key] = scheduledPush{timer: time.AfterFunc(delay, func() {
		s.sendFamily(familyID, reminder)
		s.mu.Lock()
		delete(s.pending, key)
		delete(s.byFamily[familyID], key)
		if len(s.byFamily[familyID]) == 0 {
			delete(s.byFamily, familyID)
		}
		s.mu.Unlock()
	})}
}

// SendTestPush fires a one-off push at the family after delay, bypassing the
// bottle/meds/quiet-hours pipeline. It's a manual QA hook (developer mode)
// for confirming end-to-end delivery, e.g. after locking an iOS phone, and
// isn't tracked in pending/byFamily since it has nothing to reschedule.
func (s *pushScheduler) SendTestPush(familyID string, delay time.Duration) {
	time.AfterFunc(delay, func() {
		s.sendFamily(familyID, pushReminder{Key: "dev-test", Title: "Hearth", Body: "Test push — if you can read this, it worked.", At: time.Now()})
	})
}

func (s *pushScheduler) ScheduleAll() {
	rows, err := s.db.Query(`SELECT id FROM families`)
	if err != nil {
		return
	}
	var familyIDs []string
	for rows.Next() {
		var familyID string
		if err := rows.Scan(&familyID); err != nil {
			continue
		}
		familyIDs = append(familyIDs, familyID)
	}
	rows.Close()
	for _, familyID := range familyIDs {
		s.ScheduleFamily(familyID)
	}
}

func (s *pushScheduler) familyReminders(familyID string) ([]pushReminder, error) {
	var bottleInterval float64
	var medsJSON, remindersJSON string
	if err := s.db.QueryRow(`SELECT bottle_interval_h, meds_json, reminders_json FROM settings WHERE family_id = ?`, familyID).Scan(&bottleInterval, &medsJSON, &remindersJSON); err != nil {
		return nil, err
	}
	settings := parseReminderSettings(remindersJSON)
	reminders := []pushReminder{}
	if settings.Bottle {
		var lastBottle string
		if err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = 'bottle' AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID).Scan(&lastBottle); err == nil {
			if t, err := time.Parse(time.RFC3339Nano, lastBottle); err == nil {
				at := t.Add(time.Duration(bottleInterval * float64(time.Hour)))
				if !isQuietAt(at, settings.QuietStart, settings.QuietEnd) {
					reminders = append(reminders, pushReminder{Key: "bottle", Title: "Bottle due", Body: "Time for the next feed.", At: at})
				}
			}
		}
	}
	if settings.Meds {
		var meds []struct {
			ID     string  `json:"id"`
			Name   string  `json:"name"`
			Dose   string  `json:"dose"`
			Unit   string  `json:"unit"`
			EveryH float64 `json:"everyH"`
		}
		json.Unmarshal([]byte(medsJSON), &meds)
		for _, med := range meds {
			var lastMed string
			err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = 'medicine' AND json_extract(payload_json, '$.medId') = ? AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID, med.ID).Scan(&lastMed)
			if err != nil {
				continue
			}
			if t, err := time.Parse(time.RFC3339Nano, lastMed); err == nil {
				reminders = append(reminders, pushReminder{Key: "med-" + med.ID, Title: med.Name + " due", Body: med.Dose + med.Unit + " scheduled now.", At: t.Add(time.Duration(med.EveryH * float64(time.Hour)))})
			}
		}
	}
	return reminders, nil
}

func (s *pushScheduler) sendFamily(familyID string, rem pushReminder) {
	privateKey := os.Getenv("VAPID_PRIVATE_KEY")
	publicKey := os.Getenv("VAPID_PUBLIC_KEY")
	subject := os.Getenv("VAPID_SUBJECT")
	if privateKey == "" || publicKey == "" || subject == "" {
		return
	}
	rows, err := s.db.Query(`SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps JOIN caregivers c ON c.id = ps.caregiver_id WHERE c.family_id = ?`, familyID)
	if err != nil {
		return
	}
	type sub struct{ endpoint, p256dh, auth string }
	var subs []sub
	for rows.Next() {
		var endpoint, p256dh, auth string
		if err := rows.Scan(&endpoint, &p256dh, &auth); err != nil {
			continue
		}
		subs = append(subs, sub{endpoint, p256dh, auth})
	}
	rows.Close()
	payload, _ := json.Marshal(map[string]string{"title": rem.Title, "body": rem.Body, "key": rem.Key})
	subscriber := vapidSubscriber(subject)
	for _, su := range subs {
		resp, err := webpush.SendNotification(payload, &webpush.Subscription{Endpoint: su.endpoint, Keys: webpush.Keys{P256dh: su.p256dh, Auth: su.auth}}, &webpush.Options{Subscriber: subscriber, VAPIDPublicKey: publicKey, VAPIDPrivateKey: privateKey, TTL: 86400})
		if resp != nil {
			if resp.StatusCode == http.StatusGone {
				deletePushSubscription(s.db, su.endpoint)
			} else if resp.StatusCode >= 300 {
				body, _ := io.ReadAll(resp.Body)
				log.Printf("push send to %s failed: status %d: %s", su.endpoint, resp.StatusCode, body)
			}
			resp.Body.Close()
		}
		if err != nil {
			log.Printf("push send to %s failed: %v", su.endpoint, err)
			continue
		}
	}
}
