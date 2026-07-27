package server

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
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
	return fmt.Errorf("web push is not configured: missing %s. Generate VAPID keys with: go run ./cmd/vapidgen. Then set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT (for example, mailto:you@example.com) before starting Hearth", strings.Join(missing, ", "))
}

// vapidSubscriber strips a "mailto:" prefix, if present, from the configured
// VAPID_SUBJECT before handing it to webpush-go: that library always adds
// its own "mailto:" prefix unless the subscriber string starts with
// "https:", so a pre-prefixed value produces a malformed "mailto:mailto:..."
// sub claim. Apple's push service validates that claim strictly and 403s
// every send; Google's FCM doesn't validate it, so the bug is invisible
// there and only breaks iOS/Safari push.
func vapidSubscriber(subject string) string {
	if strings.HasPrefix(subject, "https:") {
		return subject
	}
	return strings.TrimPrefix(subject, "mailto:")
}

type reminderSettings struct {
	Bottle     bool    `json:"bottle"`
	Meds       bool    `json:"meds"`
	Hygiene    bool    `json:"hygiene"`
	Lead       float64 `json:"lead"`
	QuietStart string  `json:"quietStart"`
	QuietEnd   string  `json:"quietEnd"`
}

func defaultReminderSettings() reminderSettings {
	return reminderSettings{Bottle: true, Meds: true, Hygiene: true, QuietStart: "20:00", QuietEnd: "07:00"}
}

func parseReminderSettings(raw string) reminderSettings {
	r := defaultReminderSettings()
	if raw == "" || raw == "null" {
		return r
	}
	json.Unmarshal([]byte(raw), &r)
	// Defense in depth: an older cached client state or a future client may
	// serialize settings.reminders.lead as a numeric JSON string ("lead":"30")
	// rather than a JSON number. The main unmarshal above silently drops a
	// string value because the field is a float64 (the type-mismatch error
	// is discarded), so re-extract the raw value and coerce a valid numeric
	// string to its float equivalent. A genuinely unparseable value (e.g.
	// "abc", or a non-numeric string) is left at the default 0 (no lead) —
	// falling back to the safe default is fine, but valid numeric strings
	// must be honored.
	var rawMap map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &rawMap); err == nil {
		if v, ok := rawMap["lead"]; ok {
			var leadStr string
			if json.Unmarshal(v, &leadStr) == nil {
				if parsed, perr := strconv.ParseFloat(leadStr, 64); perr == nil {
					r.Lead = parsed
				}
			}
		}
	}
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
			log.Printf("push: subscribe failed caregiver=%s endpoint=%s: %v", session.CaregiverID, pushEndpointHost(body.Endpoint), err)
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		log.Printf("push: subscribed caregiver=%s endpoint=%s", session.CaregiverID, pushEndpointHost(body.Endpoint))
		w.WriteHeader(http.StatusNoContent)
	}
}

func handlePushTest(pushes *pushScheduler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		log.Printf("push: test push requested family=%s", session.FamilyID)
		pushes.SendTestPush(session.FamilyID, 15*time.Second)
		w.WriteHeader(http.StatusNoContent)
	}
}

func pushSubscriptionID(endpoint string) string {
	sum := sha256.Sum256([]byte(endpoint))
	return hex.EncodeToString(sum[:])
}

// pushEndpointHost returns just the scheme+host of a push endpoint for
// logging, so provider (Apple/FCM) and issues are visible without leaking
// the full subscription token into logs.
func pushEndpointHost(endpoint string) string {
	if i := strings.Index(endpoint, "://"); i != -1 {
		if j := strings.Index(endpoint[i+3:], "/"); j != -1 {
			return endpoint[:i+3+j]
		}
	}
	return endpoint
}

func deletePushSubscription(db *sql.DB, endpoint string) error {
	_, err := db.Exec(`DELETE FROM push_subscriptions WHERE endpoint = ?`, endpoint)
	if err != nil {
		log.Printf("push: failed to delete expired subscription endpoint=%s: %v", pushEndpointHost(endpoint), err)
	} else {
		log.Printf("push: deleted expired subscription endpoint=%s", pushEndpointHost(endpoint))
	}
	return err
}

