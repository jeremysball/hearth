package server

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
)

const launchTokenTTL = 10 * time.Minute

// launchPreviewRateLimit bounds how often a single (IP, token) pair can hit
// the preview endpoint. The preview is read-only and unauthenticated: any
// caller with a leaked or guessed valid token can otherwise pull caregiver
// and baby PII from the same still-valid token indefinitely, since preview
// never consumes it. The redeem path doesn't have this exposure because a
// successful redeem marks the token used; preview does not, so it needs its
// own throttle. 20 probes per IP+token per minute is well above any
// reasonable human "did I send this to the right link?" pattern and slow
// enough to make large-scale enumeration obvious in the access log.
const (
	launchPreviewRateLimit  = 20
	launchPreviewRateWindow = time.Minute
)

type createLaunchTokenResponse struct {
	Token  string `json:"token"`
	TTLMin int    `json:"ttlMin"`
}

func handleCreateLaunchToken(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		token := newID()
		expiresAt := time.Now().UTC().Add(launchTokenTTL).Format(time.RFC3339Nano)

		_, err := db.Exec(
			`INSERT INTO launch_tokens (token_hash, caregiver_id, family_id, expires_at) VALUES (?, ?, ?, ?)`,
			hashToken(token), session.CaregiverID, session.FamilyID, expiresAt)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		log.Printf("launch token created: caregiver=%s family=%s", session.CaregiverID, session.FamilyID)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(createLaunchTokenResponse{Token: token, TTLMin: int(launchTokenTTL.Minutes())})
	}
}

// previewRateBucket is a fixed-window counter for a single (IP, token) pair.
// The bucket resets when windowStarted + launchPreviewRateWindow is in the
// past; the next call after that point starts a fresh window.
type previewRateBucket struct {
	count         int
	windowStarted time.Time
}

var (
	previewRateMu      sync.Mutex
	previewRateBuckets = map[string]*previewRateBucket{}
)

// allowPreviewRateLimit reports whether a preview request from ip for the
// given token is within the rate limit. It also lazily evicts expired
// buckets on each call so the map stays bounded by the number of distinct
// (IP, token) pairs seen in the current window.
func allowPreviewRateLimit(ip, token string) bool {
	key := ip + "\x00" + token
	now := time.Now()

	previewRateMu.Lock()
	defer previewRateMu.Unlock()

	// Evict any expired entries encountered along the way. With steady traffic
	// the map stays roughly bounded to the number of unique keys touched
	// inside the current window; with idle traffic it drains to empty.
	for k, b := range previewRateBuckets {
		if now.Sub(b.windowStarted) >= launchPreviewRateWindow {
			delete(previewRateBuckets, k)
		}
	}

	b, ok := previewRateBuckets[key]
	if !ok || now.Sub(b.windowStarted) >= launchPreviewRateWindow {
		previewRateBuckets[key] = &previewRateBucket{count: 1, windowStarted: now}
		return true
	}
	if b.count >= launchPreviewRateLimit {
		return false
	}
	b.count++
	return true
}

// resetPreviewRateLimits clears all rate-limit state. Tests use this between
// cases so a single windowed bucket can't leak between subtests.
func resetPreviewRateLimits() {
	previewRateMu.Lock()
	defer previewRateMu.Unlock()
	previewRateBuckets = map[string]*previewRateBucket{}
}

type previewLaunchTokenResponse struct {
	CaregiverID   string `json:"caregiverId"`
	CaregiverName string `json:"caregiverName"`
	BabyName      string `json:"babyName"`
	FamilyID      string `json:"familyId"`
}

