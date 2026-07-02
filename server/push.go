package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
	db      *sql.DB
	mu      sync.Mutex
	pending map[string]scheduledPush
}

func newPushScheduler(db *sql.DB) *pushScheduler {
	return &pushScheduler{db: db, pending: map[string]scheduledPush{}}
}

func (s *pushScheduler) ScheduleFamily(familyID string) {
	reminders, err := s.familyReminders(familyID)
	if err != nil {
		return
	}
	for _, rem := range reminders {
		key := familyID + ":" + rem.Key + ":" + rem.At.UTC().Format(time.RFC3339Nano)
		delay := time.Until(rem.At)
		if delay < 0 {
			delay = 0
		}
		s.mu.Lock()
		if old, ok := s.pending[key]; ok {
			old.timer.Stop()
		}
		reminder := rem
		s.pending[key] = scheduledPush{timer: time.AfterFunc(delay, func() {
			s.sendFamily(familyID, reminder)
			s.mu.Lock()
			delete(s.pending, key)
			s.mu.Unlock()
		})}
		s.mu.Unlock()
	}
}

func (s *pushScheduler) familyReminders(familyID string) ([]pushReminder, error) {
	var bottleInterval float64
	var medsJSON string
	if err := s.db.QueryRow(`SELECT bottle_interval_h, meds_json FROM settings WHERE family_id = ?`, familyID).Scan(&bottleInterval, &medsJSON); err != nil {
		return nil, err
	}
	reminders := []pushReminder{}
	var lastBottle string
	if err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = 'bottle' AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID).Scan(&lastBottle); err == nil {
		if t, err := time.Parse(time.RFC3339Nano, lastBottle); err == nil {
			reminders = append(reminders, pushReminder{Key: "bottle", Title: "Bottle due", Body: "Time for the next feed.", At: t.Add(time.Duration(bottleInterval * float64(time.Hour)))})
		}
	}
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
	defer rows.Close()
	payload, _ := json.Marshal(map[string]string{"title": rem.Title, "body": rem.Body, "key": rem.Key})
	for rows.Next() {
		var endpoint, p256dh, auth string
		if err := rows.Scan(&endpoint, &p256dh, &auth); err != nil {
			continue
		}
		resp, err := webpush.SendNotification(payload, &webpush.Subscription{Endpoint: endpoint, Keys: webpush.Keys{P256dh: p256dh, Auth: auth}}, &webpush.Options{Subscriber: subject, VAPIDPublicKey: publicKey, VAPIDPrivateKey: privateKey, TTL: 60})
		if resp != nil {
			if resp.StatusCode == http.StatusGone {
				deletePushSubscription(s.db, endpoint)
			}
			resp.Body.Close()
		}
		if err != nil {
			continue
		}
	}
}