type pushReminder struct {
	Key       string
	Title     string
	Body      string
	LeadTitle string // shown instead of Title when firing early, via Lead
	LeadBody  string
	At        time.Time // actual fire time — may be delayed past DueAt by backoff, or moved earlier by lead
	DueAt     time.Time // the reminder's true due time; the dedupe key for backoff state
}

// backoffFireAt returns when a reminder at stage should next fire, given its
// due time. Stage 0 = never sent (fire at due-lead, to honor the "remind me
// before" setting), 1 = sent once (fire at due+15m), 2 = sent twice (fire at
// due+75m, i.e. 1h after the +15m send). Backoff retries (stages 1+) ignore
// lead — the user's heads-up already fired, and the retry is now overdue.
// Stage 3+ means it already fired 3 times; ok=false means don't reschedule.
func backoffFireAt(due time.Time, stage int, lead time.Duration) (time.Time, bool) {
	switch stage {
	case 0:
		return due.Add(-lead), true
	case 1:
		return due.Add(15 * time.Minute), true
	case 2:
		return due.Add(75 * time.Minute), true
	default:
		return time.Time{}, false
	}
}

// reminderLead returns the lead duration that should apply to r. Only
// reminders with lead copy (LeadTitle set, populated by familyReminders for
// bottle/meds/hygiene) get the configured lead; a generic card reminder —
// the "X due" catch-alls that familyReminders builds for non-excluded
// card types without any "coming up" copy — must fire at its exact due
// time regardless of the user's "remind me before" setting, otherwise the
// "X due" copy is mislabeled (the user is being told X is due when
// actually they're being told it's due soon and it's not).
func reminderLead(r pushReminder, configured time.Duration) time.Duration {
	if r.LeadTitle == "" {
		return 0
	}
	return configured
}

// resolveScheduled takes familyReminders()'s raw per-key due times and
// applies persisted backoff state: a reminder whose due time hasn't changed
// since it was last seen gets its next backoff fire time (or is dropped
// entirely once fully escalated); a reminder whose due time has moved
// (the activity was logged, or its interval changed) resets to stage 0.
func (s *pushScheduler) resolveScheduled(familyID string, raw []pushReminder) []pushReminder {
	var remindersJSON string
	s.db.QueryRow(`SELECT reminders_json FROM settings WHERE family_id = ?`, familyID).Scan(&remindersJSON)
	settings := parseReminderSettings(remindersJSON)
	lead := time.Duration(settings.Lead * float64(time.Minute))
	out := make([]pushReminder, 0, len(raw))
	for _, r := range raw {
		dueISO := r.At.UTC().Format(time.RFC3339Nano)
		var storedDue string
		var stage int
		err := s.db.QueryRow(`SELECT due_at, stage FROM push_reminder_state WHERE family_id = ? AND reminder_key = ?`, familyID, r.Key).Scan(&storedDue, &stage)
		if err != nil && err != sql.ErrNoRows {
			log.Printf("push: resolveScheduled family=%s key=%s: read state failed: %v", familyID, r.Key, err)
			continue
		}
		if err == sql.ErrNoRows || storedDue != dueISO {
			stage = 0
			if _, execErr := s.db.Exec(`INSERT INTO push_reminder_state (family_id, reminder_key, due_at, stage, last_sent_at) VALUES (?, ?, ?, 0, NULL)
				ON CONFLICT(family_id, reminder_key) DO UPDATE SET due_at = excluded.due_at, stage = 0, last_sent_at = NULL`, familyID, r.Key, dueISO); execErr != nil {
				log.Printf("push: resolveScheduled family=%s key=%s: persist state failed: %v", familyID, r.Key, execErr)
				continue
			}
		}
		fireAt, ok := backoffFireAt(r.At, stage, reminderLead(r, lead))
		if !ok {
			continue
		}
		// A backoff retry (unlike the original due time, already filtered by
		// familyReminders) can land inside quiet hours on its own — e.g. a
		// reminder due at 19:50 retries at 20:05, inside a 20:00 quiet
		// start. Drop it for this tick; the next tick after quiet hours end
		// picks it up at the same stage (delay clamps to 0 for a past fireAt).
		if isQuietAt(fireAt, settings.QuietStart, settings.QuietEnd) {
			continue
		}
		out = append(out, pushReminder{Key: r.Key, Title: r.Title, Body: r.Body, LeadTitle: r.LeadTitle, LeadBody: r.LeadBody, At: fireAt, DueAt: r.At})
	}
	return out
}