// handlePreviewLaunchToken is the read-only sibling of the redeem handler.
// It returns the caregiver/baby/family identity attached to a still-valid
// launch token so the install-link confirmation screen can show "Maya
// invited you to track Mira" before the user commits. It does NOT consume
// the token or create a session — the user must explicitly POST to redeem
// for that, which closes the redeem-side CSRF exposure.
//
// The two lookups (caregiver name, baby name) run as a single JOIN against
// the launch token row, so a caregiver that is hard-deleted between
// queries can't produce a preview with a blank caregiverName while the
// rest of the response still ships successfully. The baby subquery picks
// a deterministic row via ORDER BY id (created_at is not set on the
// babies table on insert in any current migration, so id is the only
// stable ordering key available).
func handlePreviewLaunchToken(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.PathValue("token")

		// Per-(IP, token) rate limit. A leaked token plus an unguarded preview
		// is a PII enumeration oracle; the redeem handler is single-shot
		// because it consumes the token, but preview is not.
		ip := previewRequestIP(r)
		if !allowPreviewRateLimit(ip, token) {
			http.Error(w, "too many preview requests", http.StatusTooManyRequests)
			return
		}

		var (
			caregiverID, familyID, caregiverName, babyName, expiresAt string
		)
		_, err := lookupByToken(db,
			`SELECT lt.token_hash, lt.expires_at, lt.caregiver_id, lt.family_id,
			        COALESCE(c.display_name, ''),
			        COALESCE((SELECT b.name FROM babies b WHERE b.family_id = lt.family_id ORDER BY b.id ASC LIMIT 1), '')
			 FROM launch_tokens lt
			 LEFT JOIN caregivers c ON c.id = lt.caregiver_id
			 WHERE lt.token_hash IN (%s)`,
			token, &expiresAt, &caregiverID, &familyID, &caregiverName, &babyName)
		if err == sql.ErrNoRows {
			http.Error(w, "token not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		expiry, perr := time.Parse(time.RFC3339Nano, expiresAt)
		if perr != nil || time.Now().UTC().After(expiry) {
			http.Error(w, "token expired", http.StatusGone)
			return
		}

		// Audit the preview the same way the redeem path audits its success:
		// logAuthEvent writes an `auth` line with the same caregiver/family
		// shape, so a future grep for either event lands on the same column
		// layout. The rate limiter already slowed down bulk enumeration, but
		// per-call audit is what makes individual probes recoverable in
		// forensics if the limit is ever lifted or worked around.
		logAuthEvent(r, "launch_preview", SessionInfo{CaregiverID: caregiverID, FamilyID: familyID})

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(previewLaunchTokenResponse{
			CaregiverID:   caregiverID,
			CaregiverName: caregiverName,
			BabyName:      babyName,
			FamilyID:      familyID,
		})
	}
}

// previewRequestIP returns the same IP the access log will record for this
// request. Lives next to the preview handler so the rate-limit key and the
// audit line stay in sync.
func previewRequestIP(r *http.Request) string {
	return requestOrigin(r).IP
}

func handleRedeemLaunchToken(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.PathValue("token")

		var caregiverID, familyID, expiresAt string
		matchedHash, err := lookupByToken(db,
			`SELECT token_hash, caregiver_id, family_id, expires_at FROM launch_tokens WHERE token_hash IN (%s)`,
			token, &caregiverID, &familyID, &expiresAt)
		if err == sql.ErrNoRows {
			http.Error(w, "token not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		expiry, err := time.Parse(time.RFC3339Nano, expiresAt)
		if err != nil || time.Now().UTC().After(expiry) {
			http.Error(w, "token expired", http.StatusGone)
			return
		}

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		// Atomically claim the token and create the session in one transaction.
		res, err := tx.Exec(`UPDATE launch_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`, nowISO(), matchedHash)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "token already used", http.StatusGone)
			return
		}

		sessToken, err := createSession(tx, caregiverID, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		setSessionCookie(w, sessToken)
		log.Printf("launch token redeemed: caregiver=%s family=%s", caregiverID, familyID)
		logAuthEvent(r, "launch_login", SessionInfo{CaregiverID: caregiverID, FamilyID: familyID})

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}
