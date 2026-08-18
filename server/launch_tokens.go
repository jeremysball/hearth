package server

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"time"
)

const launchTokenTTL = 10 * time.Minute

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

// launchPreviewResponse is what the read-only preview endpoint returns:
// enough for the frontend confirmation screen to show "Maya invited you to
// join Baby Olive's family" without giving away anything an attacker
// couldn't already see in a caregiver list, and without consuming the token.
type launchPreviewResponse struct {
	CaregiverName string `json:"caregiverName"`
	BabyName      string `json:"babyName"`
	FamilyID      string `json:"familyId"`
}

// handlePreviewLaunchToken validates a launch token without consuming it,
// and returns the names the frontend needs to render an explicit join
// confirmation. Splitting read (preview) from write (redeem) is the CSRF
// fix: the redeem handler was a side-effecting GET that any cross-origin
// navigation could fire, so the victim had to tap a button to consciously
// complete the join. See js/app.js's init() for the matching confirm UI.
func handlePreviewLaunchToken(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.PathValue("token")

		var caregiverID, familyID, expiresAt string
		var usedAt sql.NullString
		_, err := lookupByToken(db,
			`SELECT token_hash, caregiver_id, family_id, expires_at, used_at FROM launch_tokens WHERE token_hash IN (%s)`,
			token, &caregiverID, &familyID, &expiresAt, &usedAt)
		if err == sql.ErrNoRows {
			http.Error(w, "token not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if usedAt.Valid && usedAt.String != "" {
			http.Error(w, "token already used", http.StatusGone)
			return
		}
		expiry, perr := time.Parse(time.RFC3339Nano, expiresAt)
		if perr != nil || time.Now().UTC().After(expiry) {
			http.Error(w, "token expired", http.StatusGone)
			return
		}

		var caregiverName, babyName string
		if err := db.QueryRow(`SELECT COALESCE(display_name,'') FROM caregivers WHERE id = ?`, caregiverID).Scan(&caregiverName); err != nil && err != sql.ErrNoRows {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if err := db.QueryRow(`SELECT COALESCE(name,'') FROM babies WHERE family_id = ? LIMIT 1`, familyID).Scan(&babyName); err != nil && err != sql.ErrNoRows {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(launchPreviewResponse{
			CaregiverName: caregiverName,
			BabyName:      babyName,
			FamilyID:      familyID,
		})
	}
}

// isCrossOriginPost reports whether r's Origin (falling back to Referer)
// names a host other than r.Host. It only ever returns true when a
// same-origin browser fetch/form POST would carry a header that
// contradicts r.Host — an attacker-controlled page's auto-submitting
// <form method=POST> triggers exactly this, since the browser stamps the
// real Origin regardless of what the form's action URL claims. A request
// with neither header (curl, a non-browser client, or a browser old
// enough to omit both) is allowed through: this endpoint's only other
// guard is the single-use, time-limited token itself, so a same-origin
// check here is defense in depth against the login-CSRF class, not the
// sole line of defense.
func isCrossOriginPost(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		origin = r.Header.Get("Referer")
	}
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return true
	}
	return u.Host != r.Host
}

func handleRedeemLaunchToken(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if isCrossOriginPost(r) {
			http.Error(w, "cross-origin request rejected", http.StatusForbidden)
			return
		}

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