// advanceStage records that rem actually fired, incrementing its backoff
// stage. The due_at equality guard makes this a no-op if the underlying
// reminder's due time already moved on (e.g. a newer ScheduleFamily call
// reset it) between when this fire was scheduled and when it ran.
func (s *pushScheduler) advanceStage(familyID string, rem pushReminder) {
	dueISO := rem.DueAt.UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`UPDATE push_reminder_state SET stage = stage + 1, last_sent_at = ? WHERE family_id = ? AND reminder_key = ? AND due_at = ?`,
		nowISO(), familyID, rem.Key, dueISO); err != nil {
		log.Printf("push: advanceStage family=%s key=%s: %v", familyID, rem.Key, err)
	}
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
	raw, err := s.familyReminders(familyID)
	if err != nil {
		log.Printf("push: scheduling family=%s failed: %v", familyID, err)
		return
	}
	reminders := s.resolveScheduled(familyID, raw)
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
	log.Printf("push: scheduled family=%s reminders=%d", familyID, len(reminders))
}

func (s *pushScheduler) scheduleLocked(familyID, key string, rem pushReminder, delay time.Duration) {
	reminder := rem
	s.pending[key] = scheduledPush{timer: time.AfterFunc(delay, func() {
		// advanceStage runs before sendFamily (which does synchronous
		// network I/O per subscription) so a concurrent ScheduleFamily —
		// the 5-min ScheduleAll tick or a log-entry handler racing this
		// fire — sees the new stage immediately instead of re-arming a
		// duplicate send at the same stage while this one is in flight.
		s.advanceStage(familyID, reminder)
		final := reminder
		// Pick lead phrasing at fire time (not earlier): a lead-scheduled fire
		// can still land at or after DueAt in practice (a delayed tick, a
		// resumed process) — in that case the user is being reminded because
		// the activity is now overdue, so the "due" copy is the honest one.
		// If no lead phrasing was configured (LeadTitle empty), the default
		// Title/Body carry through unchanged.
		if final.LeadTitle != "" && time.Now().Before(final.DueAt) {
			final.Title, final.Body = final.LeadTitle, final.LeadBody
		}
		s.sendFamily(familyID, final)
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
		log.Printf("push: ScheduleAll query families failed: %v", err)
		return
	}
	var familyIDs []string
	for rows.Next() {
		var familyID string
		if err := rows.Scan(&familyID); err != nil {
			log.Printf("push: ScheduleAll scan family failed: %v", err)
			continue
		}
		familyIDs = append(familyIDs, familyID)
	}
	if err := rows.Err(); err != nil {
		log.Printf("push: ScheduleAll rows iteration failed: %v", err)
	}
	rows.Close()
	for _, familyID := range familyIDs {
		s.ScheduleFamily(familyID)
	}
}

func (s *pushScheduler) familyReminders(familyID string) ([]pushReminder, error) {
	var bottleInterval float64
	var medsJSON, hygieneJSON, remindersJSON, cardsJSON string
	if err := s.db.QueryRow(`SELECT bottle_interval_h, meds_json, hygiene_json, reminders_json, cards_json FROM settings WHERE family_id = ?`, familyID).Scan(&bottleInterval, &medsJSON, &hygieneJSON, &remindersJSON, &cardsJSON); err != nil {
		return nil, err
	}
	settings := parseReminderSettings(remindersJSON)
	reminders := []pushReminder{}
	var ongoingAwayID string
	err := s.db.QueryRow(`SELECT id FROM log_entries WHERE family_id = ? AND type = 'away' AND deleted_at IS NULL AND json_extract(payload_json, '$.end') IS NULL AND start <= ? ORDER BY start DESC LIMIT 1`,
		familyID, time.Now().UTC().Format(time.RFC3339Nano)).Scan(&ongoingAwayID)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("push: familyReminders family=%s away: read ongoing away failed: %v", familyID, err)
	}
	if err == nil {
		return reminders, nil // ongoing away block: nothing expected to be logged
	}
	if settings.Bottle {
		var lastBottle string
		err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = 'bottle' AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID).Scan(&lastBottle)
		if err != nil && err != sql.ErrNoRows {
			log.Printf("push: familyReminders family=%s bottle: read last feed failed: %v", familyID, err)
		}
		if err == nil {
			if t, err := time.Parse(time.RFC3339Nano, lastBottle); err == nil {
				at := t.Add(time.Duration(bottleInterval * float64(time.Hour)))
				if !isQuietAt(at, settings.QuietStart, settings.QuietEnd) {
					rem := pushReminder{Key: "bottle", Title: "Bottle due", Body: "Time for the next feed.", At: at}
					if settings.Lead > 0 {
						rem.LeadTitle = "Feed coming up"
						rem.LeadBody = fmt.Sprintf("Next feed in about %d min.", int(settings.Lead))
					}
					reminders = append(reminders, rem)
				}
			} else {
				log.Printf("push: familyReminders family=%s bottle: parse start time failed: %v", familyID, err)
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
			if med.EveryH <= 0 { // as-needed medicine: no recurring dose to remind about
				continue
			}
			var lastMed string
			err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = 'medicine' AND json_extract(payload_json, '$.medId') = ? AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID, med.ID).Scan(&lastMed)
			if err != nil && err != sql.ErrNoRows {
				log.Printf("push: familyReminders family=%s med=%s: read last dose failed: %v", familyID, med.ID, err)
			}
			if err != nil {
				continue
			}
			if t, err := time.Parse(time.RFC3339Nano, lastMed); err == nil {
				at := t.Add(time.Duration(med.EveryH * float64(time.Hour)))
				rem := pushReminder{Key: "med-" + med.ID, Title: med.Name + " due", Body: med.Dose + med.Unit + " scheduled now.", At: at}
				if settings.Lead > 0 {
					rem.LeadTitle = med.Name + " coming up"
					rem.LeadBody = fmt.Sprintf("%s%s in about %d min.", med.Dose, med.Unit, int(settings.Lead))
				}
				reminders = append(reminders, rem)
			} else {
				log.Printf("push: familyReminders family=%s med=%s: parse start time failed: %v", familyID, med.ID, err)
			}
		}
	}
	if settings.Hygiene {
		var items []struct {
			ID     string  `json:"id"`
			Name   string  `json:"name"`
			EveryH float64 `json:"everyH"`
		}
		json.Unmarshal([]byte(hygieneJSON), &items)
		for _, it := range items {
			var last string
			err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = 'hygiene' AND json_extract(payload_json, '$.itemId') = ? AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID, it.ID).Scan(&last)
			if err != nil && err != sql.ErrNoRows {
				log.Printf("push: familyReminders family=%s item=%s: read last hygiene failed: %v", familyID, it.ID, err)
			}
			if err != nil {
				continue
			}
			if t, err := time.Parse(time.RFC3339Nano, last); err == nil {
				at := t.Add(time.Duration(it.EveryH * float64(time.Hour)))
				if !isQuietAt(at, settings.QuietStart, settings.QuietEnd) {
					rem := pushReminder{Key: "hyg-" + it.ID, Title: it.Name + " due", Body: it.Name + " is due now.", At: at}
					if settings.Lead > 0 {
						rem.LeadTitle = it.Name + " coming up"
						rem.LeadBody = fmt.Sprintf("%s in about %d min.", it.Name, int(settings.Lead))
					}
					reminders = append(reminders, rem)
				}
			} else {
				log.Printf("push: familyReminders family=%s item=%s: parse start time failed: %v", familyID, it.ID, err)
			}
		}
	}
	var cards struct {
		Intervals map[string]float64 `json:"intervals"`
	}
	json.Unmarshal([]byte(cardsJSON), &cards)
	var cardsRaw map[string]json.RawMessage
	json.Unmarshal([]byte(cardsJSON), &cardsRaw)
	excluded := map[string]bool{"bottle": true, "medicine": true, "hygiene": true}
	for cardType, intervalH := range cards.Intervals {
		if excluded[cardType] || cardType == "" {
			continue
		}
		if raw, ok := cardsRaw[cardType]; ok {
			var visible bool
			if err := json.Unmarshal(raw, &visible); err == nil && !visible {
				continue
			}
		}
		var lastStart string
		err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = ? AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID, cardType).Scan(&lastStart)
		if err != nil && err != sql.ErrNoRows {
			log.Printf("push: familyReminders family=%s card=%s: read last entry failed: %v", familyID, cardType, err)
		}
		if err != nil {
			continue
		}
		t, err := time.Parse(time.RFC3339Nano, lastStart)
		if err != nil {
			log.Printf("push: familyReminders family=%s card=%s: parse start time failed: %v", familyID, cardType, err)
			continue
		}
		at := t.Add(time.Duration(intervalH * float64(time.Hour)))
		if isQuietAt(at, settings.QuietStart, settings.QuietEnd) {
			continue
		}
		title := strings.ToUpper(cardType[:1]) + cardType[1:]
		reminders = append(reminders, pushReminder{Key: cardType, Title: title + " due", Body: "Time to log the next " + cardType + ".", At: at})
	}
	return reminders, nil
}

func (s *pushScheduler) sendFamily(familyID string, rem pushReminder) {
	privateKey := os.Getenv("VAPID_PRIVATE_KEY")
	publicKey := os.Getenv("VAPID_PUBLIC_KEY")
	subject := vapidSubscriber(os.Getenv("VAPID_SUBJECT"))
	if privateKey == "" || publicKey == "" || subject == "" {
		log.Printf("push: send family=%s key=%s skipped: VAPID env not configured", familyID, rem.Key)
		return
	}
	rows, err := s.db.Query(`SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps JOIN caregivers c ON c.id = ps.caregiver_id WHERE c.family_id = ?`, familyID)
	if err != nil {
		log.Printf("push: send family=%s key=%s: query subscriptions failed: %v", familyID, rem.Key, err)
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
	if len(subs) == 0 {
		log.Printf("push: send family=%s key=%s: no subscriptions on file", familyID, rem.Key)
		return
	}
	payload, _ := json.Marshal(map[string]string{"title": rem.Title, "body": rem.Body, "key": rem.Key})
	for _, su := range subs {
		resp, err := webpush.SendNotification(payload, &webpush.Subscription{Endpoint: su.endpoint, Keys: webpush.Keys{P256dh: su.p256dh, Auth: su.auth}}, &webpush.Options{Subscriber: subject, VAPIDPublicKey: publicKey, VAPIDPrivateKey: privateKey, TTL: 86400})
		if err != nil {
			log.Printf("push: send family=%s key=%s endpoint=%s failed: %v", familyID, rem.Key, pushEndpointHost(su.endpoint), err)
			if resp != nil {
				resp.Body.Close()
			}
			continue
		}
		if resp != nil {
			if resp.StatusCode >= 300 {
				log.Printf("push: send family=%s key=%s endpoint=%s got status %d", familyID, rem.Key, pushEndpointHost(su.endpoint), resp.StatusCode)
			} else {
				log.Printf("push: send family=%s key=%s endpoint=%s ok (status %d)", familyID, rem.Key, pushEndpointHost(su.endpoint), resp.StatusCode)
			}
			if resp.StatusCode == http.StatusGone {
				deletePushSubscription(s.db, su.endpoint)
			}
			resp.Body.Close()
		}
	}
}
